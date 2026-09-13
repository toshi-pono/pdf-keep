import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { decode } from "fast-png";
import { launchBrowser, poppler } from "../helpers/browser.mjs";

await mkdir("tmp/qa", { recursive: true });
await mkdir("output/pdf", { recursive: true });
const code = await build({
  entryPoints: ["src/pdf/create-pdf.ts"],
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "P",
});
const base64 = (
  await readFile("tests/fixtures/fonts/Inter-Full-Regular.ttf")
).toString("base64");
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 500, height: 600 },
    deviceScaleFactor: 1,
  });
  await page.setContent('<body style="margin:0;background:white"></body>');
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const result = await page.evaluate(async (base64) => {
    const P = window.P;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    P.registerAutomatic(bytes);
    const face = new FontFace("Inter", bytes);
    await face.load();
    document.fonts.add(face);
    const cases = [
      {
        value: "hogehoge",
        x: 30,
        y: 30,
        width: 115,
        height: 18,
        baseline: 28,
        box: [15, 10, 330, 85],
      },
      {
        value: "wide text",
        x: 30,
        y: 125,
        width: 40,
        height: 50,
        baseline: 30,
        box: [15, 105, 330, 80],
      },
      {
        value: "Ágj",
        x: 50,
        y: 225,
        width: 45,
        height: 18,
        baseline: 18,
        left: -14,
        size: 40,
        box: [15, 190, 330, 90],
      },
      {
        value: "rotated gj",
        x: 70,
        y: 300,
        width: 100,
        height: 18,
        baseline: 28,
        transform: [0.9659258, 0.258819, -0.258819, 0.9659258],
        box: [15, 290, 330, 95],
      },
      {
        value: "ABC…",
        x: 30,
        y: 410,
        width: 80,
        height: 18,
        baseline: 28,
        clipContent: true,
        box: [15, 390, 330, 80],
      },
      {
        value: "rich hogehoge",
        x: 30,
        y: 510,
        width: 115,
        height: 18,
        baseline: 28,
        rich: true,
        box: [15, 490, 330, 85],
      },
      {
        value: "ABC…",
        x: 370,
        y: 410,
        width: 80,
        height: 18,
        baseline: 28,
        clipContent: true,
        rich: true,
        transform: [0.9659258, 0.258819, -0.258819, 0.9659258],
        box: [350, 390, 140, 90],
      },
    ];
    const ns = "http://www.w3.org/2000/svg";
    const texts = cases.map((c, i) => {
      const font = {
        family: "Inter",
        style: "Regular",
        weight: 400,
        italic: false,
        characters: c.value,
      };
      const fontSize = c.size ?? 32;
      return {
        name: c.value,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        transform: c.transform,
        clipContent: c.clipContent,
        fonts: [font],
        svg: `<svg xmlns="${ns}" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><text font-family="Inter" font-size="${fontSize}" x="${c.left ?? 0}" y="${c.baseline}">${c.value}</text></svg>`,
        source: {
          key: String(i),
          characters: c.value,
          segments: [
            {
              start: 0,
              end: c.value.length,
              font,
              fontSize,
              features: c.rich ? { liga: true } : {},
              list: "NONE",
            },
          ],
        },
      };
    });
    // Independent native SVG reference: a Figma TextNode's layout box is not
    // a clipping frame. Only an explicitly clipped/truncated box should crop.
    document.body.innerHTML = `<svg xmlns="${ns}" width="500" height="600">${texts.map((t) => `<g transform="matrix(${(t.transform ?? [1, 0, 0, 1]).join(" ")} ${t.x} ${t.y})">${t.svg.replace("<svg ", `<svg overflow="${t.clipContent ? "hidden" : "visible"}" `)}</g>`).join("")}</svg>`;
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 600;
    const png = new Uint8Array(
      await (await fetch(canvas.toDataURL())).arrayBuffer(),
    );
    const pdfs = [];
    for (const protocol of [undefined, 2]) {
      const warnings = [];
      const pdf = await P.createPDF(
        {
          protocol,
          id: 1,
          name: "text-overflow",
          width: 500,
          height: 600,
          scale: 1,
          mode: "text",
          png,
          texts,
          outlineFallback: false,
        },
        () => {},
        {
          warning: (w) => warnings.push(w),
          resolveRange: () => {
            throw Error("Ordinary overflowing text must stay searchable");
          },
        },
      );
      if (warnings.length) throw Error(warnings.join("\n"));
      pdfs.push(Array.from(pdf));
    }
    return { pdfs, boxes: cases.map((c) => c.box) };
  }, base64);
  await page.screenshot({ path: "tmp/qa/text-overflow-reference.png" });
  const reference = decode(
    await readFile("tmp/qa/text-overflow-reference.png"),
  );
  const ink = (im, x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < im.width &&
    y < im.height &&
    im.data[(y * im.width + x) * im.channels] < 180;
  const coverage = (a, b, [x, y, w, h]) => {
    let total = 0,
      covered = 0;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (!ink(a, xx, yy)) continue;
        total++;
        if (
          [-1, 0, 1].some((dy) =>
            [-1, 0, 1].some((dx) => ink(b, xx + dx, yy + dy)),
          )
        )
          covered++;
      }
    assert(total > 30, "reference region must contain visible glyphs");
    return covered / total;
  };
  for (const [i, bytes] of result.pdfs.entries()) {
    const file = `output/pdf/text-overflow-${i === 0 ? "legacy" : "searchable"}.pdf`;
    await writeFile(file, new Uint8Array(bytes));
    const prefix = `tmp/qa/text-overflow-${i}`;
    execFileSync(poppler("pdftoppm"), [
      "-r",
      "96",
      "-png",
      "-singlefile",
      file,
      prefix,
    ]);
    const actual = decode(await readFile(prefix + ".png"));
    const scores = result.boxes.map((box) => [
      coverage(reference, actual, box),
      coverage(actual, reference, box),
    ]);
    console.log(`Overflow protocol ${i}:`, scores);
    assert(
      scores.every(([recall, precision]) => recall > 0.97 && precision > 0.97),
      JSON.stringify(scores),
    );
    const extracted = execFileSync(poppler("pdftotext"), [file, "-"], {
      encoding: "utf8",
    }).replace(/\s/g, "");
    for (const value of [
      "hogehoge",
      "widetext",
      "Ágj",
      "rotatedgj",
      "richhogehoge",
    ])
      assert(extracted.includes(value), extracted);
  }
} finally {
  await browser.close();
}
