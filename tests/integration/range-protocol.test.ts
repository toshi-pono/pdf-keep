import test from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "../helpers/figma";

for (const finish of ["export-finished", "cancel", "close"]) {
  test(`range protocol retains the snapshot until ${finish} and ignores stale requests`, async (t) => {
    const s = setup(false, false, true);
    s.enableTextSVG();
    s.original.children[0].resize(40, 18);
    t.after(() => s.events.close());
    s.figma.ui.onmessage({
      type: "export",
      protocol: 2,
      id: 7,
      scale: 1,
      mode: "text",
      outlineFallback: true,
    });
    await settle();
    const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
    assert(bundle, JSON.stringify(s.messages));
    assert.equal(bundle.protocol, 2);
    assert(s.created.some((n) => !n.removed));
    assert.equal(bundle.texts[0].source.characters, "ABC");
    assert.equal(
      bundle.texts[0].height,
      18,
      "do not resize the text layout to fix overflow",
    );
    assert.equal(bundle.texts[0].clipContent, false);
    s.original.children[0].characters = "Changed after export";
    s.figma.ui.onmessage({
      type: "text-range",
      id: 6,
      requestId: 1,
      range: { key: "0", start: 0, end: 1, format: "svg" },
    });
    s.figma.ui.onmessage({
      type: "text-range",
      id: 7,
      requestId: 2,
      range: { key: "0", start: 1, end: 2, format: "svg" },
    });
    await settle();
    assert(
      !s.messages.some((m) => m.type === "text-range-result" && m.id === 6),
    );
    assert(
      s.messages.some(
        (m) =>
          m.type === "text-range-result" && m.requestId === 2 && m.result?.svg,
      ),
    );
    assert(
      s.created.some(
        (n) => n.rangePaints?.length === 2 && n.characters === "ABC",
      ),
    );
    if (finish === "close") s.events.close();
    else s.figma.ui.onmessage({ type: finish, id: 7 });
    await settle();
    assert(s.created.every((n) => n.removed));
    assert(!s.original.removed);
    const count = s.messages.length;
    s.figma.ui.onmessage({
      type: "text-range",
      id: 7,
      requestId: 3,
      range: { key: "0", format: "svg" },
    });
    await settle();
    assert.equal(s.messages.length, count);
  });
}
