import {
  type Message,
  msg,
  joinMessages,
  uniqueMessages,
} from "../shared/messages";
import { AppError, errorMessage } from "../shared/errors";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatMessage } from "./i18n";
import { isLanguage, type Language } from "../i18n/languages";
import {
  createPDF,
  registry,
  registerFont,
  registerAutomatic,
} from "../pdf/create-pdf";
import {
  estimatePDFSize,
  formatBytes,
  formatSizeRange,
  type ImageSizeSample,
} from "../shared/size-estimate";
import {
  blocks,
  fontKey,
  type PluginMessage,
  type UIMessage,
  type TextRangeRequest,
  type TextRangeResult,
} from "../shared/protocol";
import {
  rasterDimensions,
  resolveScale,
  printResolution,
  type QualityPreset,
  type PaperSize,
  type Orientation,
} from "../shared/resolution";

import { downloadPDF } from "./save-pdf";

type Selection = Extract<PluginMessage, { type: "selection" }>;
interface UIState {
  selection: Selection | null;
  job: number | null;
  scale: string;
  quality: QualityPreset | "manual";
  paper: PaperSize;
  orientation: Orientation;
  longEdge: string;
  raster: boolean;
  outlineFallback: boolean;
  bulkSave: boolean;
  status: Message[];
  noticeKind: "info" | "success" | "error";
  warnings: Message[];
  download: {
    url: string;
    name: string;
    size: string;
    diagnostics: Selection["diagnostics"];
  } | null;
  sample: ImageSizeSample | null;
}
const send = (message: UIMessage) =>
  parent.postMessage({ pluginMessage: message }, "*");

export function usePluginUI() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage as Language;
  const manuallySelectedLanguage = useRef(false);
  function changeLanguage(value: unknown) {
    if (!isLanguage(value)) return;
    manuallySelectedLanguage.current = true;
    void i18n.changeLanguage(value);
    send({ type: "language-save", language: value });
  }
  const [state, setState] = useState<UIState>(() => ({
    selection: null,
    job: null,
    scale: "1",
    quality: "medium",
    paper: "A4",
    orientation: "portrait",
    longEdge: "4096",
    raster: false,
    outlineFallback: true,
    bulkSave: false,
    status: [],
    noticeKind: "info",
    warnings: [],
    download: null,
    sample: null,
  }));
  // Async Figma/font/PDF callbacks must observe the current job immediately,
  // including cancellation before React commits its next render.
  const current = useRef(state);
  const active = useRef(true);
  const serial = useRef(0);
  const jobSelection = useRef<Selection | null>(null);
  const rangeSerial = useRef(0);
  const processingBundle = useRef<number | null>(null);
  const ranges = useRef(
    new Map<
      number,
      {
        id: number;
        resolve: (r: TextRangeResult) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const clearRanges = (id?: number) => {
    for (const [key, pending] of ranges.current)
      if (id === undefined || pending.id === id) {
        clearTimeout(pending.timer);
        ranges.current.delete(key);
        pending.reject(new AppError(msg("operation.cancelled")));
      }
  };
  const resolveRange = (id: number, range: TextRangeRequest) =>
    new Promise<TextRangeResult>((resolve, reject) => {
      check(id);
      const requestId = ++rangeSerial.current;
      const timer = setTimeout(() => {
        ranges.current.delete(requestId);
        reject(new AppError(msg("errors.rangeTimeout")));
      }, 60000);
      ranges.current.set(requestId, { id, resolve, reject, timer });
      send({ type: "text-range", id, requestId, range });
    });
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const persisted = useRef(new Set<string>());
  const requests = useRef(new Set<string>());
  const fontErrors = useRef(new Map<string, Message>());
  const patch = useCallback((change: Partial<UIState>) => {
    if (!active.current) return;
    const changedOutput = (
      [
        "scale",
        "longEdge",
        "quality",
        "paper",
        "orientation",
        "raster",
        "outlineFallback",
      ] as const
    ).some(
      (key) =>
        change[key] !== undefined && change[key] !== current.current[key],
    );
    if (changedOutput && current.current.download) {
      URL.revokeObjectURL(current.current.download.url);
      change = {
        ...change,
        download: null,
        warnings: [],
        status: [],
        noticeKind: "info",
      };
    }
    current.current = { ...current.current, ...change };
    setState(current.current);
  }, []);
  const status = (
    message: Message,
    noticeKind: UIState["noticeKind"] = "info",
  ) => patch({ status: [message], noticeKind });
  const clearResult = () => {
    if (current.current.download)
      URL.revokeObjectURL(current.current.download.url);
    patch({ download: null, warnings: [], status: [], noticeKind: "info" });
  };
  const requestFonts = () => {
    for (const font of current.current.selection?.fonts ?? []) {
      const key = fontKey(font);
      if (
        registry.has(key) ||
        requests.current.has(key) ||
        fontErrors.current.has(key)
      )
        continue;
      requests.current.add(key);
      send({ type: "google-font", font });
    }
  };
  const check = (id: number) => {
    if (!active.current || current.current.job !== id)
      throw new AppError(msg("operation.cancelled"));
  };
  async function receive(event: MessageEvent) {
    const m = event.data?.pluginMessage as PluginMessage;
    // Figma relays messages with a null source in its sandbox.
    if (!m || typeof m.type !== "string" || !active.current) return;
    if (m.type === "language-settings") {
      if (!manuallySelectedLanguage.current && isLanguage(m.language))
        void i18n.changeLanguage(m.language);
      return;
    }
    if (m.type === "text-range-result") {
      const pending = ranges.current.get(m.requestId);
      if (pending && pending.id === m.id && current.current.job === m.id) {
        clearTimeout(pending.timer);
        ranges.current.delete(m.requestId);
        if (m.result) pending.resolve(m.result);
        else
          pending.reject(
            new AppError(m.error || msg("errors.outlineUnavailable")),
          );
      }
      return;
    }
    if (m.type === "selection") {
      clearResult();
      patch({ selection: m, sample: null });
      clearTimeout(previewTimer.current);
      if (m.valid && typeof m.revision === "number") {
        previewTimer.current = setTimeout(() => {
          if (
            active.current &&
            current.current.selection === m &&
            current.current.job === null
          )
            send({ type: "estimate-preview", revision: m.revision! });
        }, 250);
      }
      requestFonts();
      patch({});
    }
    if (
      m.type === "estimate-preview" &&
      m.revision === current.current.selection?.revision
    ) {
      if (m.pixels && m.bytes)
        patch({ sample: { pixels: m.pixels, bytes: m.bytes } });
    }
    if (m.type === "google-font-result") {
      requests.current.delete(m.key);
      try {
        if (!registry.has(m.key)) {
          if (!m.bytes)
            throw new AppError(m.error || msg("errors.googleFontFetch"));
          clearResult();
          registerFont(m.key, new Uint8Array(m.bytes));
        }
        fontErrors.current.delete(m.key);
      } catch (error) {
        fontErrors.current.set(m.key, errorMessage(error));
      }
      patch({});
    }
    if (m.type === "saved-fonts") {
      for (const [key, bytes] of Object.entries(m.fonts)) {
        try {
          if (!registry.has(key)) {
            clearResult();
            registerFont(key, new Uint8Array(bytes));
          }
          persisted.current.add(key);
        } catch {
          status(msg("fonts.someSavedUnavailable"));
        }
      }
      patch({});
    }
    if (m.type === "frame-created" && m.id === current.current.job) {
      patch({
        job: null,
        noticeKind: "success",
        status: [msg("export.frameCreated", { name: m.name })],
      });
    }
    if (m.type === "storage-error") status(m.message, "error");
    if (m.type === "progress" && m.id === current.current.job)
      status(m.message);
    if (m.type === "error" && m.id === current.current.job)
      patch({ status: [m.message], noticeKind: "error", job: null });
    if (m.type === "bundle" && m.bundle.id === current.current.job) {
      const id = m.bundle.id;
      if (processingBundle.current === id) return;
      processingBundle.current = id;
      let outputMode = m.bundle.mode;
      let summary: { copied: number; outlined: number } | undefined;
      try {
        status(msg("progress.embeddingFonts"));
        const warnings: Message[] = [];
        const bytes = await createPDF(m.bundle, () => check(id), {
          progress: (message) => {
            if (current.current.job === id) status(message);
          },
          warning: (message) => warnings.push(message),
          resolveRange: (range) => resolveRange(id, range),
          textSummary: (value) => {
            summary = value;
            if (!value.copied && value.outlined) outputMode = "outline";
          },
          outlined: () => {
            outputMode = "outline";
          },
        });
        check(id);
        clearResult();
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer], { type: "application/pdf" }),
        );
        const name =
          (m.bundle.name
            .replace(
              // Strip control characters from downloaded filenames.
              // eslint-disable-next-line no-control-regex
              /[\\/:*?"<>|\x00-\x1f]/g,
              "_",
            )
            .slice(0, 120) || "figure") +
          (outputMode === "raster"
            ? "-raster"
            : outputMode === "outline"
              ? "-outlined"
              : "") +
          ".pdf";
        const file = {
          url,
          name,
          size: formatBytes(bytes.byteLength),
          diagnostics: jobSelection.current?.diagnostics ?? [],
        };
        const notices = [
          ...(outputMode === "raster" || outputMode === "outline"
            ? [msg("raster.warning")]
            : []),
          ...(summary?.outlined && summary.copied
            ? [msg("outlines.partialResult")]
            : []),
          ...warnings,
        ];
        patch({
          download: file,
          warnings: uniqueMessages(notices),
          noticeKind: "success",
          status: [msg("export.downloadStarted")],
        });
        try {
          downloadPDF(file);
        } catch {
          // Keep a real, user-clickable link if the host rejects automatic download.
          status(msg("export.ready"), "info");
        }
      } catch (error) {
        if (current.current.job === id)
          status(
            joinMessages([errorMessage(error), msg("export.retryRaster")]),
            "error",
          );
      } finally {
        if (processingBundle.current === id) processingBundle.current = null;
        clearRanges(id);
        if (m.bundle.protocol === 2) send({ type: "export-finished", id });
        if (current.current.job === id) patch({ job: null });
      }
    }
  }
  useLayoutEffect(() => {
    active.current = true;
    window.addEventListener("message", receive);
    send({ type: "inspect" });
    send({ type: "language-load" });
    return () => {
      active.current = false;
      window.removeEventListener("message", receive);
      clearTimeout(previewTimer.current);
      clearRanges();
      if (current.current.job !== null)
        send({ type: "cancel", id: current.current.job });
      if (current.current.download)
        URL.revokeObjectURL(current.current.download.url);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function saveFont(key: string, save: boolean) {
    if (save) {
      const font = registry.get(key);
      if (font) {
        persisted.current.add(key);
        send({ type: "font-save", key, bytes: Array.from(font.bytes) });
      }
    } else {
      persisted.current.delete(key);
      send({ type: "font-delete", key });
    }
    patch({});
  }
  async function importFont(key: string, file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!active.current) return;
      clearResult();
      registerFont(key, bytes);
      if (persisted.current.has(key)) saveFont(key, true);
      status(msg("fonts.registered"));
    } catch (error) {
      status(errorMessage(error), "error");
    }
    patch({});
  }
  async function importFonts(files: File[]) {
    let count = 0;
    const errors: Message[] = [];
    const save = current.current.bulkSave;
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!active.current) return;
        clearResult();
        const keys = registerAutomatic(bytes);
        count++;
        if (save) for (const key of keys) saveFont(key, true);
      } catch (error) {
        errors.push(joinMessages([`${file.name}: `, errorMessage(error)], ""));
      }
    }
    status(
      joinMessages([msg("fonts.added", { count }), ...errors]),
      errors.length ? "error" : "info",
    );
  }
  function retryFonts() {
    fontErrors.current.clear();
    requestFonts();
    patch({});
  }
  const translate = (message: Message) => formatMessage(message, i18n);
  const selection = state.selection;
  const fonts = selection?.fonts ?? [];
  const missingFonts = fonts.filter((font) => !registry.has(fontKey(font)));
  const missing = missingFonts.length;
  // A normal pending fetch is not a missing-font warning. Report only fonts
  // that remain unavailable after fetching (or were removed by the user).
  const unavailable = missingFonts.filter(
    (font) => !requests.current.has(fontKey(font)),
  ).length;
  const fontWarning = unavailable
    ? translate(msg("fonts.manualCount", { count: unavailable }))
    : "";
  const busy = state.job !== null;
  const canOutline = state.outlineFallback && !state.raster;
  const needsOutline =
    canOutline &&
    !!selection &&
    (unavailable > 0 || selection.diagnostics.some((d) => blocks(d, "pdf")));
  const resolution = (s: UIState, destination: "pdf" | "frame") => {
    if (s.quality !== "manual") {
      if (!s.selection?.width || !s.selection.height) return { scale: 0 };
      const result = printResolution(
        s.selection.width,
        s.selection.height,
        s.quality,
        s.paper,
        s.orientation,
        destination,
      );
      return { scale: 0, longEdge: result.longEdge };
    }
    return s.scale === "custom"
      ? { scale: 0, longEdge: s.longEdge === "" ? NaN : Number(s.longEdge) }
      : {
          scale:
            s.scale === "" || Number(s.scale) === 0 ? NaN : Number(s.scale),
        };
  };
  const getScale = (destination: "pdf" | "frame") =>
    resolveScale(
      selection!.width!,
      selection!.height!,
      resolution(state, destination).scale,
      destination,
      resolution(state, destination).longEdge,
    );
  const sizeError = (destination: "pdf" | "frame") => {
    if (!selection?.width || !selection.height) return "";
    try {
      getScale(destination);
      return "";
    } catch (error) {
      return translate(errorMessage(error));
    }
  };
  const errorPDF = sizeError("pdf"),
    errorFrame = sizeError("frame");
  const pdfDisabled =
    busy ||
    !selection?.valid ||
    !!errorPDF ||
    (!state.raster &&
      !canOutline &&
      (missing > 0 || selection.diagnostics.some((d) => blocks(d, "pdf"))));
  const frameDisabled =
    busy ||
    !selection?.valid ||
    !!errorFrame ||
    (!state.raster && selection.diagnostics.some((d) => blocks(d, "frame")));
  let scaleHint = translate(msg("quality.autoFrame"));
  let qualityLimited = false;
  let sizeLabel = "",
    sizeNote = "";
  if (selection?.width && selection.height) {
    if (errorPDF) scaleHint = "";
    else {
      const scale = getScale("pdf");
      const pixels = rasterDimensions(selection.width, selection.height, scale);
      if (state.quality !== "manual")
        qualityLimited = printResolution(
          selection.width,
          selection.height,
          state.quality,
          state.paper,
          state.orientation,
        ).limited;
      scaleHint = `${pixels.width} × ${pixels.height} px`;
      if (selection.valid) {
        const fontSizes = state.raster
          ? []
          : fonts.map((f) => {
              const font = registry.get(fontKey(f));
              return {
                characters: f.characters,
                bytes: font?.bytes.length,
                glyphs: font?.parsed.numGlyphs,
              };
            });
        const estimate = estimatePDFSize(
          pixels.width * pixels.height,
          fontSizes,
          state.sample,
        )!;
        sizeLabel = translate(
          msg("estimate.size", {
            size: formatSizeRange(estimate.low, estimate.high),
          }),
        );
        sizeNote = translate(
          needsOutline
            ? msg("estimate.outlines")
            : estimate.sampled
              ? msg("estimate.sampled")
              : msg("estimate.rough"),
        );
      }
    }
  }
  function start(destination: "pdf" | "frame") {
    if (
      current.current.job !== null ||
      (destination === "pdf" ? pdfDisabled : frameDisabled)
    )
      return;
    const s = current.current;
    jobSelection.current = s.selection;
    clearResult();
    const id = ++serial.current;
    patch({
      job: id,
      status: [
        destination === "pdf"
          ? msg("progress.exportStarting")
          : msg("progress.creatingFrame"),
      ],
    });
    send({
      type: destination === "pdf" ? "export" : "create-frame",
      id,
      ...resolution(s, destination),
      mode: s.raster ? "raster" : "text",
      ...(destination === "pdf"
        ? {
            protocol: 2,
            outlineFallback: s.outlineFallback,
            revision: s.selection?.revision,
          }
        : {}),
    });
  }
  return {
    state,
    patch,
    t: translate,
    language,
    changeLanguage,
    busy,
    canOutline,
    needsOutline,
    pdfDisabled,
    frameDisabled,
    scaleHint,
    qualityLimited,
    resolutionError: errorPDF || (errorFrame ? `Frame: ${errorFrame}` : ""),
    sizeLabel,
    sizeNote,
    fontWarning,
    fontStatus: translate(
      missing
        ? missingFonts.some((f) => requests.current.has(fontKey(f)))
          ? msg("progress.fetchingFonts")
          : msg("fonts.manualCount", { count: missing })
        : msg("fonts.allReady"),
    ),
    fontRows: fonts.map((font) => ({
      font,
      key: fontKey(font),
      ready: registry.has(fontKey(font)),
      pending: requests.current.has(fontKey(font)),
      saved: persisted.current.has(fontKey(font)),
      error: fontErrors.current.get(fontKey(font)),
    })),
    retryDisabled: busy || requests.current.size > 0,
    start,
    retryFonts,
    importFont,
    importFonts,
    saveFont,
    removeFont: (key: string) => {
      clearResult();
      registry.delete(key);
      saveFont(key, false);
    },
    refresh: () => {
      clearResult();
      retryFonts();
      send({ type: "inspect" });
    },
    cancel: () => {
      clearRanges();
      if (current.current.job !== null)
        send({ type: "cancel", id: current.current.job });
      patch({
        job: null,
        noticeKind: "info",
        status: [msg("operation.cancelCleanup")],
      });
    },
  };
}
export type PluginUI = ReturnType<typeof usePluginUI>;
export type FontRowState = PluginUI["fontRows"][number];
