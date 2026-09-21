import { msg } from "../shared/messages";
import { useRef } from "react";
import { Help } from "./help";
import type { FontRowState, PluginUI } from "./use-plugin-ui";

function FontRow({ row, ui }: { row: FontRowState; ui: PluginUI }) {
  const input = useRef<HTMLInputElement>(null);
  const { t, busy } = ui;
  return (
    <div className="font">
      <div className="font-heading">
        <span
          className="font-name"
          title={`${row.font.family} ${row.font.style}`}
        >
          {row.font.family}
          <span className="font-style">{row.font.style}</span>
        </span>
        {row.error && !row.ready ? (
          <Help label={t(msg("fonts.downloadError"))}>{t(row.error)}</Help>
        ) : (
          <span
            className={`font-badge ${row.ready ? "ready" : row.pending ? "" : "missing"}`}
            aria-label={t(
              row.ready
                ? msg("fonts.ready")
                : row.pending
                  ? msg("fonts.fetching")
                  : msg("fonts.missing"),
            )}
            title={t(
              row.ready
                ? msg("fonts.ready")
                : row.pending
                  ? msg("fonts.fetching")
                  : msg("fonts.missing"),
            )}
          >
            {row.ready ? "✓" : row.pending ? "…" : "!"}
          </span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        className="file-input"
        accept=".ttf"
        disabled={busy}
        aria-label={`${row.font.family} ${row.font.style} TTF`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void ui.importFont(row.key, file);
        }}
      />
      <div className="font-controls">
        {row.ready ? (
          <>
            <label className="check" title={t(msg("fonts.saveDevice"))}>
              <input
                type="checkbox"
                aria-label={`${row.font.family} ${row.font.style}: ${t(msg("fonts.saveDevice"))}`}
                checked={row.saved}
                disabled={busy}
                onChange={(event) =>
                  ui.saveFont(row.key, event.currentTarget.checked)
                }
              />
              {t(msg("actions.save"))}
            </label>
            <button
              className="font-remove"
              aria-label={`${row.font.family} ${row.font.style}: ${t(msg("actions.remove"))}`}
              title={t(msg("actions.remove"))}
              disabled={busy}
              onClick={() => ui.removeFont(row.key)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
              </svg>
            </button>
          </>
        ) : (
          !row.pending && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {t(msg("fonts.addTtf"))}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export function FontSettings({ ui }: { ui: PluginUI }) {
  const input = useRef<HTMLInputElement>(null);
  const { t, busy, state, patch } = ui;
  return (
    <div id="pdf-options">
      <div className="options">
        <section className="font-section">
          <div className="section-heading">
            <div className="section-title">
              <span>{t(msg("fonts.pdfFonts"))}</span>
              <Help label={t(msg("fonts.addHelp"))}>
                {t(msg("fonts.addDescription"))}
                <br />
                {t(msg("fonts.privacy"))}
              </Help>
            </div>
            <button
              id="retry-fonts"
              className="quiet"
              disabled={ui.retryDisabled}
              onClick={ui.retryFonts}
            >
              {t(msg("actions.retry"))}
            </button>
          </div>
          <div id="font-status" className="muted" role="status">
            {ui.fontStatus}
          </div>
          <div
            id="fonts"
            role="region"
            aria-label={t(msg("fonts.pdfFonts"))}
            tabIndex={ui.fontRows.length ? 0 : undefined}
          >
            {ui.fontRows.length
              ? ui.fontRows.map((row) => (
                  <FontRow key={row.key} row={row} ui={ui} />
                ))
              : t(msg("fonts.noText"))}
          </div>
          <div className="font-import">
            <button
              id="add-fonts"
              className="secondary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {t(msg("fonts.addTtfPlus"))}
            </button>
            <input
              ref={input}
              id="bulk-fonts"
              className="file-input"
              type="file"
              accept=".ttf"
              multiple
              disabled={busy}
              aria-label={t(msg("fonts.addFiles"))}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void ui.importFonts(files);
              }}
            />
            <label className="check">
              <input
                id="bulk-save"
                type="checkbox"
                disabled={busy}
                checked={state.bulkSave}
                onChange={(event) =>
                  patch({ bulkSave: event.currentTarget.checked })
                }
              />
              {t(msg("fonts.saveOnAdd"))}
            </label>
          </div>
        </section>
        <section className="raster-section">
          <h2>{t(msg("text.handling"))}</h2>
          <div className="processing-row">
            <label className="check">
              <input
                type="checkbox"
                id="outline-fallback"
                checked={state.outlineFallback}
                disabled={busy || state.raster}
                onChange={(e) =>
                  patch({ outlineFallback: e.currentTarget.checked })
                }
              />
              <span>{t(msg("outlines.enable"))}</span>
            </label>
            <Help label={t(msg("outlines.help"))}>
              {t(msg("outlines.description"))}
            </Help>
          </div>
          <p id="outline-notice" hidden={!ui.needsOutline}>
            {t(msg("outlines.addFonts"))}
          </p>
          <div className="processing-row">
            <label id="rasterlabel" className="check">
              <input
                type="checkbox"
                id="raster"
                checked={state.raster}
                disabled={busy}
                onChange={(e) => patch({ raster: e.currentTarget.checked })}
              />
              <span>{t(msg("raster.enable"))}</span>
            </label>
            <Help label={t(msg("raster.help"))}>
              {t(msg("raster.warning"))}
            </Help>
          </div>
        </section>
      </div>
    </div>
  );
}
