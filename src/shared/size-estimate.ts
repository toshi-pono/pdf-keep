export interface ImageSizeSample {
  pixels: number;
  bytes: number;
}
export interface FontSizeSample {
  characters: string;
  bytes?: number;
  glyphs?: number;
}
/** A range, not a byte-accurate prediction: resampling changes PNG entropy and
 * PDF font subsetting retains different tables across font families. */
export function estimatePDFSize(
  pixels: number,
  fonts: FontSizeSample[],
  sample?: ImageSizeSample | null,
) {
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  let imageLow = pixels * 0.15,
    imageHigh = pixels * 2;
  const sampled = !!(
    sample &&
    Number.isFinite(sample.pixels) &&
    sample.pixels > 0 &&
    Number.isFinite(sample.bytes) &&
    sample.bytes > 0
  );
  if (sampled && sample) {
    const ratio = pixels / sample.pixels;
    const predicted = sample.bytes * Math.pow(ratio, ratio >= 1 ? 0.85 : 1);
    imageLow = predicted * 0.5;
    imageHigh = predicted * 1.5;
  }
  let low = 4000 + imageLow,
    high = 16000 + imageHigh;
  for (const font of fonts) {
    const used = new Set(font.characters.replace(/\s/g, "")).size;
    if (!used) continue;
    const average = font.bytes && font.glyphs ? font.bytes / font.glyphs : 400;
    const ceiling = font.bytes ?? Infinity;
    // Compacted TTF tables + compressed glyph data. Calibrated against the
    // Japanese/Latin PDF fixtures; fallback embedding can exceed this range.
    low += Math.min(ceiling, 600 + used * average * 0.2);
    high += Math.min(ceiling, 3000 + used * average * 1.2);
  }
  return {
    low: Math.round(low),
    high: Math.round(Math.max(low, high)),
    sampled,
  };
}
export function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
export function formatSizeRange(low: number, high: number) {
  if (high < 1_000_000)
    return `${Math.max(1, Math.round(low / 1000))}–${Math.max(1, Math.round(high / 1000))} KB`;
  return `${Math.max(0.1, low / 1_000_000).toFixed(1)}–${Math.max(0.1, high / 1_000_000).toFixed(1)} MB`;
}
