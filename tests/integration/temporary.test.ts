import test from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "../helpers/figma";
import {
  TemporaryExport,
  TEMPORARY_KEY,
  recoverTemporary,
} from "../../src/plugin/temporary";
const mark = (session = "interrupted") =>
  JSON.stringify({ purpose: "export", version: 1, session });
const start = (s: ReturnType<typeof setup>) => {
  s.enableTextSVG();
  s.figma.ui.onmessage({
    type: "export",
    protocol: 2,
    id: 7,
    scale: 1,
    mode: "text",
    outlineFallback: true,
  });
};

test("all live export nodes are owned and parked; selection and viewport stay put", async (t) => {
  const s = setup(false, false, true);
  t.after(() => s.events.close());
  const selected = s.figma.currentPage.selection;
  const viewport = { ...s.figma.viewport.bounds };
  start(s);
  await settle();
  const root = s.figma.currentPage.children.find(
    (n: any) => n.name === "PDF Keep temporary export",
  );
  assert(root);
  assert.equal(root.x, viewport.x + viewport.width + 1024);
  assert.equal(root.y, viewport.y);
  assert.equal(root.clipsContent, false);
  assert.equal(root.layoutMode, "NONE");
  assert.equal(root.fills.length, 0);
  for (const node of s.created.filter((n) => !n.removed)) {
    let top = node;
    while (top.parent !== s.figma.currentPage) top = top.parent;
    assert.equal(top, root);
    assert(top.getPluginData(TEMPORARY_KEY));
  }
  assert.equal(s.figma.currentPage.selection, selected);
  assert.deepEqual(s.figma.viewport.bounds, viewport);
  assert.equal(s.original.children[0].characters, "ABC");
});

test("normalized SVG/PDF ranges are exported once and SVG bytes are reused", async (t) => {
  const s = setup(false, false, true);
  t.after(() => s.events.close());
  start(s);
  await settle();
  let requestId = 0;
  const request = async (range: any) => {
    s.figma.ui.onmessage({
      type: "text-range",
      id: 7,
      requestId: ++requestId,
      range: { key: "0", ...range },
    });
    await settle();
    const response = s.messages.find(
      (m) => m.type === "text-range-result" && m.requestId === requestId,
    );
    assert(response?.result, JSON.stringify(response));
    return response.result;
  };
  const svg = await request({ start: 1, end: 2, format: "svg" });
  const pdf = await request({ start: 1, end: 2, format: "pdf" });
  assert(pdf.pdf.length && svg.svg.length);
  await request({ start: 1, end: 2, format: "pdf" });
  await request({ format: "svg" });
  await request({ start: 0, end: 3, format: "pdf" });
  await request({ start: 0, end: 3, format: "svg" });
  assert.equal(
    s.exports.filter((e) => e.options.svgOutlineText === true).length,
    2,
  );
  assert.equal(s.exports.filter((e) => e.options.format === "PDF").length, 2);
});

test("restart and page change recover only marked remnants, continuing past removal errors", () => {
  const s = setup();
  const bad = s.figma.createFrame(),
    leftover = s.figma.createFrame(),
    user = s.figma.createFrame();
  bad.setPluginData(TEMPORARY_KEY, mark());
  leftover.setPluginData(TEMPORARY_KEY, mark());
  user.name = "PDF Keep temporary export";
  const remove = bad.remove;
  bad.remove = () => {
    throw Error("removal failed");
  };
  s.restart();
  assert(leftover.removed);
  assert(!bad.removed && !user.removed && !s.original.removed);
  bad.remove = remove;
  s.events.currentpagechange();
  assert(bad.removed);
  assert(!user.removed);
});

test("recovery excludes the active session and completed frame descendants have no ownership", async () => {
  const s = setup(false, false, true);
  const other = s.figma.createFrame();
  other.setPluginData(TEMPORARY_KEY, mark("active"));
  recoverTemporary(s.figma.currentPage, "active");
  assert(!other.removed);
  s.figma.ui.onmessage({ type: "create-frame", id: 1, scale: 1, mode: "text" });
  await settle();
  const output = s.figma.currentPage.selection[0];
  assert.notEqual(output, s.original);
  assert.equal(output.parent, s.figma.currentPage);
  for (const n of [output, ...output.children])
    assert.equal(n.getPluginData(TEMPORARY_KEY), "");
  s.restart();
  assert(!output.removed && !output.children[0].removed);
});

test("a cleanup failure does not leave the plugin busy", async () => {
  const s = setup(false, false, true);
  start(s);
  await settle();
  const root = s.figma.currentPage.children.find((n: any) => n !== s.original);
  const remove = root.remove;
  root.remove = () => {
    throw Error("failed");
  };
  s.figma.ui.onmessage({ type: "export-finished", id: 7 });
  await settle();
  root.remove = remove;
  s.figma.ui.onmessage({ type: "export", id: 8, mode: "raster", scale: 1 });
  await settle();
  assert(s.messages.some((m) => m.type === "bundle" && m.bundle.id === 8));
  assert(root.removed);
});

test("unresolved operations time out; late callbacks cannot resume a disposed export", async () => {
  const s = setup();
  (globalThis as any).figma = s.figma;
  const session = new TemporaryExport(() => {});
  let resolve!: () => void;
  let resumed = false;
  const pending = session.run(
    "test",
    async (verify) => {
      await new Promise<void>((r) => {
        resolve = r;
      });
      verify();
      resumed = true;
    },
    15,
  );
  await assert.rejects(pending, /errors.stageTimeout/);
  session.dispose();
  resolve();
  await settle();
  assert.equal(resumed, false);
  assert.throws(session.check, /operation.cancelled/);
});

test("three failed proof ranges need four SVG exports and one merged PDF", async (t) => {
  const s = setup(false, false, true);
  t.after(() => s.events.close());
  s.original.children[0].characters = "Index12";
  start(s);
  await settle();
  let requestId = 0;
  for (const range of [
    { start: 4, end: 5, format: "svg" },
    { start: 5, end: 6, format: "svg" },
    { start: 6, end: 7, format: "svg" },
    { start: 4, end: 7, format: "pdf" },
  ]) {
    s.figma.ui.onmessage({
      type: "text-range",
      id: 7,
      requestId: ++requestId,
      range: { key: "0", ...range },
    });
    await settle();
    assert(
      s.messages.some(
        (m) =>
          m.type === "text-range-result" &&
          m.requestId === requestId &&
          m.result,
      ),
    );
  }
  assert.equal(
    s.exports.filter((e) => e.options.svgOutlineText === true).length,
    4,
  );
  assert.equal(s.exports.filter((e) => e.options.format === "PDF").length, 1);
});

for (const [format, timeout] of [
  ["SVG_STRING", 30000],
  ["PDF", 30000],
  ["PNG", 60000],
] as const) {
  test(`${format} has the specified external wait limit`, async (t) => {
    const s = setup();
    (globalThis as any).figma = s.figma;
    t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
    const session = new TemporaryExport(() => {});
    const node = s.figma.createFrame();
    session.add(node);
    node.exportAsync = () => new Promise(() => {});
    const rejected = assert.rejects(
      session.export(node, { format } as any),
      /errors.stageTimeout/,
    );
    t.mock.timers.tick(timeout);
    await rejected;
    session.dispose();
    assert(node.removed);
  });
}

test("45 second range deadline includes successive native exports", async (t) => {
  const s = setup();
  (globalThis as any).figma = s.figma;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const session = new TemporaryExport(() => {});
  const node = s.figma.createFrame();
  session.add(node);
  let first!: (value: any) => void;
  let second!: (value: any) => void;
  let count = 0,
    resumed = false;
  node.exportAsync = () =>
    new Promise((resolve) => {
      if (count++ === 0) first = resolve;
      else second = resolve;
    });
  const pending = session.run(
    "文字範囲の取得",
    async (verify) => {
      await session.export(node, { format: "SVG_STRING" }, verify);
      verify();
      await session.export(node, { format: "PDF" }, verify);
      verify();
      resumed = true;
    },
    45000,
  );
  const rejected = assert.rejects(pending, /errors.stageTimeout/);
  t.mock.timers.tick(25000);
  first("<svg/>");
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(count, 2);
  t.mock.timers.tick(20000);
  await rejected;
  session.dispose();
  second(new Uint8Array([1]));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(resumed, false);
});
