export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
export const contains = (a: Box, b: Box) =>
  b.x >= a.x - 0.01 &&
  b.y >= a.y - 0.01 &&
  b.x + b.width <= a.x + a.width + 0.01 &&
  b.y + b.height <= a.y + a.height + 0.01;

/** Nearest free edge-aligned candidate, with guaranteed space beyond all obstacles. */
export function nearbyPosition(
  source: Box,
  width: number,
  height: number,
  obstacles: Box[],
  gap = 64,
) {
  const boxes = [source, ...obstacles];
  const xs = new Set([source.x]);
  const ys = new Set([source.y]);
  for (const b of boxes) {
    xs.add(b.x + b.width + gap);
    xs.add(b.x - width - gap);
    ys.add(b.y + b.height + gap);
    ys.add(b.y - height - gap);
  }
  let best = {
    x: Math.max(...boxes.map((b) => b.x + b.width)) + gap,
    y: source.y,
  };
  let distance = Infinity;
  for (const x of xs)
    for (const y of ys) {
      const score = (x - source.x) ** 2 + (y - source.y) ** 2;
      if (score >= distance) continue;
      const padded = {
        x: x - gap,
        y: y - gap,
        width: width + 2 * gap,
        height: height + 2 * gap,
      };
      if (boxes.some((b) => intersects(padded, b))) continue;
      best = { x, y };
      distance = score;
    }
  return best;
}
