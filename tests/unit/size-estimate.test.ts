import test from "node:test";
import assert from "node:assert/strict";
import {
  estimatePDFSize,
  formatBytes,
  formatSizeRange,
} from "../../src/shared/size-estimate";

test("PDF estimate increases with output resolution and image complexity", () => {
  const simple = { pixels: 768 * 432, bytes: 12000 };
  const photo = { ...simple, bytes: 400000 };
  const small = estimatePDFSize(1001 * 564, [], photo)!;
  const large = estimatePDFSize(4096 * 2304, [], photo)!;
  const flat = estimatePDFSize(4096 * 2304, [], simple)!;
  assert(small.low < large.low && small.high < large.high);
  assert(flat.high < large.low);
  assert(large.sampled && large.low > 0 && large.high > large.low);
});

test("PDF estimates include font subsets but do not count repeated text repeatedly", () => {
  const sample = { pixels: 10000, bytes: 1000 };
  const font = { characters: "日本語 ABC", bytes: 1000000, glyphs: 2000 };
  const raster = estimatePDFSize(10000, [], sample)!;
  const text = estimatePDFSize(10000, [font], sample)!;
  const repeated = estimatePDFSize(
    10000,
    [{ ...font, characters: font.characters.repeat(100) }],
    sample,
  )!;
  assert.deepEqual(text, repeated);
  assert(text.low > raster.low && text.high > raster.high);
  assert(estimatePDFSize(10000, [font, font], sample)!.high > text.high);
});

test("missing or invalid samples use a finite fallback and invalid sizes are hidden", () => {
  const fallback = estimatePDFSize(4000000, [])!;
  assert(!fallback.sampled && Number.isFinite(fallback.high));
  for (const sample of [
    { pixels: 0, bytes: 100 },
    { pixels: 1, bytes: Infinity },
  ])
    assert.deepEqual(estimatePDFSize(4000000, [], sample), fallback);
  for (const pixels of [0, -1, NaN, Infinity])
    assert.equal(estimatePDFSize(pixels, []), null);
});

test("compact font estimates cover measured Japanese fixture subsets", () => {
  const image = { pixels: 1, bytes: 1 };
  const raster = estimatePDFSize(1, [], image)!;
  for (const [characters, embedded] of [
    [16, 1613],
    [36, 3235],
  ]) {
    const estimated = estimatePDFSize(
      1,
      [
        {
          characters: Array.from({ length: characters }, (_, i) =>
            String.fromCharCode(65 + i),
          ).join(""),
          bytes: 1760000,
          glyphs: 8676,
        },
      ],
      image,
    )!;
    assert(estimated.low - raster.low <= embedded);
    assert(estimated.high - raster.high >= embedded);
  }
});

test("file size labels use consistent decimal KB and MB", () => {
  assert.equal(formatBytes(4784702), "4.8 MB");
  assert.equal(formatBytes(51200), "51 KB");
  assert.equal(formatSizeRange(50000, 900000), "50–900 KB");
  assert.equal(formatSizeRange(900000, 2400000), "0.9–2.4 MB");
});
