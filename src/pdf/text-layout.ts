import { fontKey, type TextAsset, type TextSegment } from "../shared/protocol";
import type { RegisteredFont } from "./create-pdf";
export interface SourceChar {
  displayStart: number;
  displayEnd: number;
  start: number;
  end: number;
  text: string;
}
export interface TextRun {
  el: SVGTextContentElement;
  display: string;
  original: string;
  chars: SourceChar[];
  segment?: TextSegment;
  start?: number;
  end?: number;
  marker: boolean;
  font?: RegisteredFont;
  size: number;
  features: Record<string, boolean>;
  matrix: DOMMatrix;
  x: number;
  y: number;
  letterSpacing: number;
}
export function graphemes(text: string): { text: string; index: number }[] {
  const Segmenter = (Intl as any).Segmenter;
  if (Segmenter)
    return [
      ...new Segmenter("und", { granularity: "grapheme" }).segment(text),
    ].map((s: any) => ({ text: s.segment, index: s.index }));
  let index = 0;
  return Array.from(text, (c) => {
    const result = { text: c, index };
    index += c.length;
    return result;
  });
}
export function scriptFeatures(segment?: TextSegment) {
  return Object.keys(segment?.features ?? {}).filter(
    (tag) => /^(sups|subs|sinf)$/i.test(tag) && segment!.features[tag],
  );
}
export function inherited(el: SVGElement, name: string): string {
  let node: Element | null = el;
  while (node) {
    const value =
      (node as SVGElement).style?.getPropertyValue(name) ||
      node.getAttribute(name);
    if (value) return value;
    node = node.parentElement;
  }
  return "";
}
export function sourceMapper(asset: TextAsset) {
  const source = asset.source!;
  const original = graphemes(source.characters);
  const used = new Set<number>();
  let cursor = 0;
  const segmentAt = (offset: number) =>
    source.segments.find((s) => s.start <= offset && offset < s.end);
  return (display: string): SourceChar[] | undefined => {
    const chars = graphemes(display);
    if (!chars.length) return [];
    const candidates = [
      ...original.filter((c) => c.index >= cursor),
      ...original.filter((c) => c.index < cursor),
    ];
    for (const candidate of candidates) {
      let at = original.findIndex((c) => c.index === candidate.index);
      const mapping: SourceChar[] = [];
      let valid = true;
      for (const c of chars) {
        while (at < original.length && /^[\r\n]+$/.test(original[at].text))
          at++;
        const o = original[at++];
        if (!o || used.has(o.index)) {
          valid = false;
          break;
        }
        const equivalent =
          o.text.normalize("NFC") === c.text.normalize("NFC") ||
          (scriptFeatures(segmentAt(o.index)).length > 0 &&
            o.text.normalize("NFKC") === c.text.normalize("NFKC"));
        if (!equivalent) {
          valid = false;
          break;
        }
        mapping.push({
          displayStart: c.index,
          displayEnd: c.index + c.text.length,
          start: o.index,
          end: o.index + o.text.length,
          text: o.text,
        });
      }
      if (valid) {
        mapping.forEach((c) => used.add(c.start));
        cursor = mapping.at(-1)?.end ?? cursor;
        return mapping;
      }
    }
    return;
  };
}
/** Preserve SVG's per-line anchors; source spans carry Unicode and OT semantics. */
export function readRuns(
  svg: SVGSVGElement,
  asset: TextAsset,
  registry: Map<string, RegisteredFont>,
): TextRun[] {
  const source = asset.source!;
  const map = sourceMapper(asset);
  const runs: TextRun[] = [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (
      ["text", "tspan"].includes(node.parentElement?.localName ?? "") &&
      node.textContent
    )
      nodes.push(node);
  }
  for (const node of nodes) {
    const display = (node.textContent ?? "").replace(/[\r\n]/g, "");
    node.textContent = display;
    if (!display) continue;
    const mapping = map(display);
    let marker = false;
    if (!mapping) {
      if (
        source.segments.some((s) => s.list !== "NONE") &&
        /^\s*(?:[•◦▪●○‣]|\d+[.)])\s*$/.test(display)
      )
        marker = true;
      else throw Error("SVG の文字と元の文字範囲を対応付けできません。");
    }
    const groups: {
      display: string;
      chars: SourceChar[];
      segment?: TextSegment;
    }[] = [];
    if (marker)
      groups.push({
        display,
        chars: [],
        segment: source.segments.find((s) => s.list !== "NONE"),
      });
    else
      for (const char of mapping!) {
        const segment = source.segments.find(
            (s) => s.start <= char.start && char.start < s.end,
          ),
          last = groups.at(-1);
        if (last && last.segment === segment) {
          last.display += display.slice(char.displayStart, char.displayEnd);
          last.chars.push(char);
        } else
          groups.push({
            display: display.slice(char.displayStart, char.displayEnd),
            chars: [char],
            segment,
          });
      }
    for (const group of groups) {
      const el = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "tspan",
      );
      el.textContent = group.display;
      node.parentNode!.insertBefore(el, node);
      const offset = group.chars[0]?.displayStart ?? 0;
      const chars = group.chars.map((c) => ({
        ...c,
        displayStart: c.displayStart - offset,
        displayEnd: c.displayEnd - offset,
      }));
      const family = inherited(el, "font-family")
        .split(",")[0]
        .trim()
        .replace(/^['"]|['"]$/g, "");
      const weight = inherited(el, "font-weight") || "400",
        style = inherited(el, "font-style");
      const spec =
        asset.fonts.find(
          (f) =>
            f.family === family &&
            f.weight ===
              (weight === "bold"
                ? 700
                : weight === "normal"
                  ? 400
                  : Number(weight)) &&
            f.italic === /italic|oblique/.test(style),
        ) ?? group.segment?.font;
      const font = spec ? registry.get(fontKey(spec)) : undefined;
      const features: Record<string, boolean> = {};
      for (const [tag, value] of Object.entries(group.segment?.features ?? {}))
        features[tag.toLowerCase()] = value;
      const settings = inherited(el, "font-feature-settings");
      for (const m of settings.matchAll(/["']([\w]{4})["']\s*(on|off|\d+)?/g))
        features[m[1].toLowerCase()] = m[2] !== "off" && m[2] !== "0";
      if (font) {
        el.setAttribute("font-family", font.alias);
        el.style.fontFamily = `"${font.alias}"`;
        el.setAttribute("font-weight", "normal");
        el.setAttribute("font-style", "normal");
      }
      // A Unicode superscript emitted by Figma is already a presentation glyph.
      // Applying the feature to it again would transform it twice.
      const original = chars.map((c) => c.text).join("") || group.display;
      if (original !== group.display)
        for (const tag of ["sups", "subs", "sinf"]) delete features[tag];
      if (settings) el.style.fontFeatureSettings = settings;
      runs.push({
        el,
        display: group.display,
        original,
        chars,
        segment: group.segment,
        start: chars[0]?.start,
        end: chars.at(-1)?.end,
        marker,
        font,
        size: 0,
        features,
        matrix: new DOMMatrix(),
        x: 0,
        y: 0,
        letterSpacing: 0,
      });
    }
    node.remove();
  }
  // All font aliases are loaded before measuring. The root can contain native
  // paths (e.g. list decorations) alongside the searchable text runs.
  for (const run of runs) {
    const style = getComputedStyle(run.el);
    run.size = parseFloat(style.fontSize);
    const p = run.el.getStartPositionOfChar(0);
    run.x = p.x;
    run.y = p.y;
    run.matrix = run.el.getCTM()!;
    run.letterSpacing = parseFloat(style.letterSpacing) || 0;
    if (
      !run.matrix ||
      ![
        run.x,
        run.y,
        run.size,
        ...[
          run.matrix.a,
          run.matrix.b,
          run.matrix.c,
          run.matrix.d,
          run.matrix.e,
          run.matrix.f,
        ],
      ].every(Number.isFinite) ||
      run.size <= 0
    )
      throw Error("文字の配置を取得できません。");
  }
  return runs;
}
