import { AppError } from "../shared/errors";
import { msg } from "../shared/messages";
import type { RegisteredFont } from "./create-pdf";

interface DecoratedRun {
  el: SVGTextContentElement;
  font: RegisteredFont;
  include?: (index: number) => boolean;
}

/** SVG2PDF and the CID renderer draw glyphs, but ignore CSS text decorations.
 * Keep the glyphs searchable and draw only the rules as vector rectangles.
 * Measure each SVG character so wrapping, mixed styles and transforms survive.
 */
export function appendTextDecorations(
  svg: SVGSVGElement,
  runs: DecoratedRun[],
) {
  const rootMatrix = svg.getCTM();
  if (!rootMatrix) throw new AppError(msg("errors.textPositions"));
  const paths: SVGPathElement[] = [];
  for (const { el, font, include } of runs) {
    const decorations = new Map<string, SVGElement>();
    // Decoration propagates through descendants even when their own computed
    // text-decoration-line is 'none'. The declaring element supplies metrics.
    for (
      let owner: SVGElement | null = el;
      owner;
      owner = owner.parentElement as SVGElement | null
    ) {
      for (const line of getComputedStyle(owner).textDecorationLine.split(
        /\s+/,
      ))
        if (line !== "none" && line && !decorations.has(line))
          decorations.set(line, owner);
      if (owner === svg) break;
    }
    if (!decorations.size) continue;
    const style = getComputedStyle(el);
    const matrix = rootMatrix.inverse().multiply(el.getCTM()!);
    for (const [line, owner] of decorations) {
      if (!["underline", "line-through", "overline"].includes(line))
        throw new AppError(msg("errors.textDecoration", { decoration: line }));
      const decoration = getComputedStyle(owner);
      if (decoration.textDecorationStyle !== "solid")
        throw new AppError(
          msg("errors.decorationStyle", {
            style: decoration.textDecorationStyle,
          }),
        );
      const size = parseFloat(decoration.fontSize);
      const factor = size / font.parsed.unitsPerEm;
      const post = font.parsed.tables.post;
      const specified = decoration.textDecorationThickness;
      // Match Blink's SVG/CSS 'auto' rules rather than treating them as
      // 'from-font': auto thickness is 1/10 em with a half-thickness gap.
      const thickness =
        specified === "auto"
          ? size / 10
          : specified === "from-font"
            ? (post?.underlineThickness || font.parsed.unitsPerEm / 10) * factor
            : specified.endsWith("%")
              ? (parseFloat(specified) * size) / 100
              : parseFloat(specified);
      const offset =
        line === "line-through"
          ? (-font.parsed.ascender * factor) / 3 - thickness / 2
          : line === "overline"
            ? -font.parsed.ascender * factor
            : Math.max(1, Math.ceil(thickness / 2));
      if (![thickness, offset].every(Number.isFinite) || thickness < 0)
        throw new AppError(msg("errors.decorationDimensions"));
      if (!thickness) continue;
      const spans: { x: number; end: number; y: number }[] = [];
      for (let i = 0; i < el.getNumberOfChars(); i++) {
        if (include && !include(i)) continue;
        const start = el.getStartPositionOfChar(i);
        const end = el.getEndPositionOfChar(i);
        if (Math.abs(start.y - end.y) > 0.01 || el.getRotationOfChar(i))
          throw new AppError(msg("errors.rotatedDecoration"));
        const x = Math.min(start.x, end.x),
          right = Math.max(start.x, end.x);
        const last = spans.at(-1);
        if (
          last &&
          Math.abs(last.y - start.y) < 0.01 &&
          Math.abs(last.end - x) < 0.1
        )
          last.end = right;
        else spans.push({ x, end: right, y: start.y });
      }
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      if (!spans.some((s) => s.end > s.x)) continue;
      path.setAttribute(
        "d",
        spans
          .filter((s) => s.end > s.x)
          .map(
            (s) =>
              `M${s.x} ${s.y + offset}h${s.end - s.x}v${thickness}h${s.x - s.end}Z`,
          )
          .join(" "),
      );
      path.setAttribute(
        "transform",
        `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(" ")})`,
      );
      // SVG decorations use the declaring text's paint, including when CSS's
      // shorthand expands an implicit text-decoration-color: initial.
      path.setAttribute("fill", decoration.fill);
      path.setAttribute("fill-opacity", style.fillOpacity);
      paths.push(path);
    }
  }
  svg.append(...paths);
}
