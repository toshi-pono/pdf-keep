import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

/** PNG filters operate on bytes, including modulo-256 subtraction. Select the
 * smallest sum of signed residual magnitudes for each RGB scanline. */
export async function pngPredictorRows(
  rgb: Uint8Array,
  width: number,
  height: number,
  check = () => {},
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    rgb.length !== width * height * 3
  )
    throw Error("PNG 圧縮用の画素データが不正です。");
  const stride = width * 3;
  const output = new Uint8Array(rgb.length + height);
  const rows = Array.from({ length: 5 }, () => new Uint8Array(stride));
  let yielded = performance.now();
  for (let y = 0; y < height; y++) {
    check();
    const offset = y * stride;
    const scores = [0, 0, 0, 0, 0];
    for (let x = 0; x < stride; x++) {
      const value = rgb[offset + x];
      const left = x >= 3 ? rgb[offset + x - 3] : 0;
      const up = y ? rgb[offset + x - stride] : 0;
      const corner = y && x >= 3 ? rgb[offset + x - stride - 3] : 0;
      const p = left + up - corner;
      const a = Math.abs(p - left),
        b = Math.abs(p - up),
        c = Math.abs(p - corner);
      const paeth = a <= b && a <= c ? left : b <= c ? up : corner;
      rows[0][x] = value;
      rows[1][x] = value - left;
      rows[2][x] = value - up;
      rows[3][x] = value - Math.floor((left + up) / 2);
      rows[4][x] = value - paeth;
      for (let filter = 0; filter < 5; filter++) {
        const byte = rows[filter][x];
        scores[filter] += Math.min(byte, 256 - byte);
      }
    }
    let best = 0;
    for (let filter = 1; filter < 5; filter++)
      if (scores[filter] < scores[best]) best = filter;
    output[y * (stride + 1)] = best;
    output.set(rows[best], y * (stride + 1) + 1);
    // Let the host process cancellation and repaint during large exports.
    if (performance.now() - yielded > 16) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      check();
      yielded = performance.now();
    }
  }
  return output;
}

/** The caller supplies the already flattened opaque PNG. Keep pdf-lib's
 * original stream unless PNG Predictor 15 wins, including dictionary overhead.
 * No resizing, quantization, alpha data or source PNG metadata is introduced. */
export async function embedCompressedPNG(
  doc: PDFDocument,
  png: string,
  check = () => {},
) {
  check();
  const image = await doc.embedPng(png);
  await image.embed();
  check();
  const original = doc.context.lookup(image.ref);
  if (!(original instanceof PDFRawStream)) return image;
  if (
    original.dict.get(PDFName.of("ColorSpace")) !== PDFName.of("DeviceRGB") ||
    original.dict.has(PDFName.of("SMask")) ||
    original.dict.has(PDFName.of("Mask"))
  )
    return image;
  try {
    const rgb = decodePDFRawStream(original).decode();
    const filtered = await pngPredictorRows(
      rgb,
      image.width,
      image.height,
      check,
    );
    check();
    // Native zlib runs asynchronously. Older WebViews retain pdf-lib's encoder.
    const compressed =
      typeof CompressionStream === "undefined"
        ? doc.context.flateStream(filtered).getContents()
        : new Uint8Array(
            await new Response(
              new Blob([filtered.buffer])
                .stream()
                .pipeThrough(new CompressionStream("deflate")),
            ).arrayBuffer(),
          );
    check();
    const dict = original.dict.clone(doc.context);
    dict.set(
      PDFName.of("DecodeParms"),
      doc.context.obj({
        Predictor: 15,
        Colors: 3,
        BitsPerComponent: 8,
        Columns: image.width,
      }),
    );
    const candidate = PDFRawStream.of(dict, compressed);
    if (candidate.sizeInBytes() < original.sizeInBytes())
      doc.context.assign(image.ref, candidate);
  } catch {
    check(); // Cancellation must never become a successful fallback.
    // Compression is optional; the verified original image remains usable.
  }
  return image;
}
