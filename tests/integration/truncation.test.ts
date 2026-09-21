import { createI18n, formatMessage } from "../../src/ui/i18n";
const i18n = createI18n("ja");
import test from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "../helpers/figma";

for (const destination of ["export", "create-frame"]) {
  test(`${destination}: preserves truncated text using the appropriate output path`, async () => {
    const s = setup(false, false, true);
    const truncated = s.original.children[0];
    const ordinary = truncated.clone();
    s.original.appendChild(ordinary);
    truncated.textTruncation = "ENDING";
    truncated.characters = "ABC hidden text";
    truncated.maxLines = 2;
    truncated.textAutoResize = "HEIGHT";
    if (destination === "export") s.enableTextSVG();
    s.figma.ui.onmessage({ type: destination, id: 1, scale: 1, mode: "text" });
    await settle();
    assert(
      !s.messages.some((m) => m.type === "error"),
      JSON.stringify(s.messages),
    );
    const wrapper = s.created.find((n) => n.backgroundTextOpacities);
    assert.equal(
      wrapper.backgroundTextOpacities[0],
      0,
      "truncated text is removed from background",
    );
    assert.equal(
      wrapper.backgroundTextOpacities[1],
      0,
      "ordinary text is removed from background",
    );
    if (destination === "export") {
      const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
      assert(bundle);
      assert.equal(
        bundle.texts.length,
        2,
        "visible truncated characters have a text asset",
      );
      assert(bundle.texts[0].svg.includes("ABC…"));
      assert(!bundle.texts[0].svg.includes("hidden"));
      assert.equal(bundle.texts[0].clipContent, true);
      assert.equal(bundle.texts[1].clipContent, false);
    } else {
      const output = s.figma.currentPage.selection[0];
      assert.notEqual(output, s.original);
      assert.equal(output.children.length, 2);
      assert.equal(output.children[0].characters, "ABC hidden text");
      assert.equal(output.children[0].textTruncation, "ENDING");
      assert.equal(output.children[0].maxLines, 2);
      assert.equal(output.children[0].textAutoResize, "HEIGHT");
      assert.equal(s.fontLoadCount(), 0);
      assert(
        !s.messages.some(
          (m) =>
            m.type === "progress" &&
            formatMessage(m.message, i18n).includes("省略"),
        ),
      );
    }
    assert.equal(truncated.opacity, 1);
    assert.equal(truncated.textTruncation, "ENDING");
    assert.equal(ordinary.opacity, 1);
  });
}
test("PDF keeps the original viewport after temporarily widening a wrapped ellipsis", async () => {
  const s = setup(false, false, true);
  s.enableTextSVG();
  s.useWrappedEllipsis();
  const t = s.original.children[0];
  t.textTruncation = "ENDING";
  t.characters = "ABC hidden";
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "text" });
  await settle();
  const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
  assert(bundle, JSON.stringify(s.messages));
  assert.match(bundle.texts[0].svg, /viewBox="0 0 100 100"/);
  assert.match(bundle.texts[0].svg, /ABC…/);
  assert(!bundle.texts[0].svg.includes("hidden"));
  assert.equal(t.width, 100);
  assert.equal(t.characters, "ABC hidden");
  assert(s.created.every((n) => n.removed));
});
test("unmatched truncation fails without exporting hidden text and cleans up", async () => {
  const s = setup(false, false, true);
  s.original.children[0].textTruncation = "ENDING";
  s.enableTextSVG();
  s.rejectTruncatedPixels();
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "text" });
  await settle();
  assert(
    s.messages.some(
      (m) =>
        m.type === "error" &&
        /再現できません|32回/.test(formatMessage(m.message, i18n)),
    ),
  );
  assert(!s.messages.some((m) => m.type === "bundle"));
  assert(s.created.every((n) => n.removed));
  assert.equal(s.original.children[0].characters, "ABC");
});
test("cancellation during truncation leaves no output or temporary clones", async () => {
  const s = setup(false, false, true);
  s.original.children[0].textTruncation = "ENDING";
  s.enableTextSVG();
  s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "text" });
  s.figma.ui.onmessage({ type: "cancel", id: 1 });
  await settle();
  assert(!s.messages.some((m) => m.type === "bundle"));
  assert(s.created.every((n) => n.removed));
});
test("range protocol preserves the original viewport and excludes truncated source text", async () => {
  const s = setup(false, false, true);
  s.enableTextSVG();
  s.useWrappedEllipsis();
  s.original.children[0].textTruncation = "ENDING";
  s.original.children[0].characters = "ABC hidden";
  s.figma.ui.onmessage({
    type: "export",
    protocol: 2,
    id: 8,
    scale: 1,
    mode: "text",
    outlineFallback: true,
  });
  await settle();
  const b = s.messages.find((m) => m.type === "bundle")?.bundle;
  s.figma.ui.onmessage({ type: "export-finished", id: 8 });
  await settle();
  assert(b, JSON.stringify(s.messages));
  assert.equal(b.texts[0].source.characters, "ABC…");
  assert.equal(b.texts[0].clipContent, true);
  assert.match(b.texts[0].svg, /viewBox="0 0 100 100"/);
  assert(s.created.every((n) => n.removed));
});
