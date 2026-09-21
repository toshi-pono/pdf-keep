import { isLanguage } from "../i18n/languages";
import { msg } from "../shared/messages";
import type { PluginMessage, UIMessage } from "../shared/protocol";

export const languageStorageKey = "pdf-keep-language-v1";
/** Serialize writes so a slow save cannot overwrite a newer language choice. */
export function languageSettings(
  storage: Pick<ClientStorageAPI, "getAsync" | "setAsync">,
  send: (message: PluginMessage) => void,
) {
  let writes = Promise.resolve();
  return async (message: UIMessage): Promise<void> => {
    if (message.type === "language-load") {
      let value: unknown;
      try {
        await writes;
        value = await storage.getAsync(languageStorageKey);
      } catch {
        /* The UI keeps its environment language. */
      }
      send({
        type: "language-settings",
        ...(isLanguage(value) ? { language: value } : {}),
      });
    }
    if (message.type === "language-save" && isLanguage(message.language)) {
      writes = writes
        .then(() => storage.setAsync(languageStorageKey, message.language))
        .catch(() => {
          send({ type: "storage-error", message: msg("errors.languageSave") });
        });
      await writes;
    }
  };
}
