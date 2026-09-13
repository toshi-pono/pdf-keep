import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo, font } from "../helpers/ui.mjs";

test("font persistence, stale jobs, downloads and unmount cleanup", async (t) => {
  await mkdir("tmp/qa", { recursive: true });
  const b = await launchBrowser();
  t.after(() => b.close());
  const errors = [];
  const react = await b.newPage({
    locale: "ja-JP",
    viewport: { width: 480, height: 680 },
  });
  react.on("pageerror", (error) => errors.push(error.message));
  await react.setContent(await readFile("dist/ui.html", "utf8"));
  await react.evaluate(() => {
    window.sent = [];
    window.revoked = [];
    window.addEventListener("message", (event) => {
      if (event.data?.pluginMessage) window.sent.push(event.data.pluginMessage);
    });
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.revoked.push(url);
      revoke(url);
    };
  });
  await react.locator("#tab-settings").click();
  await deliverTo(react, {
    type: "selection",
    valid: true,
    name: "React lifecycle",
    width: 16,
    height: 16,
    fonts: [font],
    diagnostics: [],
  });
  await react.locator("#bulk-save").check();
  await react
    .locator("#bulk-fonts")
    .setInputFiles("tests/fixtures/fonts/MPLUS1p-Regular.ttf");
  await react.waitForFunction(() =>
    document.getElementById("status").textContent.includes("自動対応付け"),
  );
  assert(await react.locator("#fonts .check input").isChecked());
  assert(
    await react.evaluate(() =>
      window.sent.some(
        (message) => message.type === "font-save" && message.bytes.length > 0,
      ),
    ),
  );
  const fileInput = await react.locator("#fonts .file-input").elementHandle();
  await react.locator("#language").selectOption("en");
  assert(
    await react.evaluate(
      (node) => node === document.querySelector("#fonts .file-input"),
      fileInput,
    ),
    "language changes preserve the font component and file input",
  );
  assert(await react.locator("#bulk-save").isChecked());
  assert(await react.locator("#fonts .check input").isChecked());
  assert(await react.locator("#panel-settings").isVisible());
  await react.locator("#create-frame").click();
  await react.waitForFunction(() =>
    window.sent.some((message) => message.type === "create-frame"),
  );
  const first = await react.evaluate(
    () => window.sent.find((message) => message.type === "create-frame").id,
  );
  await react.locator("#cancel").click();
  await react.locator("#create-frame").click();
  await react.waitForFunction(
    () =>
      window.sent.filter((message) => message.type === "create-frame")
        .length === 2,
  );
  const second = await react.evaluate(
    () =>
      window.sent.filter((message) => message.type === "create-frame").at(-1)
        .id,
  );
  await deliverTo(react, {
    type: "frame-created",
    id: first,
    name: "stale completion",
  });
  assert(
    await react.locator("#cancel").isEnabled(),
    "late completion must not finish a new job",
  );
  assert(
    !(await react.locator("#status").innerText()).includes("stale completion"),
  );
  await deliverTo(react, {
    type: "frame-created",
    id: second,
    name: "current completion",
  });
  assert.equal(await react.locator("#cancel").count(), 0);
  await react.locator("#raster").check();
  await react.locator("#export").click();
  await react.waitForFunction(() =>
    window.sent.some((message) => message.type === "export"),
  );
  const exportID = await react.evaluate(
    () => window.sent.filter((message) => message.type === "export").at(-1).id,
  );
  const png = await react.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    canvas.getContext("2d").fillRect(0, 0, 48, 48);
    return Array.from(
      new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer()),
    );
  });
  await deliverTo(react, {
    type: "bundle",
    bundle: {
      id: exportID,
      name: "React lifecycle",
      width: 16,
      height: 16,
      scale: 3,
      mode: "raster",
      png,
      texts: [],
    },
  });
  await react.locator("#download").waitFor({ state: "visible" });
  let url = await react.locator("#download").getAttribute("href");
  assert.equal(
    await react.locator("#download").getAttribute("download"),
    "React lifecycle-raster.pdf",
  );
  await react.locator("#language").selectOption("en");
  assert.equal(await react.locator("#download").getAttribute("href"), url);
  await deliverTo(react, {
    type: "selection",
    valid: true,
    name: "React text",
    width: 200,
    height: 60,
    fonts: [font],
    diagnostics: [],
  });
  await react.locator("#raster").uncheck();
  await react.locator("#export").click();
  await react.waitForFunction(
    () =>
      window.sent.filter((message) => message.type === "export").length === 2,
  );
  const textID = await react.evaluate(
    () => window.sent.filter((message) => message.type === "export").at(-1).id,
  );
  const textPNG = await react.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 600, 180);
    return Array.from(
      new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer()),
    );
  });
  await deliverTo(react, {
    type: "bundle",
    bundle: {
      id: textID,
      name: "React text",
      width: 200,
      height: 60,
      scale: 3,
      mode: "text",
      png: textPNG,
      texts: [
        {
          name: "日本語",
          x: 0,
          y: 0,
          width: 200,
          height: 60,
          fonts: [font],
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text font-family="M PLUS 1p" font-size="20" x="10" y="30">日本語</text></svg>',
        },
      ],
    },
  });
  await react.locator("#download").waitFor({ state: "visible" });
  assert.equal(
    await react.locator("#download").getAttribute("download"),
    "React text.pdf",
  );
  assert(
    !(await react.locator("#status").innerText()).includes("警告"),
    "production bundle font subsetting must succeed",
  );
  assert(await react.evaluate((url) => window.revoked.includes(url), url));
  url = await react.locator("#download").getAttribute("href");
  await react.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert(
    await react.evaluate((url) => window.revoked.includes(url), url),
    "unmount releases the generated PDF URL",
  );
  assert.equal(await react.locator("main").count(), 0);
  await react.close();
  assert.deepEqual(errors, []);

  assert.deepEqual(errors, []);
});
