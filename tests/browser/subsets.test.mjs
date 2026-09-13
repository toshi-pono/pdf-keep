import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { decode } from "fast-png";
import { fontStats } from "../helpers/pdf-font-stats.mjs";
await mkdir("tmp/qa", { recursive: true });
const code = await build({
  stdin: {
    contents:
      'export * from "./src/pdf/create-pdf"; export * from "./src/fonts/font-subset";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "P",
  loader: { ".wasm": "binary" },
});
const b = await launchBrowser();
try {
  const p = await b.newPage();
  await p.setContent("<html><body></body></html>");
  await p.addScriptTag({ content: code.outputFiles[0].text });
  const fonts = await Promise.all(
    ["Regular", "Bold"].map(async (s) =>
      Array.from(await readFile(`tests/fixtures/fonts/MPLUS1p-${s}.ttf`)),
    ),
  );
  const result = await p.evaluate(async (fonts) => {
    const P = globalThis.P;
    const nativeWorker = window.Worker;
    const requestedCharacters = [];
    window.Worker = class extends nativeWorker {
      postMessage(message, ...options) {
        requestedCharacters.push(message.characters);
        super.postMessage(message, ...options);
      }
    };
    const warnings = [],
      stages = [];
    fonts.forEach((bytes) => {
      const keys = P.registerAutomatic(new Uint8Array(bytes));
      const face = P.registry.get(keys[0]);
      if (!keys.every((key) => P.registry.get(key) === face))
        throw Error("Font aliases must share the same parsed data and bytes");
    });
    const regular = [...P.registry.values()][0];
    const originalLength = regular.bytes.length;
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 200;
    const png = new Uint8Array(
      await (await fetch(canvas.toDataURL())).arrayBuffer(),
    );
    const spec = (style, text) => ({
      family: "M PLUS 1p",
      style,
      weight: style === "Bold" ? 700 : 400,
      italic: false,
      characters: text + "HIDDEN_SENTINEL_ZYX",
    });
    const asset = (text, style, y) => ({
      name: style,
      x: 10,
      y,
      width: 580,
      height: 45,
      fonts: [spec(style, text)],
      svg: `<svg width="580" height="45" xmlns="http://www.w3.org/2000/svg"><text x="0" y="32" font-family="M PLUS 1p" font-size="24" font-weight="${style === "Bold" ? 700 : 400}">${text}</text></svg>`,
    });
    const bundle = {
      id: 1,
      name: "subsets",
      width: 600,
      height: 200,
      scale: 1,
      mode: "text",
      png,
      texts: [
        asset("ABC é é … 日本語", "Regular", 5),
        asset("太字 … ABC", "Bold", 55),
        asset("ABC", "Regular", 105),
      ],
    };
    const compact = await P.createPDF(bundle, () => {}, {
      progress: (m) => stages.push(m),
      warning: (m) => warnings.push(m),
    });
    if (warnings.length) throw Error(warnings.join("\n"));
    window.Worker = nativeWorker;
    if (regular.bytes.length !== originalLength)
      throw Error("registry was mutated");
    // Same glyph map remains reusable on the next export.
    const repeated = await P.createPDF(bundle);
    let attempts = 0;
    window.Worker = class {
      constructor(...args) {
        if (++attempts === 1) throw Error("simulated unavailable worker");
        return new nativeWorker(...args);
      }
    };
    const mixedWarnings = [];
    const mixed = await P.createPDF(bundle, () => {}, {
      warning: (m) => mixedWarnings.push(m),
    });
    window.Worker = class {
      constructor() {
        throw Error("simulated unavailable worker");
      }
    };
    const fallbackWarnings = [];
    const fallback = await P.createPDF(bundle, () => {}, {
      warning: (m) => fallbackWarnings.push(m),
    });
    window.Worker = nativeWorker;
    const unused = await P.createPDF({ ...bundle, texts: [bundle.texts[0]] });
    const raster = await P.createPDF({ ...bundle, mode: "raster" });
    // A valid but irrelevant worker reply must not survive cancellation or timeout.
    let terminated = 0;
    window.Worker = class {
      postMessage() {}
      terminate() {
        terminated++;
      }
    };
    let cancelled = false,
      cancelMessage = "",
      timeoutMessage = "";
    const subsetter = P.createFontSubsetter(() => {
      if (cancelled) throw Error("cancelled");
    });
    setTimeout(() => (cancelled = true), 10);
    try {
      await subsetter.subset(regular.bytes, "ABC");
    } catch (e) {
      cancelMessage = e.message;
    } finally {
      subsetter.dispose();
    }
    const timed = P.createFontSubsetter(() => {}, 20);
    try {
      await timed.subset(regular.bytes, "ABC");
    } catch (e) {
      timeoutMessage = e.message;
    } finally {
      timed.dispose();
    }
    const cancelledWarnings = [];
    cancelled = false;
    try {
      await P.createPDF(
        bundle,
        () => {
          if (cancelled) throw Error("cancelled PDF");
        },
        {
          progress: () => setTimeout(() => (cancelled = true), 10),
          warning: (m) => cancelledWarnings.push(m),
        },
      );
      throw Error("PDF cancellation not honored");
    } catch (e) {
      if (e.message !== "cancelled PDF") throw e;
    }
    window.Worker = nativeWorker;
    if (document.fonts.size || document.querySelectorAll("body > div").length)
      throw Error("temporary layout objects leaked");
    return {
      pdfs: {
        compact: [...compact],
        repeated: [...repeated],
        mixed: [...mixed],
        fallback: [...fallback],
        unused: [...unused],
        raster: [...raster],
      },
      stages,
      requestedCharacters,
      mixedWarnings,
      fallbackWarnings,
      cancelledWarnings,
      cancelMessage,
      timeoutMessage,
      terminated,
    };
  }, fonts);
  assert(result.stages.filter((s) => s.includes("軽量化中")).length === 2);
  assert.equal(result.requestedCharacters.length, 2);
  assert(
    result.requestedCharacters[0].includes("\u0301") &&
      result.requestedCharacters[0].includes("…") &&
      result.requestedCharacters[0].includes(" "),
  );
  assert(
    result.requestedCharacters.every(
      (text) =>
        !text.includes("Z") && !text.includes("Y") && !text.includes("X"),
    ),
    "only the final SVG text is subset, never hidden FontSpec text",
  );
  assert.equal(result.mixedWarnings.length, 1);
  assert.equal(result.fallbackWarnings.length, 2);
  assert.deepEqual(result.cancelledWarnings, []);
  assert.equal(result.cancelMessage, "cancelled");
  assert.match(result.timeoutMessage, /完了しません/);
  assert.equal(result.terminated, 3);
  const stats = {};
  for (const [name, bytes] of Object.entries(result.pdfs)) {
    const pdf = Buffer.from(bytes);
    await writeFile(`tmp/qa/subset-${name}.pdf`, pdf);
    stats[name] = fontStats(pdf);
  }
  assert.equal(stats.compact.length, 2);
  assert.equal(stats.unused.length, 1);
  assert.equal(stats.raster.length, 0);
  assert(
    stats.compact.every(
      (f) => f.glyphSlots < 200 && f.tables.cmap < 5000 && f.tables.hmtx < 1000,
    ),
  );
  assert(stats.fallback.every((f) => f.glyphSlots === 8676));
  assert(stats.mixed[0].glyphSlots === 8676 && stats.mixed[1].glyphSlots < 200);
  assert.deepEqual(stats.compact, stats.repeated);
  const total = (s) => s.reduce((n, f) => n + f.compressedBytes, 0);
  assert(total(stats.compact) < total(stats.fallback) * 0.3);
  for (const name of ["compact", "fallback", "mixed"]) {
    const file = `tmp/qa/subset-${name}.pdf`;
    const text = execFileSync(poppler("pdftotext"), ["-raw", file, "-"], {
      encoding: "utf8",
    });
    assert(
      text.includes("日本語") &&
        text.includes("太字") &&
        text.includes("…") &&
        text.includes("é"),
      text,
    );
    assert(!text.includes("HIDDEN_SENTINEL"));
    execFileSync(poppler("pdftoppm"), [
      "-scale-to",
      "1200",
      "-singlefile",
      "-png",
      file,
      `tmp/qa/subset-${name}`,
    ]);
  }
  const images = await Promise.all(
    ["compact", "fallback", "mixed"].map(async (name) =>
      decode(await readFile(`tmp/qa/subset-${name}.png`)),
    ),
  );
  for (const img of images.slice(1))
    assert.deepEqual(img.data, images[0].data, "subset changed rendering");
  await writeFile("tmp/qa/subset-stats.json", JSON.stringify(stats, null, 2));
  console.log(
    `Font subset tests passed: ${total(stats.fallback)} → ${total(stats.compact)} bytes; identical rendering, extraction, per-font fallback, reuse, cancellation and timeout.`,
  );
} finally {
  await b.close();
}
