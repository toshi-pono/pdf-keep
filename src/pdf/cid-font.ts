import { PDFDocument, PDFName, PDFRef, PDFString } from "pdf-lib";
import type { RegisteredFont } from "./create-pdf";
import { createFontSubsetter } from "../fonts/font-subset";
import opentype from "opentype.js";
export const unicodeHex = (value: string) =>
  Array.from({ length: value.length }, (_, i) =>
    value.charCodeAt(i).toString(16).padStart(4, "0"),
  )
    .join("")
    .toUpperCase();
/** Explicit character codes decouple GSUB glyphs from their original Unicode. */
export class CIDFont {
  readonly ref: PDFRef;
  private codes = new Map<string, number>();
  private entries: { gid: number; unicode: string }[] = [
    { gid: 0, unicode: "" },
  ];
  constructor(
    private document: PDFDocument,
    readonly font: RegisteredFont,
    private index: number,
  ) {
    this.ref = document.context.nextRef();
  }
  code(gid: number, unicode: string) {
    if (!Number.isInteger(gid) || gid <= 0 || gid > 65535)
      throw Error("登録フォントに必要な字形がありません。");
    const key = JSON.stringify([gid, unicode]);
    let cid = this.codes.get(key);
    if (cid === undefined) {
      cid = this.entries.length;
      if (cid > 65535) throw Error("PDF フォントの文字数の上限を超えました。");
      this.entries.push({ gid, unicode });
      this.codes.set(key, cid);
    }
    return cid.toString(16).padStart(4, "0");
  }
  async embed(
    subsetter: ReturnType<typeof createFontSubsetter>,
    check: () => void,
    warning: (m: string) => void,
  ) {
    const parsed = this.font.parsed,
      upm = parsed.unitsPerEm;
    const glyphs = [...new Set(this.entries.map((x) => x.gid))];
    let bytes = this.font.bytes;
    let isSubset = false;
    const unicode = this.entries.map((x) => x.unicode).join("");
    try {
      const subset = await subsetter.subset(bytes, unicode, glyphs);
      check();
      const validation = opentype.parse(subset.slice().buffer);
      if (
        validation.unitsPerEm !== upm ||
        glyphs.some(
          (g) =>
            g >= validation.glyphs.length ||
            validation.glyphs.get(g).advanceWidth !==
              parsed.glyphs.get(g).advanceWidth,
        )
      )
        throw Error("字形の番号または幅を保持できませんでした。");
      bytes = subset;
      isSubset = true;
    } catch (e) {
      check();
      warning(
        `フォントの軽量化に失敗したため完全なフォントを埋め込みました: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const ctx = this.document.context;
    const prefix = this.index
      .toString(26)
      .padStart(6, "0")
      .split("")
      .map((x) => String.fromCharCode(65 + parseInt(x, 26)))
      .join("");
    const name = PDFName.of(
      `${isSubset ? prefix + "+" : ""}${this.font.alias}`,
    );
    const fontFile = ctx.register(
      ctx.flateStream(bytes, { Length1: bytes.length }),
    );
    const tables = parsed.tables as any,
      head = tables.head,
      os2 = tables.os2;
    const scale = (n: number) => (n * 1000) / upm;
    const descriptor = ctx.register(
      ctx.obj({
        Type: "FontDescriptor",
        FontName: name,
        Flags: 32 | (tables.post?.italicAngle ? 64 : 0),
        FontBBox: [head.xMin, head.yMin, head.xMax, head.yMax].map(scale),
        ItalicAngle: tables.post?.italicAngle ?? 0,
        Ascent: scale(parsed.ascender),
        Descent: scale(parsed.descender),
        CapHeight: scale(os2?.sCapHeight ?? parsed.ascender),
        StemV: 80,
        FontFile2: fontFile,
      }),
    );
    const map = new Uint8Array(this.entries.length * 2);
    const widths: number[] = [];
    this.entries.forEach((e, i) => {
      map[i * 2] = e.gid >>> 8;
      map[i * 2 + 1] = e.gid & 255;
      widths.push(scale(parsed.glyphs.get(e.gid).advanceWidth ?? 0));
    });
    const descendant = ctx.register(
      ctx.obj({
        Type: "Font",
        Subtype: "CIDFontType2",
        BaseFont: name,
        CIDSystemInfo: {
          Registry: PDFString.of("Adobe"),
          Ordering: PDFString.of("Identity"),
          Supplement: 0,
        },
        FontDescriptor: descriptor,
        DW: 1000,
        W: [0, widths],
        CIDToGIDMap: ctx.register(ctx.flateStream(map)),
      }),
    );
    const mappings = this.entries.flatMap((e, i) =>
      e.unicode
        ? [`<${i.toString(16).padStart(4, "0")}> <${unicodeHex(e.unicode)}>`]
        : [],
    );
    let cmap =
      "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PaperUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
    for (let i = 0; i < mappings.length; i += 100) {
      const chunk = mappings.slice(i, i + 100);
      cmap += `${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar\n`;
    }
    cmap += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
    ctx.assign(
      this.ref,
      ctx.obj({
        Type: "Font",
        Subtype: "Type0",
        BaseFont: name,
        Encoding: "Identity-H",
        DescendantFonts: [descendant],
        ToUnicode: ctx.register(ctx.flateStream(cmap)),
      }),
    );
  }
}
