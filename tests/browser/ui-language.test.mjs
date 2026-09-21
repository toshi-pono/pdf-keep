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
                reason: {
                  kind: "message",
                  key: "errors.textStroke",
                  params: {},
                },
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
                reason: { kind: "message", key: "errors.textFill", params: {} },
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

test("Korean UI restores preferences, survives late settings, and re-translates active messages", async (t) => {
  const b = await launchBrowser();
  t.after(() => b.close());
  const page = await b.newPage({
    locale: "ko-KR",
    viewport: { width: 480, height: 680 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const captureMessages = () => {
    window.outgoing = [];
    window.addEventListener("message", (e) => {
      if (e.data?.pluginMessage) window.outgoing.push(e.data.pluginMessage);
    });
  };
  const html = (await readFile("dist/ui.html", "utf8")).replace(
    "<head>",
    `<head><script>(${captureMessages.toString()})();</script>`,
  );
  await page.setContent(html);
  const deliver = async (message) => {
    await page.evaluate(
      (m) =>
        window.dispatchEvent(
          new MessageEvent("message", { data: { pluginMessage: m } }),
        ),
      message,
    );
  };
  assert.equal(await page.locator("html").getAttribute("lang"), "ko");
  assert.equal(await page.locator("#export").innerText(), "PDF 저장");
  await page.waitForFunction(() =>
    window.outgoing.some((m) => m.type === "language-load"),
  );
  await deliver({ type: "language-settings", language: "en" });
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.locator("#tab-settings").click();
  assert.deepEqual(await page.locator("#language option").allTextContents(), [
    "日本語",
    "English",
    "한국어",
  ]);
  await page.locator("#language").selectOption("ko");
  await page.waitForFunction(() =>
    window.outgoing.some(
      (m) => m.type === "language-save" && m.language === "ko",
    ),
  );
  await deliver({ type: "language-settings", language: "ja" });
  await deliver({ type: "language-settings", language: "unsupported" });
  assert.equal(await page.locator("html").getAttribute("lang"), "ko");
  const name = "日本語 한국어 <&> {{name}}";
  await deliver({
    type: "selection",
    valid: true,
    name,
    width: 800,
    height: 600,
    fonts: [],
    diagnostics: [
      {
        nodeId: "text",
        name,
        severity: "warning",
        reason: { kind: "message", key: "errors.parentStroke", params: {} },
      },
    ],
  });
  await page.locator("#pixel-mode").check();
  await page.locator("#long-edge").fill("1200");
  await page.locator("#create-frame").click();
  await page.waitForFunction(() =>
    window.outgoing.some((m) => m.type === "create-frame"),
  );
  const id = await page.evaluate(
    () => window.outgoing.findLast((m) => m.type === "create-frame").id,
  );
  await deliver({
    type: "progress",
    id,
    message: {
      kind: "message",
      key: "progress.truncatedText",
      params: {
        name,
        stage: {
          kind: "message",
          key: "progress.preparingFont",
          params: { family: "Noto Sans KR" },
        },
      },
    },
  });
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Noto Sans KR"),
  );
  for (const [language, text] of [
    ["en", "Preparing font"],
    ["ja", "フォントを準備中"],
    ["ko", "폰트를 준비하는 중"],
  ]) {
    await page.locator("#language").selectOption(language);
    assert((await page.locator("#status").innerText()).includes(text));
    assert((await page.locator("#status").innerText()).includes(name));
    assert.equal(await page.locator("#long-edge").inputValue(), "1200");
    assert(await page.locator("#cancel").isEnabled());
  }
  await page.locator(".notification-details").evaluate((el) => {
    el.open = true;
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mkdir("tmp/qa", { recursive: true });
  await page.screenshot({ path: "tmp/qa/ui-ko-settings.png", fullPage: true });
  await page.locator("#cancel").click();
  await deliver({
    type: "storage-error",
    message: { kind: "message", key: "errors.languageSave", params: {} },
  });
  await page.waitForFunction(() =>
    document
      .getElementById("status")
      .textContent.includes("언어 설정을 저장하지 못했습니다"),
  );
  assert.equal(await page.locator("html").getAttribute("lang"), "ko");
  await page.locator("#tab-convert").click();
  await page.screenshot({ path: "tmp/qa/ui-ko-convert.png", fullPage: true });
  await deliver({
    type: "selection",
    valid: true,
    name: "연구 보고서",
    width: 800,
    height: 600,
    fonts: [],
    diagnostics: [],
  });
  await page.locator('[data-quality="medium"]').click();
  await page.screenshot({ path: "tmp/qa/ui-ko-overview.png" });
  await page.locator("#tab-settings").click();
  await page.locator("#language").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/qa/ui-ko-language.png" });
  const paperHelp = page.getByRole("button", { name: "용지 크기 안내" });
  await paperHelp.scrollIntoViewIfNeeded();
  await paperHelp.hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor();
  assert((await tooltip.innerText()).includes("보통(Medium)"));
  const box = await tooltip.boundingBox();
  assert(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 480 &&
      box.y + box.height <= 680,
  );
  assert(
    await tooltip.evaluate(
      (node) =>
        node.scrollWidth <= node.clientWidth &&
        node.scrollHeight <= node.clientHeight,
    ),
  );
  await page.screenshot({ path: "tmp/qa/ui-ko-help.png" });
  assert.deepEqual(errors, []);

  // A new plugin session starts from the environment, then restores the saved choice.
  const reopened = await b.newPage({ locale: "en-US" });
  await reopened.setContent(await readFile("dist/ui.html", "utf8"));
  await reopened.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { pluginMessage: { type: "language-settings", language: "ko" } },
      }),
    ),
  );
  await reopened.waitForFunction(() => document.documentElement.lang === "ko");
  assert.equal(await reopened.locator("#export").innerText(), "PDF 저장");
});
