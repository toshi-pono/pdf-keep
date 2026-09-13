import test from "node:test";
import assert from "node:assert/strict";
import { coalesceOutlines } from "../../src/pdf/coalesce-outlines";
import type { TextAsset } from "../../src/shared/protocol";
const asset = { source: { key: "0" } } as TextAsset;
const run = {};
const part = (start: number, end: number, proofRun = run): any => ({
  type: "native",
  asset,
  proofRun,
  reason: "proof failed",
  order: start,
  range: { key: "0", start, end, format: "pdf" },
});
test("adjacent OpenType failures share a native range without changing inputs", () => {
  const parts = [part(4, 5), part(5, 6), part(6, 7)];
  assert.deepEqual(
    coalesceOutlines(parts).map((p) => p.range),
    [{ key: "0", start: 4, end: 7, format: "pdf" }],
  );
  assert.equal(parts[0].range.end, 5);
});
for (const [name, middle] of [
  ["successful glyph", { ...part(5, 6), type: "glyph" }],
  ["different style run", part(5, 6, {})],
  [
    "clipped fallback",
    { ...part(5, 6), clip: { x: 0, y: 0, width: 10, height: 10 } },
  ],
  ["other failure", { ...part(5, 6), proofRun: undefined }],
  ["different reason", { ...part(5, 6), reason: "missing font" }],
  ["different source", { ...part(5, 6), asset: { ...asset } }],
])
  test(`never merges across ${name}`, () => {
    assert.equal(coalesceOutlines([part(4, 5), middle, part(6, 7)]).length, 3);
  });
test("gaps, reverse order, full layers and composition remain separate", () => {
  for (const parts of [
    [part(4, 5), part(6, 7)],
    [part(5, 6), part(4, 5)],
    [part(4, 5), { ...part(5, 6), range: { key: "0", format: "pdf" } }],
    [part(4, 5), part(5, 6)].map((p) => ({
      ...p,
      asset: { source: { composition: true } },
    })),
  ])
    assert.equal(coalesceOutlines(parts as any).length, 2);
});
test("grapheme ranges merge at their actual UTF-16 boundaries", () => {
  assert.equal(coalesceOutlines([part(1, 3), part(3, 5)])[0].range.end, 5);
});
