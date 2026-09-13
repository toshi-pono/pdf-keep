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
const bytes = Array.from(
  await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<html><body style="margin:0;background:white"></body></html>',
  );
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const pdf = await page.evaluate(async (bytes) => {
    const P = globalThis.PaperTest;
    P.registerFont(
      JSON.stringify(["M PLUS 1p", "Regular"]),
      new Uint8Array(bytes),
    );
    const face = new FontFace("Reference", new Uint8Array(bytes).buffer);
    await face.load();
    document.fonts.add(face);
    const cases = [
      [80, 80, [0.8660254, 0.5, -0.5, 0.8660254]],
      [380, 70, [0, 1, -1, 0]],
      [700, 90, [-1, 0, 0, 1]],
      [80, 330, [1, 0, 0, -1]],
      [320, 270, [1, 0.3, 0.4, 1]],
      [550, 300, [1.5, 0, 0, 0.7]],
    ];
    const texts = cases.map(([x, y, transform], i) => ({
      x,
      y,
      transform,
      width: 140,
      height: 40,
      name: `case${i}`,
      fonts: [
        {
          family: "M PLUS 1p",
          style: "Regular",
          weight: 400,
          italic: false,
          characters: `Case${i} ABC`,
        },
      ],
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="40"><text font-family="M PLUS 1p" font-size="20" fill="black" x="0" y="25">Case${i} ABC</text></svg>`,
    }));
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const png = new Uint8Array(
      await (await fetch(canvas.toDataURL())).arrayBuffer(),
    );
    const result = await P.createPDF({
      id: 1,
      name: "affine",
      width: 800,
      height: 600,
      scale: 1,
      mode: "text",
      png,
      texts,
    });
    // Independent browser SVG renderer as the geometric reference.
    document.body.insertAdjacentHTML(
      "beforeend",
      `<svg id="reference" xmlns="http://www.w3.org/2000/svg" width="800" height="600">${cases.map(([x, y, t], i) => `<g transform="matrix(${t.join(" ")} ${x} ${y})"><text font-family="Reference" font-size="20" fill="black" x="0" y="25">Case${i} ABC</text></g>`).join("")}</svg>`,
    );
    return Array.from(result);
  }, bytes);
  await page
    .locator("#reference")
    .screenshot({ path: "tmp/qa/transforms-reference.png" });
  await writeFile("output/pdf/transforms.pdf", new Uint8Array(pdf));
  execFileSync(poppler("pdftoppm"), [
    "-r",
    "96",
    "-singlefile",
    "-png",
    "output/pdf/transforms.pdf",
    "tmp/qa/transforms",
  ]);
  const text = execFileSync(
    poppler("pdftotext"),
    ["-raw", "output/pdf/transforms.pdf", "-"],
    { encoding: "utf8" },
  );
  assert(text.replace(/\s/g, "").includes("Case0ABC"), text);
  const paths = ["tmp/qa/transforms-reference.png", "tmp/qa/transforms.png"];
  const images = await Promise.all(
    paths.map(async (p) => (await readFile(p)).toString("base64")),
  );
  const score = await page.evaluate(async (images) => {
    const masks = await Promise.all(
      images.map(async (image) => {
        const img = new Image();
        img.src = "data:image/png;base64," + image;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = 800;
        c.height = 600;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 800, 600);
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 800, 600).data;
        return Array.from({ length: 800 * 600 }, (_, i) => d[i * 4] < 180);
      }),
    );
    let union = 0,
      overlap = 0;
    for (let i = 0; i < masks[0].length; i++) {
      if (masks[0][i] || masks[1][i]) union++;
      if (masks[0][i] && masks[1][i]) overlap++;
    }
    return overlap / union;
  }, images);
  assert(
    score > 0.65,
    `Transformed PDF differs from browser reference: ${score}`,
  );
  console.log(
    `Affine PDF tests passed: rotation, horizontal/vertical reflection, shear and nonuniform scaling; pixel overlap ${score.toFixed(3)}.`,
  );
} finally {
  await browser.close();
}
