import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import { fontIdentities, normalizeFontName } from "../../src/fonts/font-names";
import fixture from "../fixtures/fonts/google-font-metadata.json";

const matches = (font: opentype.Font, family: string, style: string) =>
  fontIdentities(font).some(
    (n) =>
      normalizeFontName(n.family) === normalizeFontName(family) &&
      normalizeFontName(n.style) === normalizeFontName(style),
  );
const load = () => {
  const bytes = new Uint8Array(
    readFileSync("tests/fixtures/fonts/IosevkaCharon-Medium.ttf"),
  );
  return opentype.parse(bytes.buffer);
};
test("Google's Iosevka Charon Medium resolves without admitting another family or weight", () => {
  const font = load();
  assert(matches(font, "Iosevka Charon Medium", "Regular"));
  assert(matches(font, "Iosevka Charon", "Medium"));
  for (const [family, style] of [
    ["Iosevka Charon", "Regular"],
    ["Iosevka Charon", "Bold"],
    ["Iosevka Charon", "Medium Italic"],
    ["Iosevka Charon Mono", "Medium"],
  ])
    assert(!matches(font, family, style));
});
test("stale legacy names follow the actual instance weight and slope", () => {
  const font = load();
  font.tables.os2.usWeightClass = 400;
  assert(matches(font, "Iosevka Charon", "Regular"));
  assert(!matches(font, "Iosevka Charon", "Medium"));
  font.tables.os2.usWeightClass = 500;
  font.names.fontSubfamily.en = "Italic";
  assert(!matches(font, "Iosevka Charon", "Medium Italic"));
  font.tables.os2.fsSelection |= 1;
  assert(matches(font, "Iosevka Charon", "Medium Italic"));
  assert(!matches(font, "Iosevka Charon", "Medium"));
});
test("actual metadata from 649 Google styles resolves with no family/weight/slant substitutions", () => {
  assert.equal(fixture.cases.length, 649);
  for (const c of fixture.cases) {
    const font = {
      names: c.names,
      tables: { os2: c.os2, post: c.post },
    } as unknown as opentype.Font;
    assert(matches(font, c.family, c.style), `${c.family} ${c.style}`);
    const wrongStyle = c.italic
      ? c.style.replace(/\s*Italic$/, "") || "Regular"
      : c.style + " Italic";
    assert(
      !matches(font, c.family, wrongStyle),
      `wrong slope: ${c.family} ${c.style}`,
    );
    for (const other of [100, 200, 300, 400, 500, 600, 700, 800, 900].filter(
      (w) => w !== c.weight,
    )) {
      const otherCase = fixture.cases.find(
        (x) =>
          x.family === c.family && x.weight === other && x.italic === c.italic,
      );
      if (otherCase)
        assert(
          !matches(font, c.family, otherCase.style),
          `wrong weight: ${c.family} ${c.style} accepted ${otherCase.style}`,
        );
    }
  }
});
test("family descriptors and explicit localized name pairs remain distinct", () => {
  const font = load();
  const names = font.names as unknown as Record<string, Record<string, string>>;
  names.preferredFamily = { en: "Example Condensed", ja: "日本語ファミリー" };
  names.preferredSubfamily = { en: "Medium", ja: "中太" };
  assert(matches(font, "Example Condensed", "Medium"));
  assert(!matches(font, "Example", "Medium"));
  assert(matches(font, "日本語ファミリー", "中太"));
  assert(!matches(font, "Example Condensed", "中太"));
  names.preferredFamily = { en: "Example Display" };
  names.preferredSubfamily = {};
  assert(
    matches(font, "Example Display", "Regular"),
    "missing typographic style falls back to legacy style",
  );
});
