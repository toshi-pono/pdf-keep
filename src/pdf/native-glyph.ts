import { measure } from "../shared/performance";
import type { RegisteredFont } from "./create-pdf";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Mask {
  data: Uint8Array;
  width: number;
  height: number;
  box: Rect;
  scale: number;
}
export interface GlyphMatch {
  gid: number;
  size: number;
  x: number;
  y: number;
  score: number;
  character: string;
}
/** The caller supplies an allow-listed SVG. Invisible source ranges stay absent. */
async function renderMask(
  svg: SVGSVGElement,
  box: Rect,
  scale = 8,
): Promise<Mask> {
  if (
    box.width <= 0 ||
    box.height <= 0 ||
    box.width * box.height * scale * scale > 4_000_000
  )
    throw Error("文字の比較領域が大きすぎます。");
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  const width = Math.ceil(box.width * scale),
    height = Math.ceil(box.height * scale);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("preserveAspectRatio", "none");
  for (const element of clone.querySelectorAll<SVGElement>(
    "path,circle,ellipse,rect,polygon,polyline",
  )) {
    if (Number(element.getAttribute("fill-opacity") ?? 1) === 0) {
      element.remove();
      continue;
    }
    element.setAttribute("fill", "black");
    element.setAttribute("fill-opacity", "1");
    element.style.fill = "black";
    element.style.fillOpacity = "1";
  }
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
    canvas.width = canvas.height = 1;
    return { data, width, height, box, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function inkComponents(mask: Mask): Mask[] {
  const { data, width, height, scale } = mask;
  const visited = new Uint8Array(data.length);
  const boxes: Rect[] = [];
  for (let at = 0; at < data.length; at++) {
    if (visited[at] || data[at] < 32) continue;
    const stack = [at];
    visited[at] = 1;
    let minX = at % width,
      maxX = minX,
      minY = Math.floor(at / width),
      maxY = minY,
      count = 0;
    while (stack.length) {
      const p = stack.pop()!,
        x = p % width,
        y = Math.floor(p / width);
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ]) {
        const xx = x + dx,
          yy = y + dy,
          q = yy * width + xx;
        if (
          xx >= 0 &&
          xx < width &&
          yy >= 0 &&
          yy < height &&
          !visited[q] &&
          data[q] >= 32
        ) {
          visited[q] = 1;
          stack.push(q);
        }
      }
    }
    if (count > 2)
      boxes.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      });
  }
  boxes.sort((a, b) => a.x - b.x);
  const merged: Rect[] = [];
  for (const box of boxes) {
    const old = merged.find(
      (b) => box.x <= b.x + b.width - 1 && box.x + box.width > b.x,
    );
    if (old) {
      const right = Math.max(old.x + old.width, box.x + box.width),
        bottom = Math.max(old.y + old.height, box.y + box.height);
      old.x = Math.min(old.x, box.x);
      old.y = Math.min(old.y, box.y);
      old.width = right - old.x;
      old.height = bottom - old.y;
    } else merged.push({ ...box });
  }
  return merged.map((b) => {
    const pixels = new Uint8Array(b.width * b.height);
    for (let y = 0; y < b.height; y++)
      pixels.set(
        data.subarray(
          (b.y + y) * width + b.x,
          (b.y + y) * width + b.x + b.width,
        ),
        y * b.width,
      );
    return {
      data: pixels,
      width: b.width,
      height: b.height,
      scale,
      box: {
        x: mask.box.x + b.x / scale,
        y: mask.box.y + b.y / scale,
        width: b.width / scale,
        height: b.height / scale,
      },
    };
  });
}
function normalized(mask: Mask): Float64Array {
  const out = new Float64Array(48 * 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 48; x++) {
      const xx = Math.min(
          mask.width - 1,
          Math.floor(((x + 0.5) * mask.width) / 48),
        ),
        yy = Math.min(
          mask.height - 1,
          Math.floor(((y + 0.5) * mask.height) / 64),
        );
      out[y * 48 + x] = mask.data[yy * mask.width + xx] / 255;
    }
  return out;
}
interface GlyphCache {
  templates: Map<RegisteredFont, Map<string, Mask | undefined>>;
  normalized: Map<Mask, Float64Array>;
}
const newCache = (): GlyphCache => ({
  templates: new Map(),
  normalized: new Map(),
});
function normalizeTemplate(mask: Mask, cache: GlyphCache) {
  let value = cache.normalized.get(mask);
  if (!value) {
    value = measure("template-normalize", () => normalized(mask));
    cache.normalized.set(mask, value);
  }
  return value;
}
function glyphMask(
  font: RegisteredFont,
  gid: number,
  size: number,
  templates: GlyphCache["templates"],
): Mask | undefined {
  let cache = templates.get(font);
  if (!cache) templates.set(font, (cache = new Map()));
  const key = `${gid}:${size}`;
  if (cache.has(key)) return cache.get(key);
  cache.set(key, undefined);
  const glyph = font.parsed.glyphs.get(gid),
    bbox = glyph.getBoundingBox(),
    factor = size / font.parsed.unitsPerEm;
  if (bbox.x2 <= bbox.x1 || bbox.y2 <= bbox.y1) return;
  const scale = 8,
    box = {
      x: bbox.x1 * factor,
      y: -bbox.y2 * factor,
      width: (bbox.x2 - bbox.x1) * factor,
      height: (bbox.y2 - bbox.y1) * factor,
    };
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(box.width * scale) + 4;
  canvas.height = Math.ceil(box.height * scale) + 4;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.translate(-box.x + 0.5, -box.y + 0.5);
  glyph.getPath(0, 0, size).draw(ctx);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
  const components = inkComponents({
    data,
    width: canvas.width,
    height: canvas.height,
    scale,
    box: {
      x: box.x - 0.5,
      y: box.y - 0.5,
      width: canvas.width / scale,
      height: canvas.height / scale,
    },
  });
  if (components.length !== 1) return;
  cache.set(key, components[0]);
  return components[0];
}
/** Conservative font-template recognition: ambiguous shapes remain vectors. */
function matchGlyph(
  mask: Mask,
  font: RegisteredFont,
  candidates: { character: string; gid: number }[],
  size: number,
  allowScale = false,
  cache = newCache(),
): GlyphMatch | undefined {
  const input = normalized(mask);
  const matches: GlyphMatch[] = [];
  for (const candidate of candidates) {
    if (!candidate.gid) continue;
    const template = glyphMask(font, candidate.gid, size, cache.templates);
    if (!template) continue;
    const sx = mask.box.width / template.box.width,
      sy = mask.box.height / template.box.height;
    if (
      allowScale
        ? sx < 0.25 || sx > 1.5 || Math.abs(sx / sy - 1) > 0.1
        : Math.abs(mask.box.width - template.box.width) > 0.8 ||
          Math.abs(mask.box.height - template.box.height) > 0.8
    )
      continue;
    const target = normalizeTemplate(template, cache);
    let intersection = 0,
      union = 0;
    for (let i = 0; i < input.length; i++) {
      intersection += Math.min(input[i], target[i]);
      union += Math.max(input[i], target[i]);
    }
    const score = intersection / Math.max(union, 1);
    const actualSize = allowScale ? (size * (sx + sy)) / 2 : size;
    const bbox = font.parsed.glyphs.get(candidate.gid).getBoundingBox(),
      factor = actualSize / font.parsed.unitsPerEm;
    matches.push({
      ...candidate,
      size: actualSize,
      x: mask.box.x - bbox.x1 * factor,
      y: mask.box.y + bbox.y2 * factor,
      score,
    });
  }
  matches.sort((a, b) => b.score - a.score);
  if (
    !matches.length ||
    matches[0].score < 0.86 ||
    (matches[1] &&
      matches[0].score - matches[1].score < 0.04 &&
      matches[0].character !== matches[1].character)
  )
    return;
  return matches[0];
}

export const nativeMask = (...args: Parameters<typeof renderMask>) =>
  measure("mask", () => renderMask(...args));
export const matchNativeGlyph = (...args: Parameters<typeof matchGlyph>) =>
  measure("glyph-match", () => matchGlyph(...args));

/** Session-owned templates; no position-dependent match result is cached. */
export function createGlyphMatcher() {
  const cache = newCache();
  return {
    match(
      mask: Mask,
      font: RegisteredFont,
      candidates: { character: string; gid: number }[],
      size: number,
      allowScale = false,
    ) {
      return measure("glyph-match", () =>
        matchGlyph(mask, font, candidates, size, allowScale, cache),
      );
    },
    dispose() {
      cache.templates.clear();
      cache.normalized.clear();
    },
  };
}
