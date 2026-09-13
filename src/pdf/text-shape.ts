import { measure } from "../shared/performance";
import wasm from "harfbuzzjs/dist/harfbuzz.wasm";
export interface ShapedGlyph {
  gid: number;
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}
export interface ShapedText {
  glyphs: ShapedGlyph[];
  unitsPerEm: number;
}
function shapeWorker() {
  const scope = self as unknown as {
    onmessage: (e: MessageEvent) => void;
    postMessage: (v: unknown) => void;
  };
  let hb: Record<string, any>;
  const fonts = new Map<
    string,
    { memory: number; blob: number; face: number; font: number }
  >();
  scope.onmessage = async ({ data }) => {
    let buffer = 0,
      input = 0,
      features = 0;
    try {
      if (!hb) {
        const fail = () => {
          throw Error("文字組み用 WASM を実行できません。");
        };
        const module = await WebAssembly.instantiate(data.wasm, {
          wasi_snapshot_preview1: { proc_exit: fail },
          env: {
            _abort_js: fail,
            _emscripten_runtime_keepalive_clear: () => {},
            _setitimer_js: () => 0,
            emscripten_resize_heap: (size: number) => {
              try {
                hb.memory.grow(
                  Math.ceil((size - hb.memory.buffer.byteLength) / 65536),
                );
                return 1;
              } catch {
                return 0;
              }
            },
          },
        });
        hb = module.instance.exports;
      }
      let cached = fonts.get(data.key);
      if (!cached) {
        const memory = hb.malloc(data.font.length);
        new Uint8Array(hb.memory.buffer).set(data.font, memory);
        const blob = hb.hb_blob_create(memory, data.font.length, 2, 0, 0),
          face = hb.hb_face_create(blob, 0),
          font = hb.hb_font_create(face);
        cached = { memory, blob, face, font };
        fonts.set(data.key, cached);
      }
      buffer = hb.hb_buffer_create();
      input = hb.malloc(Math.max(2, data.text.length * 2));
      const chars = new Uint16Array(hb.memory.buffer, input, data.text.length);
      for (let i = 0; i < data.text.length; i++)
        chars[i] = data.text.charCodeAt(i);
      hb.hb_buffer_add_utf16(
        buffer,
        input,
        data.text.length,
        0,
        data.text.length,
      );
      hb.hb_buffer_set_cluster_level(buffer, 0);
      hb.hb_buffer_guess_segment_properties(buffer);
      const entries = Object.entries(
        data.features as Record<string, boolean>,
      ).filter(([tag]) => /^[a-z0-9]{4}$/.test(tag));
      features = hb.malloc(Math.max(16, entries.length * 16));
      const values = new Uint32Array(
        hb.memory.buffer,
        features,
        entries.length * 4,
      );
      entries.forEach(([tag, enabled], i) => {
        values[i * 4] =
          ((tag.charCodeAt(0) << 24) |
            (tag.charCodeAt(1) << 16) |
            (tag.charCodeAt(2) << 8) |
            tag.charCodeAt(3)) >>>
          0;
        values[i * 4 + 1] = enabled ? 1 : 0;
        values[i * 4 + 2] = 0;
        values[i * 4 + 3] = 0xffffffff;
      });
      hb.hb_shape(cached.font, buffer, features, entries.length);
      const count = hb.hb_buffer_get_length(buffer),
        info = hb.hb_buffer_get_glyph_infos(buffer, 0),
        pos = hb.hb_buffer_get_glyph_positions(buffer, 0);
      const view = new DataView(hb.memory.buffer),
        glyphs = [];
      for (let i = 0; i < count; i++)
        glyphs.push({
          gid: view.getUint32(info + i * 20, true),
          cluster: view.getUint32(info + i * 20 + 8, true),
          xAdvance: view.getInt32(pos + i * 20, true),
          yAdvance: view.getInt32(pos + i * 20 + 4, true),
          xOffset: view.getInt32(pos + i * 20 + 8, true),
          yOffset: view.getInt32(pos + i * 20 + 12, true),
        });
      scope.postMessage({
        glyphs,
        unitsPerEm: hb.hb_face_get_upem(cached.face),
      });
    } catch (e) {
      scope.postMessage({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (hb) {
        if (features) hb.free(features);
        if (input) hb.free(input);
        if (buffer) hb.hb_buffer_destroy(buffer);
      }
    }
  };
}
export function createTextShaper(check = () => {}, timeoutMs = 15000) {
  let worker: Worker | undefined;
  const sent = new Set<string>();
  const results = new Map<string, ShapedText>();
  const dispose = () => {
    worker?.terminate();
    worker = undefined;
    sent.clear();
    results.clear();
  };
  return {
    dispose,
    async shape(
      key: string,
      font: Uint8Array,
      text: string,
      features: Record<string, boolean> = {},
    ): Promise<ShapedText> {
      check();
      const cacheKey = JSON.stringify([
        key,
        text,
        Object.entries(features).sort(([a], [b]) => a.localeCompare(b)),
      ]);
      const cached = results.get(cacheKey);
      if (cached) return cached;
      const first = !worker;
      if (!worker) {
        const url = URL.createObjectURL(
          new Blob([`(${shapeWorker.toString()})();`], {
            type: "text/javascript",
          }),
        );
        try {
          worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const active = worker;
      return measure(
        "shape",
        () =>
          new Promise<ShapedText>((resolve, reject) => {
            let finished = false,
              timer: ReturnType<typeof setTimeout>;
            const deadline = Date.now() + timeoutMs;
            const finish = (error?: unknown, value?: ShapedText) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              active.onmessage = active.onerror = active.onmessageerror = null;
              if (error) {
                dispose();
                reject(error);
              } else {
                results.set(cacheKey, value!);
                resolve(value!);
              }
            };
            const poll = () => {
              try {
                check();
                if (Date.now() > deadline)
                  throw Error("文字組みが制限時間内に完了しませんでした。");
              } catch (e) {
                finish(e);
                return;
              }
              timer = setTimeout(poll, 100);
            };
            active.onmessage = ({ data }) => {
              try {
                check();
                if (data.error) throw Error(data.error);
                if (!Array.isArray(data.glyphs) || !data.unitsPerEm)
                  throw Error("文字組みの応答が不正です。");
                finish(undefined, data);
              } catch (e) {
                finish(e);
              }
            };
            active.onerror = (e) => {
              e.preventDefault();
              finish(Error(e.message));
            };
            active.onmessageerror = () =>
              finish(Error("文字組みの応答が不正です。"));
            poll();
            if (!finished) {
              active.postMessage({
                key,
                font: sent.has(key) ? undefined : font,
                text,
                features,
                wasm: first ? wasm : undefined,
              });
              sent.add(key);
            }
          }),
      );
    },
  };
}
