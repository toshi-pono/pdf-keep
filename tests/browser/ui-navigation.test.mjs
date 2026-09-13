import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo } from "../helpers/ui.mjs";

test("PDF Keep tabs, scale presets, numeric entry and pixel mode keep export settings consistent", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 480, height: 680 },
    locale: "ja-JP",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const html = await readFile("dist/ui.html", "utf8");
  assert(
    !html.includes("<!-- SCRIPT -->"),
    "the production HTML must contain its bundled script",
  );
  await page.setContent(html);
  assert.equal(await page.title(), "PDF Keep");
  assert.equal(await page.locator("h1").count(), 0);
  assert(await page.locator("#panel-settings").isHidden());
  await page.evaluate(() => {
    window.sent = [];
    window.addEventListener("message", (event) => {
      if (event.data?.pluginMessage) window.sent.push(event.data.pluginMessage);
    });
  });
  await deliverTo(page, {
    type: "selection",
    valid: true,
    name: "Presentation / Cover",
    revision: 1,
    width: 1920,
    height: 1080,
    fonts: [],
    diagnostics: [],
  });
  await page.locator('[data-quality="manual"]').click();
  await page.locator("#scale").fill("2");
  assert.equal(await page.locator("#scale").inputValue(), "2");
  await page.getByRole("button", { name: "倍率を上げる", exact: true }).click();
  assert.equal(await page.locator("#scale").inputValue(), "2.25");
  assert(await page.locator("#create-frame").isDisabled());
  assert(await page.locator("#export").isEnabled());
  await page.getByRole("button", { name: "倍率を下げる", exact: true }).click();
  assert.equal(await page.locator("#scale").inputValue(), "2");
  await page.locator("#scale").fill("");
  assert(
    await page.locator("#export").isDisabled(),
    "empty numeric input must not silently mean Auto",
  );
  await page.locator("#scale").fill("-1");
  assert(await page.locator("#export").isDisabled());
  await page.locator("#scale").fill("0.125");
  assert.equal(await page.locator("#scale-hint").innerText(), "240 × 135 px");
  await page.locator("#tab-convert").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#tab-settings").getAttribute("aria-selected"),
    "true",
  );
  assert(await page.locator("#panel-convert").isHidden());
  await page.locator("#pixel-mode").check();
  await page.locator("#long-edge").fill("1001");
  await page.locator("#tab-settings").focus();
  await page.keyboard.press("Home");
  assert.equal(await page.locator("#scale-hint").innerText(), "1001 × 564 px");
  await page.locator("#export").click();
  await page.waitForFunction(() =>
    window.sent.some((message) => message.type === "export"),
  );
  const request = await page.evaluate(() =>
    window.sent.find((message) => message.type === "export"),
  );
  assert.equal(request.scale, 0);
  assert.equal(request.longEdge, 1001);
  assert(await page.locator("#scale").isDisabled());
  await page.locator("#tab-settings").click();
  assert(await page.locator("#long-edge").isDisabled());
  await page.locator("#cancel").click();
  await page.locator("#tab-convert").click();
  await page.locator('[data-quality="manual"]').click();
  await page.locator("#scale").fill("2");
  await page.locator("#tab-settings").click();
  assert(
    !(await page.locator("#pixel-mode").isChecked()),
    "a scale preset exits pixel mode",
  );
  await page.locator("#pixel-mode").check();
  assert.equal(
    await page.locator("#long-edge").inputValue(),
    "1001",
    "previous pixel entry is retained",
  );
  await page.locator("#tab-convert").click();
  await page.locator("#scale").fill("2");
  await page.locator("#create-frame").click();
  await page.waitForFunction(() =>
    window.sent.some((message) => message.type === "create-frame"),
  );
  const frameRequest = await page.evaluate(() =>
    window.sent.find((message) => message.type === "create-frame"),
  );
  assert.equal(frameRequest.scale, 2);
  assert(!("longEdge" in frameRequest));
  await deliverTo(page, {
    type: "frame-created",
    id: frameRequest.id,
    name: "Cover",
  });
  await page.locator("#refresh").click();
  await deliverTo(page, {
    type: "selection",
    valid: true,
    name: "Presentation / Cover",
    revision: 2,
    width: 1920,
    height: 1080,
    fonts: [],
    diagnostics: [],
  });
  await mkdir("tmp/qa", { recursive: true });
  await page.screenshot({ path: "tmp/qa/pdf-keep-convert.png" });
  await page.locator("#tab-settings").click();
  await page.screenshot({ path: "tmp/qa/pdf-keep-settings.png" });
  await page.setViewportSize({ width: 360, height: 600 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth === window.innerWidth,
    ),
  );
  for (const id of ["#export", "#create-frame"]) {
    const box = await page.locator(id).boundingBox();
    assert(
      box && box.y >= 0 && box.y + box.height <= 600,
      "export actions stay within the viewport",
    );
  }
  await page.screenshot({ path: "tmp/qa/pdf-keep-narrow.png" });
  await page.addStyleTag({
    content:
      ":root { --figma-color-bg: #2c2c2c; --figma-color-text: #eee; --figma-color-border: #444; --figma-color-text-secondary: #bbb; --figma-color-bg-hover: #383838; --figma-color-bg-brand-tertiary: #163d66; --figma-color-text-brand: #8bc2ff; }",
  });
  await page.locator("#tab-convert").click();
  await page.screenshot({ path: "tmp/qa/pdf-keep-dark.png" });
  assert.deepEqual(errors, []);
});
