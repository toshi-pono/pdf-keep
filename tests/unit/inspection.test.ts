import { createI18n, formatMessage } from "../../src/ui/i18n";
const i18n = createI18n("ja");
import test from "node:test";
import assert from "node:assert/strict";
import { blocks } from "../../src/shared/protocol";
import { inspect } from "../../src/plugin/inspect";

(globalThis as any).figma = { mixed: Symbol("mixed") };
const solid = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
function node(type: string, x = 0, y = 0, w = 100, h = 30): any {
  return {
    id: Math.random().toString(),
    name: type,
    type,
    visible: true,
    opacity: 1,
    absoluteTransform: [
      [1, 0, x],
      [0, 1, y],
    ],
    absoluteBoundingBox: { x, y, width: w, height: h },
    absoluteRenderBounds: { x, y, width: w, height: h },
    effects: [],
    fills: solid,
    strokes: [],
    blendMode: "NORMAL",
    isMask: false,
    cornerRadius: 0,
    clipsContent: false,
  };
}
function scene() {
  const f = node("FRAME", 0, 0, 400, 200);
  f.children = [];
  f.clipsContent = true;
  const t = node("TEXT", 10, 10);
  Object.assign(t, {
    parent: f,
    textTruncation: "DISABLED",
    hasMissingFont: false,
    getStyledTextSegments: () => [
      {
        characters: "Hello",
        fontName: { family: "M PLUS 1p", style: "Regular" },
        fontWeight: 400,
        fills: solid,
      },
    ],
  });
  f.children.push(t);
  return { f, t };
}
test("plain text over background is accepted", () => {
  const { f } = scene();
  assert.equal(inspect(f).diagnostics.length, 0);
});
test("possible foreground overlap is a nonblocking warning", () => {
  const { f } = scene();
  f.children.push(node("RECTANGLE", 15, 15));
  const diagnostic = inspect(f).diagnostics[0];
  assert.match(formatMessage(diagnostic.reason, i18n), /前面/);
  assert.equal(diagnostic.severity, "warning");
  assert(!blocks(diagnostic, "frame"));
  assert(!blocks(diagnostic, "pdf"));
});
test("hidden ancestor text is omitted", () => {
  const { f, t } = scene();
  const g = node("GROUP");
  g.visible = false;
  g.children = [t];
  f.children = [g];
  assert.equal(inspect(f).texts.length, 0);
});
test("zero opacity and unpainted text are omitted", () => {
  const { f, t } = scene();
  t.opacity = 0;
  assert.equal(inspect(f).texts.length, 0);
  t.opacity = 1;
  t.fills = [];
  assert.equal(inspect(f).texts.length, 0);
});
test("clipped text remains rejected while rotation is supported", () => {
  const { f, t } = scene();
  t.absoluteRenderBounds.x = -5;
  assert.match(
    formatMessage(inspect(f).diagnostics[0].reason, i18n),
    /Frame|Clip/,
  );
  t.absoluteTransform = [
    [0, -1, 10],
    [1, 0, 10],
  ];
  t.absoluteRenderBounds.x = 10;
  assert.equal(inspect(f).diagnostics.length, 0);
});
test("masks and effects on retained text are rejected", () => {
  const { f, t } = scene();
  t.effects = [{ visible: true }];
  const m = node("RECTANGLE");
  m.isMask = true;
  f.children.unshift(m);
  const reasons = inspect(f)
    .diagnostics.map((d) => formatMessage(d.reason, i18n))
    .join();
  assert.match(reasons, /マスク/);
  assert.match(reasons, /効果/);
});
test("truncated text is retained with its font requirements", () => {
  const { f, t } = scene();
  t.textTruncation = "ENDING";
  const result = inspect(f);
  assert.equal(result.texts.length, 1);
  assert.equal(result.fonts.length, 1);
  assert.equal(result.diagnostics.length, 0);
});
test("transformed parent is supported while unsupported compositing stays guarded", () => {
  const { f, t } = scene();
  const g = node("GROUP", 0, 0, 200, 100);
  g.fills = [];
  g.absoluteTransform = [
    [0, -1, 100],
    [1, 0, 0],
  ];
  g.children = [t];
  g.parent = f;
  t.parent = g;
  t.absoluteTransform = [
    [0, -1, 90],
    [1, 0, 10],
  ];
  f.children = [g];
  const diagnostics = inspect(f).diagnostics;
  assert.equal(diagnostics.length, 0);
  g.opacity = 0.5;
  assert(
    inspect(f).diagnostics.some(
      (d) => !d.destination && formatMessage(d.reason, i18n).includes("半透明"),
    ),
  );
});
test("mixed solid colors remain text and keep every styled font segment", () => {
  const { f, t } = scene();
  t.fills = (globalThis as any).figma.mixed;
  const original = t.getStyledTextSegments();
  t.getStyledTextSegments = () => [
    ...original,
    {
      ...original[0],
      characters: "Bold",
      fontName: { family: "M PLUS 1p", style: "Bold" },
      fontWeight: 700,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      textDecoration: "UNDERLINE",
    },
  ];
  assert.equal(inspect(f).texts.length, 1);
  assert.equal(inspect(f).fonts.length, 2);
  assert.deepEqual(inspect(f).diagnostics, []);
});
