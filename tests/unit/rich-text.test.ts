import test from "node:test";
import assert from "node:assert/strict";
import {
  needsTextOutlines,
  svgNeedsTextOutlines,
} from "../../src/shared/rich-text";

test("only active list and script formatting requires native glyph outlines", () => {
  const check = (segment: object) =>
    needsTextOutlines({
      getStyledTextSegments: () => [segment],
    } as unknown as TextNode);
  for (const value of [
    {},
    { listOptions: { type: "NONE" } },
    { openTypeFeatures: { SUPS: false, SUBS: 0, KERN: true } },
  ]) {
    assert.equal(check(value), false);
  }
  for (const value of [
    { listOptions: { type: "ORDERED" } },
    { listOptions: { type: "UNORDERED" } },
    { openTypeFeatures: { SUPS: true } },
    { openTypeFeatures: { subs: 1 } },
    { openTypeFeatures: { SINF: true } },
  ]) {
    assert.equal(check(value), true);
  }
});

test("SVG script hints also use native glyphs when the API omits feature tags", () => {
  for (const svg of [
    `<text style="font-feature-settings: 'sups' on">2</text>`,
    `<text font-feature-settings="'subs' 1">2</text>`,
    `<text style="font-variant-position: super">2</text>`,
    `<text><tspan baseline-shift="-30%">2</tspan></text>`,
  ])
    assert(svgNeedsTextOutlines(svg));
  assert(!svgNeedsTextOutlines('<text font-size="16">normal sub text</text>'));
});
