import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo, font } from "../helpers/ui.mjs";

test("many fonts stay in compact scrollable rows and help floats on hover or focus", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 480, height: 680 },
    locale: "ja-JP",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(await readFile("dist/ui.html", "utf8"));
  await deliverTo(page, {
    type: "selection",
    name: "Many fonts",
    valid: true,
    width: 800,
    height: 600,
    fonts: [
      font,
      ...Array.from({ length: 19 }, (_, i) => ({
        ...font,
        family: `Long font family ${i}`,
        style: "Regular",
      })),
    ],
    diagnostics: [],
  });
  await deliverTo(page, {
    type: "google-font-result",
    key: JSON.stringify([font.family, font.style]),
    bytes: Array.from(
      await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
    ),
  });
  await page.locator("#tab-settings").click();
  assert.equal(await page.locator(".font").count(), 20);
  assert(
    await page
      .locator("#fonts")
      .evaluate(
        (node) =>
          node.scrollHeight > node.clientHeight && node.clientHeight <= 220,
      ),
  );
  const row = await page.locator(".font").first().boundingBox();
  assert(row.height <= 48, "a registered font occupies one compact row");
  const upload = await page.locator("#add-fonts").boundingBox();
  const help = page.getByRole("button", { name: "フォントの追加について" });
  await help.hover();
  await page.getByRole("tooltip").waitFor();
  assert.match(await page.getByRole("tooltip").innerText(), /Google Fonts/);
  assert.deepEqual(
    await page.locator("#add-fonts").boundingBox(),
    upload,
    "help must not push the layout",
  );
  await page.getByRole("tooltip").hover();
  assert(
    await page.getByRole("tooltip").isVisible(),
    "hover text remains hoverable",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("tooltip").count(), 0);
  await help.focus();
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("tooltip").count(), 0);
  await page.locator("#fonts .check input").check();
  assert(await page.locator("#fonts .check input").isChecked());
  await mkdir("tmp/qa", { recursive: true });
  await page.screenshot({ path: "tmp/qa/compact-fonts.png" });
  await page.setViewportSize({ width: 360, height: 600 });
  await help.scrollIntoViewIfNeeded();
  // Resizing/scrolling closes help. Let those browser events finish before
  // focusing it again, otherwise they race with the tooltip assertions.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await help.blur();
  await help.focus();
  await page.getByRole("tooltip").waitFor();
  const tooltip = await page.getByRole("tooltip").boundingBox();
  assert(
    tooltip.x >= 0 &&
      tooltip.x + tooltip.width <= 360 &&
      tooltip.y >= 0 &&
      tooltip.y + tooltip.height <= 600,
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "tmp/qa/compact-fonts-narrow.png" });
  assert.deepEqual(errors, []);
});
