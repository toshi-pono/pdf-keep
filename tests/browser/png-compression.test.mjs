import { build } from "esbuild";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { decode, encode } from "fast-png";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { launchBrowser, poppler } from "../helpers/browser.mjs";

await mkdir("tmp/qa", { recursive: true });
const code = await build({
  entryPoints: ["src/pdf/create-pdf.ts"],
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "P",
});
const width = 384,
  height = 256;
const data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    // Transparent magenta must be flattened, never preserved as hidden RGB/SMask.
    data.set(
      x < 30
        ? [255, 0, 255, 0]
        : [x % 256, y, (x + y) % 256, x < 70 ? 100 : 255],
      i,
    );
  }
const png = encode({ width, height, data, channels: 4 });
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const result = await page.evaluate(
    async ({ bytes, width, height }) => {
      const P = globalThis.P;
      const png = new Uint8Array(bytes);
      const reference = await P.opaquePNG(png, width, height);
      const pdf = await P.createPDF({
        protocol: 2,
        id: 1,
        name: "PNG predictor",
        width,
        height,
        scale: 1,
        mode: "text",
        png,
        texts: [],
        outlineFallback: false,
      });
      return { reference, pdf: Array.from(pdf) };
    },
    { bytes: Array.from(png), width, height },
  );
  const file = "tmp/qa/png-compression.pdf";
  await writeFile(file, new Uint8Array(result.pdf));
  const reference = Buffer.from(result.reference.split(",")[1], "base64");
  await writeFile("tmp/qa/png-compression-reference.png", reference);
  const baseline = await PDFDocument.create();
  const old = await baseline.embedPng(reference);
  await old.embed();
  baseline.addPage([width * 0.75, height * 0.75]).drawImage(old, {
    width: width * 0.75,
    height: height * 0.75,
  });
  await writeFile("tmp/qa/png-compression-before.pdf", await baseline.save());
  const original = baseline.context.lookup(old.ref);
  const doc = await PDFDocument.load(new Uint8Array(result.pdf));
  const images = doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter(
      (o) =>
        o instanceof PDFRawStream &&
        o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    );
  assert.equal(images.length, 1);
  assert(!images[0].dict.has(PDFName.of("SMask")));
  assert.match(images[0].dict.toString(), /Predictor 15/);
  assert(images[0].getContentsSize() < original.getContentsSize() * 0.5);
  execFileSync(poppler("pdfimages"), [
    "-png",
    file,
    "tmp/qa/png-compression-extracted",
  ]);
  const rgb = (png) => {
    const im = decode(png);
    return {
      width: im.width,
      height: im.height,
      data: Uint8Array.from(
        { length: im.width * im.height * 3 },
        (_, i) => im.data[Math.floor(i / 3) * im.channels + (i % 3)],
      ),
    };
  };
  assert.deepEqual(
    rgb(await readFile("tmp/qa/png-compression-extracted-000.png")),
    rgb(reference),
  );
  execFileSync(poppler("pdftoppm"), [
    "-r",
    "96",
    "-png",
    "-singlefile",
    file,
    "tmp/qa/png-compression-rendered",
  ]);
  execFileSync(poppler("pdftoppm"), [
    "-r",
    "96",
    "-png",
    "-singlefile",
    "tmp/qa/png-compression-before.pdf",
    "tmp/qa/png-compression-before",
  ]);
  assert.deepEqual(
    rgb(await readFile("tmp/qa/png-compression-rendered.png")),
    rgb(await readFile("tmp/qa/png-compression-before.png")),
  );
  console.log(
    "Predictor PDF: identical extracted and rendered pixels, one opaque image",
    {
      before: original.getContentsSize(),
      after: images[0].getContentsSize(),
    },
  );
} finally {
  await browser.close();
}
