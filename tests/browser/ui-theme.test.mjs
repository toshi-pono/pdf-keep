import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { launchBrowser } from "../helpers/browser.mjs";
import { deliverTo } from "../helpers/ui.mjs";

// Representative host palettes, not a snapshot of Figma's current colors.
// Distinct role values catch accidental use of a token for another surface.
const colors = {
  bg: ["#ffffff", "#2c2c2c"],
  text: ["#202532", "#f5f5f5"],
  border: ["#e1e4ea", "#555555"],
  "text-secondary": ["#727987", "#b6b6b6"],
  "bg-brand": ["#0d99ff", "#0c8ce9"],
  "bg-brand-hover": ["#007be5", "#0a6dc2"],
  "text-brand": ["#007be5", "#80caff"],
  "text-onbrand": ["#ffffff", "#ffffff"],
  "bg-brand-tertiary": ["#e5f4ff", "#163951"],
  "bg-hover": ["#f5f5f5", "#383838"],
  "bg-inverse": ["#2c2c2c", "#f0f0f0"],
  "text-oninverse": ["#f5f5f5", "#202020"],
  "bg-warning": ["#ffcd29", "#d4a900"],
  "text-onwarning": ["#302500", "#211a00"],
  "text-warning": ["#946100", "#ffcd29"],
};

async function setTheme(page, theme) {
  await page.evaluate(
    ({ theme, colors }) => {
      document.documentElement.classList.remove("figma-light", "figma-dark");
      document.documentElement.classList.add(`figma-${theme}`);
      let style = document.getElementById("figma-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "figma-style";
        document.head.append(style);
      }
      style.textContent = `:root { ${Object.entries(colors)
        .map(
          ([name, values]) =>
            `--figma-color-${name}: ${values[theme === "dark" ? 1 : 0]};`,
        )
        .join(" ")} }`;
    },
    { theme, colors },
  );
}

async function assertStyle(page, selector, property, expected) {
  assert.equal(
    await page
      .locator(selector)
      .evaluate((node, property) => getComputedStyle(node)[property], property),
    expected,
    `${selector}: ${property}`,
  );
}

async function setup(page) {
  await page.setContent(await readFile("dist/ui.html", "utf8"));
  await deliverTo(page, {
    type: "selection",
    valid: true,
    name: "Theme preview",
    width: 800,
    height: 600,
    fonts: [],
    diagnostics: [
      {
        name: "Text",
        nodeId: "1",
        severity: "warning",
        reason: "Check the exported appearance.",
      },
    ],
  });
}

for (const osTheme of ["light", "dark"]) {
  test(`Figma themes update live and override the ${osTheme} OS theme`, async (t) => {
    const browser = await launchBrowser();
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 480, height: 680 },
      locale: "ja-JP",
      colorScheme: osTheme,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await setup(page);
    await page.locator("#tab-settings").click();
    await page.locator("#paper-size").selectOption("A3");
    await page.locator("#pixel-mode").check();
    await page.locator("#long-edge").fill("1234");

    for (const theme of ["light", "dark", "light"]) {
      await setTheme(page, theme);
      const rgb = (name) => {
        const hex = colors[name][theme === "dark" ? 1 : 0];
        return `rgb(${hex
          .slice(1)
          .match(/../g)
          .map((value) => parseInt(value, 16))
          .join(", ")})`;
      };
      assert.equal(await page.locator("#paper-size").inputValue(), "A3");
      assert.equal(await page.locator("#long-edge").inputValue(), "1234");
      assert(await page.locator("#pixel-mode").isChecked());
      assert.equal(
        await page.locator("#tab-settings").getAttribute("aria-selected"),
        "true",
      );
      await page.mouse.move(0, 0);
      for (const [selector, property, token] of [
        ["html", "backgroundColor", "bg"],
        ["html", "color", "text"],
        ["#paper-size", "backgroundColor", "bg"],
        ["#paper-size", "color", "text"],
        ["#paper-size", "borderTopColor", "border"],
        ["#pixel-mode", "accentColor", "bg-brand"],
        ["#tab-settings", "color", "text-brand"],
        ["#export", "backgroundColor", "bg-brand"],
        ["#export", "color", "text-onbrand"],
        [".notification-icon", "color", "text-warning"],
        [".notification-details summary", "backgroundColor", "bg-warning"],
        [".notification-details summary", "color", "text-onwarning"],
      ]) {
        await assertStyle(page, selector, property, rgb(token));
      }
      for (const selector of [
        "html",
        ".content",
        "#paper-size",
        "#pixel-mode",
      ]) {
        await assertStyle(page, selector, "colorScheme", theme);
      }
      await page.locator("#export").hover();
      await assertStyle(
        page,
        "#export",
        "backgroundColor",
        rgb("bg-brand-hover"),
      );
      await page.keyboard.press("Tab");
      await page.locator("#paper-size").focus();
      assert(
        await page
          .locator("#paper-size")
          .evaluate((node) => node.matches(":focus-visible")),
      );
      await assertStyle(page, "#paper-size", "outlineColor", rgb("bg-brand"));

      const help = page.getByRole("button", { name: "フォントの追加について" });
      await help.scrollIntoViewIfNeeded();
      // Help closes on scroll; finish the previous control's scrolling before opening it.
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      await help.focus();
      await page.getByRole("tooltip").waitFor();
      await assertStyle(
        page,
        ".help-tooltip",
        "backgroundColor",
        rgb("bg-inverse"),
      );
      await assertStyle(page, ".help-tooltip", "color", rgb("text-oninverse"));
      if (osTheme === "dark") {
        await mkdir("tmp/qa", { recursive: true });
        await page.screenshot({ path: `tmp/qa/theme-${theme}-settings.png` });
      }
      await page.keyboard.press("Escape");
      await page.locator("#tab-convert").click();
      await page.mouse.move(0, 0);
      await assertStyle(
        page,
        '[aria-pressed="true"]',
        "backgroundColor",
        rgb("bg-brand-tertiary"),
      );
      await assertStyle(page, "#dimensions", "color", rgb("text-secondary"));
      if (osTheme === "dark") {
        await page.screenshot({ path: `tmp/qa/theme-${theme}-convert.png` });
      }
      await page.locator('[data-quality="light"]').hover();
      await assertStyle(
        page,
        '[data-quality="light"]',
        "backgroundColor",
        rgb("bg-hover"),
      );
      await page.locator("#tab-settings").click();
    }
    assert.deepEqual(errors, []);
  });
}

test("without Figma injection the UI retains its light fallback even on a dark OS", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ colorScheme: "dark", locale: "ja-JP" });
  await setup(page);
  await assertStyle(page, "html", "colorScheme", "light");
  await assertStyle(page, "html", "backgroundColor", "rgb(255, 255, 255)");
  await assertStyle(page, "html", "color", "rgb(32, 37, 50)");
  await assertStyle(
    page,
    ".notification-details summary",
    "color",
    "rgb(134, 84, 0)",
  );
  await assertStyle(
    page,
    ".notification-details summary",
    "backgroundColor",
    "rgb(255, 247, 232)",
  );
  await page.locator("#tab-settings").click();
  await page.getByRole("button", { name: "フォントの追加について" }).focus();
  await page.getByRole("tooltip").waitFor();
  await assertStyle(
    page,
    ".help-tooltip",
    "backgroundColor",
    "rgb(37, 42, 52)",
  );
  await assertStyle(page, ".help-tooltip", "color", "rgb(255, 255, 255)");
});
