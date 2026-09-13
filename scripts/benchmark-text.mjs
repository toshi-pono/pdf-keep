import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { launchBrowser } from "../tests/helpers/browser.mjs";
import { fixtureRangeSVG } from "../tests/helpers/range-fixture.mjs";

const label = process.argv[2] ?? "current";
await mkdir("tmp/qa", { recursive: true });
const path = `tmp/qa/${label}.js`;
if (label !== "baseline" || process.argv.includes("--capture"))
  await build({
    stdin: {
      contents:
        'export * from "./src/pdf/create-pdf"; export {jsPDF} from "jspdf"; export * from "./src/shared/performance";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    loader: { ".wasm": "binary" },
    format: "iife",
    globalName: "P",
    outfile: path,
  });
if (process.argv.includes("--capture")) process.exit(0);
const fixture = JSON.parse(
  await readFile("tests/fixtures/rich-text/figma-script-ranges.json", "utf8"),
);
const text = fixture.texts.find((t) => t.name === "Scientific inferior");
const ranges = {
  ...text.ranges,
  "4:7": fixtureRangeSVG(text, { start: 4, end: 7 }),
};
const forced = structuredClone(text);
for (const at of [4, 5, 6]) {
  forced.ranges[`${at}:${at + 1}`] = forced.ranges[`${at}:${at + 1}`].replace(
    "</svg>",
    `<path d="M${270 + at * 3} 2h1v1h-1z" fill="black"/></svg>`,
  );
}
const variants = [
  { name: "captured", text, ranges },
  {
    name: "synthetic-unmatched",
    text: forced,
    ranges: {
      ...forced.ranges,
      "4:7": fixtureRangeSVG(forced, { start: 4, end: 7 }),
    },
  },
];
const font = Array.from(
  await readFile("tests/fixtures/fonts/Inter-Full-Regular.ttf"),
);
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: await readFile(path, "utf8") });
  const result = await page.evaluate(
    async ({ variants, font }) => {
      const P = window.P;
      P.registerAutomatic(new Uint8Array(font));
      const results = [];
      for (const { name, text, ranges } of variants) {
        for (const count of [1, 10]) {
          const samples = [];
          for (let attempt = 0; attempt < 6; attempt++) {
            const timings = {},
              requests = [],
              warnings = [];
            P.observePerformance(({ stage, milliseconds }) => {
              const s = (timings[stage] ??= { count: 0, milliseconds: 0 });
              s.count++;
              s.milliseconds += milliseconds;
            });
            const height = Math.max(100, count * 50);
            const canvas = document.createElement("canvas");
            canvas.width = 400;
            canvas.height = height;
            canvas.getContext("2d").fillStyle = "white";
            canvas.getContext("2d").fillRect(0, 0, 400, height);
            const png = new Uint8Array(
              await (await fetch(canvas.toDataURL())).arrayBuffer(),
            );
            const segments = text.segments.map((s) => ({
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
            const texts = Array.from({ length: count }, (_, i) => ({
              ...text,
              x: 24,
              y: 20 + i * 50,
              opacity: 1,
              source: { key: String(i), characters: text.characters, segments },
              fonts: segments.map((s) => s.font),
            }));
            const started = performance.now();
            const bytes = await P.createPDF(
              {
                protocol: 2,
                outlineFallback: true,
                id: 1,
                name: "benchmark",
                width: 400,
                height,
                scale: 1,
                mode: "text",
                png,
                texts,
              },
              () => {},
              {
                warning: (w) => warnings.push(w),
                resolveRange: async (r) => {
                  requests.push(r);
                  return P.measure(
                    r.format === "svg"
                      ? "svg-fetch-fixture"
                      : "pdf-fetch-fixture",
                    async () => {
                      const svg =
                        r.start === undefined
                          ? text.outline
                          : ranges[`${r.start}:${r.end}`];
                      if (!svg)
                        throw Error(
                          "Missing exact fixture " + JSON.stringify(r),
                        );
                      if (r.format === "svg") return { svg };
                      const element = new DOMParser().parseFromString(
                        svg,
                        "image/svg+xml",
                      ).documentElement;
                      const doc = new P.jsPDF({
                        unit: "pt",
                        format: [text.width * 0.75, text.height * 0.75],
                        orientation: "landscape",
                      });
                      await doc.svg(element, {
                        width: text.width * 0.75,
                        height: text.height * 0.75,
                      });
                      return { pdf: new Uint8Array(doc.output("arraybuffer")) };
                    },
                  );
                },
              },
            );
            samples.push({
              milliseconds: performance.now() - started,
              bytes: bytes.length,
              timings,
              requests,
              warnings,
            });
            P.observePerformance();
          }
          const measured = samples
            .slice(1)
            .sort((a, b) => a.milliseconds - b.milliseconds);
          results.push({
            name,
            copies: count,
            median: measured[2],
            milliseconds: measured.map((s) => s.milliseconds),
          });
        }
      }
      return results;
    },
    { variants, font },
  );
  await writeFile(
    `tmp/qa/${label}-performance.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      result.map(({ name, copies, median, milliseconds }) => ({
        name,
        copies,
        milliseconds,
        medianMs: median.milliseconds,
        timings: median.timings,
        requests: median.requests.length,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
