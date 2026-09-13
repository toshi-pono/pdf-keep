import assert from "node:assert/strict";
import { test } from "node:test";
import { environmentLanguage, setLanguage, t } from "../../src/ui/i18n";

test("environment language selects Japanese or falls back to English", () => {
  for (const locale of ["ja", "ja-JP", "JA-jp"])
    assert.equal(environmentLanguage(locale), "ja");
  for (const locale of ["en-US", "fr-FR", "", "japanese"])
    assert.equal(environmentLanguage(locale), "en");
});

test("messages translate without changing user names and can switch back", () => {
  setLanguage("en");
  assert.equal(t("PDF を作成"), "Create PDF");
  assert.equal(
    t("背景画像 1920 × 1080 px（1 倍）"),
    "Background image 1920 × 1080 px (1×)",
  );
  assert.equal(
    t("文字を取得中: 日本語の見出し"),
    "Reading text: 日本語の見出し",
  );
  assert.equal(
    t("Error: フォントファイルが壊れています。"),
    "Error: The font file is corrupted.",
  );
  assert.equal(t("Unknown external error"), "Unknown external error");
  assert.equal(
    t("省略文字: フォントを準備中: Noto Sans — 日本語のレイヤー"),
    "Truncated text: Preparing font: Noto Sans — 日本語のレイヤー",
  );
  setLanguage("ja");
  assert.equal(t("PDF を作成"), "PDF を作成");
});

test("React can translate with its own language state, including nested messages", () => {
  setLanguage("ja");
  assert.equal(t("PDF を作成", "en"), "Create PDF");
  assert.equal(
    t("Error: フォントファイルが壊れています。", "en"),
    "Error: The font file is corrupted.",
  );
  assert.equal(
    t("省略文字: フォントを準備中: Noto Sans — 日本語", "en"),
    "Truncated text: Preparing font: Noto Sans — 日本語",
  );
  assert.equal(t("PDF を作成", "ja"), "PDF を作成");
});
