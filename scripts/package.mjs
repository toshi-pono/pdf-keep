import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

const archive = "output/pdf-keep-plugin.zip";
// Explicit entries prevent local notes, test data, and stale build files from shipping.
const files = [
  "manifest.json",
  "dist/code.js",
  "dist/ui.html",
  "README.md",
  "README_ja.md",
  "LICENSE",
  "docs/development.md",
  "assets/logo.png",
  "assets/teaser-en.png",
  "assets/subteaser-features-en.png",
  "licenses",
];
await mkdir("output", { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, ...files]);
console.log(archive);
