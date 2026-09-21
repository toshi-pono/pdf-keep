import { type Message, joinMessages, msg } from "../shared/messages";
import { AppError, errorMessage } from "../shared/errors";
import { TemporaryExport } from "./temporary";
import { inspect, visible, fontsFor } from "./inspect";
import { materializeTruncatedText } from "./truncated-text";
import { outlineTextPDF } from "./outline";
import {
  blocks,
  type ExportBundle,
  type PluginMessage,
  type TextSegment,
  type TextRangeRequest,
  type TextRangeResult,
} from "../shared/protocol";

export function textSegments(node: TextNode): TextSegment[] {
  let offset = 0;
  return node
    .getStyledTextSegments([
      "fontName",
      "fontWeight",
      "fontSize",
      "fills",
      "listOptions",
      "indentation",
      "paragraphIndent",
      "paragraphSpacing",
      "listSpacing",
      "openTypeFeatures",
    ])
    .map((s) => {
      const start = s.start ?? offset,
        end = s.end ?? start + s.characters.length;
      offset = end;
      const paints = s.fills.filter(
        (f) => f.visible !== false && (f.opacity ?? 1) > 0,
      );
      const fallbackReason = paints.some((f) => f.type !== "SOLID")
        ? msg("errors.textFill")
        : paints.length > 1
          ? msg("errors.multipleFills")
          : undefined;
      return {
        start,
        end,
        fills: s.fills,
        fallbackReason,
        invisible: !paints.length,
        font: {
          family: s.fontName.family,
          style: s.fontName.style,
          weight: s.fontWeight,
          italic: /italic|oblique/i.test(s.fontName.style),
          characters: s.characters,
        },
        fontSize: s.fontSize,
        features: { ...s.openTypeFeatures },
        list: s.listOptions?.type ?? "NONE",
        indentation: s.indentation ?? 0,
        paragraphIndent: s.paragraphIndent ?? 0,
        paragraphSpacing: s.paragraphSpacing ?? 0,
        listSpacing: s.listSpacing ?? 0,
      };
    });
}

interface Session {
  id: number;
  range: (request: TextRangeRequest) => Promise<TextRangeResult>;
  finish: () => void;
  touch: () => void;
}
let session: Session | undefined;
export function finishSearchableExport(id: number) {
  if (session?.id === id) session.finish();
}
export async function resolveTextRange(
  id: number,
  requestId: number,
  range: TextRangeRequest,
  send: (m: PluginMessage) => void,
) {
  const active = session;
  if (!active || active.id !== id) return;
  active.touch();
  try {
    const result = await active.range(range);
    if (session === active)
      send({ type: "text-range-result", id, requestId, result });
  } catch (e) {
    if (session === active)
      send({
        type: "text-range-result",
        id,
        requestId,
        error: errorMessage(e),
      });
  }
}

/** Keep an immutable export snapshot alive until the UI finishes its PDF.
 * Lazy range exports never read a changed selection or mutate the user's nodes.
 */
export async function exportSearchableFrame(
  frame: FrameNode,
  id: number,
  scale: number,
  pixelEdge: number | undefined,
  outlineFallback: boolean,
  temporary: TemporaryExport,
  check: () => void,
  send: (m: PluginMessage) => void,
) {
  const wrapper = figma.createFrame();
  temporary.add(wrapper);
  wrapper.name = "PDF Keep temporary export";
  wrapper.resize(frame.width, frame.height);
  wrapper.clipsContent = true;
  wrapper.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  const copy = frame.clone();
  temporary.add(copy);
  wrapper.appendChild(copy);
  copy.relativeTransform = [
    [1, 0, 0],
    [0, 1, 0],
  ];
  const { texts, diagnostics } = inspect(copy);
  const bundle: ExportBundle = {
    protocol: 2,
    outlineFallback,
    id,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    scale,
    mode: "text",
    png: new Uint8Array(),
    texts: [],
  };
  const sources = new Map<string, TextNode>();
  const rangeSVGs = new Map<string, string>();
  const rangePDFs = new Map<string, TextRangeResult>();
  // This clone preserves ancestor compositing for the rare full-layer fallback.
  let pristine: FrameNode | undefined;
  const composition = new Map<string, string>();
  const paths = new Map<SceneNode, string>();
  const visit = (n: SceneNode, path = "") => {
    paths.set(n, path);
    if ("children" in n) n.children.forEach((c, i) => visit(c, `${path}/${i}`));
  };
  visit(copy);
  for (const [index, n] of texts.entries()) {
    check();
    const failures = diagnostics.filter(
      (d) =>
        d.nodeId === n.id &&
        blocks(d, "pdf") &&
        !(
          typeof d.reason !== "string" &&
          d.reason.kind === "message" &&
          [
            "errors.textFill",
            "errors.hiddenOrMultipleFills",
            "errors.figmaFontMissing",
          ].includes(d.reason.key)
        ),
    );
    if (failures.length && !outlineFallback)
      throw new AppError(
        joinMessages(
          [`${n.name}: `, joinMessages(failures.map((d) => d.reason))],
          "",
        ),
      );
    let reason: Message | undefined = failures.length
      ? joinMessages(failures.map((d) => d.reason))
      : undefined;
    const ancestor = failures.some(
      (d) =>
        typeof d.reason !== "string" &&
        d.reason.kind === "message" &&
        [
          "errors.parentOpacity",
          "errors.textMask",
          "errors.siblingMask",
          "errors.clipBoundary",
          "errors.textOutsideFrame",
          "errors.roundedClip",
          "errors.blendMode",
          "errors.effects",
          "errors.parentStroke",
        ].includes(d.reason.key),
    );
    if (ancestor && !pristine) {
      pristine = copy.clone();
      temporary.add(pristine);
      wrapper.appendChild(pristine);
      pristine.opacity = 0;
    }
    const key = String(index);
    if (ancestor) composition.set(key, paths.get(n)!);
    let prepared: TextNode = n;
    if (!reason && n.textTruncation === "ENDING") {
      try {
        prepared = await materializeTruncatedText(
          n,
          wrapper,
          temporary,
          check,
          (stage) =>
            send({
              type: "progress",
              id,
              message: msg("progress.truncatedText", {
                stage,
                name: n.name,
              }),
            }),
        );
      } catch (e) {
        check();
        if (!outlineFallback) throw e;
        reason = errorMessage(e);
      }
    }
    const local = prepared.clone();
    temporary.add(local);
    wrapper.appendChild(local);
    local.relativeTransform = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    local.opacity = 1;
    const segments = textSegments(local);
    let svg = "";
    let measurement: TextNode | undefined;
    try {
      if (!reason) {
        if (segments.some((s) => s.fallbackReason)) {
          measurement = local.clone();
          temporary.add(measurement);
          wrapper.appendChild(measurement);
          for (const s of segments)
            if (s.fallbackReason)
              measurement.setRangeFills(s.start, s.end, [
                { type: "SOLID", color: { r: 0, g: 0, b: 0 } },
              ]);
        }
        svg = await temporary.export(measurement ?? local, {
          format: "SVG_STRING",
          svgOutlineText: false,
          useAbsoluteBounds: true,
          contentsOnly: true,
        });
      }
    } catch (e) {
      check();
      if (!outlineFallback) throw e;
      reason = errorMessage(e);
    }
    if (measurement) {
      temporary.remove(measurement);
    }
    check();
    if (prepared !== n)
      svg = svg.replace(/<svg\b[^>]*>/, (root) =>
        root
          .replace(/\bwidth="[^"]*"/, `width="${n.width}"`)
          .replace(/\bheight="[^"]*"/, `height="${n.height}"`)
          .replace(/\bviewBox="[^"]*"/, `viewBox="0 0 ${n.width} ${n.height}"`),
      );
    if (prepared !== n) {
      temporary.remove(prepared);
    }
    sources.set(key, local);
    local.opacity = 0;
    bundle.texts.push({
      name: n.name,
      svg,
      x: n.absoluteTransform[0][2] - copy.absoluteTransform[0][2],
      y: n.absoluteTransform[1][2] - copy.absoluteTransform[1][2],
      width: n.width,
      height: n.height,
      clipContent: n.textTruncation === "ENDING",
      transform: [
        n.absoluteTransform[0][0],
        n.absoluteTransform[1][0],
        n.absoluteTransform[0][1],
        n.absoluteTransform[1][1],
      ],
      opacity: n.opacity,
      fonts: fontsFor(local),
      source: {
        key,
        characters: local.characters,
        segments,
        fallbackReason: reason,
        composition: ancestor,
      },
    });
  }
  for (const [n, path] of paths)
    if (n.type === "TEXT_PATH" && visible(n)) {
      if (!outlineFallback)
        throw new AppError(msg("errors.namedTextPath", { name: n.name }));
      if (!pristine) {
        pristine = copy.clone();
        temporary.add(pristine);
        wrapper.appendChild(pristine);
        pristine.opacity = 0;
      }
      const key = `path:${path}`;
      composition.set(key, path);
      bundle.texts.push({
        name: n.name,
        svg: "",
        x: 0,
        y: 0,
        width: frame.width,
        height: frame.height,
        fonts: [],
        source: {
          key,
          characters: "",
          segments: [],
          fallbackReason: msg("errors.textPathPosition"),
          composition: true,
        },
      });
    }
  const strip = (node: SceneNode) => {
    if (!visible(node) || ("isMask" in node && node.isMask)) return;
    if (node.type === "TEXT" || node.type === "TEXT_PATH") {
      node.opacity = 0;
      return;
    }
    if ("children" in node) for (const child of node.children) strip(child);
  };
  strip(copy);
  send({ type: "progress", id, message: msg("progress.background") });
  bundle.png = await temporary.export(wrapper, {
    format: "PNG",
    constraint:
      pixelEdge === undefined
        ? { type: "SCALE", value: scale }
        : {
            type: frame.width >= frame.height ? "WIDTH" : "HEIGHT",
            value: pixelEdge,
          },
    useAbsoluteBounds: true,
    contentsOnly: true,
    colorProfile: "SRGB",
  });
  check();
  let closed = false,
    queue = Promise.resolve(),
    resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    resolveDone();
  };
  const verify = () => {
    check();
    if (closed) throw new AppError(msg("operation.cancelled"));
  };
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(finish, 120000);
  };
  const active: Session = {
    id,
    finish,
    touch,
    range(request) {
      const work = queue
        .then(() =>
          temporary.run(
            msg("progress.textRange"),
            async (verifyRange) => {
              verifyRange();
              const source = sources.get(request.key);
              if (
                (!source && !composition.has(request.key)) ||
                !["svg", "pdf"].includes(request.format)
              )
                throw new AppError(msg("errors.invalidRange"));
              if (composition.has(request.key)) {
                if (
                  request.format !== "pdf" ||
                  request.start !== undefined ||
                  request.end !== undefined
                )
                  throw new AppError(msg("errors.compositedLayer"));
                const cacheKey = JSON.stringify([request.key, "composition"]);
                const cached = rangePDFs.get(cacheKey);
                if (cached) return cached;
                pristine!.opacity = 1;
                try {
                  const result = {
                    pdf: await outlineTextPDF(
                      pristine!,
                      temporary,
                      verifyRange,
                      new Set([composition.get(request.key)!]),
                    ),
                    fullFrame: true,
                  };
                  verifyRange();
                  rangePDFs.set(cacheKey, result);
                  return result;
                } finally {
                  if (!pristine!.removed) pristine!.opacity = 0;
                }
              }
              const start = request.start ?? 0,
                end = request.end ?? source!.characters.length;
              if (
                !Number.isInteger(start) ||
                !Number.isInteger(end) ||
                start < 0 ||
                end <= start ||
                end > source!.characters.length
              )
                throw new AppError(msg("errors.invalidRange"));
              const cacheKey = JSON.stringify([request.key, start, end]);
              const cachedPDF = rangePDFs.get(cacheKey);
              if (request.format === "pdf" && cachedPDF) return cachedPDF;
              let node: TextNode | undefined;
              let vector: FrameNode | undefined;
              try {
                let svg = rangeSVGs.get(cacheKey);
                if (svg === undefined) {
                  node = source!.clone();
                  temporary.add(node);
                  wrapper.appendChild(node);
                  node.relativeTransform = [
                    [1, 0, 0],
                    [0, 1, 0],
                  ];
                  node.opacity = 1;
                  const transparent: Paint[] = [
                    { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0 },
                  ];
                  if (start > 0) node.setRangeFills(0, start, transparent);
                  if (end < node.characters.length)
                    node.setRangeFills(
                      end,
                      node.characters.length,
                      transparent,
                    );
                  svg = await temporary.export(
                    node,
                    {
                      format: "SVG_STRING",
                      svgOutlineText: true,
                      useAbsoluteBounds: true,
                      contentsOnly: true,
                    },
                    verifyRange,
                  );
                  verifyRange();
                  const asset = bundle.texts.find(
                    (t) => t.source!.key === request.key,
                  )!;
                  svg = svg.replace(/<svg\b[^>]*>/, (root) =>
                    root
                      .replace(/\bwidth="[^"]*"/, `width="${asset.width}"`)
                      .replace(/\bheight="[^"]*"/, `height="${asset.height}"`)
                      .replace(
                        /\bviewBox="[^"]*"/,
                        `viewBox="0 0 ${asset.width} ${asset.height}"`,
                      ),
                  );
                  if (/<(?:[\w.-]+:)?(?:text|tspan|textPath)\b/i.test(svg))
                    throw new AppError(msg("errors.outlineConversion"));
                  rangeSVGs.set(cacheKey, svg);
                }
                if (request.format === "svg") return { svg };
                verifyRange();
                vector = figma.createNodeFromSvg(svg);
                temporary.add(vector);
                const pdf = await temporary.export(
                  vector,
                  {
                    format: "PDF",
                    useAbsoluteBounds: true,
                    contentsOnly: true,
                  },
                  verifyRange,
                );
                verifyRange();
                const result = { pdf };
                rangePDFs.set(cacheKey, result);
                return result;
              } finally {
                for (const n of [vector, node]) if (n) temporary.remove(n);
              }
            },
            45000,
            verify,
          ),
        )
        .catch((error) => {
          if (error instanceof Error && error.name === "OperationTimeoutError")
            finish();
          throw error;
        });
      queue = work.then(
        () => {},
        () => {},
      );
      return work;
    },
  };
  session = active;
  touch();
  send({ type: "bundle", bundle });
  try {
    await done;
    await queue;
    check();
  } finally {
    finish();
    rangeSVGs.clear();
    rangePDFs.clear();
    if (session === active) session = undefined;
  }
}
