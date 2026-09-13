import { inflateSync } from "node:zlib";
// Inspect jsPDF's own output (not a general-purpose PDF parser).
export function fontStats(pdf) {
  const text = pdf.toString("latin1");
  return [...text.matchAll(/\/FontFile2 (\d+) 0 R/g)].map((match) => {
    const object = new RegExp(`(?:^|\\n)${match[1]} 0 obj\\r?\\n`).exec(text);
    const start = text.indexOf("stream\n", object.index) + 7;
    const dict = text.slice(object.index, start);
    const size = Number(dict.match(/\/Length (\d+)/)[1]);
    const packed = pdf.subarray(start, start + size);
    const raw = dict.includes("/FlateDecode") ? inflateSync(packed) : packed;
    const tables = {};
    for (let i = 0; i < raw.readUInt16BE(4); i++) {
      const p = 12 + i * 16;
      tables[raw.toString("ascii", p, p + 4)] = {
        offset: raw.readUInt32BE(p + 8),
        length: raw.readUInt32BE(p + 12),
      };
    }
    const slots = raw.readUInt16BE(tables.maxp.offset + 4);
    const long = raw.readUInt16BE(tables.head.offset + 50) === 1;
    const locations = Array.from({ length: slots + 1 }, (_, i) =>
      long
        ? raw.readUInt32BE(tables.loca.offset + 4 * i)
        : raw.readUInt16BE(tables.loca.offset + 2 * i) * 2,
    );
    return {
      compressedBytes: size,
      fontBytes: raw.length,
      glyphSlots: slots,
      nonemptyGlyphs: locations.slice(1).filter((n, i) => n !== locations[i])
        .length,
      tables: Object.fromEntries(
        Object.entries(tables).map(([tag, t]) => [tag, t.length]),
      ),
    };
  });
}
