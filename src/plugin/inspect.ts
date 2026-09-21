import { sameMessage, type Message, msg } from "../shared/messages";
import { contains, intersects } from "../shared/geometry";
import { fontKey, type FontSpec, type Diagnostic } from "../shared/protocol";
export function visible(node: SceneNode) {
  return node.visible && (!("opacity" in node) || node.opacity > 0);
}
export function fontsFor(node: TextNode): FontSpec[] {
  return node.getStyledTextSegments(["fontName", "fontWeight"]).map((s) => ({
    family: s.fontName.family,
    style: s.fontName.style,
    weight: s.fontWeight,
    italic: /italic|oblique/i.test(s.fontName.style),
    characters: s.characters,
  }));
}
export function mergeFonts(fonts: FontSpec[]): FontSpec[] {
  const map = new Map<string, FontSpec>();
  for (const f of fonts) {
    const key = fontKey(f);
    const old = map.get(key);
    map.set(key, { ...f, characters: (old?.characters ?? "") + f.characters });
  }
  return [...map.values()];
}
function paints(p: readonly Paint[] | PluginAPI["mixed"]) {
  return (
    p !== figma.mixed &&
    p.some((x) => x.visible !== false && (x.opacity ?? 1) > 0)
  );
}
function renderBox(n: SceneNode) {
  return (
    ("absoluteRenderBounds" in n ? n.absoluteRenderBounds : null) ??
    n.absoluteBoundingBox
  );
}
function hasPaint(n: SceneNode) {
  return (
    ("fills" in n &&
      (paints(n.fills) ||
        (n.type === "TEXT" &&
          n.fills === figma.mixed &&
          n.getStyledTextSegments(["fills"]).some((s) => paints(s.fills))))) ||
    ("strokes" in n && paints(n.strokes)) ||
    ("effects" in n && n.effects.some((e) => e.visible))
  );
}
export function inspect(frame: FrameNode) {
  const diagnostics: Diagnostic[] = [];
  const texts: TextNode[] = [];
  const paintOrder: SceneNode[] = [];
  const issue = (
    n: SceneNode,
    reason: Message,
    destination?: "pdf",
    severity: "error" | "warning" = "error",
  ) =>
    diagnostics.push({
      nodeId: n.id,
      name: n.name,
      reason,
      destination,
      severity,
    });
  function walk(n: SceneNode, ancestors: SceneNode[]) {
    if (!visible(n)) return;
    if (n.type === "TEXT_PATH") issue(n, msg("errors.textPathUnsupported"));
    if (n.type === "TEXT") {
      if (!hasPaint(n)) return;
      paintOrder.push(n);
      texts.push(n);
      const box = n.absoluteRenderBounds ?? n.absoluteBoundingBox;
      if (!box) return;
      if (!contains(frame.absoluteBoundingBox!, box))
        issue(n, msg("errors.textOutsideFrame"));
      if (n.hasMissingFont) issue(n, msg("errors.figmaFontMissing"));
      for (const a of [...ancestors, n]) {
        if (a !== n && "opacity" in a && a.opacity !== 1)
          issue(n, msg("errors.parentOpacity"));
        if (
          "blendMode" in a &&
          !["PASS_THROUGH", "NORMAL"].includes(a.blendMode)
        )
          issue(n, msg("errors.blendMode"));
        if ("effects" in a && a.effects.some((e) => e.visible))
          issue(n, msg("errors.effects"));
        if ("isMask" in a && a.isMask) issue(n, msg("errors.textMask"));
        if (
          "children" in a &&
          a.children.some((c) => "isMask" in c && c.isMask && visible(c))
        )
          issue(n, msg("errors.siblingMask"));
        if ("clipsContent" in a && a.clipsContent) {
          if (!contains(a.absoluteBoundingBox!, box))
            issue(n, msg("errors.clipBoundary"));
          if ("cornerRadius" in a && a.cornerRadius !== 0)
            issue(n, msg("errors.roundedClip"));
        }
      }
      if (
        n.fills === figma.mixed ||
        n.fills.some((f) => f.visible !== false && f.type !== "SOLID")
      ) {
        // Mixed solid fills are checked per segment below.
        if (
          n
            .getStyledTextSegments(["fills"])
            .some((s) =>
              s.fills.some((f) => f.visible !== false && f.type !== "SOLID"),
            )
        )
          issue(n, msg("errors.textFill"));
      }
      if (
        n
          .getStyledTextSegments(["fills"])
          .some(
            (s) =>
              !paints(s.fills) ||
              s.fills.filter((f) => f.visible !== false && (f.opacity ?? 1) > 0)
                .length !== 1,
          )
      )
        issue(n, msg("errors.hiddenOrMultipleFills"));
      if (n.strokes.length) issue(n, msg("errors.textStroke"));
      return;
    }
    if (hasPaint(n)) paintOrder.push(n);
    if ("children" in n) {
      // Reversed stacking is used by some auto-layout frames.
      const children =
        "itemReverseZIndex" in n && n.itemReverseZIndex
          ? [...n.children].reverse()
          : n.children;
      for (const c of children) walk(c, [...ancestors, n]);
      // Container borders can paint over descendants.
      if ("strokes" in n && paints(n.strokes))
        for (const t of texts.filter((t) => ancestorsOf(t).includes(n)))
          issue(t, msg("errors.parentStroke"), undefined, "warning");
    }
  }
  walk(frame, []);
  for (const t of texts) {
    const box = t.absoluteRenderBounds ?? t.absoluteBoundingBox;
    if (!box) continue;
    const later = paintOrder
      .slice(paintOrder.indexOf(t) + 1)
      .find(
        (n) =>
          n.type !== "TEXT" && renderBox(n) && intersects(box, renderBox(n)!),
      );
    if (later)
      issue(
        t,
        msg("errors.overlap", { name: later.name }),
        undefined,
        "warning",
      );
  }
  return {
    texts,
    fonts: mergeFonts(texts.flatMap(fontsFor)),
    diagnostics: diagnostics.filter(
      (d, i, a) =>
        a.findIndex(
          (x) => x.nodeId === d.nodeId && sameMessage(x.reason, d.reason),
        ) === i,
    ),
  };
}
function ancestorsOf(n: BaseNode): BaseNode[] {
  const a: BaseNode[] = [];
  while (n.parent) {
    a.push(n.parent);
    n = n.parent;
  }
  return a;
}
