// Optional live integration test: npm run test:network
import { downloadGoogleFont } from "../../src/fonts/google-fonts.ts";
import { build } from "esbuild";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const fonts = [];
for (const [family, style, weight, characters] of [
  ["Inter", "Medium", 500, "Google Fonts 123"],
  ["Noto Sans JP", "Regular", 400, "日本語の自動埋め込み"],
  ["Noto Sans JP", "Thin", 100, "極細の日本語テスト"],
  ["Noto Sans JP", "ExtraLight", 200, "細い日本語テスト"],
  ["Noto Sans JP", "Medium", 500, "中太の日本語テスト"],
  ["Noto Sans JP", "Bold", 700, "太字の日本語テスト"],
  ["Noto Sans JP", "Black", 900, "極太の日本語テスト"],
  ["Noto Serif JP", "Regular", 400, "明朝体の日本語テスト"],
  ["Noto Sans SC", "Regular", 400, "简体中文测试 123"],
  ["Noto Sans TC", "Regular", 400, "繁體中文測試 123"],
  ["Noto Sans KR", "Regular", 400, "한글 글꼴 테스트 123"],
  ["M PLUS 1p", "Bold", 700, "太字のテスト"],
  ["M PLUS Rounded 1c", "Regular", 400, "丸ゴシックの日本語テスト"],
  ["Iosevka Charon", "Medium", 500, "Iosevka Charon Medium 123"],
  ["Montserrat", "Medium Italic", 500, "Montserrat Medium Italic 123"],
  ["Nunito Sans", "Regular", 400, "Nunito Sans Regular 123"],
  ["DM Sans", "Regular", 400, "DM Sans Regular 123"],
  ["Source Sans 3", "ExtraLight", 200, "Source Sans ExtraLight 123"],
  ["Fira Code", "Regular", 400, "Fira Code Regular 123"],
  ["Lato", "Thin", 100, "Lato Thin 123"],
]) {
  if (
    process.env.GOOGLE_FONT_TEST_FAMILY &&
    family !== process.env.GOOGLE_FONT_TEST_FAMILY
  )
    continue;
  const spec = {
    family,
    style,
    weight,
    italic: /Italic/.test(style),
    characters,
  };
  fonts.push({
    spec,
    base64: Buffer.from(await downloadGoogleFont(spec)).toString("base64"),
  });
}
assert(fonts.length > 0, "No matching live font test case");
const code = await build({
  entryPoints: ["src/pdf/create-pdf.ts"],
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  format: "iife",
  globalName: "PaperTest",
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: code.outputFiles[0].text });
  const bytes = await page.evaluate(async (fonts) => {
    const P = globalThis.PaperTest;
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = fonts.length * 60 + 20;
    const png = new Uint8Array(
      await (await fetch(canvas.toDataURL())).arrayBuffer(),
    );
    const texts = fonts.map(({ spec, base64 }, i) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const key = JSON.stringify([spec.family, spec.style]);
      P.registerFont(key, bytes);
      const registered = P.registry.get(key);
      for (const character of spec.characters) {
        if (
          !/\s/.test(character) &&
          !registered.parsed.charToGlyphIndex(character)
        )
          throw new Error(
            `${spec.family} ${spec.style} is missing ${character}`,
          );
      }
      const automatic = P.registerAutomatic(bytes);
      if (!automatic.includes(key))
        throw new Error(`Missing manual alias: ${key}`);
      if (
        !automatic.every(
          (alias) => P.registry.get(alias) === P.registry.get(key),
        )
      )
        throw new Error(`Manual aliases duplicated parsed font data: ${key}`);
      if (
        registered.parsed.tables.os2.usWeightClass !==
        P.registry.get(key).parsed.tables.os2.usWeightClass
      )
        throw new Error(`Changed font weight: ${key}`);
      return {
        x: 20,
        y: 20 + 60 * i,
        width: 550,
        height: 50,
        name: spec.family,
        fonts: [spec],
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="550" height="50"><text font-family="${spec.family}" font-weight="${spec.weight}" font-style="${spec.italic ? "italic" : "normal"}" font-size="24" y="30">${spec.characters}</text></svg>`,
      };
    });
    const warnings = [];
    const pdf = await P.createPDF(
      {
        id: 1,
        name: "Google Fonts",
        width: 600,
        height: canvas.height,
        scale: 1,
        mode: "text",
        png,
        texts,
      },
      () => {},
      { warning: (message) => warnings.push(message) },
    );
    if (warnings.length) throw new Error(warnings.join("\n"));
    return Array.from(pdf);
  }, fonts);
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/google-fonts.pdf", new Uint8Array(bytes));
  const text = execFileSync(
    poppler("pdftotext"),
    ["output/pdf/google-fonts.pdf", "-"],
    { encoding: "utf8" },
  );
  for (const { spec } of fonts)
    assert(
      text.replace(/\s/g, "").includes(spec.characters.replace(/\s/g, "")),
      text,
    );
  console.log(
    `Live Google Fonts download, exact style registration and PDF text extraction passed (${fonts.map((f) => `${f.spec.family} ${f.spec.style}`).join(", ")}).`,
  );
} finally {
  await browser.close();
}
