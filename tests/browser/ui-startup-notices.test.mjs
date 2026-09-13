import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo, font } from "../helpers/ui.mjs";

test("startup font loading never flashes warnings; real failures and selection diagnostics remain visible", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    locale: "ja-JP",
    viewport: { width: 480, height: 680 },
  });
  await page.setContent(await readFile("dist/ui.html", "utf8"));
  const notice = page.locator(".notification-card");
  assert(await notice.isHidden());
  const select = (fonts, diagnostics = []) =>
    deliverTo(page, {
      type: "selection",
      valid: true,
      revision: 1,
      name: "Startup",
      width: 800,
      height: 600,
      fonts,
      diagnostics,
    });
  await select([font]);
  assert.match(await page.locator("#font-status").innerText(), /取得中/);
  assert(await notice.isHidden(), "a pending download is not a warning");
  assert.equal(
    await page.locator(".settings-link").count(),
    0,
    "loading is not an outline fallback",
  );
  const bytes = Array.from(
    await readFile("tests/fixtures/fonts/MPLUS1p-Regular.ttf"),
  );
  const key = JSON.stringify([font.family, font.style]);
  await deliverTo(page, { type: "saved-fonts", fonts: { [key]: bytes } });
  assert(await notice.isHidden(), "restoring a saved font stays quiet");
  await deliverTo(page, {
    type: "google-font-result",
    key,
    error: "late network error",
  });
  assert(
    await notice.isHidden(),
    "a ready saved font is not missing when a later request fails",
  );
  const other = { ...font, family: "Private Font" };
  const later = { ...font, family: "Another Font" };
  await select([other, later]);
  assert(await notice.isHidden());
  await deliverTo(page, {
    type: "google-font-result",
    key: JSON.stringify([other.family, other.style]),
    error: "Not in Google Fonts",
  });
  assert(
    await notice.isVisible(),
    "real failures appear while other fonts are still loading",
  );
  assert.match(
    await page.locator("#diagnostics").textContent(),
    /1 種類のフォントは手動追加/,
  );
  assert(!/取得中/.test(await page.locator("#diagnostics").textContent()));
  assert.match(
    await page.locator(".settings-link").innerText(),
    /アウトライン/,
  );
  await deliverTo(page, {
    type: "google-font-result",
    key: JSON.stringify([later.family, later.style]),
    error: "Not in Google Fonts",
  });
  assert.match(await page.locator("#diagnostics").textContent(), /2 種類/);
  await page.locator("#refresh").click();
  assert(
    await notice.isHidden(),
    "retrying returns to a neutral loading state",
  );
  await select(
    [other],
    [
      {
        name: "Text",
        nodeId: "1",
        severity: "warning",
        reason: "Visible export warning",
      },
    ],
  );
  assert(
    await notice.isVisible(),
    "genuine selection warnings are never delayed by font loading",
  );
  assert.match(
    await page.locator("#diagnostics").textContent(),
    /Visible export warning/,
  );
  await select([]);
  assert(await notice.isHidden());
});
