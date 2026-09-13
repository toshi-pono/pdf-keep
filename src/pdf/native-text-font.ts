import { PDFDocument, PDFName } from "pdf-lib";
import { unicodeHex } from "./cid-font";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tight bounds prevent transparent neighbouring ranges from becoming glyph
 * metrics. The original viewport clips only explicitly truncated text. */
export function nativeTextGlyph(
  source: SVGSVGElement,
  clip?: { width: number; height: number },
  whitespace?: Box,
) {
  const svg = source.cloneNode(true) as SVGSVGElement;
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none";
  host.append(svg);
  document.body.append(host);
  let box: Box;
  try {
    for (const element of svg.querySelectorAll<SVGElement>(
      "path,circle,ellipse,rect,line,polygon,polyline",
    )) {
      if (Number(getComputedStyle(element).fillOpacity) === 0) element.remove();
    }
    const b = svg.getBBox();
    box = { x: b.x, y: b.y, width: b.width, height: b.height };
  } finally {
    host.remove();
  }
  if ((box.width <= 0 || box.height <= 0) && whitespace)
    box = { ...whitespace };
  if (clip) {
    const right = Math.min(clip.width, box.x + box.width);
    const bottom = Math.min(clip.height, box.y + box.height);
    box.x = Math.max(0, box.x);
    box.y = Math.max(0, box.y);
    box.width = right - box.x;
    box.height = bottom - box.y;
  }
  if (box.width <= 0 || box.height <= 0)
    throw Error("代替文字の可視字形がありません。");
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  svg.setAttribute("width", String(box.width));
  svg.setAttribute("height", String(box.height));
  return { box, svg: new XMLSerializer().serializeToString(svg) };
}

/** A Type 3 glyph can contain a complete shaped run, just like a ligature.
 * Its visible artwork comes from Figma; ToUnicode supplies the original text.
 * This avoids guessing which fallback font/version produced missing glyphs.
 */
export async function embedNativeTextFont(
  document: PDFDocument,
  pdf: Uint8Array,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  anchor: { x: number; y: number },
) {
  if (
    !text ||
    ![box.x, box.y, box.width, box.height, anchor.x, anchor.y].every(
      Number.isFinite,
    ) ||
    box.width <= 0 ||
    box.height <= 0
  )
    throw Error("代替フォントの字形または文字情報が不正です。");
  const source = await PDFDocument.load(pdf);
  if (source.getPageCount() !== 1)
    throw Error("代替フォントの字形ページが不正です。");
  const [glyph] = await document.embedPages([source.getPage(0)]);
  const ctx = document.context;
  const x = box.x - anchor.x;
  const y = anchor.y - box.y - box.height;
  const width = Math.max(box.width, x + box.width);
  const procedure = ctx.register(
    ctx.flateStream(
      `${width} 0 d0\nq\n${box.width / glyph.width} 0 0 ${box.height / glyph.height} ${x} ${y} cm\n/Glyph Do\nQ`,
    ),
  );
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /PDFKeepNativeUnicode def
/CMapType 2 def
1 begincodespacerange
<01> <01>
endcodespacerange
1 beginbfchar
<01> <${unicodeHex(text)}>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  return ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type3",
      FontBBox: [x, y, x + box.width, y + box.height],
      FontMatrix: [1, 0, 0, 1, 0, 0],
      CharProcs: { Run: procedure },
      Encoding: { Type: "Encoding", Differences: [1, PDFName.of("Run")] },
      FirstChar: 1,
      LastChar: 1,
      Widths: [width],
      Resources: { XObject: { Glyph: glyph.ref } },
      ToUnicode: ctx.register(ctx.flateStream(cmap)),
    }),
  );
}
