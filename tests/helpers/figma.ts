import assert from "node:assert/strict";
import { encode } from "fast-png";
import vm from "node:vm";
import { buildSync } from "esbuild";
const code = buildSync({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  write: false,
  target: "es2020",
}).outputFiles[0].text;
export function setup(fail = false, paused = false, withText = false) {
  const messages: any[] = [];
  const created: any[] = [];
  const exports: { node: any; options: any }[] = [];
  let nextNode = 0;
  const events: Record<string, (...args: any[]) => any> = {};
  let allowTextSVG = false;
  let textSVGAttributes = "";
  let allowTruncatedMatch = true;
  let fontLoads = 0;
  let wrappedEllipsis = false;
  let release: () => void = () => {};
  const pause = new Promise<void>((r) => {
    release = r;
  });
  function frame(): any {
    const f: any = {
      type: "FRAME",
      id: `f${++nextNode}`,
      data: {} as Record<string, string>,
      setPluginData(key: string, value: string) {
        this.data[key] = value;
      },
      getPluginData(key: string) {
        return this.data[key] ?? "";
      },
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      get x() {
        return this.relativeTransform[0][2];
      },
      set x(value: number) {
        this.relativeTransform[0][2] = value;
      },
      get y() {
        return this.relativeTransform[1][2];
      },
      set y(value: number) {
        this.relativeTransform[1][2] = value;
      },
      name: "Test",
      width: 100,
      height: 100,
      visible: true,
      opacity: 1,
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 100 },
      effects: [],
      fills: [],
      strokes: [],
      blendMode: "NORMAL",
      cornerRadius: 0,
      clipsContent: true,
      children: [],
      removed: false,
      clone() {
        const copy = frame();
        for (const child of this.children) copy.appendChild(child.clone());
        copy.data = { ...this.data };
        created.push(copy);
        figma.currentPage.appendChild(copy);
        return copy;
      },
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
      },
      appendChild(c: any) {
        if (c.parent?.children)
          c.parent.children = c.parent.children.filter((n: any) => n !== c);
        this.children.push(c);
        c.parent = this;
      },
      remove() {
        this.removed = true;
        if (this.parent?.children)
          this.parent.children = this.parent.children.filter(
            (n: any) => n !== this,
          );
        for (const c of [...this.children]) c.remove?.();
      },
      async exportAsync(options: any) {
        exports.push({ node: this, options });
        this.lastExportOptions = options;
        if (options.format === "PNG" && this.children?.[0]?.name === "Copy")
          this.backgroundTextOpacities = this.children[0].children.map(
            (n: any) => n.opacity,
          );
        if (paused) await pause;
        if (fail) throw Error("render failure");
        if (options.format === "SVG_STRING") {
          assert.equal(options.svgOutlineText, true);
          return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0H10V10Z"/></svg>';
        }
        if (
          wrappedEllipsis &&
          this.fills.length === 0 &&
          this.children[0]?.type === "TEXT"
        ) {
          const t = this.children[0];
          return encode({
            width: 1,
            height: 1,
            data: Uint8Array.from([
              0,
              0,
              0,
              t.width > 100 && t.characters === "ABC…" ? 255 : 0,
            ]),
          });
        }
        return new Uint8Array([1]);
      },
    };
    return f;
  }
  function text(): any {
    const t: any = {
      ...frame(),
      type: "TEXT",
      id: "t",
      name: "Label",
      characters: "ABC",
      textTruncation: "DISABLED",
      insertCharacters(at: number, value: string) {
        this.characters =
          this.characters.slice(0, at) + value + this.characters.slice(at);
      },
      deleteCharacters(start: number, end: number) {
        this.characters =
          this.characters.slice(0, start) + this.characters.slice(end);
      },
      hasMissingFont: false,
      fills: [{ type: "SOLID" }],
      clipsContent: false,
      absoluteTransform: [
        [1, 0, 10],
        [0, 1, 10],
      ],
      absoluteBoundingBox: { x: 10, y: 10, width: 40, height: 20 },
      absoluteRenderBounds: { x: 10, y: 10, width: 40, height: 20 },
      setRangeFills(start: number, end: number, fills: any[]) {
        this.rangePaints ??= [];
        this.rangePaints.push({ start, end, fills });
      },
      getRangeFontSize() {
        return wrappedEllipsis ? 12 : figma.mixed;
      },
      getStyledTextSegments() {
        return [
          {
            characters: this.characters,
            fontName: { family: "M PLUS 1p", style: "Regular" },
            fontWeight: 400,
            fills: [{ type: "SOLID" }],
          },
        ];
      },
      clone() {
        const c = text();
        c.opacity = this.opacity;
        c.width = this.width;
        c.height = this.height;
        c.textTruncation = this.textTruncation;
        c.maxLines = this.maxLines;
        c.textAutoResize = this.textAutoResize;
        c.characters = this.characters;
        c.fills = this.fills;
        c.getStyledTextSegments = this.getStyledTextSegments;
        c.absoluteTransform = this.absoluteTransform.map((row: number[]) => [
          ...row,
        ]);
        c.data = { ...this.data };
        created.push(c);
        figma.currentPage.appendChild(c);
        return c;
      },
      remove() {
        this.removed = true;
        if (this.parent?.children)
          this.parent.children = this.parent.children.filter(
            (n: any) => n !== this,
          );
      },
      async exportAsync(options: any) {
        exports.push({ node: this, options });
        this.lastExportOptions = options;
        if (!allowTextSVG)
          throw Error("Native frame must not export any text asset");
        if (options.format === "PNG")
          return encode({
            width: 1,
            height: 1,
            data: new Uint8Array([
              0,
              0,
              0,
              this.textTruncation === "ENDING" ||
              (allowTruncatedMatch &&
                !wrappedEllipsis &&
                this.characters === "ABC…")
                ? 255
                : 0,
            ]),
          });
        if (!allowTextSVG) throw Error("Native frame must not export text SVG");
        assert.deepEqual(JSON.parse(JSON.stringify(this.relativeTransform)), [
          [1, 0, 0],
          [0, 1, 0],
        ]);
        if (options.svgOutlineText)
          return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0H10V10Z"/></svg>';
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><text ${textSVGAttributes}>${this.textTruncation === "ENDING" ? "ABCD" : this.characters}</text></svg>`;
      },
    };
    delete t.children;
    return t;
  }
  const original = frame();
  if (withText) {
    const t = text();
    original.appendChild(t);
  }
  original.fills = [{ type: "SOLID" }];
  original.clone = () => {
    const c = frame();
    c.name = "Copy";
    for (const t of original.children) c.appendChild(t.clone());
    c.data = { ...original.data };
    created.push(c);
    figma.currentPage.appendChild(c);
    return c;
  };
  const figma: any = {
    mixed: Symbol(),
    async loadFontAsync() {
      fontLoads++;
    },
    currentPage: {
      type: "PAGE",
      selection: [original],
      children: [original],
      appendChild(c: any) {
        if (c.parent?.children)
          c.parent.children = c.parent.children.filter((n: any) => n !== c);
        this.children.push(c);
        c.parent = this;
      },
      findAllWithCriteria({ pluginData }: any) {
        const result: any[] = [];
        const visit = (n: any) => {
          if (
            pluginData.keys.some((key: string) => n.getPluginData(key) !== "")
          )
            result.push(n);
          for (const c of n.children ?? []) visit(c);
        };
        this.children.forEach(visit);
        return result;
      },
    },
    createImage() {
      return { hash: "flattened-image" };
    },
    createNodeFromSvg(svg: string) {
      assert.match(svg, /<path/);
      const node = frame();
      created.push(node);
      figma.currentPage.appendChild(node);
      return node;
    },
    viewport: {
      bounds: { x: -100, y: -50, width: 800, height: 600 },
      scrollAndZoomIntoView() {},
    },
    showUI() {},
    ui: {
      postMessage(m: any) {
        messages.push(m);
      },
    },
    on(name: string, fn: (...args: any[]) => any) {
      events[name] = fn;
    },
    clientStorage: {
      async getAsync() {
        return {};
      },
      async setAsync() {},
    },
    createFrame() {
      const f = frame();
      created.push(f);
      figma.currentPage.appendChild(f);
      return f;
    },
  };
  original.parent = figma.currentPage;
  const start = () =>
    vm.runInNewContext(code, {
      figma,
      __html__: "",
      Uint8Array,
      console,
      setTimeout,
      clearTimeout,
    });
  start();
  return {
    restart: start,
    figma,
    original,
    created,
    exports,
    messages,
    release,
    events,
    fontLoadCount: () => fontLoads,
    useWrappedEllipsis: () => {
      wrappedEllipsis = true;
    },
    rejectTruncatedPixels: () => {
      allowTruncatedMatch = false;
    },
    enableTextSVG: () => {
      allowTextSVG = true;
    },
    useScriptSVG: () => {
      textSVGAttributes = `style="font-feature-settings: 'sups' on"`;
    },
  };
}
export async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
}
