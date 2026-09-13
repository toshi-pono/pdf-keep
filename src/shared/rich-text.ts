/** Figma's list layout and OpenType script glyphs are not reproduced by svg2pdf.
 * Export these text nodes as vector glyphs, keeping other nodes searchable.
 */
export function needsTextOutlines(node: TextNode): boolean {
  return node
    .getStyledTextSegments(["listOptions", "openTypeFeatures"])
    .some(
      (segment) =>
        (segment.listOptions && segment.listOptions.type !== "NONE") ||
        Object.entries(segment.openTypeFeatures ?? {}).some(
          ([tag, enabled]) => /^(sups|subs|sinf)$/i.test(tag) && enabled,
        ),
    );
}

/** Also recognize SVG script positioning when metadata lacks feature tags. */
export function svgNeedsTextOutlines(svg: string): boolean {
  return /(?:font-feature-settings\s*[=:][^<>;]*\b(?:sups|subs|sinf)\b|font-variant-position\s*[=:][^<>;]*\b(?:super|sub)\b|baseline-shift\s*[=:])/i.test(
    svg,
  );
}
