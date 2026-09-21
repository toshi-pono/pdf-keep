import { joinMessages, type Message, msg } from "../shared/messages";
import { AppError, errorMessage } from "../shared/errors";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { createFontSubsetter } from "../fonts/font-subset";
import { renderSearchablePDF } from "./searchable-pdf";
import "svg2pdf.js";
import opentype from "opentype.js";
import {
  fontKey,
  type FontSpec,
  type ExportBundle,
  type TextAsset,
  type TextRangeRequest,
  type TextRangeResult,
} from "../shared/protocol";
import { validateSize, rasterDimensions } from "../shared/resolution";
import { appendTextDecorations } from "./text-decorations";
import { fontIdentities, normalizeFontName } from "../fonts/font-names";
export interface RegisteredFont {
  bytes: Uint8Array;
  parsed: opentype.Font;
  alias: string;
}
export const registry = new Map<string, RegisteredFont>();
function readStaticFont(bytes: Uint8Array) {
  if (bytes.length > 32_000_000)
    throw new AppError(msg("errors.fontSizeLimit"));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(0) !== 0x00010000)
    throw new AppError(msg("errors.staticTtf"));
  const tables = view.getUint16(4);
  if (12 + tables * 16 > bytes.length)
    throw new AppError(msg("errors.corruptFont"));
  for (let i = 0; i < tables; i++) {
    const off = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.slice(off, off + 4));
    if (tag === "fvar") throw new AppError(msg("errors.variableFont"));
  }
  const copy = bytes.slice();
  const parsed = opentype.parse(copy.buffer);
  return { bytes: copy, parsed };
}
function storeFont(
  keys: Iterable<string>,
  font: ReturnType<typeof readStaticFont>,
) {
  const registered = {
    ...font,
    alias: `PaperFont${registry.size}_${Math.random().toString(36).slice(2, 8)}`,
  };
  for (const key of keys) registry.set(key, registered);
}
export function registerFont(key: string, bytes: Uint8Array) {
  const font = readStaticFont(bytes);
  const [family, style] = JSON.parse(key) as [string, string];
  const identities = fontIdentities(font.parsed);
  if (
    !identities.some(
      (name) =>
        normalizeFontName(name.family) === normalizeFontName(family) &&
        normalizeFontName(name.style) === normalizeFontName(style),
    )
  )
    throw new AppError(
      msg("errors.fontNameMismatch", {
        family,
        style,
        fileFamily: identities[0]?.family ?? "?",
        fileStyle: identities[0]?.style ?? "?",
      }),
    );
  storeFont([key], font);
}
/** Import once by font metadata; later frame selections use the same registry automatically. */
export function registerAutomatic(bytes: Uint8Array): string[] {
  if (bytes.length > 32_000_000 || bytes.length < 12)
    throw new AppError(msg("errors.invalidFontSize"));
  const font = readStaticFont(bytes);
  const keys = new Set(fontIdentities(font.parsed).map(fontKey));
  if (!keys.size) throw new AppError(msg("errors.fontNames"));
  storeFont(keys, font);
  return [...keys];
}
const ns = "http://www.w3.org/2000/svg";
const allowedAttrs = new Set([
  "x",
  "y",
  "dx",
  "dy",
  "rotate",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "fill",
  "fill-rule",
  "clip-rule",
  "fill-opacity",
  "opacity",
  "xml:space",
  "textLength",
  "lengthAdjust",
]);
const allowedStyles = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "fill",
  "fill-rule",
  "clip-rule",
  "fill-opacity",
  "opacity",
  "white-space",
  "white-space-collapse",
  "text-wrap-mode",
  "text-wrap-style",
]);
// Geometry only, from an explicitly outlined TextNode. Images, references and
// arbitrary Figma artwork still cannot enter the independent PDF this way.
const vectorTags = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polygon",
  "polyline",
]);
const vectorAttrs = new Set([
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "width",
  "height",
  "fill-rule",
  "clip-rule",
]);
function weight(value: string) {
  return value === "bold"
    ? 700
    : value === "normal" || !value
      ? 400
      : Number(value);
}
function chooseFont(el: SVGElement, fonts: FontSpec[]) {
  const style = getComputedStyle(el);
  const inherited = (name: string, fallback: string) => {
    let n: Element | null = el;
    while (n) {
      const value =
        (n as SVGElement).style?.getPropertyValue(name) || n.getAttribute(name);
      if (value) return value;
      n = n.parentElement;
    }
    return fallback;
  };
  const family = inherited("font-family", style.fontFamily)
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
  const w = weight(inherited("font-weight", "400"));
  const italic = /italic|oblique/.test(inherited("font-style", "normal"));
  const matches = fonts.filter(
    (f) => f.family === family && f.weight === w && f.italic === italic,
  );
  const keys = new Set(matches.map(fontKey));
  if (keys.size !== 1)
    throw new AppError(
      msg("errors.svgFontMatch", {
        family,
        weight: w,
        style: style.fontStyle,
      }),
    );
  const f = matches[0];
  const registered = registry.get(fontKey(f));
  if (!registered)
    throw new AppError(
      msg("errors.registerNamedFont", { family: f.family, style: f.style }),
    );
  return registered;
}
/** Rebuild an allow-listed text-only SVG. Never forward Figma's image/defs tree to PDF. */
export function textSVG(asset: TextAsset, rich = false): SVGSVGElement {
  const doc = new DOMParser().parseFromString(asset.svg, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw new AppError(msg("errors.parseTextSvg"));
  const root = doc.documentElement;
  const vb = (
    root.getAttribute("viewBox") ?? `0 0 ${asset.width} ${asset.height}`
  )
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length !== 4 || !vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0)
    throw new AppError(msg("errors.svgDimensions"));
  const out = document.createElementNS(ns, "svg");
  out.setAttribute("width", String(asset.width));
  out.setAttribute("height", String(asset.height));
  out.setAttribute("viewBox", vb.join(" "));
  // A TextNode's dimensions describe layout, not a clipping frame. Nested SVGs
  // otherwise default to hidden overflow and crop descenders or long lines.
  out.setAttribute("overflow", asset.clipContent ? "hidden" : "visible");
  function copy(node: Element, parent: Element) {
    if (node.localName === "defs") return;
    const vector = (asset.outlined || rich) && vectorTags.has(node.localName);
    if (
      asset.outlined &&
      ["text", "tspan", "textPath"].includes(node.localName)
    )
      throw new AppError(msg("errors.outlineConversion"));
    if (!["svg", "g", "text", "tspan"].includes(node.localName) && !vector)
      throw new AppError(msg("errors.svgElement", { element: node.localName }));
    const target =
      node.localName === "svg"
        ? parent
        : document.createElementNS(ns, node.localName);
    if (target !== parent) parent.appendChild(target);
    for (const attr of node.attributes) {
      // Internal SVGs are serialized again for decorations. Reapply the asset's
      // clipping policy instead of copying a previous root overflow attribute.
      if (node === root && attr.name === "overflow") continue;
      if (vector && vectorAttrs.has(attr.name)) {
        if (/url\s*\(/i.test(attr.value))
          throw new AppError(msg("errors.svgReference"));
        target.setAttribute(attr.name, attr.value);
        continue;
      }
      if (
        [
          "xmlns",
          "xmlns:xlink",
          "width",
          "height",
          "viewBox",
          "id",
          "version",
          "data-figma-text",
        ].includes(attr.name)
      )
        continue;
      if (attr.name === "style") {
        const scratch = document.createElement("span");
        scratch.setAttribute("style", attr.value);
        for (const prop of scratch.style) {
          if (
            !allowedStyles.has(prop) &&
            !(
              rich &&
              [
                "font-feature-settings",
                "font-variant-position",
                "baseline-shift",
              ].includes(prop)
            )
          )
            throw new AppError(msg("errors.textStyle", { style: prop }));
          const value = scratch.style.getPropertyValue(prop);
          if (/url\s*\(/i.test(value))
            throw new AppError(msg("errors.externalSvgReference"));
          (target as SVGElement).style.setProperty(prop, value);
        }
      } else if (
        allowedAttrs.has(attr.name) ||
        (rich &&
          [
            "font-feature-settings",
            "font-variant-position",
            "baseline-shift",
          ].includes(attr.name))
      ) {
        if (/url\s*\(/i.test(attr.value))
          throw new AppError(msg("errors.svgReference"));
        target.setAttribute(attr.name, attr.value);
      } else
        throw new AppError(
          msg("errors.svgAttribute", { attribute: attr.name }),
        );
    }
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) copy(child as Element, target);
      else if (
        child.nodeType === Node.TEXT_NODE &&
        ["text", "tspan"].includes(node.localName)
      )
        target.appendChild(document.createTextNode(child.textContent ?? ""));
    }
  }
  copy(root, out);
  if (
    !asset.outlined &&
    !out.querySelector("text") &&
    asset.fonts.some((f) => f.characters.trim())
  )
    throw new AppError(msg("errors.svgTextMissing"));
  // svg2pdf replaces nested opacity rather than multiplying it. Resolve the
  // text-node alpha and SVG group alpha into each painted run explicitly.
  const alpha = (value: string) => {
    const number = value.endsWith("%")
      ? Number(value.slice(0, -1)) / 100
      : Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1)
      throw new AppError(msg("errors.textOpacity"));
    return number;
  };
  function opacity(node: SVGElement, ancestor: number, inheritedFill: number) {
    const property = (name: string) =>
      node.style.getPropertyValue(name) || node.getAttribute(name);
    const own = property("opacity");
    const paint = property("fill-opacity");
    const combined = ancestor * (own ? alpha(own) : 1);
    const fill = paint ? alpha(paint) : inheritedFill;
    const textNode = ["text", "tspan"].includes(node.localName);
    if (textNode && node.children.length) {
      // Keep container graphics states opaque. Otherwise svg2pdf may leave a
      // parent's translucent state active when a child restores opaque paint.
      for (const child of [...node.childNodes]) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const span = document.createElementNS(ns, "tspan");
        node.replaceChild(span, child);
        span.append(child);
      }
    }
    for (const child of node.children)
      opacity(child as SVGElement, combined, fill);
    const painted =
      (textNode && !node.children.length) || vectorTags.has(node.localName);
    node.style.removeProperty("opacity");
    node.style.removeProperty("fill-opacity");
    node.setAttribute("opacity", "1");
    node.setAttribute("fill-opacity", String(painted ? combined * fill : 1));
  }
  opacity(out, alpha(String(asset.opacity ?? 1)), 1);
  return out;
}
/** Page-sized SVG applies arbitrary affine text transforms in downward-Y coordinates. */
export function positionedTextSVG(
  asset: TextAsset,
  width: number,
  height: number,
) {
  const [a, b, c, d] = asset.transform ?? [1, 0, 0, 1];
  if (
    ![a, b, c, d, asset.x, asset.y].every(Number.isFinite) ||
    Math.abs(a * d - b * c) < 1e-12
  )
    throw new AppError(msg("errors.textTransform"));
  const page = document.createElementNS(ns, "svg");
  page.setAttribute("width", String(width));
  page.setAttribute("height", String(height));
  page.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const group = document.createElementNS(ns, "g");
  group.setAttribute(
    "transform",
    `matrix(${a} ${b} ${c} ${d} ${asset.x} ${asset.y})`,
  );
  group.append(textSVG(asset));
  page.append(group);
  return page;
}
function validateGlyphs(font: RegisteredFont, text: string) {
  for (const c of text) {
    if (/[\n\r\t]/.test(c)) continue;
    if (c.codePointAt(0)! > 0xffff)
      throw new AppError(
        msg("errors.supplementaryCharacter", { character: c }),
      );
    if (!font.parsed.charToGlyphIndex(c))
      throw new AppError(msg("errors.missingCharacter", { character: c }));
  }
}
function binary(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}
export async function opaquePNG(
  bytes: Uint8Array,
  width: number,
  height: number,
): Promise<string> {
  const blob = new Blob([bytes.slice().buffer], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.width !== width || img.height !== height)
      throw new AppError(
        msg("errors.pngDimensions", {
          actualWidth: img.width,
          actualHeight: img.height,
          width,
          height,
        }),
      );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    const result = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 1;
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export interface PDFCallbacks {
  progress?: (message: Message) => void;
  warning?: (message: Message) => void;
  outlined?: () => void;
  resolveRange?: (range: TextRangeRequest) => Promise<TextRangeResult>;
  textSummary?: (summary: { copied: number; outlined: number }) => void;
}
export async function createPDF(
  bundle: ExportBundle,
  check = () => {},
  callbacks: PDFCallbacks = {},
): Promise<Uint8Array> {
  if (bundle.protocol === 2 && bundle.mode === "text") {
    validateSize(bundle.width, bundle.height, bundle.scale);
    return renderSearchablePDF(bundle, check, callbacks, {
      registry,
      svg: textSVG,
      opaquePNG,
      plain: (b) => renderPDF(b, check, {}, false),
    });
  }
  try {
    return await renderPDF(bundle, check, callbacks);
  } catch (error) {
    check(); // Cancellation must never start a second export.
    if (bundle.mode !== "text" || !bundle.outlinePDF) {
      if (bundle.outlineError)
        throw new AppError(
          joinMessages([errorMessage(error), bundle.outlineError]),
        );
      throw error;
    }
    callbacks.warning?.(errorMessage(error));
    const bytes = await renderPDF(
      { ...bundle, mode: "outline", texts: [] },
      check,
      callbacks,
    );
    callbacks.outlined?.();
    return bytes;
  }
}
async function renderPDF(
  bundle: ExportBundle,
  check = () => {},
  callbacks: PDFCallbacks = {},
  background = true,
): Promise<Uint8Array> {
  validateSize(bundle.width, bundle.height, bundle.scale);
  check();
  const width = bundle.width * 0.75,
    height = bundle.height * 0.75;
  const pdf = new jsPDF({
    unit: "pt",
    format: [width, height],
    orientation: width > height ? "landscape" : "portrait",
    compress: true,
    putOnlyUsedFonts: true,
  });
  // The freshly created PDF receives only the flattened opaque image and validated text.
  if (background)
    pdf.addImage(
      await opaquePNG(
        bundle.png,
        rasterDimensions(bundle.width, bundle.height, bundle.scale).width,
        rasterDimensions(bundle.width, bundle.height, bundle.scale).height,
      ),
      "PNG",
      0,
      0,
      width,
      height,
    );
  check();
  if (bundle.mode === "outline") {
    if (!bundle.outlinePDF?.length)
      throw new AppError(msg("errors.outlineUnavailable"));
    callbacks.progress?.(msg("progress.embeddingOutlines"));
    const result = await PDFDocument.load(pdf.output("arraybuffer"));
    check();
    const layer = await PDFDocument.load(bundle.outlinePDF);
    if (layer.getPageCount() !== 1)
      throw new AppError(msg("errors.outlinePageCount"));
    const [outlines] = await result.embedPages([layer.getPage(0)]);
    result.getPage(0).drawPage(outlines, { x: 0, y: 0, width, height });
    check();
    const bytes = await result.save();
    check();
    return bytes;
  }
  const loadedFaces: FontFace[] = [];
  const hosts: HTMLElement[] = [];
  const subsetter = createFontSubsetter(check);
  const prepared: {
    svg: SVGSVGElement;
    resolved: { el: SVGElement; font: RegisteredFont }[];
  }[] = [];
  const usage = new Map<RegisteredFont, Set<string>>();
  const subsetNames = new Map<string, string>();
  try {
    if (bundle.mode === "text") {
      // Gather only final SVG text: never the original, possibly truncated FontSpec.characters.
      for (const asset of bundle.texts) {
        check();
        if (asset.outlined)
          callbacks.warning?.(
            msg("outlines.vectorLayer", { name: asset.name }),
          );
        const svg = positionedTextSVG(asset, bundle.width, bundle.height);
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;left:-100000px;top:0;pointer-events:none";
        host.append(svg);
        document.body.append(host);
        hosts.push(host);
        const resolved = [
          ...svg.querySelectorAll<SVGElement>("text,tspan"),
        ].map((el) => ({ el, font: chooseFont(el, asset.fonts) }));
        for (const { el, font } of resolved) {
          const text = [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? "")
            .join("");
          validateGlyphs(font, text);
          if (!text) continue;
          let characters = usage.get(font);
          if (!characters) usage.set(font, (characters = new Set()));
          for (const c of text) if (!/[\n\r\t]/.test(c)) characters.add(c);
        }
        prepared.push({ svg, resolved });
      }
      let index = 0;
      for (const [font, characters] of usage) {
        if (!characters.size) continue;
        check();
        const label = [
          font.parsed.names.fontFamily?.en ?? font.alias,
          font.parsed.names.fontSubfamily?.en,
        ]
          .filter(Boolean)
          .join(" / ");
        index++;
        callbacks.progress?.(
          msg("progress.subsettingFont", {
            current: index,
            total: usage.size,
            family: label,
          }),
        );
        let bytes = font.bytes;
        const alias = font.alias;
        try {
          const compact = await subsetter.subset(
            font.bytes,
            [...characters].join(""),
          );
          check();
          const parsed = opentype.parse(compact.slice().buffer);
          if (parsed.unitsPerEm !== font.parsed.unitsPerEm)
            throw new AppError(msg("errors.fontUnitsChanged"));
          for (const c of characters) {
            if (
              !parsed.charToGlyphIndex(c) ||
              parsed.charToGlyph(c).advanceWidth !==
                font.parsed.charToGlyph(c).advanceWidth
            )
              throw new AppError(
                msg("errors.characterWidth", { character: c }),
              );
          }
          // A PDF subset tag identifies the fully compacted font, not just sparse outlines.
          subsetNames.set(
            alias,
            `${index
              .toString(26)
              .padStart(6, "0")
              .split("")
              .map((c) => String.fromCharCode(65 + parseInt(c, 26)))
              .join("")}+${font.alias}`,
          );
          bytes = compact;
        } catch (e) {
          check(); // Cancellation never becomes a successful fallback.
          callbacks.warning?.(
            msg("fonts.fallbackEmbedding", {
              family: label,
              reason: errorMessage(e),
            }),
          );
        }
        pdf.addFileToVFS(alias + ".ttf", binary(bytes));
        pdf.addFont(alias + ".ttf", alias, "normal");
        if (!pdf.getFontList()[alias])
          throw new AppError(msg("errors.pdfFontRegistration"));
        // Browser measurements keep original shaping tables and metrics.
        const face = new FontFace(alias, font.bytes.slice().buffer);
        await face.load();
        document.fonts.add(face);
        loadedFaces.push(face);
      }
      subsetter.dispose();
      callbacks.progress?.(msg("progress.placingText"));
      for (const { svg, resolved } of prepared) {
        for (const { el, font } of resolved) {
          const alias = font.alias;
          el.style.fontFamily = `"${alias}"`;
          el.style.fontWeight = "normal";
          el.style.fontStyle = "normal";
          el.setAttribute("font-family", alias);
          el.setAttribute("font-weight", "normal");
          el.setAttribute("font-style", "normal");
        }
        appendTextDecorations(
          svg,
          resolved
            .filter(({ el }) => !el.children.length && el.textContent)
            .map(({ el, font }) => ({
              el: el as SVGTextContentElement,
              font,
            })),
        );
        check();
        await pdf.svg(svg, { x: 0, y: 0, width, height });
        check();
      }
    }
    check();
    // Apply PDF-only subset names after layout. '+' is not a CSS font identifier.
    for (const [alias, name] of subsetNames) {
      pdf.setFont(alias, "normal");
      pdf.getFont().fontName = name;
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    subsetter.dispose();
    for (const host of hosts) host.remove();
    for (const face of loadedFaces) document.fonts.delete(face);
  }
}
