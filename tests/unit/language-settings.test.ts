import assert from "node:assert/strict";
import test from "node:test";
import {
  languageSettings,
  languageStorageKey,
} from "../../src/plugin/language-settings";
import { msg } from "../../src/shared/messages";
import type { PluginMessage } from "../../src/shared/protocol";

test("loads only supported saved preferences and isolates the storage key", async () => {
  for (const value of [
    "ko",
    "ja",
    "en",
    "ko-KR",
    "fr",
    null,
    { language: "ja" },
  ]) {
    const messages: PluginMessage[] = [];
    const handle = languageSettings(
      {
        getAsync: async (key) => {
          assert.equal(key, languageStorageKey);
          return value;
        },
        setAsync: async () => {},
      },
      (message) => messages.push(message),
    );
    await handle({ type: "language-load" });
    assert.deepEqual(messages, [
      {
        type: "language-settings",
        ...(["ko", "ja", "en"].includes(value as string)
          ? { language: value }
          : {}),
      },
    ]);
  }
});
test("read failure falls back quietly; write failure is localized and does not block later saves", async () => {
  const messages: PluginMessage[] = [];
  const saved: string[] = [];
  const handle = languageSettings(
    {
      getAsync: async () => {
        throw Error("unavailable");
      },
      setAsync: async (_key, value) => {
        if (value === "ja") throw Error("quota");
        saved.push(value);
      },
    },
    (message) => messages.push(message),
  );
  await handle({ type: "language-load" });
  await handle({ type: "language-save", language: "ja" });
  await handle({ type: "language-save", language: "ko" });
  assert.deepEqual(messages, [
    { type: "language-settings" },
    { type: "storage-error", message: msg("errors.languageSave") },
  ]);
  assert.deepEqual(saved, ["ko"]);
});
test("rapid changes serialize writes and a subsequent load observes the last choice", async () => {
  let value = "en";
  const writes: string[] = [];
  const messages: PluginMessage[] = [];
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handle = languageSettings(
    {
      getAsync: async () => value,
      setAsync: async (key, next) => {
        assert.equal(key, languageStorageKey);
        writes.push(next);
        if (next === "ja") await first;
        value = next;
      },
    },
    (message) => messages.push(message),
  );
  const a = handle({ type: "language-save", language: "ja" });
  const b = handle({ type: "language-save", language: "ko" });
  const load = handle({ type: "language-load" });
  await Promise.resolve();
  assert.deepEqual(writes, ["ja"]);
  release();
  await Promise.all([a, b, load]);
  assert.deepEqual(writes, ["ja", "ko"]);
  assert.deepEqual(messages, [{ type: "language-settings", language: "ko" }]);
});
