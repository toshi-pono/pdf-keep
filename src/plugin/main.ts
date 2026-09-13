import { TemporaryExport, recoverTemporary } from "./temporary";
import { materializeTruncatedText } from "./truncated-text";
import {
  exportSearchableFrame,
  finishSearchableExport,
  resolveTextRange,
} from "./export-searchable";
import { outlineTextPDF } from "./outline";
import { needsTextOutlines, svgNeedsTextOutlines } from "../shared/rich-text";
import { downloadGoogleFont } from "../fonts/google-fonts";
import { inspect, visible, fontsFor } from "./inspect";
import { resolveScale } from "../shared/resolution";
import {
  blocks,
  fontKey,
  type UIMessage,
  type PluginMessage,
  type ExportBundle,
  type Mode,
} from "../shared/protocol";
import { nearbyPosition } from "../shared/geometry";
import { errorMessage } from "../shared/errors";
figma.showUI(__html__, { width: 480, height: 680, themeColors: true });
const send = (message: PluginMessage) => figma.ui.postMessage(message);
let activeTemporary: TemporaryExport | undefined;
recoverTemporary(figma.currentPage);
figma.on("currentpagechange", () => {
  recoverTemporary(figma.currentPage, activeTemporary?.session);
  report();
});
let running: number | null = null;
const cancelled = new Set<number>();
const storageKey = "paper-pdf-fonts-v1";
const saved: Record<string, number[]> = {};
const storageReady = figma.clientStorage
  .getAsync(storageKey)
  .then((value) => {
    if (value && typeof value === "object") Object.assign(saved, value);
    send({ type: "saved-fonts", fonts: saved });
  })
  .catch(() =>
    send({
      type: "storage-error",
      message: "保存済みフォントを読み込めませんでした。再登録してください。",
    }),
  );
function selection() {
  const s = figma.currentPage.selection;
  return s.length === 1 && s[0].type === "FRAME" ? s[0] : null;
}
let selectionRevision = 0;
function report() {
  const revision = ++selectionRevision;
  try {
    const f = selection();
    if (!f) {
      send({
        type: "selection",
        name: "Frame を一つ選択してください",
        valid: false,
        fonts: [],
        diagnostics: [],
      });
      return;
    }
    const result = inspect(f);
    send({
      type: "selection",
      revision,
      name: f.name,
      valid: true,
      width: f.width,
      height: f.height,
      fonts: result.fonts,
      diagnostics: result.diagnostics,
    });
  } catch (e) {
    send({
      type: "selection",
      name: "選択の解析に失敗しました",
      valid: false,
      fonts: [],
      diagnostics: [{ nodeId: "", name: "解析", reason: String(e) }],
    });
  }
}
// One small read-only preview at a time; rapid selection changes replace the
// queued request. Quality changes reuse the UI's sample, never re-render.
let pendingEstimate: number | null = null;
let estimating = false;
async function estimatePreview(revision: number) {
  pendingEstimate = revision;
  if (estimating) return;
  estimating = true;
  try {
    while (pendingEstimate !== null) {
      const current = pendingEstimate;
      pendingEstimate = null;
      const frame = selection();
      if (!frame || current !== selectionRevision) continue;
      if (running !== null) {
        send({ type: "estimate-preview", revision: current });
        continue;
      }
      const width = frame.width,
        height = frame.height;
      try {
        const png = await frame.exportAsync({
          format: "PNG",
          constraint: {
            type: width >= height ? "WIDTH" : "HEIGHT",
            value: Math.min(768, Math.max(width, height)),
          },
          useAbsoluteBounds: true,
          contentsOnly: true,
          colorProfile: "SRGB",
        });
        if (
          current !== selectionRevision ||
          frame.removed ||
          frame.width !== width ||
          frame.height !== height
        )
          continue;
        const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
        const pixels = header.getUint32(16) * header.getUint32(20);
        if (!pixels) throw Error("Invalid preview");
        send({
          type: "estimate-preview",
          revision: current,
          pixels,
          bytes: png.byteLength,
        });
      } catch {
        if (current === selectionRevision)
          send({ type: "estimate-preview", revision: current });
      }
    }
  } finally {
    estimating = false;
  }
}
figma.on("selectionchange", report);
figma.on("close", () => {
  if (running !== null) {
    cancelled.add(running);
    finishSearchableExport(running);
  }
  activeTemporary?.dispose();
});
function check(id: number) {
  if (cancelled.has(id)) throw new Error("キャンセルしました。");
}
async function exportFrame(
  id: number,
  scale: number,
  mode: Mode,
  destination: "pdf" | "frame" = "pdf",
  longEdge?: number,
  outlineFallback = false,
  revision?: number,
  protocol?: 2,
) {
  if (running !== null) {
    send({
      type: "error",
      id,
      message: "別の書き出し処理中です。少し待ってから再実行してください。",
    });
    return;
  }
  running = id;
  recoverTemporary(figma.currentPage);
  const temporary = new TemporaryExport(() => check(id));
  activeTemporary = temporary;
  let wrapper: FrameNode | undefined;
  try {
    const frame = selection();
    if (!frame) throw new Error("Frame を一つ選択してください。");
    if (revision !== undefined && revision !== selectionRevision)
      throw new Error("選択が変わりました。もう一度 PDF を作成してください。");
    const automatic = scale === 0 && longEdge === undefined;
    scale = resolveScale(
      frame.width,
      frame.height,
      scale,
      destination,
      longEdge,
    );
    if (destination === "pdf" && mode === "text" && protocol === 2) {
      await exportSearchableFrame(
        frame,
        id,
        scale,
        longEdge ?? (automatic && scale < 3 ? 4096 : undefined),
        outlineFallback,
        temporary,
        temporary.check,
        send,
      );
      return;
    }
    const { diagnostics } = inspect(frame);
    if (
      mode === "text" &&
      destination === "pdf" &&
      outlineFallback &&
      diagnostics.some((d) => blocks(d, "pdf"))
    )
      mode = "outline";
    if (mode === "text" && diagnostics.some((d) => blocks(d, destination)))
      throw new Error(
        "文字を保持できないレイヤーがあります。診断を確認してください。",
      );
    wrapper = figma.createFrame();
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
    const { texts } = inspect(copy);
    const opacities = new Map(texts.map((n) => [n, n.opacity]));
    const prepared = new Map<TextNode, TextNode>();
    const bundle: ExportBundle = {
      id,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      scale,
      mode,
      png: new Uint8Array(),
      texts: [],
    };
    try {
      // Native Frame output keeps the original editable TextNode and truncation.
      // Only a PDF needs a materialized visible string with no hidden suffix.
      if (mode === "text" && destination === "pdf")
        for (const n of texts) {
          if (n.textTruncation !== "ENDING" || needsTextOutlines(n)) continue;
          send({
            type: "progress",
            id,
            message: `省略表示を文字に変換中: ${n.name}`,
          });
          const local = await materializeTruncatedText(
            n,
            wrapper,
            temporary,
            temporary.check,
            (stage) =>
              send({
                type: "progress",
                id,
                message: `省略文字: ${stage} — ${n.name}`,
              }),
          );
          local.opacity = 0;
          prepared.set(n, local);
        }
      if (mode === "text" && destination === "pdf")
        for (const n of texts) {
          temporary.check();
          send({ type: "progress", id, message: `文字を取得中: ${n.name}` });
          // Export a detached, untransformed clone so the SVG's coordinates are
          // local. Reapply the full ancestor transform exactly once in the PDF.
          const local = (prepared.get(n) ?? n).clone();
          let outlined = needsTextOutlines(n);
          local.opacity = 1;
          temporary.add(local);
          let svg: string;
          try {
            wrapper.appendChild(local);
            local.relativeTransform = [
              [1, 0, 0],
              [0, 1, 0],
            ];
            svg = await temporary.export(local, {
              format: "SVG_STRING",
              svgOutlineText: outlined,
              useAbsoluteBounds: true,
              contentsOnly: true,
            });
            temporary.check();
            if (!outlined && svgNeedsTextOutlines(svg)) {
              outlined = true;
              svg = await temporary.export(local, {
                format: "SVG_STRING",
                svgOutlineText: true,
                useAbsoluteBounds: true,
                contentsOnly: true,
              });
            }
          } finally {
            temporary.remove(local);
          }
          temporary.check();
          if (prepared.has(n)) {
            // Keep the source viewport: a wider temporary layout must not scale
            // the text or expose pixels beyond the original text box in the PDF.
            svg = svg.replace(/<svg\b[^>]*>/, (root) =>
              root
                .replace(/\bwidth="[^"]*"/, `width="${n.width}"`)
                .replace(/\bheight="[^"]*"/, `height="${n.height}"`)
                .replace(
                  /\bviewBox="[^"]*"/,
                  `viewBox="0 0 ${n.width} ${n.height}"`,
                ),
            );
          }
          bundle.texts.push({
            svg,
            opacity: n.opacity,
            outlined,
            clipContent: n.textTruncation === "ENDING",
            transform: [
              n.absoluteTransform[0][0],
              n.absoluteTransform[1][0],
              n.absoluteTransform[0][1],
              n.absoluteTransform[1][1],
            ],
            x: n.absoluteTransform[0][2] - copy.absoluteTransform[0][2],
            y: n.absoluteTransform[1][2] - copy.absoluteTransform[1][2],
            width: n.width,
            height: n.height,
            fonts: outlined ? [] : fontsFor(prepared.get(n) ?? n),
            name: n.name,
          });
        }
    } catch (error) {
      temporary.check();
      if (!outlineFallback || mode !== "text" || destination !== "pdf")
        throw error;
      mode = "outline";
      bundle.mode = mode;
      bundle.texts = [];
    }
    temporary.check();
    if (
      destination === "pdf" &&
      (mode === "outline" || (mode === "text" && outlineFallback))
    ) {
      send({ type: "progress", id, message: "文字をアウトラインに変換中…" });
      try {
        bundle.outlinePDF = await outlineTextPDF(
          copy,
          temporary,
          temporary.check,
        );
      } catch (error) {
        temporary.check();
        if (mode === "outline") throw error;
        // A failed backup must not block otherwise supported text output.
        bundle.outlineError = errorMessage(error);
      }
    }
    send({ type: "progress", id, message: "背景を安全に焼き込み中…" });
    if (mode === "text" || mode === "outline") {
      const strip = (n: SceneNode) => {
        if (!visible(n)) return;
        if ("isMask" in n && n.isMask) return;
        if (n.type === "TEXT" || n.type === "TEXT_PATH") {
          // Text masks still need to clip the background artwork.
          if (!n.isMask) n.opacity = 0;
          return;
        }
        if ("children" in n) for (const c of n.children) strip(c);
      };
      strip(copy);
    }
    const pixelEdge = longEdge ?? (automatic && scale < 3 ? 4096 : undefined);
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
    temporary.check();
    if (destination === "pdf") send({ type: "bundle", bundle });
    else {
      const output = figma.createFrame();
      temporary.add(output);
      output.name = `${frame.name} — ${mode === "text" ? "flattened background" : "raster"}`;
      output.resize(bundle.width, bundle.height);
      output.clipsContent = false;
      output.fills = [
        {
          type: "IMAGE",
          imageHash: figma.createImage(bundle.png).hash,
          scaleMode: "FILL",
        },
      ];
      output.exportSettings = [{ format: "PDF", suffix: "" }];
      const siblings = temporary.page.children.filter((n) => !temporary.has(n));
      const position = nearbyPosition(
        frame.absoluteBoundingBox!,
        bundle.width,
        bundle.height,
        siblings.flatMap(
          (n) =>
            ("absoluteRenderBounds" in n ? n.absoluteRenderBounds : null) ??
            n.absoluteBoundingBox ??
            [],
        ),
      );
      output.x = position.x;
      output.y = position.y;
      if (mode === "text")
        for (const source of texts) {
          const x =
            source.absoluteTransform[0][2] - copy.absoluteTransform[0][2];
          const y =
            source.absoluteTransform[1][2] - copy.absoluteTransform[1][2];
          const text = (prepared.get(source) ?? source).clone();
          temporary.add(text);
          output.appendChild(text);
          // absoluteTransform includes every ancestor transform. The export
          // copy has an identity linear transform, so only its origin is removed.
          text.relativeTransform = [
            [source.absoluteTransform[0][0], source.absoluteTransform[0][1], x],
            [source.absoluteTransform[1][0], source.absoluteTransform[1][1], y],
          ];
          text.opacity = opacities.get(source) ?? 1;
        }
      temporary.check();
      temporary.publish(output);
      if (figma.currentPage === temporary.page) {
        figma.currentPage.selection = [output];
        figma.viewport.scrollAndZoomIntoView([output]);
      }

      send({ type: "frame-created", id, name: output.name });
    }
  } catch (e) {
    send({
      type: "error",
      id,
      message: errorMessage(e),
    });
  } finally {
    temporary.dispose();
    if (activeTemporary === temporary) activeTemporary = undefined;
    cancelled.delete(id);
    running = null;
    // Protocol 2 finishes after the UI has created its download. A redundant
    // selection event here would revoke that freshly created URL.
    if (protocol !== 2) report();
  }
}
let storageQueue = Promise.resolve();
figma.ui.onmessage = (m: UIMessage) => {
  if (m.type === "export-finished") finishSearchableExport(m.id);
  if (m.type === "text-range" && Number.isSafeInteger(m.requestId))
    void resolveTextRange(m.id, m.requestId, m.range, send);
  if (m.type === "inspect") report();
  if (m.type === "estimate-preview" && Number.isSafeInteger(m.revision))
    void estimatePreview(m.revision);
  if (m.type === "google-font") void fetchGoogleFont(m.font);
  if (m.type === "cancel" && m.id === running) {
    cancelled.add(m.id);
    finishSearchableExport(m.id);
  }
  if (
    (m.type === "export" || m.type === "create-frame") &&
    Number.isSafeInteger(m.id) &&
    ["text", "raster", ...(m.type === "export" ? ["outline"] : [])].includes(
      m.mode,
    )
  )
    void exportFrame(
      m.id,
      m.scale,
      m.mode,
      m.type === "create-frame" ? "frame" : "pdf",
      m.longEdge,
      m.outlineFallback,
      m.revision,
      m.protocol,
    );
  if (m.type === "font-save" || m.type === "font-delete")
    storageQueue = storageQueue
      .then(async () => {
        await storageReady;
        if (m.type === "font-save") {
          if (m.bytes.length > 32_000_000)
            throw new Error("フォントが大きすぎます。");
          saved[m.key] = m.bytes;
        } else delete saved[m.key];
        await figma.clientStorage.setAsync(storageKey, saved);
      })
      .catch(() =>
        send({
          type: "storage-error",
          message:
            "端末へのフォント保存に失敗しました。このセッションでは使用できます。",
        }),
      );
};
report();

async function fetchGoogleFont(font: import("../shared/protocol").FontSpec) {
  const key = fontKey(font);
  try {
    const bytes = await downloadGoogleFont(font);
    send({ type: "google-font-result", key, bytes: Array.from(bytes) });
  } catch (e) {
    send({
      type: "google-font-result",
      key,
      error: errorMessage(e),
    });
  }
}
