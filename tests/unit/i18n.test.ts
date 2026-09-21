import assert from "node:assert/strict";
import { test } from "node:test";
import { createI18n, formatMessage, resources } from "../../src/ui/i18n";
import {
  environmentLanguage,
  supportedLanguages,
} from "../../src/i18n/languages";
import {
  msg,
  joinMessages,
  sameMessage,
  uniqueMessages,
  type Message,
} from "../../src/shared/messages";
import { AppError, errorMessage } from "../../src/shared/errors";

test("environment languages normalize regions and case, otherwise default to English", () => {
  for (const [locale, expected] of [
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["JA-jp", "ja"],
    ["ko", "ko"],
    ["KO-KR", "ko"],
    ["en-US", "en"],
    ["fr-FR", "en"],
    ["", "en"],
    ["japanese", "en"],
  ]) {
    assert.equal(environmentLanguage(locale), expected);
  }
});
test("all locales have complete keys, placeholders, and plural forms", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();
  for (const language of supportedLanguages) {
    const translations = resources[language].translation;
    assert.deepEqual(
      Object.keys(translations).sort(),
      Object.keys(resources.en.translation).sort(),
    );
    for (const key of Object.keys(
      resources.en.translation,
    ) as (keyof typeof resources.en.translation)[]) {
      assert(translations[key].trim(), `${language}: ${key}`);
      assert.deepEqual(
        placeholders(translations[key]),
        placeholders(resources.en.translation[key]),
        `${language}: ${key}`,
      );
    }
  }
});
test("nested messages remain localizable across workers, errors, and language switches", async () => {
  const instance = createI18n("en");
  const message = msg("progress.truncatedText", {
    stage: msg("progress.preparingFont", { family: "Noto Sans" }),
    name: "日本語의 레이어",
  });
  const cloned = structuredClone(errorMessage(new AppError(message)));
  assert.equal(
    formatMessage(cloned, instance),
    "Truncated text: Preparing font: Noto Sans — 日本語의 레이어",
  );
  await instance.changeLanguage("ko");
  assert.equal(
    formatMessage(cloned, instance),
    "생략된 텍스트: 폰트를 준비하는 중: Noto Sans — 日本語의 레이어",
  );
  await instance.changeLanguage("ja");
  assert.equal(
    formatMessage(cloned, instance),
    "省略文字: フォントを準備中: Noto Sans — 日本語의 레이어",
  );
  assert.deepEqual(errorMessage(structuredClone(message)), message);
});
test("opaque names and errors are neither translated nor re-interpolated", () => {
  const instance = createI18n("ko");
  const external = 'PDF を保存 {{name}} $t(actions.savePdf) <script> & "';
  assert.equal(formatMessage(external, instance), external);
  assert.equal(
    formatMessage(msg("progress.readingText", { name: external }), instance),
    `텍스트를 가져오는 중: ${external}`,
  );
  assert.equal(
    formatMessage(errorMessage({ message: external }), instance),
    external,
  );
  assert.equal(
    formatMessage(
      joinMessages([msg("notice.error"), external], ": "),
      instance,
    ),
    `오류: ${external}`,
  );
});
test("pluralization and English fallback use i18next", async () => {
  const instance = createI18n("en");
  assert.equal(
    formatMessage(msg("notice.reviewCount", { count: 1 }), instance),
    "1 item to review",
  );
  assert.equal(
    formatMessage(msg("notice.reviewCount", { count: 2 }), instance),
    "2 items to review",
  );
  await instance.changeLanguage("ko");
  assert.equal(
    formatMessage(msg("notice.reviewCount", { count: 0 }), instance),
    "확인할 항목 0개",
  );
  // Clone resources before altering this instance's store.
  instance.addResourceBundle(
    "ko",
    "translation",
    { ...resources.ko.translation },
    false,
    true,
  );
  const ko = instance.getResourceBundle("ko", "translation");
  delete ko["actions.savePdf"];
  assert.equal(formatMessage(msg("actions.savePdf"), instance), "Save PDF");
});
test("message identity compares nested content independent of object identity or key order", () => {
  const a = msg("progress.truncatedText", {
    stage: msg("progress.originalAppearance"),
    name: "layer",
  });
  const b = msg("progress.truncatedText", {
    name: "layer",
    stage: msg("progress.originalAppearance"),
  });
  assert(sameMessage(a, b));
  assert.equal(uniqueMessages([a, b, "external"]).length, 2);
  assert(
    !sameMessage(
      a,
      msg("progress.truncatedText", { stage: "other", name: "layer" }),
    ),
  );
});
// These must fail at compile time, without running invalid calls.
function checkMessageTypes() {
  // @ts-expect-error unknown key
  msg("unknown.key");
  // @ts-expect-error missing parameter
  msg("progress.readingText");
  // @ts-expect-error unknown parameter
  msg("progress.readingText", { label: "x" });
  // @ts-expect-error counts must be numbers
  msg("notice.reviewCount", { count: "1" });
}
void checkMessageTypes;
const message: Message = msg("actions.savePdf");
void message;
