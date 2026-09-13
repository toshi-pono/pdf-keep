import assert from "node:assert/strict";

/** Assemble only individually captured ranges; never substitute the full layer. */
export function fixtureRangeSVG(text, range) {
  if (range.start === undefined && range.end === undefined) return text.outline;
  const start = range.start ?? 0,
    end = range.end ?? text.characters.length;
  const exact = text.ranges?.[`${start}:${end}`];
  if (exact) return exact;
  let at = start;
  const pieces = [];
  while (at < end) {
    const entry = Object.entries(text.ranges ?? {}).find(([key]) => {
      const [a, b] = key.split(":").map(Number);
      return a === at && b > a && b <= end;
    });
    assert(entry, `Missing captured range ${text.name}: ${at}–${end}`);
    pieces.push(entry[1]);
    at = Number(entry[0].split(":")[1]);
  }
  const roots = pieces.map((svg) => /<svg\b[^>]*>/.exec(svg)?.[0]);
  assert(
    roots[0] && roots.every((root) => root === roots[0]),
    "Mismatched range viewports",
  );
  return (
    roots[0] +
    pieces
      .map((svg) =>
        svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, ""),
      )
      .join("") +
    "</svg>"
  );
}
