import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSize,
  recommendedScale,
  resolveScale,
  rasterDimensions,
  printResolution,
} from "../../src/shared/resolution";

test("paper presets target A4 width and limit enlargement around Medium", () => {
  for (const [quality, width, cap] of [
    ["light", 1737, 2.1],
    ["medium", 2481, 3],
    ["sharp", 3226, 3.9],
  ] as const) {
    const large = printResolution(10000, 6000, quality, "A4", "portrait");
    assert.equal(rasterDimensions(10000, 6000, large.scale).width, width);
    assert.equal(large.limited, false);
    const small = printResolution(100, 60, quality, "A4", "portrait");
    assert.equal(small.scale, cap);
    assert.equal(small.limited, true);
    const tall = printResolution(2000, 2500, quality, "A4", "portrait");
    assert.equal(rasterDimensions(2000, 2500, tall.scale).width, width);
  }
  const huge = printResolution(1_000_000, 500_000, "medium", "A4", "portrait");
  assert.equal(huge.longEdge, 2481);
  assert.equal(
    resolveScale(1_000_000, 500_000, 0, "pdf", huge.longEdge),
    huge.scale,
  );
});

test("poster sizes, orientation and extreme aspect ratios obey raster limits", () => {
  assert.equal(
    printResolution(10000, 1000, "medium", "A0", "portrait").longEdge,
    9934,
  );
  assert.equal(
    printResolution(10000, 1000, "medium", "A1", "portrait").longEdge,
    7016,
  );
  assert.equal(
    printResolution(10000, 1000, "medium", "A4", "landscape").longEdge,
    3508,
  );
  assert.equal(
    printResolution(10000, 1000, "medium", "Letter", "portrait").longEdge,
    2550,
  );
  for (const [width, height] of [
    [10000, 14140],
    [100, 100000],
    [100000, 100],
    [8410, 11890],
  ]) {
    for (const destination of ["pdf", "frame"] as const) {
      const result = printResolution(
        width,
        height,
        "sharp",
        "A0",
        "landscape",
        destination,
      );
      validateSize(width, height, result.scale, destination);
      assert.equal(result.limited, true);
      assert.equal(
        resolveScale(width, height, 0, destination, result.longEdge),
        result.scale,
      );
    }
  }
  assert.throws(() => printResolution(NaN, 100, "medium", "A4", "portrait"));
});

test("size guards reject invalid scales and excessive memory", () => {
  for (const s of [0.25, 0.5, 1, 2, 3, 4]) validateSize(500, 300, s);
  for (const s of [0, -1, Infinity, NaN])
    assert.throws(() => validateSize(500, 300, s));
  assert.throws(() => validateSize(10000, 10000, 4));
  assert.throws(() => validateSize(Infinity, 100, 3));
});
test("frame image limit accepts lower scales and rejects dimensions over 4096", () => {
  for (const s of [0.25, 0.5, 1, 2, 3, 4]) {
    validateSize(4096 / s, 100, s, "frame");
    assert.throws(
      () => validateSize(4097 / s, 100, s, "frame"),
      /errors.frameBackgroundLimit/,
    );
  }
  validateSize(6000, 1000, 1, "pdf");
  validateSize(6000, 1000, 0.5, "frame");
});
test("PDF and frame recommendations cap backgrounds at 4096px, up to 3x", () => {
  for (const destination of ["pdf", "frame"] as const) {
    assert.equal(recommendedScale(500, 300, destination), 3);
    for (const [w, h] of [
      [1920, 1080],
      [4097, 100],
      [10000, 10000],
      [20000, 100],
    ]) {
      const scale = recommendedScale(w, h, destination)!;
      assert.equal(
        Math.max(...Object.values(rasterDimensions(w, h, scale))),
        4096,
      );
    }
  }
  assert.equal(recommendedScale(NaN, 100, "pdf"), null);
});
test("custom pixel resolution preserves aspect ratio and validates limits", () => {
  assert.deepEqual(
    rasterDimensions(1920, 1080, resolveScale(1920, 1080, 0, "pdf", 1001)),
    { width: 1001, height: 564 },
  );
  assert.deepEqual(
    rasterDimensions(1080, 1920, resolveScale(1080, 1920, 0, "frame", 1001)),
    { width: 564, height: 1001 },
  );
  for (const value of [0, -1, NaN, Infinity, 100.5, 16385])
    assert.throws(() => resolveScale(1920, 1080, 0, "pdf", value));
  assert.throws(() => resolveScale(1920, 1080, 0, "frame", 4097));
  assert.throws(() => resolveScale(100, 100, 0, "pdf", 16384));
  validateSize(500, 300, 1.237);
});
