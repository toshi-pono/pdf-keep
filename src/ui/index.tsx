import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App } from "./app";

const root = createRoot(document.getElementById("root")!);
// Register the Figma message listener before the initial script task ends.
flushSync(() => root.render(<App />));
window.addEventListener("pagehide", () => root.unmount(), { once: true });
