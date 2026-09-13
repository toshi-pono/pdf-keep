import test from "node:test";
import assert from "node:assert/strict";
import {
  googleFontsCSSURL,
  staticFontFaces,
} from "../../scripts/lib/google-font-catalog.mjs";

test("catalog requests every advertised script and excludes preview subsets", () => {
  const url = new URL(
    googleFontsCSSURL({
      family: "Noto Sans JP",
      fonts: { 400: {}, "500i": {} },
      subsets: ["menu", "latin", "japanese", "vietnamese"],
    }),
  );
  assert.equal(url.searchParams.get("family"), "Noto Sans JP:400,500italic");
  assert.deepEqual(url.searchParams.get("subset").split(","), [
    "japanese",
    "latin",
    "vietnamese",
  ]);
  const tamil = new URL(
    googleFontsCSSURL({
      family: "Example Tamil",
      fonts: { 400: {} },
      subsets: ["menu", "latin", "tamil"],
    }),
  );
  assert.equal(tamil.searchParams.get("subset"), "latin,tamil");
});

test("catalog rejects split subsets instead of keeping the final small TTF", () => {
  const face = (name, style, weight, file, range = "") =>
    `@font-face {font-family: '${name}'; font-style: ${style}; font-weight: ${weight}; src: url(https://fonts.gstatic.com/${file}.ttf) format('truetype'); ${range}}`;
  const regular = face("Example", "normal", 400, "full");
  const italic = face("Example", "italic", 500, "italic");
  assert.deepEqual(staticFontFaces(regular + italic), {
    Example: {
      400: "https://fonts.gstatic.com/full.ttf",
      "500i": "https://fonts.gstatic.com/italic.ttf",
    },
  });
  assert.throws(
    () => staticFontFaces(regular + face("Example", "normal", 400, "latin")),
    /split subsets/,
  );
  assert.throws(
    () =>
      staticFontFaces(
        face("Example", "normal", 400, "latin", "unicode-range: U+0000-00FF;"),
      ),
    /split subsets/,
  );
});
