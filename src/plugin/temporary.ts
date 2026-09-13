import { operationBudget } from "../shared/operation-budget";
import { measure } from "../shared/performance";

export const TEMPORARY_KEY = "pdf-keep.temporary.v1";
interface Ownership {
  purpose: "export";
  version: 1;
  session: string;
}
function ownership(node: BaseNode): Ownership | undefined {
  try {
    const value = JSON.parse(node.getPluginData(TEMPORARY_KEY));
    if (
      value?.purpose === "export" &&
      value.version === 1 &&
      typeof value.session === "string"
    )
      return value;
  } catch {
    /* Unmarked or unrelated data is never ours. */
  }
}
export function recoverTemporary(page: PageNode, active?: string) {
  try {
    const nodes = page.findAllWithCriteria({
      pluginData: { keys: [TEMPORARY_KEY] },
    });
    for (const node of nodes) {
      try {
        if (!node.removed) {
          const mark = ownership(node);
          if (mark && mark.session !== active) node.remove();
        }
      } catch {
        /* Keep the mark so a later recovery can retry. */
      }
    }
  } catch {
    /* An inaccessible page must not prevent opening the plugin. */
  }
}

/** One export owns its nodes and cancellation lifetime, including late callbacks. */
export class TemporaryExport {
  readonly session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  readonly page = figma.currentPage;
  private nodes = new Set<SceneNode>();
  private root?: FrameNode;
  private closed = false;
  constructor(private verify: () => void) {}
  check = () => {
    if (this.closed) throw Error("キャンセルしました。");
    this.verify();
  };
  private mark(node: SceneNode) {
    this.nodes.add(node);
    node.setPluginData(
      TEMPORARY_KEY,
      JSON.stringify({ purpose: "export", version: 1, session: this.session }),
    );
  }
  private workspace() {
    if (!this.root) {
      const root = figma.createFrame();
      this.root = root;
      this.mark(root);
      this.page.appendChild(root);
      root.name = "PDF Keep temporary export";
      root.fills = [];
      root.strokes = [];
      root.effects = [];
      root.layoutMode = "NONE";
      root.clipsContent = false;
      let right = figma.viewport.bounds.x + figma.viewport.bounds.width;
      for (const node of this.page.children) {
        if (this.nodes.has(node)) continue;
        const b =
          ("absoluteRenderBounds" in node ? node.absoluteRenderBounds : null) ??
          node.absoluteBoundingBox;
        if (b) right = Math.max(right, b.x + b.width);
      }
      root.x = right + 1024;
      root.y = figma.viewport.bounds.y;
    }
    return this.root;
  }
  add(node: SceneNode) {
    this.check();
    this.mark(node);
    this.workspace().appendChild(node);
    // Keep the node's linear transform, but never leave a new node at page origin.
    node.x = 0;
    node.y = 0;
    return this;
  }
  has(node: SceneNode) {
    return this.nodes.has(node);
  }
  [Symbol.iterator]() {
    return this.nodes.values();
  }
  remove(node: SceneNode) {
    try {
      if (!node.removed) node.remove();
      this.nodes.delete(node);
    } catch {
      // A failed removal during preparation must not paint into the background.
      // Keep the ownership mark and move the remnant out of the export wrapper.
      try {
        if (node !== this.root && this.root && !this.root.removed) {
          this.root.appendChild(node);
          node.x = node.y = 0;
          if ("opacity" in node) node.opacity = 0;
        }
      } catch {
        /* Disposal/recovery still retries the marked node. */
      }
    }
  }
  /** Only completed output is released; preserve its intended page coordinates. */
  publish(node: SceneNode) {
    this.check();
    const transform = node.relativeTransform.map((row) => [
      ...row,
    ]) as Transform;
    this.page.appendChild(node);
    node.relativeTransform = transform;
    const clear = (n: SceneNode) => {
      n.setPluginData(TEMPORARY_KEY, "");
      if ("children" in n) for (const child of n.children) clear(child);
    };
    clear(node);
    const release = (n: SceneNode) => {
      this.nodes.delete(n);
      if ("children" in n) for (const child of n.children) release(child);
    };
    release(node);
  }
  dispose() {
    this.closed = true;
    // Children first, workspace last. A failed child removal cannot stop others.
    for (const node of [...this.nodes].reverse())
      if (node !== this.root) this.remove(node);
    if (this.root) this.remove(this.root);
    this.nodes.clear();
  }
  async run<T>(
    label: string,
    work: (check: () => void) => Promise<T>,
    ms = 30000,
    check = this.check,
  ): Promise<T> {
    const budget = operationBudget(
      () => {
        this.check();
        check();
      },
      ms,
      undefined,
      (stage) => `${stage}が制限時間を超えました。`,
    );
    return budget.run(label, () => work(() => budget.check(label)));
  }
  export(
    node: SceneNode,
    options: ExportSettingsSVGString,
    check?: () => void,
  ): Promise<string>;
  export(
    node: SceneNode,
    options: ExportSettingsImage | ExportSettingsPDF,
    check?: () => void,
  ): Promise<Uint8Array>;
  export(
    node: SceneNode,
    options: ExportSettingsSVGString | ExportSettingsImage | ExportSettingsPDF,
    check = this.check,
  ): Promise<string | Uint8Array> {
    const label =
      options.format === "PNG"
        ? "背景PNGの取得"
        : options.format === "PDF"
          ? "PDFの取得"
          : "SVGの取得";
    return this.run<string | Uint8Array>(
      label,
      () =>
        measure(`figma-${options.format.toLowerCase()}`, () =>
          options.format === "SVG_STRING"
            ? node.exportAsync(options)
            : node.exportAsync(options),
        ),
      options.format === "PNG" ? 60000 : 30000,
      check,
    );
  }
}
