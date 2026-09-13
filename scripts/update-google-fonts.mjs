// Refresh official full static TTF URLs outside the browser's CORS boundary.
// Only URLs/metadata are stored; font binaries are downloaded on demand.
import { mkdir, writeFile } from "node:fs/promises";
import {
  googleFontsCSSURL,
  staticFontFaces,
} from "./lib/google-font-catalog.mjs";
const get = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/4.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};
const metadata = JSON.parse(
  (await get("https://fonts.google.com/metadata/fonts")).replace(
    /^\)\]\}'\s*/,
    "",
  ),
);
const families = metadata.familyMetadataList.filter(
  (f) => f.isOpenSource !== false,
);
const catalog = {};
const failed = [];
const unavailableStyles = [];
async function fetchFamily(family) {
  try {
    const css = await get(googleFontsCSSURL(family));
    const faces = staticFontFaces(css)[family.family];
    if (!faces) throw new Error("No static TTF styles in the CSS response");
    const missing = Object.keys(family.fonts).filter((style) => !faces[style]);
    if (missing.length)
      unavailableStyles.push({ family: family.family, styles: missing });
    catalog[family.family] = faces;
  } catch (e) {
    failed.push({ family: family.family, error: String(e) });
  }
}
const queue = [...families];
let complete = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      await fetchFamily(queue.shift());
      complete++;
      if (complete % 200 === 0)
        console.log(
          `${complete} requests, ${Object.keys(catalog).length} families`,
        );
    }
  }),
);
const sorted = Object.fromEntries(
  Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)),
);
await mkdir("tmp", { recursive: true });
await writeFile(
  "src/fonts/google-font-catalog.json",
  JSON.stringify(
    { generatedAt: new Date().toISOString().slice(0, 10), families: sorted },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "tmp/google-font-catalog-report.json",
  JSON.stringify(
    {
      families: Object.keys(sorted).length,
      failed,
      unavailableStyles,
      unavailable: families
        .filter((f) => !catalog[f.family])
        .map((f) => f.family),
    },
    null,
    2,
  ),
);
console.log(
  `Saved ${Object.keys(sorted).length} families; ${failed.length} unavailable requests.`,
);
