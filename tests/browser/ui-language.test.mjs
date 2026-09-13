import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";

test("language switching retains settings and diagnostics", async (t) => {
  await mkdir("tmp/qa", { recursive: true });
  const b = await launchBrowser();
  t.after(() => b.close());
  const errors = [];
  const english = await b.newPage({
    locale: "en-US",
    viewport: { width: 480, height: 680 },
  });
  await english.setContent(await readFile("dist/ui.html", "utf8"));
  assert.equal(await english.locator("html").getAttribute("lang"), "en");
  assert.equal(await english.locator("#export").innerText(), "Save PDF");
  assert.equal(
    await english.locator("#selection").innerText(),
    "Select one frame",
  );
  await english.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          pluginMessage: {
            type: "selection",
            valid: true,
            name: "日本語のフレーム",
            width: 800,
            height: 600,
            fonts: [],
            diagnostics: [
              {
                nodeId: "1",
                name: "文字の名前",
                severity: "warning",
                reason: "文字の輪郭線は未対応です。",
              },
            ],
          },
        },
      }),
    ),
  );
  await english.waitForFunction(
    () =>
      document.getElementById("selection").textContent === "日本語のフレーム",
  );
  await english.locator("#tab-settings").click();
  await english.locator("#pixel-mode").check();
  await english.locator("#long-edge").fill("1200");
  assert.equal(
    await english.locator("#scale-hint").innerText(),
    "1200 × 900 px",
  );
  await english.locator("#tab-settings").click();
  assert.match(
    await english.locator("#diagnostics").textContent(),
    /Warning.*文字の名前: Text strokes are not supported/,
  );
  await english.screenshot({ path: "tmp/qa/ui-en.png" });
  await english.locator("#create-frame").click();
  assert.match(
    await english.locator("#status").innerText(),
    /Creating converted frame/,
  );
  await english.locator("#language").selectOption("ja");
  assert.equal(await english.locator("html").getAttribute("lang"), "ja");
  assert.equal(await english.locator("#export").innerText(), "PDF を保存");
  assert.equal(
    await english.locator("#selection").innerText(),
    "日本語のフレーム",
  );
  assert.match(await english.locator("#status").innerText(), /変換済み Frame/);
  assert.equal(await english.locator("#long-edge").inputValue(), "1200");
  assert(await english.locator("#pixel-mode").isChecked());
  assert(await english.locator("#create-frame").isDisabled());
  assert(await english.locator("#cancel").isEnabled());
  assert(await english.locator("#panel-settings").isVisible());
  await english.locator("#cancel").click();
  await english.locator("#language").selectOption("en");
  assert.match(await english.locator("#status").innerText(), /Cancelled/);
  assert.match(
    await english.locator("#diagnostics").textContent(),
    /Text strokes/,
  );
  await english.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          pluginMessage: {
            type: "selection",
            valid: true,
            name: "Ski slope",
            width: 800,
            height: 600,
            fonts: [],
            diagnostics: [
              {
                nodeId: "ski",
                name: "(b) Real ski-slope images",
                reason:
                  "文字のグラデーション・画像塗り・半透明塗りは未対応です。",
              },
            ],
          },
        },
      }),
    ),
  );
  await english.waitForFunction(
    () => document.getElementById("selection").textContent === "Ski slope",
  );
  assert(await english.locator("#outline-fallback").isChecked());
  assert(await english.locator("#export").isEnabled());
  assert(await english.locator("#create-frame").isDisabled());
  assert.match(
    await english.locator("#diagnostics").textContent(),
    /PDF: outline unsupported ranges/,
  );
  assert.match(
    await english.locator("#outline-notice").innerText(),
    /Add fonts to keep more text copyable/,
  );
  await english.locator("#outline-fallback").uncheck();
  assert(await english.locator("#export").isDisabled());
  await english.locator("#outline-fallback").check();
  await english.locator("#language").selectOption("ja");
  assert.match(
    await english.locator("#diagnostics").textContent(),
    /PDF: 該当範囲をアウトラインで保持/,
  );
  assert(await english.locator("#export").isEnabled());
  await english.screenshot({
    path: "tmp/qa/ui-outline-fallback.png",
    fullPage: true,
  });
  await english.close();

  assert.deepEqual(errors, []);
});
