import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo } from "../helpers/ui.mjs";

test("one Save PDF click downloads inside a sandboxed iframe; retries, warnings and invalidation stay consistent", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 480, height: 680 },
    locale: "ja-JP",
  });
  const downloads = [];
  const errors = [];
  page.on("download", (file) => downloads.push(file));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(
    '<iframe style="border:0;width:480px;height:680px" sandbox="allow-scripts allow-downloads"></iframe>',
  );
  await page.evaluate(
    (html) => {
      window.sent = [];
      window.addEventListener("message", (event) => {
        if (event.data?.pluginMessage)
          window.sent.push(event.data.pluginMessage);
      });
      document.querySelector("iframe").srcdoc = html;
    },
    await readFile("dist/ui.html", "utf8"),
  );
  const frame = page
    .frames()
    .find((candidate) => candidate !== page.mainFrame());
  await frame.locator("#export").waitFor();
  assert.equal(await frame.locator("#export").innerText(), "PDF を保存");
  await deliverTo(frame, {
    type: "selection",
    name: "Cover",
    valid: true,
    revision: 1,
    width: 16,
    height: 16,
    fonts: [],
    diagnostics: [
      {
        name: "Title",
        nodeId: "1",
        severity: "warning",
        reason: "文字の輪郭線は未対応です。",
      },
    ],
  });
  assert(await frame.locator("#diagnostics").isHidden());
  const compact = await frame.locator(".notification-card").boundingBox();
  assert(compact.height < 100, "collapsed warnings remain compact");
  await frame.locator(".notification-details summary").click();
  assert(await frame.locator("#diagnostics").isVisible());
  await frame.locator(".notification-details summary").click();
  const png = await frame.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    return Array.from(
      new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer()),
    );
  });
  const request = async () => {
    await frame.locator("#export").click();
    return await page.evaluate(
      () =>
        window.sent.filter((message) => message.type === "export").at(-1).id,
    );
  };
  const bundle = (id) => ({
    type: "bundle",
    bundle: {
      id,
      name: "Cover",
      width: 16,
      height: 16,
      scale: 3,
      mode: "raster",
      png,
      texts: [],
    },
  });
  const id = await request();
  const automaticDownload = page.waitForEvent("download");
  await deliverTo(frame, bundle(id));
  const file = await automaticDownload;
  assert.equal(file.suggestedFilename(), "Cover-raster.pdf");
  assert.equal(
    (await PDFDocument.load(await readFile(await file.path()))).getPageCount(),
    1,
  );
  await frame.locator("#download").waitFor({ state: "visible" });
  assert.equal(downloads.length, 1);
  assert.match(await frame.locator("#status").innerText(), /保存を開始/);
  assert.match(await frame.locator("#diagnostics").textContent(), /Title/);
  assert.match(
    await frame.locator("#diagnostics").textContent(),
    /検索・コピー/,
  );
  assert(await frame.locator("#diagnostics").isHidden());
  const button = await frame.locator("#download").boundingBox();
  assert(button.height >= 40 && button.width > 350);
  const retry = page.waitForEvent("download");
  await frame.locator("#download").click();
  await retry;
  assert.equal(
    await page.evaluate(
      () => window.sent.filter((m) => m.type === "export").length,
    ),
    1,
    "saving again reuses the generated file",
  );
  await frame.locator('[data-quality="light"]').click();
  assert(await frame.locator("#download").isHidden());
  assert(await frame.locator("#export").isVisible());
  const cancelledID = await request();
  await frame.locator("#cancel").click();
  await deliverTo(frame, bundle(cancelledID));
  assert.equal(
    downloads.length,
    2,
    "a cancelled job cannot auto-download a late bundle",
  );
  const failedID = await request();
  await deliverTo(frame, {
    type: "error",
    id: failedID,
    message: "Test export failure",
  });
  assert(await frame.locator(".notification-card.error").isVisible());
  assert(await frame.locator("#download").isHidden());
  assert(await frame.locator("#export").isEnabled());
  await mkdir("tmp/qa", { recursive: true });
  await page.screenshot({ path: "tmp/qa/save-error.png" });
  assert.deepEqual(errors, []);
});
