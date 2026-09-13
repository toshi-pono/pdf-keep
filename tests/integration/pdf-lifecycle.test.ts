import test from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "../helpers/figma";

test("successful export cleans snapshot and leaves original intact", async () => {
  const s = setup();
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 3, mode: "text" });
  await settle();
  assert(s.messages.some((m) => m.type === "bundle"));
  assert(s.created.every((n) => n.removed));
  assert(!s.original.removed);
  assert.equal(s.original.opacity, 1);
});
test("render failure cleans all temporary nodes", async () => {
  const s = setup(true);
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 3, mode: "text" });
  await settle();
  assert(
    s.messages.some(
      (m) => m.type === "error" && m.message.includes("render failure"),
    ),
  );
  assert(s.created.every((n) => n.removed));
});
test("cancel during Figma render suppresses PDF bundle and cleans after render", async () => {
  const s = setup(false, true);
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 3, mode: "text" });
  s.figma.ui.onmessage({ type: "cancel", id: 1 });
  s.release();
  await settle();
  assert(!s.messages.some((m) => m.type === "bundle"));
  assert(s.created.every((n) => n.removed));
});
test("close callback removes temporary nodes synchronously", async () => {
  const s = setup(false, true);
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 3, mode: "raster" });
  s.events.close();
  assert(s.created.every((n) => n.removed));
  s.release();
  await settle();
});
for (const paint of [{ type: "GRADIENT_LINEAR" }, { type: "IMAGE" }]) {
  test(`unsupported ${paint.type} text produces outlines and a baked background`, async () => {
    const s = setup(false, false, true);
    const text = s.original.children[0];
    text.fills = [paint];
    const segments = text.getStyledTextSegments;
    text.getStyledTextSegments = function () {
      return segments
        .call(this)
        .map((segment: any) => ({ ...segment, fills: this.fills }));
    };
    s.figma.ui.onmessage({
      type: "export",
      id: 1,
      scale: 1,
      mode: "text",
      outlineFallback: true,
    });
    await settle();
    const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
    assert(bundle, JSON.stringify(s.messages));
    assert.equal(bundle.mode, "outline");
    assert.equal(bundle.texts.length, 0);
    assert(bundle.outlinePDF.length);
    assert(bundle.png.length);
    assert.equal(text.opacity, 1);
    assert.deepEqual(text.fills, [paint]);
    assert(s.created.every((n) => n.removed));
  });
}
test("text export failure falls back to outlines only when enabled", async () => {
  for (const enabled of [false, true]) {
    const s = setup(false, false, true); // Text SVG export fails in this fixture.
    s.figma.ui.onmessage({
      type: "export",
      id: 1,
      scale: 1,
      mode: "text",
      outlineFallback: enabled,
    });
    await settle();
    const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
    assert.equal(!!bundle, enabled, JSON.stringify(s.messages));
    if (enabled) assert.equal(bundle.mode, "outline");
    assert(s.created.every((n) => n.removed));
  }
});
test("cancelling an outline export never emits a bundle and cleans up", async () => {
  const s = setup(false, true, true);
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "outline" });
  s.figma.ui.onmessage({ type: "cancel", id: 1 });
  s.release();
  await settle();
  assert(!s.messages.some((m) => m.type === "bundle"));
  assert(
    s.messages.some((m) => m.type === "error" && /キャンセル/.test(m.message)),
  );
  assert(s.created.every((n) => n.removed));
});
test("stale selection revision is rejected before any temporary clone", async () => {
  const s = setup();
  s.figma.ui.onmessage({
    type: "export",
    id: 1,
    scale: 1,
    mode: "outline",
    revision: -1,
  });
  await settle();
  assert(
    s.messages.some(
      (m) => m.type === "error" && /選択が変わりました/.test(m.message),
    ),
  );
  assert.equal(s.created.length, 0);
});
test("closing during outline rendering never creates another temporary node", async () => {
  const s = setup(false, true, true);
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "outline" });
  s.events.close();
  const count = s.created.length;
  s.release();
  await settle();
  assert.equal(s.created.length, count);
  assert(s.created.every((node) => node.removed));
  assert(!s.messages.some((message) => message.type === "bundle"));
});
for (const formatting of [
  { listOptions: { type: "UNORDERED" } },
  { listOptions: { type: "ORDERED" }, indentation: 2 },
  { openTypeFeatures: { SUPS: true } },
  { openTypeFeatures: { subs: true } },
  { openTypeFeatures: { SINF: true } },
]) {
  test(`rich formatting uses local vector glyphs without outlining ordinary text: ${JSON.stringify(formatting)}`, async () => {
    const s = setup(false, false, true);
    s.enableTextSVG();
    const plain = s.original.children[0];
    const rich = plain.clone();
    s.original.appendChild(rich);
    rich.name = "Rich text";
    rich.opacity = 0.6;
    rich.textTruncation = "ENDING";
    const segments = rich.getStyledTextSegments;
    rich.getStyledTextSegments = function () {
      return segments
        .call(this)
        .map((segment: any) => ({ ...segment, ...formatting }));
    };
    s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "text" });
    await settle();
    const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
    assert(bundle, JSON.stringify(s.messages));
    assert.equal(bundle.mode, "text");
    assert.equal(bundle.texts.length, 2);
    assert.equal(bundle.texts[0].outlined, false);
    assert.equal(bundle.texts[1].outlined, true);
    assert.equal(bundle.texts[1].opacity, 0.6);
    assert.equal(bundle.texts[1].fonts.length, 0);
    assert.match(bundle.texts[1].svg, /<path/);
    assert(!bundle.texts[1].svg.includes("<text"));
    assert.equal(
      s.fontLoadCount(),
      0,
      "Native vector export must retain native truncation",
    );
    assert.equal(rich.opacity, 0.6);
    assert.equal(rich.textTruncation, "ENDING");
  });
}
test("script styling in SVG triggers a native re-export without relying on API feature tags", async () => {
  const s = setup(false, false, true);
  s.enableTextSVG();
  s.useScriptSVG();
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "text" });
  await settle();
  const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
  assert(bundle, JSON.stringify(s.messages));
  assert.equal(bundle.mode, "text");
  assert.equal(bundle.texts[0].outlined, true);
  assert.match(bundle.texts[0].svg, /<path/);
  assert(s.created.every((n) => n.removed));
});
