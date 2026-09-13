import { fixtureRangeSVG } from "../helpers/range-fixture.mjs";
import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { decode } from "fast-png";
await mkdir("tmp/qa", { recursive: true });
const code = await build({
  stdin: {
    contents:
      'export * from "./src/pdf/create-pdf"; export {jsPDF} from "jspdf"; export * from "./src/pdf/native-glyph"; export {createTextShaper} from "./src/pdf/text-shape";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "P",
});
const fixture = JSON.parse(
  await readFile("tests/fixtures/rich-text/figma-script-ranges.json", "utf8"),
);
for (const text of fixture.texts) {
  if (text.name === "Scientific inferior")
    text.ranges["4:7"] = fixtureRangeSVG(text, { start: 4, end: 7 });
}
const font = Array.from(
  await readFile("tests/fixtures/fonts/Inter-Full-Regular.ttf"),
);
const featureFont = Array.from(
  await readFile("tests/fixtures/fonts/SourceSans3-Regular.ttf"),
);
const plainFont = Array.from(
  await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
);
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log(m.text()));
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const result = await page.evaluate(
    async ({ fixture, font, featureFont, plainFont }) => {
      const NativeWorker = window.Worker;
      const workers = new Set();
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          workers.add(this);
        }
        terminate() {
          workers.delete(this);
          return super.terminate();
        }
      };
      const P = window.P;
      P.registerAutomatic(new Uint8Array(font));
      const shaper = P.createTextShaper();
      const shaped = {};
      for (const tag of ["sups", "subs", "sinf"]) {
        shaped[tag] = await shaper.shape(
          "feature",
          new Uint8Array(featureFont),
          "123",
          { [tag]: true },
        );
      }
      shaped.normal = await shaper.shape(
        "feature",
        new Uint8Array(featureFont),
        "123",
        {},
      );
      shaper.dispose();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 720;
      canvas.getContext("2d").fillStyle = "white";
      canvas.getContext("2d").fillRect(0, 0, 720, 720);
      const png = new Uint8Array(
        await (await fetch(canvas.toDataURL())).arrayBuffer(),
      );
      const texts = fixture.texts.map((t, i) => {
        const segments = t.segments.map((s) => ({
          ...s,
          font: {
            family: s.fontName.family,
            style: s.fontName.style,
            weight: s.fontWeight,
            italic: false,
            characters: s.characters,
          },
          features: s.openTypeFeatures,
          list: s.listOptions.type,
        }));
        return {
          ...t,
          opacity: 1,
          source: { key: String(i), characters: t.characters, segments },
          fonts: segments.map((s) => s.font),
        };
      });
      const warnings = [],
        requests = [];
      let summary;
      const bytes = await P.createPDF(
        {
          protocol: 2,
          outlineFallback: true,
          id: 1,
          name: fixture.name,
          width: 720,
          height: 720,
          scale: 1,
          mode: "text",
          png,
          texts,
        },
        () => {},
        {
          warning: (m) => warnings.push(m),
          textSummary: (s) => (summary = s),
          resolveRange: async (r) => {
            requests.push(r);
            const t = fixture.texts[Number(r.key)];
            if (r.format === "svg")
              return {
                svg:
                  r.start === undefined
                    ? t.outline
                    : t.ranges?.[`${r.start}:${r.end}`],
              };
            const svg = new DOMParser().parseFromString(
              r.start === undefined
                ? t.outline
                : t.ranges?.[`${r.start}:${r.end}`],
              "image/svg+xml",
            ).documentElement;
            const d = new P.jsPDF({
              unit: "pt",
              format: [t.width * 0.75, t.height * 0.75],
              orientation: t.width > t.height ? "landscape" : "portrait",
            });
            await d.svg(svg, {
              width: t.width * 0.75,
              height: t.height * 0.75,
            });
            return { pdf: new Uint8Array(d.output("arraybuffer")) };
          },
        },
      );

      P.registerAutomatic(new Uint8Array(featureFont));
      P.registerAutomatic(new Uint8Array(plainFont));
      const sourceFont = [...P.registry.values()].find(
        (f) => f.parsed.names.fontFamily.en === "Source Sans 3",
      );
      const ordinary = [...P.registry.values()].find((f) =>
        f.parsed.names.fontFamily.en.includes("M PLUS"),
      );
      const wrap = (inner) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="70" viewBox="0 0 400 70">${inner}</svg>`;
      const cases = [],
        native = new Map(),
        shape = P.createTextShaper();
      for (const [i, tag] of [
        "sups",
        "subs",
        "sinf",
        "synthetic",
        "liga",
        "missing",
      ].entries()) {
        const f =
          tag === "synthetic" || tag === "missing" ? ordinary : sourceFont;
        const value =
          tag === "liga"
            ? "office e\u0301"
            : tag === "missing"
              ? "A🫠B"
              : tag === "synthetic"
                ? "H2O"
                : tag === "sups"
                  ? "123 ²"
                  : "123";
        const features =
          tag === "synthetic"
            ? { sups: true }
            : tag === "missing"
              ? {}
              : { [tag]: true };
        const fs = {
          family: f.parsed.names.fontFamily.en,
          style: "Regular",
          weight: 400,
          italic: false,
          characters: value,
        };
        const actualSize = tag === "synthetic" ? 15 : 24;
        const s = await shape.shape(
          f.alias,
          f.bytes,
          value,
          tag === "synthetic" ? {} : features,
        );
        let x = 0;
        const outlines = [];
        for (const g of s.glyphs) {
          const at = s.glyphs.indexOf(g),
            end = s.glyphs[at + 1]?.cluster ?? value.length;
          const path = f.parsed.glyphs
            .get(g.gid)
            .getPath(
              x + (g.xOffset * actualSize) / s.unitsPerEm,
              36 - (g.yOffset * actualSize) / s.unitsPerEm,
              actualSize,
            )
            .toPathData(5);
          const outline = wrap(`<path fill="black" d="${path}"/>`);
          native.set(`${i}:${g.cluster}:${end}`, outline);
          outlines.push(`<path fill="black" d="${path}"/>`);
          x += (g.xAdvance * actualSize) / s.unitsPerEm;
        }
        native.set(`${i}:undefined:undefined`, wrap(outlines.join("")));
        native.set(`${i}:0:${value.length}`, wrap(outlines.join("")));
        cases.push({
          name: tag,
          x: 24,
          y: 24 + i * 100,
          width: 400,
          height: 70,
          opacity: 0.5,
          fonts: [fs],
          svg: wrap(
            `<text font-family="${fs.family}" font-size="24" fill="black"><tspan x="0" y="36">${value}</tspan></text>`,
          ),
          source: {
            key: String(i),
            characters: value,
            segments: [
              {
                start: 0,
                end: value.length,
                font: fs,
                fontSize: 24,
                features,
                list: "NONE",
                indentation: 0,
                paragraphIndent: 0,
                paragraphSpacing: 0,
                listSpacing: 0,
              },
            ],
          },
        });
      }
      shape.dispose();
      for (const [i, asset] of cases.entries()) {
        const svg = native.get(`${i}:undefined:undefined`),
          url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const ctx = canvas.getContext("2d");
          ctx.globalAlpha = asset.opacity;
          ctx.drawImage(image, asset.x, asset.y);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const additionalReference = canvas.toDataURL().split(",")[1];
      const additionalWarnings = [];
      const resolve = async (r) => {
        const svg = native.get(`${r.key}:${r.start}:${r.end}`);
        if (!svg) throw Error("Unexpected range " + JSON.stringify(r));
        if (r.format === "svg") return { svg };
        const d = new P.jsPDF({
          unit: "pt",
          format: [300, 52.5],
          orientation: "landscape",
        });
        await d.svg(
          new DOMParser().parseFromString(svg, "image/svg+xml").documentElement,
          { width: 300, height: 52.5 },
        );
        return { pdf: new Uint8Array(d.output("arraybuffer")) };
      };
      const extraBundle = {
        protocol: 2,
        outlineFallback: true,
        id: 2,
        name: "Features",
        width: 720,
        height: 720,
        scale: 1,
        mode: "text",
        png,
        texts: cases,
      };
      const additional = await P.createPDF(extraBundle, () => {}, {
        resolveRange: resolve,
        warning: (m) => additionalWarnings.push(m),
      });
      let disabledError = "";
      try {
        await P.createPDF(
          { ...extraBundle, outlineFallback: false },
          () => {},
          { resolveRange: resolve },
        );
      } catch (e) {
        disabledError = String(e);
      }
      return {
        bytes: Array.from(bytes),
        additional: Array.from(additional),
        additionalReference,
        additionalWarnings,
        disabledError,
        activeWorkers: workers.size,
        warnings,
        requests,
        summary,
        shaped,
      };
    },
    { fixture, font, featureFont, plainFont },
  );
  await writeFile("tmp/qa/searchable.pdf", new Uint8Array(result.bytes));
  delete result.bytes;
  console.log(
    JSON.stringify(
      {
        warnings: result.warnings,
        summary: result.summary,
        additionalWarnings: result.additionalWarnings,
        disabledError: result.disabledError,
      },
      null,
      2,
    ),
  );
  const text = execFileSync(
    poppler("pdftotext"),
    ["-raw", "tmp/qa/searchable.pdf", "-"],
    { encoding: "utf8" },
  );
  console.log(text);
  for (const tag of ["sups", "subs", "sinf"])
    assert.notDeepEqual(
      result.shaped[tag].glyphs.map((g) => g.gid),
      result.shaped.normal.glyphs.map((g) => g.gid),
      tag,
    );
  assert.match(text, /Bullet one wraps/);
  assert.match(text, /11\./);
  assert.match(text, /x2 \+ y3/);
  await writeFile(
    "tmp/qa/searchable-features.pdf",
    new Uint8Array(result.additional),
  );
  const extraText = execFileSync(
    poppler("pdftotext"),
    ["-raw", "tmp/qa/searchable-features.pdf", "-"],
    { encoding: "utf8" },
  );
  console.log(extraText);
  assert.equal(result.activeWorkers, 0);
  assert.match(extraText, /²/);
  assert.match(extraText, /H2O/);
  assert.match(extraText, /office e\u0301/);
  assert.equal((extraText.match(/123/g) ?? []).length, 3);
  assert.match(extraText, /A/);
  assert.match(extraText, /B/);
  assert.deepEqual(result.additionalWarnings, []);
  assert.equal(result.disabledError, "");
  assert.match(extraText, /A🫠B/);
  const fonts = execFileSync(
    poppler("pdffonts"),
    ["tmp/qa/searchable-features.pdf"],
    { encoding: "utf8" },
  );
  assert(fonts.includes("Type 3"));
  assert.match(fonts, /CID TrueType/);
  await writeFile(
    "tmp/qa/searchable-reference.png",
    Buffer.from(fixture.png, "base64"),
  );
  execFileSync(poppler("pdftoppm"), [
    "-scale-to",
    "720",
    "-png",
    "-singlefile",
    "tmp/qa/searchable.pdf",
    "tmp/qa/searchable",
  ]);
  await writeFile(
    "tmp/qa/searchable-features-reference.png",
    Buffer.from(result.additionalReference, "base64"),
  );
  execFileSync(poppler("pdftoppm"), [
    "-scale-to",
    "720",
    "-png",
    "-singlefile",
    "tmp/qa/searchable-features.pdf",
    "tmp/qa/searchable-features",
  ]);
  for (const name of ["searchable", "searchable-features"]) {
    const expected = decode(await readFile(`tmp/qa/${name}-reference.png`)),
      actual = decode(await readFile(`tmp/qa/${name}.png`));
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    let difference = 0;
    for (let i = 0; i < actual.width * actual.height; i++)
      for (let c = 0; c < 3; c++)
        difference += Math.abs(
          actual.data[i * actual.channels + c] -
            expected.data[i * expected.channels + c],
        );
    const mean = difference / (actual.width * actual.height * 3);
    console.log(`${name} rendered mean RGB error: ${mean.toFixed(3)}`);
    assert(mean < 2, `Rendering changed: ${name}: ${mean}`);
  }
} finally {
  await browser.close();
}
