import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { fontStats } from "../helpers/pdf-font-stats.mjs";
await mkdir("output/pdf", { recursive: true });
await mkdir("tmp/qa", { recursive: true });
const code = await build({
  entryPoints: ["src/pdf/create-pdf.ts"],
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "PaperTest",
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const fonts = {};
  for (const style of ["Regular", "Bold"])
    fonts[style] = Array.from(
      await readFile(`tests/fixtures/fonts/MPLUS1p-${style}.ttf`),
    );
  const result = await page.evaluate(async (fonts) => {
    const P = globalThis.PaperTest;
    const family = "M PLUS 1p";
    const spec = (style, characters) => ({
      family,
      style,
      weight: style === "Bold" ? 700 : 400,
      italic: false,
      characters,
    });
    for (const bytes of Object.values(fonts))
      P.registerAutomatic(new Uint8Array(bytes));
    const source = document.createElement("canvas");
    source.width = 300;
    source.height = 180;
    const s = source.getContext("2d");
    s.fillStyle = "#339fcc";
    s.fillRect(0, 0, 300, 180);
    s.fillStyle = "#ff00ff";
    s.fillRect(0, 0, 55, 180);
    s.fillRect(125, 55, 50, 65);
    const bg = document.createElement("canvas");
    bg.width = 1680;
    bg.height = 1080;
    const c = bg.getContext("2d");
    c.scale(3, 3);
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 560, 360);
    c.drawImage(source, 60, 0, 240, 180, 30, 90, 240, 180);
    c.fillStyle = "#000";
    c.fillRect(95, 145, 50, 65);
    const png = new Uint8Array(
      await (await fetch(bg.toDataURL())).arrayBuffer(),
    );
    const asset = (text, x, y, size, style = "Regular") => ({
      x,
      y,
      width: 500 - x,
      height: 60,
      name: text,
      fonts: [spec(style, text)],
      svg: `<svg width="${500 - x}" height="60" viewBox="0 0 ${500 - x} 60" xmlns="http://www.w3.org/2000/svg"><text fill="black" xml:space="preserve" style="white-space: pre" font-family="M PLUS 1p" font-size="${size}" font-weight="${style === "Bold" ? 700 : 400}"><tspan x="0" y="${size}">${text}</tspan></text></svg>`,
    });
    const texts = [
      asset("Safe images, real text", 30, 22, 24, "Bold"),
      asset("日本語の検索とコピー", 294, 100, 18),
      asset("Nested clip + redaction", 294, 139, 14),
      asset("Figure 1: ABC 123", 30, 294, 18),
    ];
    texts.push({
      x: 294,
      y: 194,
      width: 230,
      height: 70,
      name: "mixed",
      fonts: [spec("Regular", "Regular and "), spec("Bold", "Bold")],
      svg: '<svg width="230" height="70" viewBox="0 0 230 70" xmlns="http://www.w3.org/2000/svg"><g font-family="M PLUS 1p" font-size="16"><text xml:space="preserve"><tspan x="0" y="16">Regular and </tspan><tspan font-weight="700">Bold</tspan><tspan x="0" y="40" fill="#2563eb">Second line</tspan></text></g></svg>',
    });
    const bundle = {
      id: 1,
      name: "verification",
      width: 560,
      height: 360,
      scale: 3,
      mode: "text",
      png,
      texts,
    };
    const rejected = [];
    for (const [name, svg] of Object.entries({
      image: '<svg><image href="data:image/png;base64,AA"/></svg>',
      script: "<svg><script>alert(1)</script></svg>",
      mask: '<svg><text clip-path="url(#hidden)">SECRET</text></svg>',
      css: '<svg><text style="fill:url(https://example.com)">SECRET</text></svg>',
    })) {
      try {
        P.textSVG({ ...texts[0], svg });
        throw Error("accepted unsafe SVG " + name);
      } catch (e) {
        if (String(e).includes("accepted unsafe")) throw e;
        rejected.push(name);
      }
    }
    const pdf = await P.createPDF(bundle);
    let cancelled = false;
    try {
      await P.createPDF(bundle, () => {
        throw Error("cancelled");
      });
    } catch {
      cancelled = true;
    }
    if (!cancelled) throw Error("cancel not honored");
    let missing = false;
    try {
      await P.createPDF({ ...bundle, texts: [asset("😀", 30, 20, 20)] });
    } catch {
      missing = true;
    }
    if (!missing) throw Error("unsupported glyph not blocked");
    return { pdf: Array.from(pdf), rejected };
  }, fonts);
  await writeFile("output/pdf/verification.pdf", new Uint8Array(result.pdf));
  const embedded = fontStats(Buffer.from(result.pdf));
  assert.equal(embedded.length, 2);
  assert(embedded.every((f) => f.glyphSlots < 100));
  assert(
    embedded.reduce((n, f) => n + f.compressedBytes, 0) < 195773 * 0.3,
    "at least 70% smaller than the previous Japanese fixture",
  );
  execFileSync(poppler("pdftotext"), [
    "-enc",
    "UTF-8",
    "output/pdf/verification.pdf",
    "tmp/qa/text.txt",
  ]);
  const text = await readFile("tmp/qa/text.txt", "utf8");
  for (const expected of [
    "Safe images, real text",
    "日本語の検索とコピー",
    "Figure 1: ABC 123",
    "Regular and Bold",
    "Second line",
  ])
    assert(text.includes(expected), `Missing ${expected}: ${text}`);
  const fontInfo = execFileSync(
    poppler("pdffonts"),
    ["output/pdf/verification.pdf"],
    { encoding: "utf8" },
  );
  assert(fontInfo.includes("yes"));
  await writeFile("tmp/qa/fonts.txt", fontInfo);
  const images = execFileSync(
    poppler("pdfimages"),
    ["-list", "output/pdf/verification.pdf"],
    { encoding: "utf8" },
  );
  assert.equal(images.trim().split("\n").length, 3, images);
  assert(!images.includes("smask"));
  await writeFile("tmp/qa/images.txt", images);
  execFileSync(poppler("pdfimages"), [
    "-png",
    "output/pdf/verification.pdf",
    "tmp/qa/image",
  ]);
  const extracted = await readFile("tmp/qa/image-000.png");
  await page.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const c = canvas.getContext("2d");
    c.drawImage(img, 0, 0);
    const pixels = c.getImageData(0, 0, img.width, img.height).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 245 && pixels[i + 1] < 10 && pixels[i + 2] > 245)
        throw Error("Private magenta pixels survived");
    const at = c.getImageData(110 * 3, 160 * 3, 1, 1).data;
    if (at[0] || at[1] || at[2]) throw Error("Redaction not baked in");
  }, extracted.toString("base64"));
  execFileSync(poppler("pdftoppm"), [
    "-scale-to",
    "1000",
    "-singlefile",
    "-png",
    "output/pdf/verification.pdf",
    "tmp/qa/verification",
  ]);
  await writeFile(
    "tmp/qa/report.json",
    JSON.stringify(
      {
        passed: true,
        rejected: result.rejected,
        text,
        fonts: fontInfo,
        images,
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser PDF tests passed: Japanese + English extraction, font embedding, single opaque image, no private pixels, SVG rejection, cancellation.",
  );
} finally {
  await browser.close();
}
