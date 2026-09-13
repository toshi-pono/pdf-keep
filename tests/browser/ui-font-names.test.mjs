import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { launchBrowser, poppler } from "../helpers/browser.mjs";
import { deliverTo } from "../helpers/ui.mjs";

// Unmodified static TTF from the Google CDN URL in google-font-catalog.json.
// Legacy family: Iosevka Charon Medium; legacy style: Regular; weight: 500.
const fixture = "tests/fixtures/fonts/IosevkaCharon-Medium.ttf";
const font = {
  family: "Iosevka Charon",
  style: "Medium",
  weight: 500,
  italic: false,
  characters: "Iosevka Charon Medium 123",
};
test("Google font results register Medium, remain searchable, and reject a different requested face", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    locale: "ja-JP",
    viewport: { width: 480, height: 680 },
  });
  await page.setContent(await readFile("dist/ui.html", "utf8"));
  await page.evaluate(() => {
    window.sent = [];
    window.addEventListener("message", (e) => {
      if (e.data?.pluginMessage) window.sent.push(e.data.pluginMessage);
    });
  });
  await deliverTo(page, {
    type: "selection",
    valid: true,
    revision: 1,
    name: "Font regression",
    width: 400,
    height: 70,
    fonts: [font],
    diagnostics: [],
  });
  await page.waitForFunction(() =>
    window.sent.some(
      (m) =>
        m.type === "google-font" &&
        m.font.family === "Iosevka Charon" &&
        m.font.weight === 500,
    ),
  );
  const bytes = Array.from(await readFile(fixture));
  await deliverTo(page, {
    type: "google-font-result",
    key: JSON.stringify([font.family, font.style]),
    bytes,
  });
  await page.locator("#tab-settings").click();
  assert.match(await page.locator("#font-status").innerText(), /準備完了/);
  assert.equal(await page.locator(".font-badge.ready").count(), 1);
  await page.locator("#fonts .check input").check();
  await page.waitForFunction(() =>
    window.sent.some(
      (m) =>
        m.type === "font-save" &&
        m.key === JSON.stringify(["Iosevka Charon", "Medium"]),
    ),
  );
  await page.locator("#export").click();
  await page.waitForFunction(() =>
    window.sent.some((m) => m.type === "export"),
  );
  const id = await page.evaluate(
    () => window.sent.filter((m) => m.type === "export").at(-1).id,
  );
  const png = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 70;
    return Array.from(
      new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer()),
    );
  });
  const download = page.waitForEvent("download");
  await deliverTo(page, {
    type: "bundle",
    bundle: {
      protocol: 2,
      id,
      name: "iosevka-charon-medium",
      width: 400,
      height: 70,
      scale: 1,
      mode: "text",
      outlineFallback: false,
      png,
      texts: [
        {
          name: "Medium text",
          x: 0,
          y: 0,
          width: 400,
          height: 70,
          fonts: [font],
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="70"><text x="15" y="40" font-family="Iosevka Charon" font-weight="500" font-size="24">${font.characters}</text></svg>`,
          source: {
            key: "font",
            characters: font.characters,
            segments: [
              {
                start: 0,
                end: font.characters.length,
                font,
                fontSize: 24,
                features: {},
                list: "NONE",
              },
            ],
          },
        },
      ],
    },
  });
  const file = await download;
  const extracted = execFileSync(
    poppler("pdftotext"),
    [await file.path(), "-"],
    { encoding: "utf8" },
  );
  assert(extracted.includes(font.characters), extracted);
  // The alias fix must not turn any other weight/family into this Medium face.
  for (const wrong of [
    { ...font, style: "Bold", weight: 700 },
    { ...font, family: "Iosevka Charon Mono" },
  ]) {
    await deliverTo(page, {
      type: "selection",
      valid: true,
      name: "Wrong face",
      width: 400,
      height: 70,
      fonts: [wrong],
      diagnostics: [],
    });
    await deliverTo(page, {
      type: "google-font-result",
      key: JSON.stringify([wrong.family, wrong.style]),
      bytes,
    });
    assert.equal(await page.locator(".font-badge.ready").count(), 0);
    const help = page.getByRole("button", { name: "フォントの取得エラー" });
    await help.hover();
    assert.match(
      await page.getByRole("tooltip").innerText(),
      /名前が一致しません/,
    );
    await page.keyboard.press("Escape");
  }
  // Bulk manual import and persisted-font reload share the same identity rules.
  await deliverTo(page, {
    type: "selection",
    valid: true,
    name: "Manual font",
    width: 400,
    height: 70,
    fonts: [font],
    diagnostics: [],
  });
  await page.locator(".font-remove").click();
  await page.locator("#bulk-fonts").setInputFiles(fixture);
  await page.locator(".font-badge.ready").waitFor();
  await page.locator(".font-remove").click();
  await deliverTo(page, {
    type: "saved-fonts",
    fonts: { [JSON.stringify([font.family, font.style])]: bytes },
  });
  assert.equal(await page.locator(".font-badge.ready").count(), 1);
});
