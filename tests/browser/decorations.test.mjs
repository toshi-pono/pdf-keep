import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { decode } from "fast-png";

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
const font = Array.from(
  await readFile("tests/fixtures/fonts/Inter-Full-Regular.ttf"),
);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 700, height: 530 },
    deviceScaleFactor: 1,
  });
  await page.setContent('<body style="margin:0"></body>');
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const output = await page.evaluate(async (font) => {
    const P = window.P;
    P.registerAutomatic(new Uint8Array(font));
    const spec = {
      family: "Inter",
      style: "Regular",
      weight: 400,
      italic: false,
      characters: "",
    };
    const face = new FontFace("Inter", new Uint8Array(font).buffer);
    await face.load();
    document.fonts.add(face);
    const ns = "http://www.w3.org/2000/svg";
    const cases = [
      {
        text: "Underline CSS",
        inner:
          '<text x="20" y="45" style="text-decoration:underline #164cad">Underline CSS</text>',
      },
      {
        text: "Strike CSS",
        inner:
          '<text x="20" y="100" style="text-decoration:line-through">Strike CSS</text>',
      },
      {
        text: "Attribute underline",
        inner:
          '<text x="20" y="155" text-decoration="underline">Attribute underline</text>',
      },
      {
        text: "Plain Underline Strike",
        inner:
          '<text x="20" y="210">Plain <tspan fill="#164cad" style="text-decoration:underline">Underline</tspan> <tspan fill="#b32a35" style="text-decoration:line-through">Strike</tspan></text>',
      },
      {
        text: "Wrapped first\nSecond line",
        inner:
          '<text style="text-decoration:underline"><tspan x="20" y="265">Wrapped first</tspan><tspan x="20" y="305">Second line</tspan></text>',
      },
      {
        text: "office ligature",
        rich: true,
        inner:
          '<text x="20" y="365" style="text-decoration:line-through">office ligature</text>',
      },
      {
        text: "Mixed size rules",
        rich: true,
        inner:
          '<text x="20" y="430"><tspan style="text-decoration:underline">Mixed </tspan><tspan font-size="44" fill="#164cad" style="text-decoration:line-through">size</tspan><tspan style="text-decoration:underline"> rules</tspan></text>',
      },
      {
        text: "Transformed rules",
        rich: true,
        inner:
          '<g transform="translate(25 440) rotate(6)"><text x="0" y="40" style="text-decoration:underline line-through">Transformed rules</text></g>',
      },
    ];
    const texts = cases.map((c, i) => ({
      name: c.text,
      width: 700,
      height: 530,
      x: 0,
      y: 0,
      opacity: i === 6 ? 0.5 : 1,
      fonts: [{ ...spec, characters: c.text }],
      svg: `<svg xmlns="${ns}" width="700" height="530" viewBox="0 0 700 530"><g font-family="Inter" font-size="32" fill="#222222">${c.inner}</g></svg>`,
      source: {
        key: String(i),
        characters: c.text,
        segments: [
          {
            start: 0,
            end: c.text.length,
            font: spec,
            fontSize: 32,
            features: c.rich ? { liga: true } : {},
            list: "NONE",
          },
        ],
      },
    }));
    // This is browser-native SVG decoration, independent of the PDF helper.
    document.body.innerHTML = `<svg xmlns="${ns}" width="700" height="530">${texts.map((t) => `<g opacity="${t.opacity}">${t.svg}</g>`).join("")}</svg>`;
    const canvas = document.createElement("canvas");
    canvas.width = 700;
    canvas.height = 530;
    canvas.getContext("2d").fillStyle = "white";
    canvas.getContext("2d").fillRect(0, 0, 700, 530);
    const png = new Uint8Array(
      await (await fetch(canvas.toDataURL())).arrayBuffer(),
    );
    const warnings = [];
    let summary;
    const bytes = await P.createPDF(
      {
        protocol: 2,
        outlineFallback: false,
        id: 1,
        name: "decorations",
        width: 700,
        height: 530,
        scale: 1,
        mode: "text",
        png,
        texts,
      },
      () => {},
      {
        warning: (w) => warnings.push(w),
        textSummary: (s) => (summary = s),
        resolveRange: () => {
          throw Error("Decorations must not request native text outlines");
        },
      },
    );
    return {
      bytes: Array.from(bytes),
      warnings,
      summary,
      expected: cases.map((c) => c.text),
    };
  }, font);
  assert.deepEqual(output.warnings, []);
  assert.equal(output.summary.outlined, 0);
  assert(output.summary.copied >= output.expected.length);
  await page.screenshot({ path: "tmp/qa/decorations-reference.png" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("svg, g, text, tspan")) {
      el.removeAttribute("text-decoration");
      el.style.textDecoration = "none";
    }
  });
  await page.screenshot({ path: "tmp/qa/decorations-without-rules.png" });
  const file = "output/pdf/decorations.pdf";
  await writeFile(file, new Uint8Array(output.bytes));
  const extracted = execFileSync(poppler("pdftotext"), [file, "-"], {
    encoding: "utf8",
  });
  for (const value of output.expected)
    assert(
      extracted.replace(/\s+/g, "").includes(value.replace(/\s+/g, "")),
      extracted,
    );
  const fonts = execFileSync(poppler("pdffonts"), [file], { encoding: "utf8" });
  assert.match(
    fonts,
    /yes\s+yes\s+yes/,
    "decorated text has embedded Unicode fonts",
  );
  const images = execFileSync(poppler("pdfimages"), ["-list", file], {
    encoding: "utf8",
  });
  assert.equal(
    images.trim().split("\n").length,
    3,
    "only the baked background is an image",
  );
  execFileSync(poppler("pdftoppm"), [
    "-r",
    "96",
    "-singlefile",
    "-png",
    file,
    "tmp/qa/decorations",
  ]);
  const [reference, rendered, withoutRules] = await Promise.all(
    [
      "tmp/qa/decorations-reference.png",
      "tmp/qa/decorations.png",
      "tmp/qa/decorations-without-rules.png",
    ].map(async (p) => decode(await readFile(p))),
  );
  assert.equal(rendered.width, reference.width);
  assert.equal(rendered.height, reference.height);
  const regions = [
    [0, 65],
    [65, 120],
    [120, 175],
    [175, 230],
    [230, 325],
    [325, 385],
    [385, 450],
    [450, 530],
  ];
  const errors = regions.map(([top, bottom]) => {
    let total = 0;
    for (let y = top; y < bottom; y++)
      for (let x = 0; x < 650; x++)
        for (let c = 0; c < 3; c++)
          total += Math.abs(
            reference.data[(y * 700 + x) * reference.channels + c] -
              rendered.data[(y * 700 + x) * rendered.channels + c],
          );
    return total / ((bottom - top) * 650 * 3);
  });
  console.log("Decoration rendering mean RGB errors:", errors);
  assert(
    errors.every((error) => error < 8),
    `decorations shifted or missing: ${errors}`,
  );
  // Check the rules themselves, not just a mostly-white page average. Pixels
  // introduced by native SVG decoration must also exist in the PDF, allowing
  // one pixel for browser/Poppler antialiasing and preserving the line color.
  const pixel = (image, x, y, c) =>
    image.data[(y * image.width + x) * image.channels + c];
  for (const [top, bottom] of regions) {
    const rulePixels = [];
    let darkest = 255;
    for (let y = top; y < bottom; y++)
      for (let x = 1; x < 649; x++) {
        if (
          ![0, 1, 2].every((c) => pixel(withoutRules, x, y, c) > 250) ||
          ![0, 1, 2].some((c) => pixel(reference, x, y, c) < 220)
        )
          continue;
        const shade = Math.min(
          ...[0, 1, 2].map((c) => pixel(reference, x, y, c)),
        );
        darkest = Math.min(darkest, shade);
        rulePixels.push({ x, y, shade });
      }
    // Interior rule pixels avoid fractional edge-coverage differences between
    // Blink's antialiasing and Poppler's snapped horizontal vector strokes.
    let expected = 0,
      matched = 0;
    for (const { x, y, shade } of rulePixels) {
      if (shade > darkest + 30) continue;
      expected++;
      let found = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (
            [0, 1, 2].every(
              (c) =>
                Math.abs(
                  pixel(reference, x, y, c) -
                    pixel(rendered, x + dx, y + dy, c),
                ) < 55,
            )
          )
            found = true;
      if (found) matched++;
    }
    assert(expected > 50, `reference contains a visible rule in row ${top}`);
    assert(
      matched / expected > 0.9,
      `rule missing, shifted or recolored in row ${top}: ${matched}/${expected}`,
    );
  }
} finally {
  await browser.close();
}
