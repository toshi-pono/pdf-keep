// The Figma sandbox lacks Encoding API globals; the polyfill exports them in
// environments without window/global. Initialize before loading the PNG decoder.
import * as encoding from "fast-text-encoding";
const polyfill = encoding as unknown as {
  TextEncoder: typeof TextEncoder;
  TextDecoder: typeof TextDecoder;
};
globalThis.TextEncoder ??= polyfill.TextEncoder;
globalThis.TextDecoder ??= class {
  private decoder?: TextDecoder;
  constructor(label = "utf-8") {
    if (!["latin1", "ascii"].includes(label))
      this.decoder = new polyfill.TextDecoder(label);
  }
  decode(input: ArrayBuffer | ArrayBufferView = new Uint8Array()) {
    if (this.decoder) return this.decoder.decode(input);
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return text;
  }
} as unknown as typeof TextDecoder;
