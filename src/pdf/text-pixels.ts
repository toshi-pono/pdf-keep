import "../shared/figma-encoding";
import { decode } from "fast-png";
export const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
/** A separately drawn Figma ellipsis can lack the normal preceding kerning.
 * Estimate that horizontal offset only when the differing region has the same
 * ink mass. The caller must verify all pixels again after applying the offset. */
export function ellipsisOffset(
  reference: Uint8Array,
  candidate: Uint8Array,
): number | null {
  return textPixelComparator(reference)(candidate);
}
/** Decode the reference once for the entire candidate search. */
export function textPixelComparator(reference: Uint8Array) {
  const a = decode(reference);
  return (candidate: Uint8Array): number | null => {
    const b = decode(candidate);
    if (
      a.width !== b.width ||
      a.height !== b.height ||
      a.channels !== 4 ||
      b.channels !== 4 ||
      a.depth !== 8 ||
      b.depth !== 8
    )
      return null;
    let left = a.width,
      right = -1,
      top = a.height,
      bottom = -1;
    for (let y = 0; y < a.height; y++)
      for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * 4;
        if (
          a.data[i] !== b.data[i] ||
          a.data[i + 1] !== b.data[i + 1] ||
          a.data[i + 2] !== b.data[i + 2] ||
          a.data[i + 3] !== b.data[i + 3]
        ) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    if (right < 0) return 0;
    let massA = 0,
      massB = 0,
      momentA = 0,
      momentB = 0;
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const i = (y * a.width + x) * 4 + 3;
        massA += a.data[i];
        massB += b.data[i];
        momentA += x * a.data[i];
        momentB += x * b.data[i];
      }
    if (
      !massA ||
      !massB ||
      Math.abs(massA - massB) > Math.max(massA, massB) * 0.02
    )
      return null;
    const offset = Math.round((momentA / massA - momentB / massB) * 64) / 64;
    return offset === 0 ? null : offset;
  };
}
