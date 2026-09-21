import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { decode } from "fast-png";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { fixtureRangeSVG } from "../helpers/range-fixture.mjs";

await mkdir("tmp/qa", { recursive: true });
const fixture = JSON.parse(
  await readFile("tests/fixtures/rich-text/figma-script-ranges.json", "utf8"),
);
const source = fixture.texts.find((t) => t.name === "Scientific inferior");
// A disconnected ink component makes these captured ranges unmatchable. Each
// extra component is placed separately so their union is an exact reference.
const extras = [];
for (const at of [4, 5, 6]) {
  const extra = `<path d="M${270 + at * 3} 2h1v1h-1z" fill="black"/>`;
  extras.push(extra);
  source.ranges[`${at}:${at + 1}`] = source.ranges[`${at}:${at + 1}`].replace(
    "</svg>",
    extra + "</svg>",
  );
}
source.ranges["4:7"] = fixtureRangeSVG(source, { start: 4, end: 7 });
source.outline = source.outline.replace("</svg>", extras.join("") + "</svg>");
const font = Array.from(
  await readFile("tests/fixtures/fonts/Inter-Full-Regular.ttf"),
);
const code = await build({
  stdin: {
    contents:
      'export * from "./src/pdf/create-pdf"; export {jsPDF} from "jspdf"; export * from "./src/shared/performance";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  loader: { ".wasm": "binary" },
  format: "iife",
  globalName: "P",
  write: false,
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const results = await page.evaluate(
    async ({ source, font }) => {
      const P = window.P;
      P.registerAutomatic(new Uint8Array(font));
      const segments = source.segments.map((s) => ({
        ...s,
        features: s.openTypeFeatures,
        list: s.listOptions.type,
        font: {
          family: s.fontName.family,
          style: s.fontName.style,
          weight: s.fontWeight,
          italic: false,
          characters: s.characters,
        },
      }));
      const output = [];
      for (const count of [1, 5]) {
        const height = 100 * count;
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.fillStyle = "white";
        context.fillRect(0, 0, 400, height);
        const png = new Uint8Array(
          await (await fetch(canvas.toDataURL())).arrayBuffer(),
        );
        const image = new Image();
        const url = URL.createObjectURL(
          new Blob([source.outline], { type: "image/svg+xml" }),
        );
        try {
          image.src = url;
          await image.decode();
          for (let i = 0; i < count; i++)
            context.drawImage(image, 20, 20 + i * 100);
        } finally {
          URL.revokeObjectURL(url);
        }
        const texts = Array.from({ length: count }, (_, i) => ({
          ...source,
          x: 20,
          y: 20 + i * 100,
          opacity: 1,
          fonts: segments.map((s) => s.font),
          source: { key: String(i), characters: source.characters, segments },
        }));
        const requests = [],
          warnings = [],
          metrics = {};
        P.observePerformance(
          ({ stage }) => (metrics[stage] = (metrics[stage] ?? 0) + 1),
        );
        const pdf = await P.createPDF(
          {
            protocol: 2,
            outlineFallback: true,
            id: 1,
            name: "grouped-script",
            width: 400,
            height,
            scale: 1,
            mode: "text",
            png,
            texts,
          },
          () => {},
          {
            warning: (message) => warnings.push(message),
            resolveRange: async (range) => {
              requests.push(range);
              const svg = source.ranges[`${range.start}:${range.end}`];
              if (!svg)
                throw Error("Missing exact range " + JSON.stringify(range));
              if (range.format === "svg") return { svg };
              const node = new DOMParser().parseFromString(
                svg,
                "image/svg+xml",
              ).documentElement;
              const doc = new P.jsPDF({
                unit: "pt",
                format: [source.width * 0.75, source.height * 0.75],
                orientation: "landscape",
              });
              await doc.svg(node, {
                width: source.width * 0.75,
                height: source.height * 0.75,
              });
              return { pdf: new Uint8Array(doc.output("arraybuffer")) };
            },
          },
        );
        P.observePerformance();
        output.push({
          count,
          pdf: Array.from(pdf),
          reference: canvas.toDataURL().split(",")[1],
          requests,
          warnings,
          metrics,
        });
      }
      return output;
    },
    { source, font },
  );
  for (const result of results) {
    const pdfRequests = result.requests.filter((r) => r.format === "pdf");
    assert.equal(pdfRequests.length, result.count);
    assert(pdfRequests.every((r) => r.start === 4 && r.end === 7));
    assert.equal(
      result.requests.filter((r) => r.format === "svg").length,
      7 * result.count,
      "each character is still verified",
    );
    assert.equal(result.warnings.length, result.count);
    assert(
      result.warnings.every(
        (w) => w.key === "outlines.range" && w.params.scope === "4–7",
      ),
    );
    assert.equal(result.metrics["pdf-load"], result.count);
    assert.equal(result.metrics["pdf-embed"], result.count);
    const name = `tmp/qa/grouped-script-${result.count}`;
    await writeFile(`${name}.pdf`, new Uint8Array(result.pdf));
    await writeFile(
      `${name}-reference.png`,
      Buffer.from(result.reference, "base64"),
    );
    const text = execFileSync(
      poppler("pdftotext"),
      ["-raw", `${name}.pdf`, "-"],
      { encoding: "utf8" },
    );
    assert.equal(
      (text.match(/Inde/g) ?? []).length,
      result.count,
      "successful letters remain searchable",
    );
    assert(
      !text.includes("Index12"),
      "unsupported glyphs are not emitted as guessed text",
    );
    execFileSync(poppler("pdftoppm"), [
      "-r",
      "96",
      "-png",
      "-singlefile",
      `${name}.pdf`,
      name,
    ]);
    const expected = decode(await readFile(`${name}-reference.png`)),
      actual = decode(await readFile(`${name}.png`));
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    let difference = 0;
    for (let i = 0; i < actual.width * actual.height; i++)
      for (let c = 0; c < 3; c++)
        difference += Math.abs(
          actual.data[i * actual.channels + c] -
            expected.data[i * expected.channels + c],
        );
    assert(
      difference / (actual.width * actual.height * 3) < 2,
      "merged outline must preserve the native appearance",
    );
  }
  assert.equal(
    results[1].metrics.shape,
    results[0].metrics.shape,
    "repeated shaping uses session cache",
  );
  assert.equal(
    results[1].metrics["template-normalize"],
    results[0].metrics["template-normalize"],
    "templates are normalized once per session",
  );
  console.log(
    "OpenType regression: seven character proofs, one merged PDF, repeated shaping/template reuse, unchanged native pixels and searchable prefix.",
  );
} finally {
  await browser.close();
}
