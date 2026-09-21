import { I18nextProvider } from "react-i18next";
import { i18nInstance } from "./i18n";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App } from "./app";

const root = createRoot(document.getElementById("root")!);
// Register the Figma message listener before the initial script task ends.
flushSync(() =>
  root.render(
    <I18nextProvider i18n={i18nInstance}>
      <App />
    </I18nextProvider>,
  ),
);
window.addEventListener("pagehide", () => root.unmount(), { once: true });
