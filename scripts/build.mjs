import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  loader: { ".wasm": "binary" },
  outfile: "dist/code.js",
  target: "es2020",
});
const ui = await build({
  entryPoints: ["src/ui/index.tsx"],
  bundle: true,
  loader: { ".wasm": "binary" },
  write: false,
  target: "es2020",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
});
const css = await readFile("src/ui/styles.css", "utf8");
await writeFile(
  "dist/ui.html",
  (await readFile("src/ui/index.html", "utf8"))
    .replace("/* STYLE */", () => css)
    .replace(
      "<!-- SCRIPT -->",
      () =>
        `<script>${ui.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`,
    ),
);
