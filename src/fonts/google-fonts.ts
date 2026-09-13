import { errorMessage } from "../shared/errors";
import { type FontSpec } from "../shared/protocol";
import catalog from "./google-font-catalog.json";
import { canonicalFontFamily, normalizeFontName } from "./font-names";

const families: Record<string, Record<string, string>> = catalog.families;
const normalizedFamilies = new Map(
  Object.keys(families).map((family) => [normalizeFontName(family), family]),
);
export const googleFontCatalogDate = catalog.generatedAt;
export const googleFontFamilyCount = Object.keys(families).length;

export function googleFontURL(font: FontSpec): string {
  const family =
    normalizedFamilies.get(normalizeFontName(font.family)) ??
    normalizedFamilies.get(normalizeFontName(canonicalFontFamily(font.family)));
  const url =
    family && families[family]?.[`${font.weight}${font.italic ? "i" : ""}`];
  if (!url)
    throw new Error(
      "このフォント・太さは自動取得の対象外です。静的 TTF を追加してください。",
    );
  return url;
}

/** Fetch the full static TTF directly from Google's CORS-enabled CDN.
 * Runtime CSS negotiation produces WOFF2; fonts.google.com/download/list
 * disallows cross-origin reads from Figma. The official URLs are refreshed
 * separately with scripts/update-google-fonts.mjs. No document text is sent.
 */
export async function downloadGoogleFont(
  font: FontSpec,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const url = googleFontURL(font);
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      (async () => {
        let response;
        try {
          response = await request(url);
        } catch (error) {
          throw new Error(
            `Google Fonts に接続できません。再取得してください（${errorMessage(error)}）。`,
          );
        }
        if (!response.ok)
          throw new Error(
            `Google Fonts の取得に失敗しました（HTTP ${response.status}）。再取得するか TTF を追加してください。`,
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 32_000_000 || bytes.length < 12)
          throw new Error("取得したフォントのサイズが不正です。");
        return bytes;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Google Fonts の取得がタイムアウトしました。再取得してください。",
              ),
            ),
          20000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
