export type Mode = "text" | "raster" | "outline";
export interface FontSpec {
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  characters: string;
}
export interface Diagnostic {
  severity?: "warning" | "error";
  destination?: "pdf";
  nodeId: string;
  name: string;
  reason: string;
}
export interface TextAsset {
  source?: {
    key: string;
    characters: string;
    segments: TextSegment[];
    fallbackReason?: string;
    composition?: boolean;
  };
  /** Local text coordinates to the exported frame: a, b, c, d. */
  transform?: [number, number, number, number];
  /** Text-node opacity, separate from the per-run paint alpha in the SVG. */
  opacity?: number;
  /** Native Figma vector glyphs for list/script formatting; no embedded text. */
  outlined?: boolean;
  /** Explicit truncation viewport; ordinary text can paint outside its box. */
  clipContent?: boolean;
  svg: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: FontSpec[];
  name: string;
}
export interface TextSegment {
  start: number;
  end: number;
  font: FontSpec;
  fontSize: number;
  features: Record<string, boolean>;
  fills?: unknown[];
  fallbackReason?: string;
  invisible?: boolean;
  list: "NONE" | "ORDERED" | "UNORDERED";
  indentation: number;
  paragraphIndent: number;
  paragraphSpacing: number;
  listSpacing: number;
}
export interface TextRangeRequest {
  key: string;
  start?: number;
  end?: number;
  format: "svg" | "pdf";
}
export interface TextRangeResult {
  svg?: string;
  pdf?: Uint8Array;
  /** Ancestor clipping/compositing requires a full-frame overlay. */
  fullFrame?: boolean;
}
export interface ExportBundle {
  protocol?: 2;
  outlineFallback?: boolean;
  id: number;
  name: string;
  width: number;
  height: number;
  scale: number;
  mode: Mode;
  png: Uint8Array;
  /** Transparent, full-frame PDF containing outlined text only. */
  outlinePDF?: Uint8Array;
  outlineError?: string;
  texts: TextAsset[];
}
export type UIMessage =
  | { type: "inspect" }
  | { type: "estimate-preview"; revision: number }
  | { type: "google-font"; font: FontSpec }
  | {
      type: "export" | "create-frame";
      id: number;
      mode: Mode;
      scale: number;
      longEdge?: number;
      outlineFallback?: boolean;
      revision?: number;
      protocol?: 2;
    }
  | { type: "cancel"; id: number }
  | {
      type: "text-range";
      id: number;
      requestId: number;
      range: TextRangeRequest;
    }
  | { type: "export-finished"; id: number }
  | { type: "font-save"; key: string; bytes: number[] }
  | { type: "font-delete"; key: string };
export type PluginMessage =
  | {
      type: "text-range-result";
      id: number;
      requestId: number;
      result?: TextRangeResult;
      error?: string;
    }
  | {
      type: "selection";
      revision?: number;
      name: string;
      valid: boolean;
      width?: number;
      height?: number;
      fonts: FontSpec[];
      diagnostics: Diagnostic[];
    }
  | {
      type: "google-font-result";
      key: string;
      bytes?: number[];
      error?: string;
    }
  | {
      type: "estimate-preview";
      revision: number;
      pixels?: number;
      bytes?: number;
    }
  | { type: "bundle"; bundle: ExportBundle }
  | { type: "frame-created"; id: number; name: string }
  | { type: "error"; id: number; message: string }
  | { type: "progress"; id: number; message: string }
  | { type: "saved-fonts"; fonts: Record<string, number[]> }
  | { type: "storage-error"; message: string };
export const fontKey = (f: Pick<FontSpec, "family" | "style">) =>
  JSON.stringify([f.family, f.style]);
export function blocks(d: Diagnostic, destination: "pdf" | "frame") {
  return (
    d.severity !== "warning" &&
    (!d.destination || d.destination === destination)
  );
}
