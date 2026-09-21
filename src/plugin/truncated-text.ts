import { type Message, msg } from "../shared/messages";
import { AppError } from "../shared/errors";
import { TemporaryExport } from "./temporary";
import { operationBudget } from "../shared/operation-budget";
import { sameBytes, textPixelComparator } from "../pdf/text-pixels";
/** Figma's text SVG omits its ellipsis. Use its visible glyph count to locate
 * candidates, then accept only a candidate with exactly the original pixels. */
function xmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
      (_, entity: string) => {
        if (entity[0] !== "#")
          return (
            { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity] ?? ""
          );
        const hex = entity[1].toLowerCase() === "x";
        return String.fromCodePoint(
          parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10),
        );
      },
    );
}
/** Recover soft wraps in display order, even when Figma groups spans by style. */
export function softLineBreaks(characters: string, svg: string): number[] {
  if (/[\r\n]/.test(characters)) return [];
  const spans = [...svg.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)].map(
    (m) => ({
      x: Number(/\bx="([^"]+)"/.exec(m[1])?.[1]),
      y: Number(/\by="([^"]+)"/.exec(m[1])?.[1]),
      text: xmlText(m[2]),
    }),
  );
  if (spans.some((s) => !Number.isFinite(s.x) || !Number.isFinite(s.y)))
    return [];
  spans.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; text: string }[] = [];
  for (const span of spans) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - span.y) < 0.01) last.text += span.text;
    else lines.push({ y: span.y, text: span.text });
  }
  let position = 0;
  const breaks: number[] = [];
  for (const line of lines.slice(0, -1)) {
    if (!characters.startsWith(line.text, position)) return [];
    position += line.text.length;
    if (characters[position - 1] === " ") breaks.push(position - 1);
    else return [];
  }
  return breaks;
}

export function truncationCandidates(
  characters: string,
  svg: string,
): number[] {
  let visible = "";
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    visible += xmlText(match[1]);
  }
  const count = Array.from(visible.replace(/[\r\n]/g, "")).length;
  const offsets: { end: number; distance: number }[] = [
    { end: 0, distance: count },
  ];
  let end = 0,
    glyphs = 0;
  for (const c of characters) {
    end += c.length;
    if (!/[\r\n]/.test(c)) glyphs++;
    offsets.push({ end, distance: Math.abs(glyphs - count) });
  }
  return offsets
    .sort((a, b) => a.distance - b.distance || a.end - b.end)
    .slice(0, 64)
    .map((x) => x.end);
}

/** Raster centroids estimate the shift only approximately. Search nearby
 * subpixel positions and accept a correction only after exact verification. */
export function trackingCandidates(estimate: number): number[] {
  return [
    ...new Set([
      Math.round(estimate * 4) / 4,
      estimate,
      ...[1, 2, 3, 4].flatMap((step) => [
        estimate - step / 64,
        estimate + step / 64,
      ]),
    ]),
  ];
}

/** Source and its ancestors remain untouched, including auto-layout geometry. */
export async function materializeTruncatedText(
  source: TextNode,
  parent: FrameNode,
  temporary: TemporaryExport,
  check: () => void,
  progress: (stage: Message) => void = () => {},
): Promise<TextNode> {
  const budget = operationBudget(check, 15000, progress);
  const loaded = new Set<string>();
  for (const { fontName } of source.getStyledTextSegments(["fontName"])) {
    const key = JSON.stringify(fontName);
    if (loaded.has(key)) continue;
    await budget.run(
      msg("progress.preparingFont", { family: fontName.family }),
      () => figma.loadFontAsync(fontName),
    );
    loaded.add(key);
  }
  const clone = () => {
    const n = source.clone();
    temporary.add(n);
    parent.appendChild(n);
    n.relativeTransform = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    return n;
  };
  const remove = (n: TextNode) => {
    temporary.remove(n);
  };
  const reference = clone();
  const options: ExportSettingsImage = {
    format: "PNG",
    constraint: { type: "SCALE", value: 1 },
    useAbsoluteBounds: true,
    contentsOnly: true,
  };
  try {
    // Prevent a single synchronous PNG decode from monopolizing the sandbox.
    if (source.width * source.height > 4_000_000)
      throw new AppError(msg("errors.truncationArea"));
    const pixels = await budget.run(msg("progress.originalAppearance"), () =>
      reference.exportAsync(options),
    );
    const comparePixels = textPixelComparator(pixels);
    check();
    const svg = await budget.run(msg("progress.truncationPoint"), () =>
      reference.exportAsync({
        format: "SVG_STRING",
        svgOutlineText: false,
        useAbsoluteBounds: true,
        contentsOnly: true,
      }),
    );
    // BEFORE and AFTER produce identical output on uniformly styled text.
    const uniform =
      source.getStyledTextSegments([
        "fontName",
        "fontSize",
        "fills",
        "textDecoration",
        "letterSpacing",
        "lineHeight",
        "textCase",
      ]).length <= 1;
    const inheritance = uniform
      ? (["BEFORE"] as const)
      : (["BEFORE", "AFTER"] as const);
    const lineBreaks = softLineBreaks(source.characters, svg);
    const candidates = [
      { end: source.characters.length, suffix: "", inherit: "BEFORE" as const },
      ...truncationCandidates(source.characters, svg).flatMap((end) =>
        ["…", "..."].flatMap((suffix) =>
          inheritance.map((inherit) => ({
            end,
            suffix,
            inherit,
          })),
        ),
      ),
    ];
    const maxRenders = 32;
    let renders = 0;
    const render = (n: TextNode) => {
      if (renders >= maxRenders)
        throw new AppError(msg("errors.truncationComparisons"));
      const stage = msg("progress.comparing", {
        current: ++renders,
        total: maxRenders,
      });
      return budget.run(stage, async () => {
        if (n.width === source.width) return n.exportAsync(options);
        // Figma's truncator can place the ellipsis where normal word wrapping
        // would move the last word to a new line. Match within the original
        // viewport while allowing the candidate to lay out that last word.
        const viewport = figma.createFrame();
        temporary.add(viewport);
        parent.appendChild(viewport);
        viewport.resize(source.width, source.height);
        viewport.fills = [];
        viewport.clipsContent = true;
        viewport.appendChild(n);
        n.relativeTransform = [
          [1, 0, 0],
          [0, 1, 0],
        ];
        try {
          return await viewport.exportAsync(options);
        } finally {
          if (!n.removed && !parent.removed) parent.appendChild(n);
          temporary.remove(viewport);
        }
      });
    };
    for (const { end, suffix, inherit } of candidates) {
      budget.check(msg("progress.appearanceComparison"));
      const n = clone();
      let accepted = false;
      try {
        n.textAutoResize = "NONE";
        n.resize(source.width, source.height);
        n.maxLines = null;
        n.textTruncation = "DISABLED";
        if (suffix) n.insertCharacters(end, suffix, inherit);
        if (end + suffix.length < n.characters.length)
          n.deleteCharacters(end + suffix.length, n.characters.length);
        const rendered = await render(n);
        check();
        let matches = sameBytes(pixels, rendered);
        if (!matches && suffix && end > 0) {
          let offset = comparePixels(rendered);
          if (offset === null) {
            const size = n.getRangeFontSize(end - 1, end);
            if (size !== figma.mixed) {
              n.resize(source.width + size, source.height);
              if (lineBreaks.length) {
                n.paragraphSpacing = 0;
                for (const index of [...lineBreaks].reverse()) {
                  if (index >= end) continue;
                  n.deleteCharacters(index, index + 1);
                  n.insertCharacters(index, "\n", "BEFORE");
                }
              }
              const expanded = await render(n);
              matches = sameBytes(pixels, expanded);
              offset = comparePixels(expanded);
            }
          }
          if (offset === 0) matches = true;
          else if (offset !== null && Math.abs(offset) <= 4) {
            const start =
              end - (source.characters.codePointAt(end - 2)! > 0xffff ? 2 : 1);
            const tracking = n.getRangeLetterSpacing(start, end);
            const size = n.getRangeFontSize(start, end);
            if (tracking !== figma.mixed && size !== figma.mixed) {
              const original =
                tracking.unit === "PIXELS"
                  ? tracking.value
                  : (tracking.value * size) / 100;
              for (const correction of trackingCandidates(offset)) {
                n.setRangeLetterSpacing(start, end, {
                  unit: "PIXELS",
                  value: original + correction,
                });
                const corrected = await render(n);
                matches =
                  sameBytes(pixels, corrected) ||
                  comparePixels(corrected) === 0;
                check();
                if (matches) break;
              }
            }
          }
        }
        if (matches) {
          n.name = n.characters;
          accepted = true;
          return n;
        }
      } finally {
        if (!accepted) remove(n);
      }
    }
    throw new AppError(
      msg("errors.truncationReproduction", { name: source.name }),
    );
  } finally {
    remove(reference);
  }
}
