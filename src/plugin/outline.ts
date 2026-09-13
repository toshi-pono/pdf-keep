import { TemporaryExport } from "./temporary";
/** Produce only outlined text, retaining its ancestor transforms and clipping.
 * Non-text artwork is baked separately into the opaque background image.
 */
export async function outlineTextPDF(
  source: FrameNode,
  temporary: TemporaryExport,
  check: () => void,
  onlyTextPaths?: Set<string>,
): Promise<Uint8Array> {
  const textOnly = source.clone();
  temporary.add(textOnly);
  let outlined: FrameNode | undefined;
  try {
    function isolate(node: SceneNode, path = ""): boolean {
      if (!node.visible || ("opacity" in node && node.opacity === 0))
        return false;
      if ("isMask" in node && node.isMask) return true;
      if (node.type === "TEXT" || node.type === "TEXT_PATH") {
        const retain = !onlyTextPaths || onlyTextPaths.has(path);
        if (!retain) node.opacity = 0;
        return retain;
      }
      if (!("children" in node)) return false;
      const retained = node.children.map((child, i) =>
        isolate(child, `${path}/${i}`),
      );
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        // A mask is needed by the text after it, even when it contains no text.
        if (!retained[i] && !("isMask" in child && child.isMask)) {
          // Hiding an auto-layout child would move the text. Slices have no paint.
          if ("opacity" in child) child.opacity = 0;
        }
      }
      if ("fills" in node) node.fills = [];
      // Keep stroke geometry when strokes participate in auto-layout sizing.
      if ("strokes" in node)
        node.strokes = node.strokes.map(() => ({
          type: "SOLID",
          color: { r: 0, g: 0, b: 0 },
          opacity: 0,
        }));
      return retained.some(Boolean);
    }
    isolate(textOnly);
    textOnly.clipsContent = true;
    check();
    const svg = await temporary.export(
      textOnly,
      {
        format: "SVG_STRING",
        svgOutlineText: true,
        useAbsoluteBounds: true,
        contentsOnly: true,
      },
      check,
    );
    check();
    // Do not silently accept editable or hidden text from an outline export.
    if (/<(?:[\w.-]+:)?(?:text|tspan|textPath)\b/i.test(svg))
      throw new Error("文字のアウトライン化に失敗しました。");
    outlined = figma.createNodeFromSvg(svg);
    temporary.add(outlined);
    const bytes = await temporary.export(
      outlined,
      {
        format: "PDF",
        useAbsoluteBounds: true,
        contentsOnly: true,
      },
      check,
    );
    check();
    return bytes;
  } finally {
    for (const node of [outlined, textOnly]) {
      if (!node) continue;
      temporary.remove(node);
    }
  }
}
