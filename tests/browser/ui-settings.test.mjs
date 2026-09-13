import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo, font } from "../helpers/ui.mjs";

test("paper quality defaults, poster resolution and export requests stay consistent", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 480, height: 680 },
    locale: "ja-JP",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(await readFile("dist/ui.html", "utf8"));
  await page.evaluate(() => {
    window.sent = [];
    window.addEventListener("message", (e) => {
      if (e.data?.pluginMessage) window.sent.push(e.data.pluginMessage);
    });
  });
  const select = (width, height) =>
    deliverTo(page, {
      type: "selection",
      valid: true,
      name: "Research figure",
      revision: 1,
      width,
      height,
      fonts: [],
      diagnostics: [],
    });
  await select(10000, 1000);
  assert.equal(
    await page.locator('[data-quality="medium"]').getAttribute("aria-pressed"),
    "true",
  );
  assert(await page.locator("#scale").isHidden());
  const mediumSize = await page.locator("#pdf-size").innerText();
  for (const [quality, expected] of [
    ["sharp", "3226 × 323 px"],
    ["light", "1737 × 174 px"],
    ["medium", "2481 × 249 px"],
  ]) {
    await page.locator(`[data-quality="${quality}"]`).click();
    assert.equal(await page.locator("#scale-hint").innerText(), expected);
    if (quality !== "medium")
      assert.notEqual(await page.locator("#pdf-size").innerText(), mediumSize);
  }
  await mkdir("tmp/qa", { recursive: true });
  await page.screenshot({ path: "tmp/qa/paper-quality-medium.png" });
  await page.locator("#tab-settings").click();
  assert.equal(await page.locator("#paper-size").inputValue(), "A4");
  await page.locator("#paper-size").selectOption("A1");
  assert.equal(
    await page.locator("#scale-hint").textContent(),
    "7016 × 702 px",
  );
  await page.locator("#paper-size").selectOption("A0");
  assert.equal(
    await page.locator("#scale-hint").textContent(),
    "9934 × 994 px",
  );
  await page.screenshot({ path: "tmp/qa/paper-quality-settings.png" });
  await page.locator("#export").click();
  await page.waitForFunction(() =>
    window.sent.some((m) => m.type === "export"),
  );
  const pdf = await page.evaluate(() =>
    window.sent.find((m) => m.type === "export"),
  );
  assert.equal(pdf.longEdge, 9934);
  assert.equal(pdf.scale, 0);
  assert(await page.locator("#paper-size").isDisabled());
  assert(await page.locator("#paper-orientation").isDisabled());
  await page.locator("#cancel").click();
  await page.locator("#create-frame").click();
  await page.waitForFunction(() =>
    window.sent.some((m) => m.type === "create-frame"),
  );
  const frame = await page.evaluate(() =>
    window.sent.find((m) => m.type === "create-frame"),
  );
  assert.equal(
    frame.longEdge,
    4096,
    "Figma image fills keep their existing limit",
  );
  await page.locator("#cancel").click();
  await page.locator("#paper-size").selectOption("A4");
  await page.locator("#paper-orientation").selectOption("landscape");
  assert.equal(
    await page.locator("#scale-hint").textContent(),
    "3508 × 351 px",
  );
  await page.locator("#paper-orientation").selectOption("portrait");
  await select(100, 60);
  assert.equal(await page.locator("#scale-hint").textContent(), "300 × 180 px");
  assert.match(await page.locator(".quality-reference").textContent(), /上限/);
  await page.locator("#tab-convert").click();
  await page.locator('[data-quality="manual"]').click();
  await page.locator("#scale").fill("2.125");
  await page.locator('[data-quality="light"]').click();
  await page.locator('[data-quality="manual"]').click();
  assert.equal(await page.locator("#scale").inputValue(), "2.125");
  await page.locator("#scale").fill("0");
  assert(
    await page.locator("#export").isDisabled(),
    "Manual zero cannot silently enable legacy Auto",
  );
  await page.locator('[data-quality="medium"]').click();
  await select(10000, 14140);
  await page.locator("#tab-settings").click();
  await page.locator("#paper-size").selectOption("A0");
  assert(
    await page.locator("#export").isEnabled(),
    "poster presets fit the memory budget automatically",
  );
  assert.match(await page.locator(".quality-reference").textContent(), /上限/);
  await page.setViewportSize({ width: 360, height: 600 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth === window.innerWidth,
    ),
  );
  await page.screenshot({ path: "tmp/qa/paper-quality-narrow.png" });
  assert.deepEqual(errors, []);
});

test("selection, scale controls, limits and font loading", async (t) => {
  await mkdir("tmp/qa", { recursive: true });
  const b = await launchBrowser();
  t.after(() => b.close());
  const errors = [];
  const p = await b.newPage({
    viewport: { width: 480, height: 680 },
    locale: "ja-JP",
  });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setContent(await readFile("dist/ui.html", "utf8"));
  await p.locator("#tab-settings").click();
  await p.locator("#outline-fallback").uncheck();
  await p.locator("#tab-convert").click();
  const deliver = (message) => deliverTo(p, message);
  await deliver({
    type: "selection",
    valid: true,
    name: "UI test",
    fonts: [],
    diagnostics: [],
  });
  assert.equal(await p.locator("#selection").innerText(), "UI test");
  assert(await p.locator("#export").isEnabled());
  assert(await p.locator("#create-frame").isEnabled());
  await deliver({
    type: "selection",
    valid: true,
    name: "Rotated text",
    fonts: [],
    diagnostics: [
      {
        name: "Rating",
        reason: "PDF専用の未対応表現",
        nodeId: "1",
        destination: "pdf",
      },
    ],
  });
  assert(!(await p.locator("#export").isEnabled()));
  assert(await p.locator("#create-frame").isEnabled());
  await deliver({
    type: "selection",
    valid: true,
    name: "プレゼンテーション",
    revision: 10,
    width: 1920,
    height: 1080,
    fonts: [],
    diagnostics: [
      {
        name: "見出し",
        reason:
          "前面の図形と重なる可能性があります。変換後の見た目を確認してください。",
        nodeId: "1",
        severity: "warning",
      },
    ],
  });
  assert(await p.locator("#export").isEnabled());
  assert(await p.locator("#create-frame").isEnabled());
  assert.equal(
    await p.locator('[data-quality="medium"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.match(await p.locator("#scale-hint").innerText(), /2481 × 1396 px/);
  assert(
    await p.locator("#pdf-size-estimate").evaluate((node) => !node.hidden),
  );
  assert.match(
    await p.locator("#pdf-size").innerText(),
    /推定PDF容量 約 .* MB/,
  );
  await deliver({
    type: "estimate-preview",
    revision: 10,
    pixels: 768 * 432,
    bytes: 400000,
  });
  const recommendedSize = await p.locator("#pdf-size").innerText();
  await deliver({
    type: "estimate-preview",
    revision: 9,
    pixels: 1,
    bytes: 10000000,
  });
  assert.equal(
    await p.locator("#pdf-size").innerText(),
    recommendedSize,
    "ignore stale frame samples",
  );
  await p.screenshot({ path: "tmp/qa/ui-redesign.png" });
  await p.locator('[data-quality="manual"]').click();
  await p.locator("#scale").fill("3");
  assert.notEqual(await p.locator("#pdf-size").innerText(), recommendedSize);
  assert(!(await p.locator("#create-frame").isEnabled()));
  assert(await p.locator("#export").isEnabled());
  await p.locator("#tab-settings").click();
  await p.locator("#pixel-mode").check();
  await p.locator("#long-edge").fill("1001");
  assert.match(await p.locator("#scale-hint").innerText(), /1001 × 564/);
  assert.notEqual(await p.locator("#pdf-size").innerText(), recommendedSize);
  assert(await p.locator("#create-frame").isEnabled());
  await p.locator("#long-edge").fill("4097");
  assert(!(await p.locator("#create-frame").isEnabled()));
  assert(await p.locator("#export").isEnabled());
  await p.locator("#long-edge").fill("");
  assert(await p.locator("#pdf-size-estimate").isHidden());
  assert(!(await p.locator("#export").isEnabled()));
  await p.locator("#tab-convert").click();
  await p.locator('[data-quality="medium"]').click();
  await deliver({
    type: "selection",
    valid: true,
    name: "Unsafe test",
    fonts: [],
    diagnostics: [
      { name: "Covered label", reason: "前景に遮蔽されています", nodeId: "1" },
    ],
  });
  assert(!(await p.locator("#export").isEnabled()));
  assert(!(await p.locator("#create-frame").isEnabled()));
  assert(await p.locator("#pdf-size-estimate").isHidden());
  await p.locator("#tab-settings").click();
  await p.locator("#raster").check();
  assert(await p.locator("#export").isEnabled());
  await p.locator("#tab-settings").click();
  await p.locator("#export").click();
  assert(await p.locator("#cancel").isEnabled());
  await p.locator("#cancel").click();
  assert(await p.locator("#export").isEnabled());
  await p.locator("#raster").uncheck();
  await deliver({
    type: "selection",
    valid: true,
    name: "Google Fonts",
    fonts: [font],
    diagnostics: [],
  });
  assert(!(await p.locator("#export").isEnabled()));
  assert(await p.locator("#create-frame").isEnabled());
  assert.match(await p.locator("#font-status").innerText(), /取得中/);
  await deliver({
    type: "google-font-result",
    key: JSON.stringify([font.family, font.style]),
    error: "通信できません。TTF を追加してください。",
  });
  assert.match(await p.locator("#font-status").innerText(), /手動追加/);
  await p.locator("#tab-convert").click();
  await p.locator("#refresh").click();
  assert.match(await p.locator("#font-status").innerText(), /取得中/);
  await deliver({
    type: "google-font-result",
    key: JSON.stringify([font.family, font.style]),
    bytes: Array.from(
      await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
    ),
  });
  assert(await p.locator("#export").isEnabled());
  assert.match(await p.locator("#font-status").innerText(), /準備完了/);
  await deliver({
    type: "selection",
    revision: 11,
    valid: true,
    name: "Preview failure",
    width: 1920,
    height: 1080,
    fonts: [],
    diagnostics: [],
  });
  await deliver({ type: "estimate-preview", revision: 11 });
  assert(
    await p.locator("#pdf-size-estimate").evaluate((node) => !node.hidden),
  );
  await p.getByRole("button", { name: "推定容量について" }).hover();
  assert.match(await p.getByRole("tooltip").textContent(), /概算/);
  assert(await p.locator("#export").isEnabled());
  await deliver({
    type: "selection",
    valid: false,
    name: "No frame",
    fonts: [],
    diagnostics: [],
  });
  assert(await p.locator("#pdf-size-estimate").isHidden());
  await p.screenshot({ path: "tmp/qa/ui.png" });

  assert.deepEqual(errors, []);
});
