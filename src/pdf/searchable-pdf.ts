import { coalesceOutlines } from "./coalesce-outlines";
import { measure } from "../shared/performance";
import { PDFDocument, PDFName, type PDFEmbeddedPage } from "pdf-lib";
import type { RegisteredFont, PDFCallbacks } from "./create-pdf";
import {
  fontKey,
  type ExportBundle,
  type TextAsset,
  type TextRangeRequest,
  type TextRangeResult,
} from "../shared/protocol";
import { errorMessage } from "../shared/errors";
import { rasterDimensions } from "../shared/resolution";
import { CIDFont, unicodeHex } from "./cid-font";
import { embedNativeTextFont, nativeTextGlyph } from "./native-text-font";
import { embedCompressedPNG } from "./png-compression";
import { createTextShaper } from "./text-shape";
import { createFontSubsetter } from "../fonts/font-subset";
import { readRuns, type TextRun } from "./text-layout";
import { appendTextDecorations } from "./text-decorations";
import {
  nativeMask,
  inkComponents,
  createGlyphMatcher,
  type GlyphMatch,
  type Rect,
} from "./native-glyph";
interface Dependencies {
  registry: Map<string, RegisteredFont>;
  svg: (asset: TextAsset, rich?: boolean) => SVGSVGElement;
  opaquePNG: (
    bytes: Uint8Array,
    width: number,
    height: number,
  ) => Promise<string>;
  plain: (bundle: ExportBundle) => Promise<Uint8Array>;
}
interface GlyphPart {
  type: "glyph";
  asset: TextAsset;
  font: RegisteredFont;
  text: string;
  glyphs: {
    gid: number;
    x: number;
    y: number;
    size: number;
    matrix: DOMMatrix;
  }[];
  color: [number, number, number];
  opacity: number;
  order: number;
}
interface NativePart {
  type: "native";
  asset: TextAsset;
  range: TextRangeRequest;
  clip?: Rect;
  reason: string;
  order: number;
  proofRun?: TextRun;
  /** Preserve a Figma fallback run as a Unicode-mapped PDF font. */
  text?: string;
}
type Part = GlyphPart | NativePart;
const fmt = (n: number) => {
  if (!Number.isFinite(n)) throw Error("文字の配置が不正です。");
  return String(Math.round(n * 1e6) / 1e6);
};
const matrixFor = (asset: TextAsset) =>
  new DOMMatrix([...(asset.transform ?? [1, 0, 0, 1]), asset.x, asset.y]);
function paint(run: TextRun): {
  color: [number, number, number];
  opacity: number;
} {
  const style = getComputedStyle(run.el),
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  if (style.fill === "none") return { color: [0, 0, 0], opacity: 0 };
  ctx.fillStyle = style.fill;
  ctx.fillRect(0, 0, 1, 1);
  const c = ctx.getImageData(0, 0, 1, 1).data;
  return {
    color: [c[0] / 255, c[1] / 255, c[2] / 255],
    opacity: ((Number(style.fillOpacity) || 0) * c[3]) / 255,
  };
}
function nativeRequest(
  asset: TextAsset,
  start?: number,
  end?: number,
  format: "svg" | "pdf" = "pdf",
): TextRangeRequest {
  return {
    key: asset.source!.key,
    ...(start !== undefined ? { start, end } : {}),
    format,
  };
}
function sourceRange(
  run: TextRun,
  from: number,
  to: number,
  original: boolean,
): { start?: number; end?: number; text: string } {
  if (run.marker) return { text: run.display.slice(from, to) };
  const chars = run.chars.filter((c) =>
    original
      ? c.start < run.start! + to && c.end > run.start! + from
      : c.displayStart < to && c.displayEnd > from,
  );
  if (!chars.length) throw Error("字形の元文字列を対応付けできません。");
  return {
    start: chars[0].start,
    end: chars[chars.length - 1].end,
    text: chars.map((c) => c.text).join(""),
  };
}
const scriptChars = (text: string, tag: string) => {
  const at = "0123456789+-=()".indexOf(text);
  return at < 0
    ? undefined
    : Array.from(tag === "sups" ? "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾" : "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎")[at];
};

export async function renderSearchablePDF(
  bundle: ExportBundle,
  check: () => void,
  callbacks: PDFCallbacks,
  dep: Dependencies,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create(),
    page = doc.addPage([bundle.width * 0.75, bundle.height * 0.75]);
  const dimensions = rasterDimensions(
    bundle.width,
    bundle.height,
    bundle.scale,
  );
  const image = await embedCompressedPNG(
    doc,
    await dep.opaquePNG(bundle.png, dimensions.width, dimensions.height),
    check,
  );
  page.drawImage(image, {
    width: bundle.width * 0.75,
    height: bundle.height * 0.75,
  });
  check();
  const featureCache = new Map<RegisteredFont, Set<string>>();
  const gsubFeatures = (font: RegisteredFont) => {
    let features = featureCache.get(font);
    if (!features) {
      features = new Set<string>(
        ((font.parsed.tables as any).gsub?.features ?? []).map(
          (f: any) => f.tag,
        ),
      );
      featureCache.set(font, features);
    }
    return features;
  };
  const matcher = createGlyphMatcher();
  const parsedSVGs = new Map<string, SVGSVGElement>();
  const embeddedPDFs = new Map<
    string,
    { embedded: PDFEmbeddedPage; name: PDFName; fullFrame?: boolean }
  >();
  const shaper = createTextShaper(check),
    subsetter = createFontSubsetter(check),
    faces: FontFace[] = [],
    hosts: HTMLElement[] = [];
  const fonts = new Map<RegisteredFont, { font: CIDFont; name: PDFName }>(),
    alpha = new Map<number, PDFName>(),
    ranges = new Map<string, Promise<TextRangeResult>>();
  let copied = 0,
    outlined = 0;
  const decorations = new Map<TextAsset, string>();
  const available = new Map(dep.registry);
  const warn = (message: string) => callbacks.warning?.(message);
  const request = (range: TextRangeRequest) => {
    check();
    const key = JSON.stringify(range);
    let pending = ranges.get(key);
    if (!pending) {
      if (!callbacks.resolveRange)
        throw Error("文字範囲のアウトラインを取得できません。");
      pending = callbacks.resolveRange(range).then((result) => {
        check();
        return result;
      });
      ranges.set(key, pending);
    }
    return pending;
  };
  const nativeSVG = async (asset: TextAsset, start?: number, end?: number) => {
    const range = nativeRequest(asset, start, end, "svg");
    const key = JSON.stringify(range);
    const cached = parsedSVGs.get(key);
    if (cached) return cached;
    const result = await request(range);
    if (!result.svg) throw Error("文字のアウトラインを取得できませんでした。");
    const svg = dep.svg({
      ...asset,
      svg: result.svg,
      outlined: true,
      opacity: 1,
      fonts: [],
    });
    parsedSVGs.set(key, svg);
    return svg;
  };
  const fallback = (
    asset: TextAsset,
    range: TextRangeRequest,
    reason: string,
    order: number,
    clip?: Rect,
    proofRun?: TextRun,
  ): NativePart => {
    if (!bundle.outlineFallback)
      throw Error(
        `${asset.name}${range.start === undefined ? "" : ` (${range.start}–${range.end})`}: ${reason}`,
      );
    return { type: "native", asset, range, reason, order, clip, proofRun };
  };
  const clipMask = async (
    asset: TextAsset,
    range: TextRangeRequest,
    box: Rect,
  ) => nativeMask(await nativeSVG(asset, range.start, range.end), box);
  const prepare = async (asset: TextAsset): Promise<Part[]> => {
    if (asset.source!.fallbackReason)
      return [
        fallback(asset, nativeRequest(asset), asset.source!.fallbackReason, 0),
      ];
    const svg = dep.svg(asset, true);
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:-100000px;top:0;pointer-events:none";
    host.append(svg);
    document.body.append(host);
    hosts.push(host);
    const runs = readRuns(svg, asset, available),
      parts: Part[] = [];
    // Browser/primary-font fallback metrics are not Figma's. If any glyph is
    // absent, preserve all runs in this asset from Figma's actual geometry so
    // following Latin text and differently styled spans cannot drift either.
    const nativeText = runs.some(
      (run) =>
        run.font &&
        Array.from(run.display).some(
          (character) =>
            !/[\n\r\t]/.test(character) &&
            !run.font!.parsed.charToGlyphIndex(character),
        ),
    );
    for (const run of runs) {
      check();
      if (run.segment?.invisible) continue;
      if (run.segment?.fallbackReason) {
        parts.push(
          fallback(
            asset,
            nativeRequest(asset, run.start, run.end),
            run.segment.fallbackReason,
            run.start ?? 0,
          ),
        );
        continue;
      }
      const style = paint(run);
      if (!style.opacity) continue;
      if (
        nativeText &&
        run.start !== undefined &&
        run.end !== undefined &&
        !run.marker
      ) {
        // PDF readers may discard a standalone space glyph. Keep boundary
        // whitespace with its adjacent native run, including its Unicode map.
        const previous = parts.at(-1);
        if (
          previous?.type === "native" &&
          previous.text !== undefined &&
          previous.range.end === run.start &&
          (!run.original.trim() || !previous.text.trim())
        ) {
          previous.range.end = run.end;
          previous.text += run.original;
          continue;
        }
        parts.push({
          type: "native",
          asset,
          range: nativeRequest(asset, run.start, run.end),
          text: run.original,
          proofRun: run,
          order: run.start,
          reason: "Figma の代替フォントを文字として埋め込めませんでした。",
        });
        continue;
      }
      if (!run.font) {
        parts.push(
          fallback(
            asset,
            nativeRequest(asset, run.start, run.end),
            "フォントを登録してください。",
            run.start ?? -1,
          ),
        );
        continue;
      }
      const sourceFeatures = Object.fromEntries(
        Object.entries(run.segment?.features ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      );
      const script = Object.keys(sourceFeatures).find(
        (tag) => /^(sups|subs|sinf)$/.test(tag) && sourceFeatures[tag],
      );
      const supported = script ? gsubFeatures(run.font).has(script) : false;
      const shapeOriginal = !!(
        script &&
        supported &&
        run.original !== run.display
      );
      const value = shapeOriginal ? run.original : run.display;
      const features = shapeOriginal
        ? { ...run.features, ...sourceFeatures }
        : run.features;
      let shaped;
      try {
        shaped = await shaper.shape(
          run.font.alias,
          run.font.bytes,
          value,
          features,
        );
        check();
      } catch (e) {
        check();
        parts.push(
          fallback(
            asset,
            nativeRequest(asset, run.start, run.end),
            errorMessage(e),
            run.start ?? 0,
          ),
        );
        continue;
      }
      const starts = [...new Set(shaped.glyphs.map((g) => g.cluster))].sort(
          (a, b) => a - b,
        ),
        groups = new Map<number, typeof shaped.glyphs>();
      for (const g of shaped.glyphs) {
        const list = groups.get(g.cluster) ?? [];
        list.push(g);
        groups.set(g.cluster, list);
      }
      let penX = run.x,
        penY = run.y;
      // LTR English/Japanese text retains Figma's line anchors. Browser measured
      // letter spacing is added only between clusters, not within a ligature.
      const visualStarts = [...groups.keys()];
      for (const start of visualStarts) {
        const glyphs = groups.get(start)!,
          end = starts[starts.indexOf(start) + 1] ?? value.length;
        const original = sourceRange(run, start, end, shapeOriginal),
          order = original.start ?? (run.start ?? 0) - 0.5;
        const factor = run.size / shaped.unitsPerEm;
        const positions = glyphs.map((g) => {
          const position = {
            gid: g.gid,
            x: penX + g.xOffset * factor,
            y: penY - g.yOffset * factor,
            size: run.size,
            matrix: matrixFor(asset).multiply(run.matrix),
          };
          penX += g.xAdvance * factor;
          penY -= g.yAdvance * factor;
          return position;
        });
        penX += run.letterSpacing;
        if (glyphs.some((g) => g.gid === 0) && !script) {
          parts.push(
            fallback(
              asset,
              nativeRequest(asset, original.start, original.end),
              `登録フォントに文字「${original.text}」がありません。`,
              order,
            ),
          );
          continue;
        }
        // If Figma used a feature absent from the supplied font and the SVG did
        // not expose a presentation character, verify the native glyph before
        // accepting an ordinary/synthetic replacement.
        const needsProof =
          script && original.start !== undefined && original.text.trim();
        if (needsProof) {
          try {
            const box = {
              x: 0,
              y: 0,
              width: asset.width,
              height: asset.height,
            };
            const components = inkComponents(
              await clipMask(
                asset,
                nativeRequest(asset, original.start, original.end, "svg"),
                box,
              ),
            );
            check();
            const alternatives: number[] = [];
            for (const tag of ["sups", "subs", "sinf"])
              if (gsubFeatures(run.font).has(tag)) {
                const alternate = await shaper.shape(
                  run.font.alias,
                  run.font.bytes,
                  original.text,
                  { [tag]: true },
                );
                check();
                if (alternate.glyphs.length === 1)
                  alternatives.push(alternate.glyphs[0].gid);
              }
            const alt = scriptChars(original.text, script!);
            const candidates = [
              ...new Set([
                glyphs.length === 1 ? glyphs[0].gid : 0,
                run.font.parsed.charToGlyphIndex(original.text),
                alt ? run.font.parsed.charToGlyphIndex(alt) : 0,
                ...alternatives,
              ]),
            ]
              .filter(Boolean)
              .map((gid) => ({ gid, character: original.text }));
            const match =
              components.length === 1
                ? matcher.match(
                    components[0],
                    run.font,
                    candidates,
                    run.size,
                    true,
                  )
                : undefined;
            if (match) {
              parts.push({
                type: "glyph",
                asset,
                font: run.font,
                text: original.text,
                glyphs: [
                  {
                    gid: match.gid,
                    x: match.x,
                    y: match.y,
                    size: match.size,
                    matrix: matrixFor(asset),
                  },
                ],
                ...style,
                order,
              });
              continue;
            }
            parts.push(
              fallback(
                asset,
                nativeRequest(asset, original.start, original.end),
                "OpenType の字形・位置を登録フォントで再現できません。",
                order,
                undefined,
                run,
              ),
            );
            continue;
          } catch (e) {
            check();
            parts.push(
              fallback(
                asset,
                nativeRequest(asset, original.start, original.end),
                errorMessage(e),
                order,
              ),
            );
            continue;
          }
        }
        parts.push({
          type: "glyph",
          asset,
          font: run.font,
          text: original.text,
          glyphs: positions,
          ...style,
          order,
        });
      }
    }
    // Native SVG text omits list markers. Read their *visible* glyph shapes;
    // never infer a counter start/restart that the API does not expose.
    let start = 0;
    for (const paragraph of asset.source!.characters.split("\n")) {
      const segment = asset.source!.segments.find(
        (s) => s.start <= start && start < s.end,
      );
      if (segment && segment.list !== "NONE") {
        const first = runs.find(
          (r) => r.start !== undefined && r.start <= start && r.end! > start,
        );
        if (!first) throw Error("空のリスト段落の位置を取得できません。");
        if (
          !parts.some(
            (p) =>
              p.type === "native" &&
              p.range.start !== undefined &&
              p.range.start <= start &&
              p.range.end! > start,
          ) &&
          !runs.some(
            (r) => r.marker && Math.abs(r.y - first.y) < first.size * 0.4,
          )
        ) {
          const top = Math.max(0, first.y - first.size);
          const box = {
            x: 0,
            y: top,
            width: first.x - 0.5,
            height: Math.min(first.y + first.size * 0.2, asset.height) - top,
          };
          if (box.width <= 0)
            throw Error("リスト記号を本文から分離できません。");
          let matches: (GlyphMatch | undefined)[] = [];
          try {
            if (first.font) {
              const masks = inkComponents(
                await nativeMask(await nativeSVG(asset), box),
              );
              const characters =
                segment.list === "ORDERED" ? "0123456789.)" : "•◦▪●○‣";
              const candidates = Array.from(characters, (character) => ({
                character,
                gid: first.font!.parsed.charToGlyphIndex(character),
              }));
              matches = masks.map((mask) =>
                matcher.match(mask, first.font!, candidates, first.size),
              );
            }
          } catch {
            check();
          }
          const label = matches.map((m) => m?.character ?? "").join("");
          const valid =
            matches.length > 0 &&
            matches.every(Boolean) &&
            (segment.list === "ORDERED"
              ? /^\d+[.)]$/.test(label)
              : matches.length === 1);
          if (valid) {
            const style = paint(first);
            parts.push({
              type: "glyph",
              asset,
              font: first.font!,
              text: label,
              glyphs: matches.map((m) => ({
                gid: m!.gid,
                x: m!.x,
                y: m!.y,
                size: m!.size,
                matrix: matrixFor(asset),
              })),
              ...style,
              order: start - 0.5,
            });
          } else
            parts.push(
              fallback(
                asset,
                nativeRequest(asset),
                "リスト記号・番号を登録フォントと照合できません。",
                start - 0.5,
                box,
              ),
            );
        }
      }
      start += paragraph.length + 1;
    }
    const nativeParts = parts.filter(
      (part): part is NativePart => part.type === "native" && !part.clip,
    );
    appendTextDecorations(
      svg,
      runs
        .filter((run) => run.font && !run.segment?.invisible)
        .map((run) => ({
          el: run.el,
          font: run.font!,
          include: (index: number) => {
            if (!nativeParts.length) return true;
            const char = run.chars.find(
              (c) => c.displayStart <= index && index < c.displayEnd,
            );
            return !nativeParts.some(
              (part) =>
                part.range.start === undefined ||
                (char &&
                  part.range.start < char.end &&
                  part.range.end! > char.start),
            );
          },
        })),
    );
    // Native vector decorations already included in the text SVG are retained
    // separately. They must not cause otherwise supported text to be outlined.
    if (svg.querySelector("path,circle,ellipse,rect,line,polygon,polyline")) {
      const vector = svg.cloneNode(true) as SVGSVGElement;
      for (const text of vector.querySelectorAll("text")) text.remove();
      decorations.set(asset, new XMLSerializer().serializeToString(vector));
    }
    return coalesceOutlines(parts.sort((a, b) => a.order - b.order));
  };
  const graphicsAlpha = (opacity: number) => {
    let name = alpha.get(opacity);
    if (!name) {
      name = page.node.newExtGState(
        "Alpha",
        doc.context.register(
          doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity }),
        ),
      );
      alpha.set(opacity, name);
    }
    return name;
  };
  const commands: (string | Uint8Array)[] = [];
  const flush = () => {
    if (!commands.length) return;
    const stream = doc.context.register(
      doc.context.flateStream(commands.join("\n")),
    );
    page.node.addContentStream(stream);
    (page as any).contentStream = undefined;
    commands.length = 0;
  };
  try {
    // Load each available font once; absent fonts are handled per source span.
    for (const font of new Set(dep.registry.values())) {
      check();
      const face = new FontFace(font.alias, font.bytes.slice().buffer);
      try {
        await face.load();
        check();
        document.fonts.add(face);
        faces.push(face);
      } catch {
        check();
        for (const [key, registered] of available)
          if (registered === font) available.delete(key);
      }
    }
    for (const asset of bundle.texts) {
      check();
      callbacks.progress?.(`文字を取得中: ${asset.name}`);
      if (!asset.source) throw Error("文字の範囲情報がありません。");
      const simple =
        !/font-feature-settings|baseline-shift|font-variant-position/.test(
          asset.svg,
        ) &&
        !asset.source.fallbackReason &&
        asset.source.segments.every(
          (s) =>
            !s.fallbackReason &&
            !s.invisible &&
            s.list === "NONE" &&
            !Object.values(s.features).some(Boolean),
        ) &&
        asset.fonts.every((f) => {
          const font = available.get(fontKey(f));
          return (
            font &&
            Array.from(f.characters).every(
              (c) =>
                /[\n\r\t]/.test(c) ||
                (c.codePointAt(0)! <= 0xffff &&
                  font.parsed.charToGlyphIndex(c) > 0),
            )
          );
        });
      if (simple) {
        try {
          const bytes = await dep.plain({
            ...bundle,
            protocol: undefined,
            texts: [asset],
          });
          check();
          const layer = await PDFDocument.load(bytes);
          const [embedded] = await doc.embedPages([layer.getPage(0)]);
          flush();
          page.drawPage(embedded, {
            width: bundle.width * 0.75,
            height: bundle.height * 0.75,
          });
          copied++;
          continue;
        } catch {
          check();
        }
      }
      let parts: Part[];
      try {
        parts = await prepare(asset);
      } catch (e) {
        check();
        if (!bundle.outlineFallback) throw e;
        parts = [fallback(asset, nativeRequest(asset), errorMessage(e), 0)];
      }
      for (const part of parts) {
        check();
        if (part.type === "native") {
          if (part.text !== undefined) {
            try {
              const run = part.proofRun!;
              const anchor = {
                x: run.matrix.a * run.x + run.matrix.c * run.y + run.matrix.e,
                y: run.matrix.b * run.x + run.matrix.d * run.y + run.matrix.f,
              };
              const { box, svg } = nativeTextGlyph(
                await nativeSVG(asset, part.range.start, part.range.end),
                asset.clipContent ? asset : undefined,
                part.text.trim()
                  ? undefined
                  : {
                      x: anchor.x,
                      y: anchor.y - run.size,
                      width: Math.max(run.size, run.el.getComputedTextLength()),
                      height: run.size,
                    },
              );
              const bytes = await dep.plain({
                ...bundle,
                protocol: undefined,
                width: box.width,
                height: box.height,
                scale: 1,
                texts: [
                  {
                    ...asset,
                    source: undefined,
                    svg,
                    width: box.width,
                    height: box.height,
                    x: 0,
                    y: 0,
                    transform: undefined,
                    opacity: 1,
                    fonts: [],
                    outlined: true,
                    clipContent: true,
                  },
                ],
              });
              check();
              const ref = await embedNativeTextFont(
                doc,
                bytes,
                part.text,
                box,
                anchor,
              );
              check();
              const name = page.node.newFontDictionary("FigmaFallback", ref);
              const m = matrixFor(asset);
              const x = m.a * anchor.x + m.c * anchor.y + m.e;
              const y = m.b * anchor.x + m.d * anchor.y + m.f;
              commands.push(
                "q",
                `${graphicsAlpha(asset.opacity ?? 1)} gs`,
                `/Span << /ActualText <FEFF${unicodeHex(part.text)}> >> BDC`,
                `BT ${name} 0.75 Tf ${[m.a, -m.b, -m.c, m.d, x * 0.75, (bundle.height - y) * 0.75].map(fmt).join(" ")} Tm <01> Tj ET`,
                "EMC",
                "Q",
              );
              copied++;
              continue;
            } catch (error) {
              check();
              if (!bundle.outlineFallback) throw error;
              part.reason += ` ${errorMessage(error)}`;
            }
          }
          const key = JSON.stringify(part.range);
          let native = embeddedPDFs.get(key);
          if (!native) {
            const result = await request(part.range);
            if (!result.pdf)
              throw Error("文字のアウトラインを取得できませんでした。");
            const layer = await measure("pdf-load", () =>
              PDFDocument.load(result.pdf!),
            );
            if (layer.getPageCount() !== 1)
              throw Error("アウトライン PDF のページ数が不正です。");
            const [embedded] = await measure("pdf-embed", () =>
              doc.embedPages([layer.getPage(0)]),
            );
            check();
            native = {
              embedded,
              name: page.node.newXObject("NativeText", embedded.ref),
              fullFrame: result.fullFrame,
            };
            embeddedPDFs.set(key, native);
          }
          const { embedded, name } = native;
          commands.push("q");
          if (native.fullFrame) {
            commands.push(
              `${fmt((bundle.width * 0.75) / embedded.width)} 0 0 ${fmt((bundle.height * 0.75) / embedded.height)} 0 0 cm`,
            );
          } else {
            const m = matrixFor(asset);
            commands.push(
              `${fmt(0.75 * m.a)} ${fmt(-0.75 * m.b)} ${fmt(0.75 * m.c)} ${fmt(-0.75 * m.d)} ${fmt(0.75 * m.e)} ${fmt(0.75 * (bundle.height - m.f))} cm`,
            );
            if (part.clip) {
              const r = part.clip;
              commands.push(
                `${fmt(r.x)} ${fmt(r.y)} ${fmt(r.width)} ${fmt(r.height)} re W n`,
              );
            }
            commands.push(
              `${graphicsAlpha(asset.opacity ?? 1)} gs`,
              `${fmt(asset.width / embedded.width)} 0 0 ${fmt(-asset.height / embedded.height)} 0 ${fmt(asset.height)} cm`,
            );
          }
          commands.push(`${name} Do`, "Q");
          outlined++;
          const scope = part.clip
            ? "リスト記号"
            : part.range.start === undefined
              ? "レイヤー全体"
              : `${part.range.start}–${part.range.end}`;
          warn(
            `「${asset.name}」の${scope}をアウトラインで保持しました: ${part.reason}`,
          );
          continue;
        }
        let registered = fonts.get(part.font);
        if (!registered) {
          const font = new CIDFont(doc, part.font, fonts.size + 1);
          registered = {
            font,
            name: page.node.newFontDictionary("Text", font.ref),
          };
          fonts.set(part.font, registered);
        }
        commands.push("q");
        if (asset.clipContent) {
          const m = matrixFor(asset);
          // Apply the explicit text viewport in page coordinates so rotations,
          // reflections and glyph transforms keep the same clipping boundary.
          for (const [i, [x, y]] of [
            [0, 0],
            [asset.width, 0],
            [asset.width, asset.height],
            [0, asset.height],
          ].entries()) {
            commands.push(
              `${fmt((m.a * x + m.c * y + m.e) * 0.75)} ${fmt((bundle.height - (m.b * x + m.d * y + m.f)) * 0.75)} ${i ? "l" : "m"}`,
            );
          }
          commands.push("h W n");
        }
        commands.push(
          `${graphicsAlpha(part.opacity)} gs`,
          `${part.color.map(fmt).join(" ")} rg`,
          `/Span << /ActualText <FEFF${unicodeHex(part.text)}> >> BDC`,
        );
        for (const [i, g] of part.glyphs.entries()) {
          const code = registered.font.code(g.gid, i === 0 ? part.text : "");
          const m = g.matrix,
            x = m.a * g.x + m.c * g.y + m.e,
            y = m.b * g.x + m.d * g.y + m.f;
          commands.push(
            `BT ${registered.name} ${fmt(g.size * 0.75)} Tf ${[m.a, -m.b, -m.c, m.d, x * 0.75, (bundle.height - y) * 0.75].map(fmt).join(" ")} Tm <${code}> Tj ET`,
          );
        }
        commands.push("EMC", "Q");
        copied++;
      }
      const vector = decorations.get(asset);
      if (vector) {
        const bytes = await dep.plain({
          ...bundle,
          protocol: undefined,
          texts: [
            { ...asset, opacity: 1, svg: vector, outlined: true, fonts: [] },
          ],
        });
        check();
        const layer = await PDFDocument.load(bytes);
        const [embedded] = await doc.embedPages([layer.getPage(0)]);
        flush();
        page.drawPage(embedded, {
          width: bundle.width * 0.75,
          height: bundle.height * 0.75,
        });
      }
    }
    flush();
    shaper.dispose();
    for (const { font } of fonts.values()) {
      check();
      callbacks.progress?.("フォントを軽量化中…");
      await font.embed(subsetter, check, warn);
    }
    check();
    const bytes = await doc.save();
    check();
    callbacks.textSummary?.({ copied, outlined });
    return bytes;
  } finally {
    shaper.dispose();
    subsetter.dispose();
    matcher.dispose();
    featureCache.clear();
    parsedSVGs.clear();
    embeddedPDFs.clear();
    ranges.clear();
    decorations.clear();
    for (const host of hosts) host.remove();
    for (const face of faces) document.fonts.delete(face);
  }
}
