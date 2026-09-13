import { encode } from "fast-png";
import test from "node:test";
import assert from "node:assert/strict";
import { setup, settle } from "../helpers/figma";

test("size preview is read-only, bounded and discards stale selections", async () => {
  const s = setup(false, false, true);
  s.original.resize(2000, 1000);
  const png = encode({ width: 2, height: 1, data: new Uint8Array(8) });
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: any[] = [];
  s.original.exportAsync = async (options: any) => {
    calls.push(options);
    if (calls.length === 1) await paused;
    return png;
  };
  const request = () => {
    const revision = s.messages
      .filter((m) => m.type === "selection")
      .at(-1).revision;
    s.figma.ui.onmessage({ type: "estimate-preview", revision });
    return revision;
  };
  request();
  s.events.selectionchange();
  request();
  s.events.selectionchange();
  const latest = request();
  assert.equal(calls.length, 1, "only one preview renders at a time");
  release();
  await settle();
  const responses = s.messages.filter((m) => m.type === "estimate-preview");
  assert.equal(responses.length, 1);
  assert.equal(responses[0].revision, latest);
  assert.equal(responses[0].pixels, 2);
  assert.equal(responses[0].bytes, png.length);
  assert.equal(calls.length, 2, "superseded queued request is discarded");
  assert.equal(calls[0].constraint.type, "WIDTH");
  assert.equal(calls[0].constraint.value, 768);
  assert.equal(s.created.length, 0);
  assert.equal(s.fontLoadCount(), 0);
  assert.equal(s.original.children[0].opacity, 1);
});
test("preview failure does not block native frame export", async () => {
  const s = setup();
  s.original.exportAsync = async () => {
    throw Error("preview unavailable");
  };
  const revision = s.messages.find((m) => m.type === "selection").revision;
  s.figma.ui.onmessage({ type: "estimate-preview", revision });
  await settle();
  assert(s.messages.some((m) => m.type === "estimate-preview" && !m.bytes));
  s.figma.ui.onmessage({
    type: "create-frame",
    id: 1,
    scale: 1,
    mode: "raster",
  });
  await settle();
  assert(s.messages.some((m) => m.type === "frame-created"));
});
