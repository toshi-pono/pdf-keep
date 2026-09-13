export function googleFontsCSSURL(f) {
  // Keep families separate: e.g. requesting M PLUS 1p together with M PLUS
  // Code Latin can return a TTF without Japanese despite subset=japanese.
  const family = `${f.family}:${Object.keys(f.fonts)
    .map((style) => style.replace(/i$/, "italic"))
    .join(",")}`;
  // Request every script advertised by these families, not only Latin or a
  // fixed shortlist. Do not request "menu", which is a tiny preview subset.
  const subset = [...new Set(f.subsets ?? [])]
    .filter((name) => name !== "menu")
    .sort()
    .join(",");
  const url = new URL("https://fonts.googleapis.com/css");
  url.search = new URLSearchParams({ family, subset }).toString();
  return url.href;
}

export function staticFontFaces(css) {
  const catalog = {};
  for (const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const family = block[1].match(/font-family:\s*['"]([^'"]+)['"]/)?.[1];
    const weight = block[1].match(/font-weight:\s*(\d+)/)?.[1];
    const italic = /font-style:\s*italic/.test(block[1]);
    const url = block[1].match(
      /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"]truetype['"]\)/,
    )?.[1];
    if (!family || !weight || !url) continue;
    const key = weight + (italic ? "i" : "");
    const variants = (catalog[family] ??= {});
    if (
      (variants[key] && variants[key] !== url) ||
      /unicode-range\s*:/.test(block[1])
    )
      throw new Error(
        `Expected one complete static TTF for ${family} ${key}; received split subsets`,
      );
    variants[key] = url;
  }
  return catalog;
}
