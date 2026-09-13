import test from "node:test";
import assert from "node:assert/strict";
import { truncationCandidates } from "../../src/plugin/truncated-text";
test("visible glyph count decodes entities, combines styles and respects UTF-16 boundaries", () => {
  const source = "日&\n😀AB hidden";
  const svg =
    "<svg><text><tspan>日&amp;</tspan><tspan>&#x1f600;A</tspan></text><text>B</text></svg>";
  const ends = truncationCandidates(source, svg);
  assert.equal(ends[0], 7);
  assert(!ends.includes(4), "never split a surrogate pair");
});
test("candidate work is bounded for large truncated documents", () => {
  const ends = truncationCandidates(
    "A".repeat(100000),
    "<svg><text><tspan>AAA</tspan></text></svg>",
  );
  assert.equal(ends.length, 64);
  assert.equal(ends[0], 3);
});

test("ellipsis offset never mistakes equal centroids for equal pixels", async () => {
  const { encode } = await import("fast-png");
  const { ellipsisOffset } = await import("../../src/pdf/text-pixels");
  const png = (alphas: number[]) =>
    encode({
      width: 3,
      height: 1,
      data: Uint8Array.from(alphas.flatMap((a) => [0, 0, 0, a])),
    });
  assert.equal(ellipsisOffset(png([100, 0, 100]), png([0, 200, 0])), null);
  assert.equal(ellipsisOffset(png([0, 0, 100]), png([0, 100, 0])), 1);
  assert.equal(ellipsisOffset(png([0, 100, 0]), png([0, 100, 0])), 0);
  assert.equal(ellipsisOffset(png([0, 255, 0]), png([0, 0, 0])), null);
});

test("36px multiline regression searches the exact kerning near a noisy centroid", async () => {
  const { trackingCandidates } =
    await import("../../src/plugin/truncated-text");
  // Real Figma fixture: centroid 2.28125, exact matching letter spacing 2.25.
  const candidates = trackingCandidates(2.28125);
  assert.equal(candidates[0], 2.25);
  assert(candidates.includes(2.28125));
  assert(candidates.includes(2.265625));
  assert.equal(new Set(candidates).size, candidates.length);
  assert(candidates.length <= 10);
});

test("search prioritizes prefixes within the visible range over longer hidden suffixes", () => {
  const ends = truncationCandidates(
    "ABC hidden",
    "<svg><text>ABC</text></svg>",
  );
  assert.deepEqual(ends.slice(0, 3), [3, 2, 4]);
});

test("soft wraps are reconstructed in display order across differently styled spans", async () => {
  const { softLineBreaks } = await import("../../src/plugin/truncated-text");
  const text = "A red gate current path hidden";
  const svg =
    '<svg><text><tspan x="20" y="30">red gate </tspan><tspan x="0" y="70">current path</tspan></text><text><tspan x="0" y="30">A </tspan></text></svg>';
  assert.deepEqual(softLineBreaks(text, svg), [10]);
  assert.deepEqual(softLineBreaks("Different text", svg), []);
  assert.deepEqual(softLineBreaks("A red gate\ncurrent path", svg), []);
});
