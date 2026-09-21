import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { launchBrowser } from "../helpers/browser.mjs";

test("worker application errors retain their message keys through the real Blob worker boundary", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const bundle = await build({
    stdin: {
      contents:
        'export { createFontSubsetter } from "./src/fonts/font-subset"; export { createTextShaper } from "./src/pdf/text-shape"; export { errorMessage } from "./src/shared/errors";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "P",
    loader: { ".wasm": "binary" },
  });
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const P = window.P;
    // Force known WASM failures inside actual workers, without changing their
    // self-contained code or the parent-side serialization/error handling.
    const originalURL = URL.createObjectURL.bind(URL);
    const blobs = new Map();
    URL.createObjectURL = (blob) => {
      const url = originalURL(blob);
      blobs.set(url, blob);
      return url;
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url) {
        const bootstrap = `WebAssembly.instantiate = async (_bytes, imports) => {
          if (imports) imports.env._abort_js();
          return { instance: { exports: { malloc: () => 0 } } };
        };\n`;
        const testURL = originalURL(
          new Blob([bootstrap, blobs.get(url)], { type: "text/javascript" }),
        );
        super(testURL);
        URL.revokeObjectURL(testURL);
      }
    };
    const subsetter = P.createFontSubsetter();
    const shaper = P.createTextShaper();
    const messages = [];
    for (const run of [
      () => subsetter.subset(new Uint8Array([0]), "가"),
      () => shaper.shape("test", new Uint8Array([0]), "가", {}),
    ]) {
      try {
        await run();
      } catch (error) {
        messages.push(P.errorMessage(error));
      }
    }
    subsetter.dispose();
    shaper.dispose();
    return messages;
  });
  assert.deepEqual(result, [
    { kind: "message", key: "errors.fontMemory", params: {} },
    { kind: "message", key: "errors.shapingModule", params: {} },
  ]);
});
