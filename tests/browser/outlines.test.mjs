import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
await mkdir("tmp/qa", { recursive: true });
const code = await build({
  stdin: {
    contents:
      'export * from "./src/pdf/create-pdf"; export { jsPDF } from "jspdf";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "PaperTest",
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 240 } });
  await page.setContent('<body style="margin:0"></body>');
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const font = Array.from(
    await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
  );
  const output = await page.evaluate(async (font) => {
    const P = window.PaperTest;
    P.registerAutomatic(new Uint8Array(font));
    const parsed = [...P.registry.values()][0].parsed;
    const path = (text, y) => parsed.getPath(text, 24, y, 26).toPathData(3);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240" viewBox="0 0 560 240">
      <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#1769ef"/><stop offset="1" stop-color="#e02b55"/></linearGradient></defs>
      <path d="${path("(b) Real ski-slope images", 52)}" fill="url(#g)"/>
      <path d="${path("半透明の文字 / translucent", 112)}" fill="#1251aa" opacity="0.5"/>
      <path d="${path("Outlined stroke / 輪郭線", 176)}" fill="#fff" stroke="#345" stroke-width="0.6"/>
    </svg>`;
    const canvas = document.createElement("canvas");
    canvas.width = 560;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4eddc";
    ctx.fillRect(0, 0, 560, 240);
    ctx.fillStyle = "#d6e8eb";
    ctx.fillRect(0, 70, 560, 65);
    const background = canvas.toDataURL();
    document.body.style.backgroundImage = `url(${background})`;
    document.body.innerHTML = svg;
    const layer = new P.jsPDF({
      unit: "pt",
      format: [560, 240],
      orientation: "landscape",
      compress: true,
      putOnlyUsedFonts: true,
    });
    await layer.svg(document.querySelector("svg"), {
      x: 0,
      y: 0,
      width: 560,
      height: 240,
    });
    const outlinePDF = new Uint8Array(layer.output("arraybuffer"));
    const png = new Uint8Array(await (await fetch(background)).arrayBuffer());
    const bundle = {
      id: 1,
      name: "outline-verification",
      width: 560,
      height: 240,
      scale: 1,
      mode: "outline",
      png,
      outlinePDF,
      texts: [],
    };
    P.registry.clear(); // Outlines require no font registration.
    const direct = await P.createPDF(bundle);
    let fallback = 0;
    const textBundle = {
      ...bundle,
      mode: "text",
      texts: [
        {
          x: 0,
          y: 0,
          width: 560,
          height: 240,
          name: "unsupported",
          fonts: [],
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240"><text x="10" y="30" font-family="Missing Font">Unconvertible text</text></svg>',
        },
      ],
    };
    const automatic = await P.createPDF(textBundle, () => {}, {
      outlined: () => fallback++,
    });
    if (fallback !== 1) throw Error("Text conversion did not fall back");
    let cancelled = false;
    try {
      await P.createPDF(
        textBundle,
        () => {
          throw Error("cancel");
        },
        { outlined: () => fallback++ },
      );
    } catch (error) {
      cancelled = error.message === "cancel";
    }
    if (!cancelled || fallback !== 1)
      throw Error("Cancellation started a fallback");
    let invalid = false;
    try {
      await P.createPDF({ ...bundle, outlinePDF: new Uint8Array([1, 2, 3]) });
    } catch {
      invalid = true;
    }
    if (!invalid) throw Error("Invalid outline PDF was accepted");
    return { direct: Array.from(direct), automatic: Array.from(automatic) };
  }, font);
  await page.screenshot({ path: "tmp/qa/outlines-reference.png" });
  for (const [name, bytes] of Object.entries(output)) {
    const path = `tmp/qa/outlines-${name}.pdf`;
    await writeFile(path, new Uint8Array(bytes));
    assert.equal(
      execFileSync(poppler("pdftotext"), [path, "-"], {
        encoding: "utf8",
      }).trim(),
      "",
    );
    const images = execFileSync(poppler("pdfimages"), ["-list", path], {
      encoding: "utf8",
    });
    assert.equal(
      images.trim().split("\n").length,
      3,
      "Only the baked background should be an image",
    );
    const fonts = execFileSync(poppler("pdffonts"), [path], {
      encoding: "utf8",
    });
    assert.equal(
      fonts.trim().split("\n").length,
      2,
      "Outlined glyphs must not embed fonts",
    );
    execFileSync(poppler("pdftoppm"), [
      "-r",
      "96",
      "-singlefile",
      "-png",
      path,
      `tmp/qa/outlines-${name}`,
    ]);
  }
  const images = await Promise.all(
    ["reference", "direct", "automatic"].map(async (name) =>
      (await readFile(`tmp/qa/outlines-${name}.png`)).toString("base64"),
    ),
  );
  const comparison = await page.evaluate(async (images) => {
    const pixels = await Promise.all(
      images.map(async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        if (image.width !== 560 || image.height !== 240)
          throw Error("Wrong page dimensions");
        const canvas = document.createElement("canvas");
        canvas.width = 560;
        canvas.height = 240;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, 560, 240).data;
      }),
    );
    return pixels.slice(1).map((candidate) => {
      let difference = 0;
      for (let i = 0; i < candidate.length; i += 4) {
        if (
          Math.max(
            ...[0, 1, 2].map((c) =>
              Math.abs(candidate[i + c] - pixels[0][i + c]),
            ),
          ) > 45
        )
          difference++;
      }
      return difference / (560 * 240);
    });
  }, images);
  assert(
    comparison.every((ratio) => ratio < 0.035),
    `Visual difference: ${comparison}`,
  );
  console.log(
    "Outline PDF tests passed: gradient, opacity, stroke, vector-only text, baked background, automatic fallback, cancellation, page scaling.",
    comparison,
  );
} finally {
  await browser.close();
}
