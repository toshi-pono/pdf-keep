import { AppError } from "./errors";
import { msg } from "./messages";
export const MAX_PIXELS = 32_000_000;
export const PAPER_SIZES = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;
export type Orientation = "portrait" | "landscape";
export const QUALITY_FACTORS = { sharp: 1.3, medium: 1, light: 0.7 } as const;
export type QualityPreset = keyof typeof QUALITY_FACTORS;

/** Paper width is a raster quality reference, not a PDF page resize.
 * Medium caps enlargement at 3×; other presets scale that baseline.
 * Integer long-edge requests also work below Figma's SCALE precision limits. */
export function printResolution(
  width: number,
  height: number,
  quality: QualityPreset,
  paper: PaperSize,
  orientation: Orientation,
  destination: "pdf" | "frame" = "pdf",
) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new AppError(msg("errors.frameDimensions"));
  const paperWidth = PAPER_SIZES[paper][orientation === "portrait" ? 0 : 1];
  const factor = QUALITY_FACTORS[quality];
  const targetWidth = Math.ceil(Math.ceil((paperWidth / 25.4) * 300) * factor);
  const desired = Math.min(3 * factor, targetWidth / width);
  const edge = Math.max(width, height);
  const limited = Math.min(
    desired,
    (destination === "frame" ? 4096 : 16384) / edge,
    Math.sqrt(MAX_PIXELS / (width * height)),
  );
  let longEdge = Math.max(1, Math.floor(edge * limited + 1e-8));
  // Ceil rounding of the shorter edge must also fit the memory budget.
  while (longEdge > 1) {
    const pixels = rasterDimensions(width, height, longEdge / edge);
    if (pixels.width * pixels.height <= MAX_PIXELS) break;
    longEdge--;
  }
  const scale = longEdge / edge;
  validateSize(width, height, scale, destination);
  return {
    scale,
    longEdge,
    targetDpi: 300 * factor,
    limited: width * scale + 1 < targetWidth,
  };
}
export function validateSize(
  width: number,
  height: number,
  scale: number,
  destination: "pdf" | "frame" = "pdf",
) {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new AppError(msg("errors.positiveResolution"));
  if (
    ![width, height].every((n) => Number.isFinite(n) && n > 0) ||
    rasterDimensions(width, height, scale).width > 16384 ||
    rasterDimensions(width, height, scale).height > 16384 ||
    rasterDimensions(width, height, scale).width *
      rasterDimensions(width, height, scale).height >
      MAX_PIXELS
  )
    throw new AppError(msg("errors.frameTooLarge"));
  if (
    destination === "frame" &&
    Math.max(...Object.values(rasterDimensions(width, height, scale))) > 4096
  )
    throw new AppError(msg("errors.frameBackgroundLimit"));
}
/** Ignore floating point residue at exact pixel boundaries. */
export function rasterDimensions(width: number, height: number, scale: number) {
  const pixels = (n: number) => Math.max(1, Math.ceil(n - 1e-8));
  return { width: pixels(width * scale), height: pixels(height * scale) };
}
/** Both destinations use at most 3× and a 4096px background long edge. */
export function recommendedScale(
  width: number,
  height: number,
  destination: "pdf" | "frame",
): number | null {
  const scale = Math.min(3, 4096 / Math.max(width, height));
  try {
    validateSize(width, height, scale, destination);
    return scale;
  } catch {
    return null;
  }
}
export function resolveScale(
  width: number,
  height: number,
  scale: number,
  destination: "pdf" | "frame",
  longEdge?: number,
) {
  if (longEdge !== undefined) {
    if (!Number.isInteger(longEdge) || longEdge < 1 || longEdge > 16384)
      throw new AppError(msg("errors.longEdge"));
    scale = longEdge / Math.max(width, height);
  } else if (scale === 0) {
    const recommended = recommendedScale(width, height, destination);
    if (recommended === null) throw new AppError(msg("errors.frameDimensions"));
    scale = recommended;
  }
  validateSize(width, height, scale, destination);
  return scale;
}
