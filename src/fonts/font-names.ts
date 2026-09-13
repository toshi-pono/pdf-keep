import type { Font } from "opentype.js";

export const normalizeFontName = (value: string) =>
  value.toLowerCase().replace(/[\s_-]/g, "");

const weightNames: Record<number, string[]> = {
  100: ["Thin", "Hairline"],
  200: ["ExtraLight", "UltraLight"],
  300: ["Light"],
  350: ["DemiLight"],
  400: ["Regular", "Normal", "Roman", "Book"],
  500: ["Medium"],
  600: ["SemiBold", "DemiBold"],
  700: ["Bold"],
  800: ["ExtraBold", "UltraBold"],
  900: ["Black", "Heavy"],
};
const weights = new Map(
  Object.entries(weightNames).flatMap(([weight, names]) =>
    names.map((name) => [normalizeFontName(name), Number(weight)] as const),
  ),
);
const weightSuffix =
  /[\s_-]+(Thin|Hairline|Extra[\s_-]?Light|Ultra[\s_-]?Light|Demi[\s_-]?Light|Light|Regular|Normal|Roman|Book|Medium|Semi[\s_-]?Bold|Demi[\s_-]?Bold|Bold|Extra[\s_-]?Bold|Ultra[\s_-]?Bold|Black|Heavy)$/i;
const opticalSuffix = /[\s_-]+\d+(?:\.\d+)?pt$/i;
// Google Fonts' public name differs from the original upstream family name.
const familyAliases: Record<string, string> = {
  roundedmplus1c: "M PLUS Rounded 1c",
};
export function canonicalFontFamily(family: string) {
  let base = family;
  while (true) {
    const next = base.replace(weightSuffix, "").replace(opticalSuffix, "");
    if (!next || next === base) break;
    base = next;
  }
  return familyAliases[normalizeFontName(base)] ?? base;
}
function styleWeight(style: string) {
  return weights.get(
    normalizeFontName(style).replace(/(?:italic|oblique)$/, "") || "regular",
  );
}

/** Preserve explicit name pairs and add semantic aliases for static instances.
 * Google's legacy TTFs can retain a variable font's default weight/optical size
 * in IDs 1/16 even after instancing. OS/2 supplies the actual weight; the final
 * subfamily distinguishes Thin/ExtraLight in old fonts clamped to 250/275.
 * Only standard style/optical-size suffixes are removed, never arbitrary family
 * prefixes or width descriptors such as Condensed, Display, or Mono.
 */
export function fontIdentities(
  font: Font,
): { family: string; style: string }[] {
  const names = font.names as unknown as Record<string, Record<string, string>>;
  const result: { family: string; style: string }[] = [];
  const seen = new Set<string>();
  const add = (family: string, style: string) => {
    const key = JSON.stringify([
      normalizeFontName(family),
      normalizeFontName(style),
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ family, style });
    }
  };
  for (const [familyID, styleID] of [
    ["preferredFamily", "preferredSubfamily"],
    ["wwsFamily", "wwsSubfamily"],
    ["fontFamily", "fontSubfamily"],
  ]) {
    const languages = new Set([
      ...Object.keys(names[familyID] ?? {}),
      ...Object.keys(names[styleID] ?? {}),
    ]);
    for (const language of languages) {
      const family =
        names[familyID]?.[language] ?? names.fontFamily?.[language];
      const style =
        names[styleID]?.[language] ?? names.fontSubfamily?.[language];
      if (family && style) add(family, style);
    }
  }
  const explicit = [...result];
  const rawWeight = font.tables.os2?.usWeightClass;
  const italic =
    !!((font.tables.os2?.fsSelection ?? 0) & 0x201) ||
    !!font.tables.post?.italicAngle;
  const slope = explicit.some((n) => /oblique/i.test(n.style))
    ? "Oblique"
    : "Italic";
  for (const { family, style } of explicit) {
    // Do not invent a semantic face when the declared slope contradicts it.
    if (/italic|oblique/i.test(style) !== italic) continue;
    let weight = rawWeight;
    if (rawWeight === 250 || rawWeight === 275) {
      const declared = styleWeight(style);
      const suffix = family.match(weightSuffix)?.[1];
      const legacy = suffix ? styleWeight(suffix) : undefined;
      const light = declared && declared < 300 ? declared : legacy;
      if (light === 200 || (light === 100 && rawWeight === 250)) weight = light;
    }
    const aliases = weightNames[weight] ?? [];
    for (const base of new Set([family, canonicalFontFamily(family)])) {
      for (const name of aliases) add(base, name + (italic ? ` ${slope}` : ""));
      if (weight === 400 && italic) add(base, slope);
    }
  }
  return result;
}
