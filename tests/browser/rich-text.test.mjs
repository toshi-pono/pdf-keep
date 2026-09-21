import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
await mkdir("tmp/qa", { recursive: true });
const code = await build({
  entryPoints: ["src/pdf/create-pdf.ts"],
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "PaperTest",
});
const font = Array.from(
  await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 760, height: 500 },
    deviceScaleFactor: 1,
  });
  await page.setContent('<body style="margin:0"></body>');
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const output = await page.evaluate(async (font) => {
    const P = window.PaperTest;
    P.registerAutomatic(new Uint8Array(font));
    const parsed = [...P.registry.values()][0].parsed;
    const face = new FontFace("Reference", new Uint8Array(font).buffer);
    await face.load();
    document.fonts.add(face);
    const ns = "http://www.w3.org/2000/svg";
    const wrap = (inner) =>
      `<svg xmlns="${ns}" width="760" height="500" viewBox="0 0 760 500">${inner}</svg>`;
    const fonts = [
      {
        family: "M PLUS 1p",
        style: "Regular",
        weight: 400,
        italic: false,
        characters: "",
      },
    ];
    const text = (inner, opacity = 1) => ({
      name: "Searchable alpha",
      x: 0,
      y: 0,
      width: 760,
      height: 500,
      opacity,
      fonts,
      svg: wrap(
        `<text font-family="M PLUS 1p" font-size="26" fill="#164cad">${inner}</text>`,
      ),
    });
    const texts = [
      text(
        '<tspan x="24" y="42" fill-opacity="0.5">Fill alpha 50% / 半透明</tspan>',
      ),
      text('<tspan x="24" y="88">Layer alpha 50%</tspan>', 0.5),
      text(
        '<tspan x="24" y="134" fill-opacity="0.5">Combined alpha 25%</tspan><tspan x="390" y="134">Normal paint 50%</tspan>',
        0.5,
      ),
      text(
        '<tspan x="24" y="182" fill-opacity="0.2">Alpha 20%</tspan><tspan x="230" y="182" fill-opacity="1">Opaque 100%</tspan>',
      ),
    ];
    // Simulated native Figma glyph output. The lifecycle test verifies that lists
    // and script OpenType ranges actually request svgOutlineText:true from Figma.
    const path = (value, x, y, size = 22) =>
      `<path d="${parsed.getPath(value, x, y, size).toPathData(3)}"/>`;
    texts[3].svg = texts[3].svg.replace("<text ", '<text fill-opacity="0.4" ');
    texts[2].svg = wrap(
      `<text font-family="M PLUS 1p" font-size="26" fill="#164cad"><tspan x="24" y="134" opacity="0.5">Combined alpha 25%</tspan><tspan x="390" y="134">Normal paint 50%</tspan></text>`,
    );
    texts[0].svg = wrap(
      `<g opacity="0.5"><text font-family="M PLUS 1p" font-size="26" fill="#164cad"><tspan x="24" y="42">Fill alpha 50% / 半透明</tspan></text></g>`,
    );
    const rich = [
      '<circle cx="29" cy="228" r="3"/>',
      path("Bullet first line", 48, 235),
      path("wrapped continuation", 48, 263),
      '<circle cx="53" cy="287" r="2.5"/>',
      path("Nested item", 72, 294),
      path("9.", 392, 235),
      path("Numbered item", 432, 235),
      path("10.", 378, 265),
      path("Two-digit number", 432, 265),
      path("11.", 378, 295),
      path("Next paragraph", 432, 295),
      path("E = mc", 24, 354, 28),
      path("2", 117, 341, 18),
      path("H", 220, 354, 28),
      path("2", 242, 364, 18),
      path("O", 256, 354, 28),
      path("x", 370, 354, 28),
      path("n+1", 387, 341, 18),
      path("Index", 490, 354, 28),
      path("i,j", 572, 364, 18),
    ].join("");
    texts.push({
      name: "Native list and script glyphs",
      x: 0,
      y: 0,
      width: 760,
      height: 500,
      opacity: 0.65,
      outlined: true,
      fonts: [],
      svg: wrap(`<g fill="#123b63" fill-rule="nonzero">${rich}</g>`),
    });
    texts.push(
      text('<tspan x="24" y="435">Searchable text after vector glyphs</tspan>'),
    );
    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = 500;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f3ead4";
    ctx.fillRect(0, 0, 760, 500);
    ctx.fillStyle = "#c9e5e6";
    ctx.fillRect(0, 55, 760, 98);
    ctx.fillStyle = "#e5eef4";
    ctx.fillRect(0, 205, 760, 180);
    const background = canvas.toDataURL();
    document.body.style.backgroundImage = `url(${background})`;
    // Independent reference, without using the production sanitizer/positioner.
    document.body.innerHTML = wrap(
      texts
        .map(
          (asset) =>
            `<g opacity="${asset.opacity}">${asset.svg.replaceAll('font-family="M PLUS 1p"', 'font-family="Reference"')}</g>`,
        )
        .join(""),
    );
    const png = new Uint8Array(await (await fetch(background)).arrayBuffer());
    const warnings = [];
    const pdf = await P.createPDF(
      {
        id: 1,
        name: "rich-text",
        width: 760,
        height: 500,
        scale: 1,
        mode: "text",
        texts,
        png,
      },
      () => {},
      { warning: (message) => warnings.push(message) },
    );
    if (
      warnings.length !== 1 ||
      warnings[0].key !== "outlines.vectorLayer" ||
      warnings[0].params.name !== "Native list and script glyphs"
    )
      throw Error(JSON.stringify(warnings));
    const vectorAsset = texts.find((asset) => asset.outlined);
    for (const payload of [
      '<image href="secret.png"/>',
      "<script>alert(1)</script>",
      '<path fill="url(#secret)" d="M0 0H10V10Z"/>',
      "<text>Hidden original text</text>",
    ]) {
      let rejected = false;
      try {
        P.textSVG({ ...vectorAsset, svg: wrap(payload) });
      } catch {
        rejected = true;
      }
      if (!rejected) throw Error(`Unsafe vector asset accepted: ${payload}`);
    }
    return Array.from(pdf);
  }, font);
  await page.screenshot({ path: "tmp/qa/rich-text-reference.png" });
  const file = "tmp/qa/rich-text.pdf";
  await writeFile(file, new Uint8Array(output));
  const extracted = execFileSync(poppler("pdftotext"), ["-layout", file, "-"], {
    encoding: "utf8",
  });
  for (const expected of [
    "Fill alpha 50% / 半透明",
    "Layer alpha 50%",
    "Combined alpha 25%",
    "Normal paint 50%",
    "Alpha 20%",
    "Opaque 100%",
    "Searchable text after vector glyphs",
  ])
    assert(extracted.includes(expected), extracted);
  assert(
    !extracted.includes("Bullet first line"),
    "Native outlined text must not add hidden searchable copies",
  );
  const images = execFileSync(poppler("pdfimages"), ["-list", file], {
    encoding: "utf8",
  });
  assert.equal(
    images.trim().split("\n").length,
    3,
    "Only one baked image; glyphs remain vectors/text",
  );
  const fonts = execFileSync(poppler("pdffonts"), [file], { encoding: "utf8" });
  assert.match(
    fonts,
    /yes\s+yes\s+yes/,
    "Searchable subset font with Unicode mapping",
  );
  execFileSync(poppler("pdftoppm"), [
    "-r",
    "96",
    "-singlefile",
    "-png",
    file,
    "tmp/qa/rich-text",
  ]);
  const pngs = await Promise.all(
    ["reference", "pdf"].map(async (name) =>
      (
        await readFile(
          name === "reference"
            ? "tmp/qa/rich-text-reference.png"
            : "tmp/qa/rich-text.png",
        )
      ).toString("base64"),
    ),
  );
  const comparisons = await page.evaluate(async (pngs) => {
    const pixels = await Promise.all(
      pngs.map(async (png) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        if (img.width !== 760 || img.height !== 500)
          throw Error("Wrong PDF dimensions");
        const canvas = document.createElement("canvas");
        canvas.width = 760;
        canvas.height = 500;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, 760, 500).data;
      }),
    );
    return [
      [0, 760, 0, 55],
      [0, 760, 55, 102],
      [0, 360, 102, 151],
      [380, 760, 102, 151],
      [0, 200, 151, 200],
      [210, 760, 151, 200],
      [0, 760, 205, 385],
      [0, 760, 390, 465],
    ].map(([left, right, top, bottom]) => {
      const stats = pixels.map((data) => {
        const colors = [];
        const bounds = [right, bottom, left, top];
        for (let y = top; y < bottom; y++)
          for (let x = left; x < right; x++) {
            const index = (y * 760 + x) * 4;
            const background = data[(y * 760 + 755) * 4];
            if (data[index] < background - 15) {
              colors.push(data[index]);
              bounds[0] = Math.min(bounds[0], x);
              bounds[1] = Math.min(bounds[1], y);
              bounds[2] = Math.max(bounds[2], x);
              bounds[3] = Math.max(bounds[3], y);
            }
          }
        colors.sort((a, b) => a - b);
        // Interior ink color checks alpha independently of browser/Poppler
        // antialiasing. Bounds separately catch baseline and layout shifts.
        return {
          ink: colors.slice(0, 20).reduce((a, b) => a + b, 0) / 20,
          count: colors.length,
          bounds,
        };
      });
      return {
        region: [left, right, top, bottom],
        inkDelta: Math.abs(stats[0].ink - stats[1].ink),
        boundsDelta: Math.max(
          ...stats[0].bounds.map((value, index) =>
            Math.abs(value - stats[1].bounds[index]),
          ),
        ),
        stats,
      };
    });
  }, pngs);
  for (const result of comparisons) {
    assert(
      result.stats.every((stat) => stat.count > 100),
      JSON.stringify(comparisons),
    );
    // Blink and Poppler differ by up to three 8-bit color levels for the
    // 20% fill on Linux, even with identical geometry and font hinting off.
    assert(result.inkDelta <= 3, JSON.stringify(comparisons));
    assert(result.boundsDelta <= 4, JSON.stringify(comparisons));
  }
  console.log(
    "Rich text PDF passed: searchable fill/layer/combined alpha, native vector lists/scripts, per-layer warnings, opaque background, reference render comparison.",
    comparisons,
  );
} finally {
  await browser.close();
}
