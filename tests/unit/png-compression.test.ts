import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { encode, decode } from "fast-png";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  type PDFRef,
} from "pdf-lib";
import {
  embedCompressedPNG,
  pngPredictorRows,
} from "../../src/pdf/png-compression";

function imageStream(doc: PDFDocument, ref: PDFRef) {
  const stream = doc.context.lookup(ref);
  assert(stream instanceof PDFRawStream);
  return stream;
}
// pdf-lib's stream decoder inflates but does not undo PNG predictors. Use the
// independent PNG decoder with minimal test-only framing (CRCs are not needed).
function readRGB(stream: PDFRawStream, width: number, height: number) {
  if (!stream.dict.has(PDFName.of("DecodeParms")))
    return decodePDFRawStream(stream).decode();
  const chunk = (tag: string, bytes: Uint8Array) => {
    const out = Buffer.alloc(bytes.length + 12);
    out.writeUInt32BE(bytes.length);
    out.write(tag, 4);
    out.set(bytes, 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", stream.getContents()),
    chunk("IEND", new Uint8Array()),
  ]);
  return decode(png, { checkCrc: false }).data;
}

function fixture(width: number, height: number, noise = false) {
  let seed = 413;
  const data = Uint8Array.from({ length: width * height * 3 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    if (noise) return seed >>> 24;
    const x = Math.floor(i / 3) % width,
      y = Math.floor(i / 3 / width);
    return (x * ((i % 3) + 1) + y * 2) % 256;
  });
  const png = `data:image/png;base64,${Buffer.from(encode({ width, height, data, channels: 3 })).toString("base64")}`;
  return { data, png };
}

test("PNG row prediction round-trips byte boundaries, gradients and noise", async () => {
  const doc = await PDFDocument.create();
  for (const [width, height] of [
    [1, 1],
    [1, 257],
    [257, 1],
    [197, 113],
  ]) {
    for (const noise of [false, true]) {
      const { data } = fixture(width, height, noise);
      const rows = await pngPredictorRows(data, width, height);
      const stream = doc.context.stream(deflateSync(rows), {
        Filter: "FlateDecode",
        DecodeParms: {
          Predictor: 15,
          Colors: 3,
          BitsPerComponent: 8,
          Columns: width,
        },
      });
      assert.deepEqual(readRGB(stream, width, height), data);
    }
  }
  await assert.rejects(pngPredictorRows(new Uint8Array(2), 1, 1));
  await assert.rejects(pngPredictorRows(new Uint8Array(), 0, 1));
});

test("PNG compression only replaces smaller streams and survives save/load", async () => {
  for (const [width, height, noise] of [
    [1, 1, false],
    [211, 149, false],
    [193, 127, true],
  ] as const) {
    const { png, data } = fixture(width, height, noise);
    const baseline = await PDFDocument.create();
    const old = await baseline.embedPng(png);
    await old.embed();
    const original = imageStream(baseline, old.ref);
    const doc = await PDFDocument.create();
    const image = await embedCompressedPNG(doc, png);
    doc.addPage([width, height]).drawImage(image, { width, height });
    const stream = imageStream(doc, image.ref);
    assert(stream.sizeInBytes() <= original.sizeInBytes());
    if (width === 1)
      assert(
        !stream.dict.has(PDFName.of("DecodeParms")),
        "dictionary overhead must not enlarge tiny images",
      );
    else if (!noise) {
      assert(stream.dict.has(PDFName.of("DecodeParms")));
      assert(stream.getContentsSize() < original.getContentsSize() * 0.5);
    }
    assert.deepEqual(readRGB(stream, width, height), data);
    const loaded = await PDFDocument.load(await doc.save());
    assert.deepEqual(
      readRGB(imageStream(loaded, image.ref), width, height),
      data,
    );
  }
});

test("compression failure keeps the original; cancellation still rejects", async () => {
  const { png, data } = fixture(120, 100);
  const native = globalThis.CompressionStream;
  let cancelled = false;
  try {
    globalThis.CompressionStream = class {
      constructor() {
        throw Error("encoder failure");
      }
    } as unknown as typeof CompressionStream;
    const doc = await PDFDocument.create();
    const image = await embedCompressedPNG(doc, png);
    const stream = imageStream(doc, image.ref);
    assert(!stream.dict.has(PDFName.of("DecodeParms")));
    assert.deepEqual(readRGB(stream, 120, 100), data);
    globalThis.CompressionStream = class {
      constructor() {
        cancelled = true;
        throw Error("encoder failure");
      }
    } as unknown as typeof CompressionStream;
    await assert.rejects(
      embedCompressedPNG(await PDFDocument.create(), png, () => {
        if (cancelled) throw Error("cancelled");
      }),
      /cancelled/,
    );
    globalThis.CompressionStream =
      undefined as unknown as typeof CompressionStream;
    const fallback = await PDFDocument.create();
    const other = await embedCompressedPNG(fallback, png);
    const encoded = imageStream(fallback, other.ref);
    assert(encoded.dict.has(PDFName.of("DecodeParms")));
    assert.deepEqual(readRGB(encoded, 120, 100), data);
  } finally {
    globalThis.CompressionStream = native;
  }
  let stop = false;
  setTimeout(() => {
    stop = true;
  }, 0);
  await assert.rejects(
    pngPredictorRows(new Uint8Array(1500 * 1000 * 3), 1500, 1000, () => {
      if (stop) throw Error("cancelled");
    }),
    /cancelled/,
  );
});
