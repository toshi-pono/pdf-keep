import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo } from "../helpers/ui.mjs";

test("range export cancellation and completion", async (t) => {
  await mkdir("tmp/qa", { recursive: true });
  const b = await launchBrowser();
  t.after(() => b.close());
  const errors = [];
  const rangeUI = await b.newPage({ locale: "en-US" });
  rangeUI.on("pageerror", (e) => errors.push(e.message));
  await rangeUI.setContent(await readFile("dist/ui.html", "utf8"));
  await rangeUI.evaluate(() => {
    window.sent = [];
    window.addEventListener("message", (e) => {
      if (e.data?.pluginMessage) window.sent.push(e.data.pluginMessage);
    });
  });
  await deliverTo(rangeUI, {
    type: "selection",
    valid: true,
    name: "Ranges",
    width: 16,
    height: 16,
    fonts: [],
    diagnostics: [],
  });
  const native = await PDFDocument.create();
  native.addPage([12, 12]).drawRectangle({ x: 2, y: 2, width: 4, height: 4 });
  const nativePDF = Array.from(await native.save());
  const rangePNG = await rangeUI.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    c.getContext("2d").fillRect(0, 0, 48, 48);
    return Array.from(
      new Uint8Array(await (await fetch(c.toDataURL())).arrayBuffer()),
    );
  });
  let rangeExports = 0;
  for (const cancelled of [true, false]) {
    await rangeUI.locator("#export").click();
    await rangeUI.waitForFunction(
      (count) =>
        window.sent.filter((m) => m.type === "export").length === count,
      ++rangeExports,
    );
    const id = await rangeUI.evaluate(
      () => window.sent.filter((m) => m.type === "export").at(-1).id,
    );
    assert.equal(
      await rangeUI.evaluate(
        () => window.sent.filter((m) => m.type === "export").at(-1).protocol,
      ),
      2,
    );
    await deliverTo(rangeUI, {
      type: "bundle",
      bundle: {
        protocol: 2,
        outlineFallback: true,
        id,
        name: "Ranges",
        width: 16,
        height: 16,
        scale: 3,
        mode: "text",
        png: rangePNG,
        texts: [
          {
            name: "unsupported",
            x: 0,
            y: 0,
            width: 16,
            height: 16,
            svg: "",
            fonts: [],
            source: {
              key: "0",
              characters: "x",
              segments: [],
              fallbackReason: "フォントを登録してください。",
            },
          },
        ],
      },
    });
    await rangeUI.waitForFunction(
      (id) => window.sent.some((m) => m.type === "text-range" && m.id === id),
      id,
    );
    const requestId = await rangeUI.evaluate(
      (id) =>
        window.sent.find((m) => m.type === "text-range" && m.id === id)
          .requestId,
      id,
    );
    if (cancelled) await rangeUI.locator("#cancel").click();
    await rangeUI.evaluate(
      ({ id, requestId, pdf }) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              pluginMessage: {
                type: "text-range-result",
                id,
                requestId,
                result: { pdf: new Uint8Array(pdf) },
              },
            },
          }),
        ),
      { id, requestId, pdf: nativePDF },
    );
    await rangeUI.waitForFunction(
      (id) =>
        window.sent.some((m) => m.type === "export-finished" && m.id === id),
      id,
    );
    if (cancelled)
      assert.equal(await rangeUI.locator("#download").isVisible(), false);
    else {
      await rangeUI.locator("#download").waitFor({ state: "visible" });
      assert.match(
        await rangeUI.locator("#diagnostics").textContent(),
        /Outlined text layer/,
      );
    }
  }
  await rangeUI.close();
  assert.deepEqual(errors, []);

  assert.deepEqual(errors, []);
});
