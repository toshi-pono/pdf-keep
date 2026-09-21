import { AppError, errorMessage } from "../shared/errors";
import { msg } from "../shared/messages";
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
  if (!url) throw new AppError(msg("errors.googleFontUnsupported"));
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
          throw new AppError(
            msg("errors.googleFontConnection", { reason: errorMessage(error) }),
          );
        }
        if (!response.ok)
          throw new AppError(
            msg("errors.googleFontHttp", { status: response.status }),
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 32_000_000 || bytes.length < 12)
          throw new AppError(msg("errors.downloadedFontSize"));
        return bytes;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AppError(msg("errors.googleFontTimeout"))),
          20000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
