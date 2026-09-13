import wasm from "harfbuzzjs/dist/harfbuzz-subset.wasm";

// Self-contained: serialized into a Blob worker by the UI bundle.
function subsetWorker() {
  const scope = self as unknown as {
    onmessage: (event: MessageEvent) => void;
    postMessage: (value: unknown, transfer?: Transferable[]) => void;
  };
  let initialized: Promise<WebAssembly.WebAssemblyInstantiatedSource>;
  scope.onmessage = async ({ data }) => {
    let hb: Record<string, any> | undefined;
    let buffer = 0,
      blob = 0,
      face = 0,
      input = 0,
      subset = 0,
      result = 0;
    try {
      initialized ??= WebAssembly.instantiate(data.wasm);
      hb = (await initialized).instance.exports;
      buffer = hb.malloc(data.font.byteLength);
      if (!buffer) throw Error("フォント処理用メモリを確保できません。");
      new Uint8Array(hb.memory.buffer).set(data.font, buffer);
      blob = hb.hb_blob_create(buffer, data.font.byteLength, 2, 0, 0);
      face = hb.hb_face_create(blob, 0);
      input = hb.hb_subset_input_create_or_fail();
      if (!input) throw Error("サブセット処理を初期化できません。");
      const unicodes = hb.hb_subset_input_unicode_set(input);
      for (const c of data.characters as string)
        hb.hb_set_add(unicodes, c.codePointAt(0));
      if (data.glyphs) {
        const glyphs = hb.hb_subset_input_glyph_set(input);
        for (const gid of data.glyphs) hb.hb_set_add(glyphs, gid);
        // The shaped PDF writer supplies an explicit CIDToGIDMap. Preserve its
        // original glyph IDs, including GSUB-only glyphs with no Unicode cmap.
        hb.hb_subset_input_set_flags(
          input,
          hb.hb_subset_input_get_flags(input) | 2,
        );
      }
      // Keep layout dependencies and hints; compact glyph IDs (no RETAIN_GIDS).
      const features = hb.hb_subset_input_set(input, 6);
      hb.hb_set_clear(features);
      hb.hb_set_invert(features);
      subset = hb.hb_subset_or_fail(face, input);
      if (!subset) throw Error("フォントのサブセット作成に失敗しました。");
      result = hb.hb_face_reference_blob(subset);
      const offset = hb.hb_blob_get_data(result, 0);
      const length = hb.hb_blob_get_length(result);
      if (!length) throw Error("サブセットが空です。");
      const bytes = new Uint8Array(hb.memory.buffer, offset, length).slice();
      scope.postMessage({ bytes }, [bytes.buffer]);
    } catch (e) {
      scope.postMessage({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (hb) {
        if (result) hb.hb_blob_destroy(result);
        if (subset) hb.hb_face_destroy(subset);
        if (input) hb.hb_subset_input_destroy(input);
        if (face) hb.hb_face_destroy(face);
        if (blob) hb.hb_blob_destroy(blob);
        if (buffer) hb.free(buffer);
      }
    }
  };
}

/** One worker per PDF, fonts processed sequentially. Originals are never transferred. */
export function createFontSubsetter(check = () => {}, timeoutMs = 15000) {
  let worker: Worker | undefined;
  const dispose = () => {
    worker?.terminate();
    worker = undefined;
  };
  return {
    dispose,
    async subset(
      font: Uint8Array,
      characters: string,
      glyphs?: number[],
    ): Promise<Uint8Array> {
      check();
      const first = !worker;
      if (!worker) {
        const url = URL.createObjectURL(
          new Blob([`(${subsetWorker.toString()})();`], {
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
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        let finished = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (error?: unknown, bytes?: Uint8Array) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          active.onmessage = active.onerror = active.onmessageerror = null;
          if (error) {
            dispose();
            reject(error);
          } else resolve(bytes!);
        };
        const verify = () => {
          check();
          if (Date.now() >= deadline)
            throw Error("フォントの軽量化が15秒以内に完了しませんでした。");
        };
        const poll = () => {
          try {
            verify();
          } catch (e) {
            finish(e);
            return;
          }
          timer = setTimeout(
            poll,
            Math.max(1, Math.min(100, deadline - Date.now())),
          );
        };
        active.onmessage = ({ data }) => {
          try {
            verify();
            if (data.error) throw Error(data.error);
            if (!(data.bytes instanceof Uint8Array) || !data.bytes.length)
              throw Error("サブセットの応答が不正です。");
            finish(undefined, data.bytes);
          } catch (e) {
            finish(e);
          }
        };
        active.onerror = (event) => {
          event.preventDefault();
          finish(Error(event.message || "フォント処理を実行できません。"));
        };
        active.onmessageerror = () =>
          finish(Error("フォント処理の応答を読み取れません。"));
        poll();
        if (!finished) {
          try {
            active.postMessage({
              font,
              characters,
              glyphs,
              wasm: first ? wasm : undefined,
            });
          } catch (e) {
            finish(e);
          }
        }
      });
    },
  };
}
