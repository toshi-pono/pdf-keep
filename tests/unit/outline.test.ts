import type { TemporaryExport } from "../../src/plugin/temporary";
import test from "node:test";
import assert from "node:assert/strict";
import { outlineTextPDF } from "../../src/plugin/outline";

test("outline isolation preserves layout, text styles, masks and ancestors, excludes artwork", async () => {
  const text: any = {
    type: "TEXT",
    visible: true,
    opacity: 0.5,
    fills: [{ type: "GRADIENT_LINEAR" }],
  };
  const image: any = {
    type: "RECTANGLE",
    visible: true,
    opacity: 1,
    fills: [{ type: "IMAGE" }],
  };
  const mask: any = {
    type: "GROUP",
    visible: true,
    opacity: 1,
    isMask: true,
    children: [{ ...image }],
  };
  const group: any = {
    type: "FRAME",
    visible: true,
    opacity: 0.7,
    fills: [{}],
    strokes: [{}],
    layoutMode: "HORIZONTAL",
    relativeTransform: [
      [0, -1, 100],
      [1, 0, 0],
    ],
    children: [image, mask, text],
  };
  let exported: any;
  const temporary = Object.assign(new Set<any>(), {
    remove(this: Set<any>, node: any) {
      node.remove();
      this.delete(node);
    },
    export(node: any, options: any) {
      return node.exportAsync(options);
    },
  });
  const clone: any = {
    type: "FRAME",
    visible: true,
    opacity: 1,
    fills: [{}],
    children: [group],
    removed: false,
    remove() {
      this.removed = true;
    },
    async exportAsync(options: any) {
      assert.equal(options.svgOutlineText, true);
      exported = structuredClone(this.children);
      return '<svg width="100" height="100"><path d="M0 0H10V10Z"/></svg>';
    },
  };
  const imported: any = {
    removed: false,
    remove() {
      this.removed = true;
    },
    async exportAsync(options: any) {
      assert.equal(options.format, "PDF");
      return new Uint8Array([1, 2, 3]);
    },
  };
  (globalThis as any).figma = { createNodeFromSvg: () => imported };
  await outlineTextPDF(
    { clone: () => clone } as any,
    temporary as unknown as TemporaryExport,
    () => {},
  );
  assert.equal(
    exported[0].children[0].visible,
    true,
    "auto-layout children stay present",
  );
  assert.equal(
    exported[0].children[0].opacity,
    0,
    "background artwork is not in the vector PDF",
  );
  assert.deepEqual(exported[0].fills, []);
  assert.equal(exported[0].strokes.length, 1);
  assert.equal(exported[0].strokes[0].opacity, 0);
  assert.equal(exported[0].opacity, 0.7);
  assert.deepEqual(exported[0].relativeTransform, [
    [0, -1, 100],
    [1, 0, 0],
  ]);
  assert.equal(exported[0].children[2].opacity, 0.5);
  assert.equal(exported[0].children[2].fills[0].type, "GRADIENT_LINEAR");
  assert.equal(exported[0].children[1].isMask, true);
  assert.equal(exported[0].children[1].children[0].opacity, 1);
  assert(clone.removed && imported.removed);
  assert.equal(temporary.size, 0);
});

test("text left in the SVG is rejected and the temporary clone is removed", async () => {
  const clone: any = {
    type: "FRAME",
    visible: true,
    opacity: 1,
    children: [],
    removed: false,
    remove() {
      this.removed = true;
    },
    async exportAsync() {
      return "<svg><text>hidden</text></svg>";
    },
  };
  const temporary = Object.assign(new Set<any>(), {
    remove(this: Set<any>, node: any) {
      node.remove();
      this.delete(node);
    },
    export(node: any, options: any) {
      return node.exportAsync(options);
    },
  });
  await assert.rejects(
    outlineTextPDF(
      { clone: () => clone } as any,
      temporary as unknown as TemporaryExport,
      () => {},
    ),
    /アウトライン/,
  );
  assert(clone.removed);
  assert.equal(temporary.size, 0);
});
