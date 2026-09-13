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
    reason: string,
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
    if (n.type === "TEXT_PATH")
      issue(n, "パス上の文字は初版では対応していません。");
    if (n.type === "TEXT") {
      if (!hasPaint(n)) return;
      paintOrder.push(n);
      texts.push(n);
      const box = n.absoluteRenderBounds ?? n.absoluteBoundingBox;
      if (!box) return;
      if (!contains(frame.absoluteBoundingBox!, box))
        issue(n, "Frame の外に出る文字は保持できません。");
      if (n.hasMissingFont)
        issue(n, "Figma 側で使用フォントが不足しています。");
      for (const a of [...ancestors, n]) {
        if (a !== n && "opacity" in a && a.opacity !== 1)
          issue(n, "親レイヤーの半透明合成は未対応です。");
        if (
          "blendMode" in a &&
          !["PASS_THROUGH", "NORMAL"].includes(a.blendMode)
        )
          issue(n, "文字に影響する描画モードは未対応です。");
        if ("effects" in a && a.effects.some((e) => e.visible))
          issue(n, "文字に影響する影・ぼかし等の効果は未対応です。");
        if ("isMask" in a && a.isMask)
          issue(n, "文字を含むマスクは未対応です。");
        if (
          "children" in a &&
          a.children.some((c) => "isMask" in c && c.isMask && visible(c))
        )
          issue(n, "文字と同じ階層にマスクがあります。");
        if ("clipsContent" in a && a.clipsContent) {
          if (!contains(a.absoluteBoundingBox!, box))
            issue(n, "文字が Clip content の境界にかかっています。");
          if ("cornerRadius" in a && a.cornerRadius !== 0)
            issue(n, "角丸クリッピング内の文字は保守的に非対応とします。");
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
          issue(n, "文字のグラデーション・画像塗りは未対応です。");
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
        issue(n, "非表示の文字範囲、または複数の文字塗りは未対応です。");
      if (n.strokes.length) issue(n, "文字の輪郭線は未対応です。");
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
          issue(
            t,
            "親コンテナの輪郭線と文字が重なる可能性があります。変換後の見た目を確認してください。",
            undefined,
            "warning",
          );
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
        `前面の「${later.name}」と重なる可能性があります。変換すると文字が前面になります。`,
        undefined,
        "warning",
      );
  }
  return {
    texts,
    fonts: mergeFonts(texts.flatMap(fontsFor)),
    diagnostics: diagnostics.filter(
      (d, i, a) =>
        a.findIndex((x) => x.nodeId === d.nodeId && x.reason === d.reason) ===
        i,
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
