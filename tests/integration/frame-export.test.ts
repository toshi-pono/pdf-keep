import test from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "../helpers/figma";

test("native frame uses baked background and editable text without SVG or fonts", async () => {
  const s = setup(false, false, true);
  s.figma.ui.onmessage({ type: "create-frame", id: 1, scale: 3, mode: "text" });
  await settle();
  assert(
    s.messages.some((m) => m.type === "frame-created"),
    JSON.stringify(s.messages),
  );
  const output = s.figma.currentPage.selection[0];
  assert.notEqual(output, s.original);
  assert.equal(output.clipsContent, false);
  assert.equal(output.fills[0].imageHash, "flattened-image");
  assert.equal(output.exportSettings[0].format, "PDF");
  assert.equal(output.children.length, 1);
  assert.equal(output.children[0].type, "TEXT");
  assert.equal(output.children[0].opacity, 1);
  assert.deepEqual(
    Array.from(output.children[0].relativeTransform, (row: number[]) =>
      Array.from(row),
    ),
    [
      [1, 0, 10],
      [0, 1, 10],
    ],
  );
  assert.equal(s.original.children[0].opacity, 1);
  assert(!output.removed);
  assert(
    s.created
      .filter((n) => n !== output && !output.children.includes(n))
      .every((n) => n.removed),
  );
});
for (const [name, transform] of [
  [
    "rotation",
    [
      [0, -1, 50],
      [1, 0, 10],
    ],
  ],
  [
    "reflection",
    [
      [-1, 0, 50],
      [0, 1, 10],
    ],
  ],
  [
    "ancestor rotation with local reflection and scaling",
    [
      [0, -2, 60],
      [-1, 0, 40],
    ],
  ],
] as const) {
  test(`native frame and PDF preserve ${name}`, async () => {
    const s = setup(false, false, true);
    s.original.children[0].absoluteTransform = transform;
    s.enableTextSVG();
    s.figma.ui.onmessage({ type: "export", id: 1, scale: 1, mode: "text" });
    await settle();
    const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
    assert(bundle, JSON.stringify(s.messages));
    assert.deepEqual(JSON.parse(JSON.stringify(bundle.texts[0].transform)), [
      transform[0][0],
      transform[1][0],
      transform[0][1],
      transform[1][1],
    ]);
    s.figma.ui.onmessage({
      type: "create-frame",
      id: 2,
      scale: 1,
      mode: "text",
    });
    await settle();
    assert(
      s.messages.some((m) => m.type === "frame-created"),
      JSON.stringify(s.messages),
    );
    const output = s.figma.currentPage.selection[0];
    assert.deepEqual(
      JSON.parse(JSON.stringify(output.children[0].relativeTransform)),
      transform,
    );
    assert.deepEqual(s.original.children[0].absoluteTransform, transform);
    assert.equal(output.children[0].opacity, 1);
  });
}
test("mixed text survives native conversion and auto scale resolves in the sandbox", async () => {
  const s = setup(false, false, true);
  s.original.children[0].fills = s.figma.mixed;
  s.figma.ui.onmessage({ type: "create-frame", id: 1, scale: 0, mode: "text" });
  await settle();
  assert(
    s.messages.some((m) => m.type === "frame-created"),
    JSON.stringify(s.messages),
  );
  assert.equal(s.figma.currentPage.selection[0].children.length, 1);
  assert.equal(
    s.figma.currentPage.selection[0].children[0].fills,
    s.figma.mixed,
  );
});
test("sandbox resolves auto and custom pixel sizes against the current frame", async () => {
  for (const longEdge of [undefined, 1001]) {
    const s = setup();
    s.original.resize(1920, 1080);
    s.figma.ui.onmessage({
      type: "export",
      id: 1,
      scale: 0,
      mode: "raster",
      longEdge,
    });
    await settle();
    const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
    assert(bundle, JSON.stringify(s.messages));
    assert.equal(bundle.scale, (longEdge ?? 4096) / 1920);
    const wrapper = s.created.find((n) => n.lastExportOptions);
    assert.equal(wrapper.lastExportOptions.constraint.type, "WIDTH");
    assert.equal(wrapper.lastExportOptions.constraint.value, longEdge ?? 4096);
  }
});
test("translucent text keeps paint alpha and layer opacity in PDF and native Frame", async () => {
  for (const destination of ["export", "create-frame"]) {
    const s = setup(false, false, true);
    s.enableTextSVG();
    const source = s.original.children[0];
    source.opacity = 0.4;
    source.fills = [{ type: "SOLID", opacity: 0.5 }];
    const segments = source.getStyledTextSegments;
    source.getStyledTextSegments = function () {
      return segments
        .call(this)
        .map((segment: any) => ({ ...segment, fills: this.fills }));
    };
    s.figma.ui.onmessage({ type: destination, id: 1, scale: 1, mode: "text" });
    await settle();
    if (destination === "export") {
      const bundle = s.messages.find((m) => m.type === "bundle")?.bundle;
      assert(bundle, JSON.stringify(s.messages));
      assert.equal(bundle.mode, "text");
      assert.equal(bundle.texts[0].opacity, 0.4);
      assert.equal(bundle.texts[0].outlined, false);
      assert.equal(bundle.texts[0].fonts.length, 1);
    } else {
      assert(
        s.messages.some((m) => m.type === "frame-created"),
        JSON.stringify(s.messages),
      );
      assert.equal(s.figma.currentPage.selection[0].children[0].opacity, 0.4);
      assert.equal(
        s.figma.currentPage.selection[0].children[0].fills[0].opacity,
        0.5,
      );
    }
    assert.equal(source.opacity, 0.4);
    assert.equal(source.fills[0].opacity, 0.5);
  }
});
