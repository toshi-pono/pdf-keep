import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
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
const fonts = await Promise.all(
  ["Inter-Full-Regular.ttf", "NotoSansJP-fallback.ttf"].map(async (f) =>
    (await readFile("tests/fixtures/fonts/" + f)).toString("base64"),
  ),
);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 640, height: 620 },
    deviceScaleFactor: 1,
  });
  await page.setContent('<body style="margin:0;background:white"></body>');
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const result = await page.evaluate(async (fonts) => {
    const P = window.P,
      ns = "http://www.w3.org/2000/svg";
    for (const encoded of fonts)
      P.registerAutomatic(
        Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      );
    const inter = P.registry.get(JSON.stringify(["Inter", "Regular"]));
    const noto = P.registry.get(JSON.stringify(["Noto Sans JP", "Regular"]));
    if (
      inter.parsed.charToGlyphIndex("ほ") ||
      !noto.parsed.charToGlyphIndex("ほ")
    )
      throw Error("Invalid fallback fixture");
    const definitions = [
      { name: "Bullets", parts: [{ text: "ほげほげ" }], list: true },
      {
        name: "Mixed Latin and Japanese",
        parts: [{ text: "ABC ほげほげ xyz" }],
      },
      {
        name: "Styled and rotated",
        parts: [
          { text: "ABC" },
          { text: " " },
          { text: "ほげ", color: "#276bc0" },
          { text: " " },
          { text: "xyz" },
        ],
        opacity: 0.6,
        transform: [0.984808, 0.173648, -0.173648, 0.984808],
      },
      {
        name: "Small text box",
        parts: [{ text: "ほげほげ" }],
        height: 18,
        width: 90,
      },
      {
        name: "Noto explicitly selected",
        parts: [{ text: "日本語" }],
        family: "Noto Sans JP",
      },
      {
        name: "Hidden range",
        parts: [{ text: "ほげほげ" }, { text: "INVISIBLE", invisible: true }],
      },
    ];
    const captures = [],
      texts = [];
    for (const [index, c] of definitions.entries()) {
      const characters = c.parts.map((p) => p.text).join("");
      const spec = {
        family: c.family ?? "Inter",
        style: "Regular",
        weight: 400,
        italic: false,
        characters,
      };
      let offset = 0,
        pen = c.list ? 30 : 8;
      const glyphs = [],
        segments = [],
        elements = [];
      for (const p of c.parts) {
        const start = offset;
        const color = p.color ?? "#111111";
        const nodeX = pen;
        for (const char of p.text) {
          const font = c.family
            ? noto
            : inter.parsed.charToGlyphIndex(char)
              ? inter
              : noto;
          const path = font.parsed
            .charToGlyph(char)
            .getPath(pen, 34, 32)
            .toPathData(5);
          glyphs.push({
            start: offset,
            end: offset + char.length,
            path,
            color,
            invisible: p.invisible,
          });
          pen +=
            (font.parsed.charToGlyph(char).advanceWidth * 32) /
            font.parsed.unitsPerEm;
          offset += char.length;
        }
        segments.push({
          start,
          end: offset,
          font: spec,
          fontSize: 32,
          features: {},
          list: c.list ? "UNORDERED" : "NONE",
          invisible: p.invisible,
        });
        elements.push(
          `<text xml:space="preserve" style="white-space: pre" x="${nodeX}" y="34" fill="${color}" fill-opacity="${p.invisible ? 0 : 1}" font-family="${spec.family}" font-size="32">${p.text}</text>`,
        );
      }
      const width = c.width ?? 560,
        height = c.height ?? 55;
      const wrap = (inner) =>
        `<svg xmlns="${ns}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`;
      // These constructed Noto outlines stand in for Figma's range export. They
      // intentionally differ from Inter's missing-glyph metrics and are never
      // supplied as a replacement TTF to the PDF's text shaping path.
      const outline = (start = 0, end = characters.length) =>
        wrap(
          (c.list
            ? `<circle cx="12" cy="22" r="3" fill-opacity="${start === 0 ? 1 : 0}"/>`
            : "") +
            glyphs
              .map(
                (g) =>
                  `<path d="${g.path}" fill="${g.color}" fill-opacity="${!g.invisible && g.start >= start && g.end <= end ? 1 : 0}"/>`,
              )
              .join(""),
        );
      captures.push({ outline, characters });
      texts.push({
        name: c.name,
        x: 25,
        y: 20 + index * 95,
        width,
        height,
        opacity: c.opacity ?? 1,
        transform: c.transform,
        fonts: [spec],
        svg: wrap(elements.join("")),
        source: { key: String(index), characters, segments },
      });
    }
    // Native geometry is an independent reference, including the invisible paths
    // that must not enlarge the embedded fallback font's bounds or copied text.
    document.body.innerHTML = `<svg xmlns="${ns}" width="640" height="620">${texts.map((a, i) => `<g opacity="${a.opacity}" transform="matrix(${(a.transform ?? [1, 0, 0, 1]).join(" ")} ${a.x} ${a.y})">${captures[i].outline().replace("<svg ", '<svg overflow="visible" ')}</g>`).join("")}</svg>`;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 620;
    const png = new Uint8Array(
      await (await fetch(canvas.toDataURL())).arrayBuffer(),
    );
    const bundle = {
      protocol: 2,
      id: 1,
      name: "font-fallback",
      width: 640,
      height: 620,
      scale: 1,
      mode: "text",
      png,
      texts,
      outlineFallback: false,
    };
    const requests = [],
      warnings = [];
    let summary;
    const resolveRange = async (r) => {
      requests.push(r);
      if (r.format !== "svg")
        throw Error("Fallback must be embedded as text, not outlined PDF");
      return { svg: captures[Number(r.key)].outline(r.start, r.end) };
    };
    const bytes = await P.createPDF(bundle, () => {}, {
      resolveRange,
      warning: (w) => warnings.push(w),
      textSummary: (s) => (summary = s),
    });
    let cancelled = false,
      rejected = false;
    try {
      await P.createPDF(
        { ...bundle, texts: [texts[0]] },
        () => {
          if (cancelled) throw Error("cancelled");
        },
        {
          resolveRange: async (r) => {
            cancelled = true;
            return resolveRange(r);
          },
        },
      );
    } catch (e) {
      rejected = /cancelled/.test(String(e));
    }
    if (!rejected)
      throw Error("Cancellation must not become a font/outline fallback");
    let invalid = false;
    try {
      await P.createPDF({ ...bundle, texts: [texts[0]] }, () => {}, {
        resolveRange: async () => ({
          svg: `<svg xmlns="${ns}" width="100" height="50"><text>fabricated</text></svg>`,
        }),
      });
    } catch {
      invalid = true;
    }
    if (!invalid)
      throw Error("Only native vector glyphs can define a fallback font");
    return { bytes: Array.from(bytes), warnings, summary, requests };
  }, fonts);
  await page.screenshot({ path: "tmp/qa/font-fallback-reference.png" });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.summary.outlined, 0);
  assert(result.summary.copied >= 6);
  assert(
    result.requests
      .filter((r) => r.key === "0")
      .every((r) => r.start === 0 && r.end === 4),
  );
  assert(
    !result.requests.some((r) => r.key === "5" && r.end > 4),
    "Invisible source text must never be requested as a font glyph",
  );
  const file = "output/pdf/font-fallback.pdf";
  await writeFile(file, new Uint8Array(result.bytes));
  const extracted = execFileSync(poppler("pdftotext"), ["-raw", file, "-"], {
    encoding: "utf8",
  });
  console.log(extracted);
  for (const value of ["ほげほげ", "ABCほげほげxyz", "ABCほげxyz", "日本語"])
    assert(extracted.replace(/\s/g, "").includes(value), extracted);
  assert(
    extracted.includes("ABC ほげ xyz"),
    "Styled boundaries must retain spaces",
  );
  assert(!extracted.includes("INVISIBLE"));
  const fontList = execFileSync(poppler("pdffonts"), [file], {
    encoding: "utf8",
  });
  console.log(fontList);
  assert.match(fontList, /Type 3/);
  assert.match(fontList, /CID TrueType/);
  assert(
    fontList
      .split("\n")
      .filter((l) => l.includes("Type 3"))
      .every((l) => /yes\s+no\s+yes/.test(l)),
    "Fallback fonts must be embedded and Unicode mapped",
  );
  execFileSync(poppler("pdftoppm"), [
    "-r",
    "96",
    "-png",
    "-singlefile",
    file,
    "tmp/qa/font-fallback",
  ]);
  const a = decode(await readFile("tmp/qa/font-fallback-reference.png")),
    b = decode(await readFile("tmp/qa/font-fallback.png"));
  const ink = (im, x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < im.width &&
    y < im.height &&
    im.data[(y * im.width + x) * im.channels] < 220;
  const coverage = (a, b, y) => {
    let n = 0,
      m = 0;
    for (let yy = y; yy < y + 90; yy++)
      for (let x = 0; x < 640; x++) {
        if (!ink(a, x, yy)) continue;
        n++;
        if (
          [-1, 0, 1].some((dy) =>
            [-1, 0, 1].some((dx) => ink(b, x + dx, yy + dy)),
          )
        )
          m++;
      }
    assert(n > 100);
    return m / n;
  };
  const scores = Array.from({ length: 6 }, (_, i) => [
    coverage(a, b, i * 95),
    coverage(b, a, i * 95),
  ]);
  console.log("Native fallback pixel coverage:", scores);
  assert(
    scores.every((s) => s.every((n) => n > 0.97)),
    JSON.stringify(scores),
  );
} finally {
  await browser.close();
}
