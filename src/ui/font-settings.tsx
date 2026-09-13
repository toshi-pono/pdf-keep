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
          <Help label={t("フォントの取得エラー")}>{t(row.error)}</Help>
        ) : (
          <span
            className={`font-badge ${row.ready ? "ready" : row.pending ? "" : "missing"}`}
            aria-label={t(
              row.ready ? "✓ 準備完了" : row.pending ? "取得中…" : "未取得",
            )}
            title={t(
              row.ready ? "✓ 準備完了" : row.pending ? "取得中…" : "未取得",
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
            <label className="check" title={t("この端末に保存")}>
              <input
                type="checkbox"
                aria-label={`${row.font.family} ${row.font.style}: ${t("この端末に保存")}`}
                checked={row.saved}
                disabled={busy}
                onChange={(event) =>
                  ui.saveFont(row.key, event.currentTarget.checked)
                }
              />
              {t("保存")}
            </label>
            <button
              className="font-remove"
              aria-label={`${row.font.family} ${row.font.style}: ${t("削除")}`}
              title={t("削除")}
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
              {t("TTF を追加")}
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
              <span>{t("PDF のフォント")}</span>
              <Help label={t("フォントの追加について")}>
                {t(
                  "Google Fonts は自動取得します。その他のフォントは TTF を追加してください。",
                )}
                <br />
                {t("Google への送信はフォント名・スタイルのみ。")}
              </Help>
            </div>
            <button
              id="retry-fonts"
              className="quiet"
              disabled={ui.retryDisabled}
              onClick={ui.retryFonts}
            >
              {t("再取得")}
            </button>
          </div>
          <div id="font-status" className="muted" role="status">
            {ui.fontStatus}
          </div>
          <div
            id="fonts"
            role="region"
            aria-label={t("PDF のフォント")}
            tabIndex={ui.fontRows.length ? 0 : undefined}
          >
            {ui.fontRows.length
              ? ui.fontRows.map((row) => (
                  <FontRow key={row.key} row={row} ui={ui} />
                ))
              : t("文字レイヤーはありません。")}
          </div>
          <div className="font-import">
            <button
              id="add-fonts"
              className="secondary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {t("＋ TTF を追加")}
            </button>
            <input
              ref={input}
              id="bulk-fonts"
              className="file-input"
              type="file"
              accept=".ttf"
              multiple
              disabled={busy}
              aria-label={t("TTF をまとめて追加")}
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
              {t("追加時にこの端末へ保存")}
            </label>
          </div>
        </section>
        <section className="raster-section">
          <h2>{t("文字の処理")}</h2>
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
              <span>{t("未対応の文字はアウトラインで PDF 出力")}</span>
            </label>
            <Help label={t("アウトラインについて")}>
              {t(
                "再現できない範囲だけをアウトラインにします。その範囲以外の文字は検索・コピーできます。",
              )}
            </Help>
          </div>
          <p id="outline-notice" hidden={!ui.needsOutline}>
            {t(
              "再現できない範囲だけをアウトラインで保持します。フォントを追加するとコピー可能な文字が増えます。",
            )}
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
              <span>{t("全文字を画像化する")}</span>
            </label>
            <Help label={t("画像化について")}>
              {t("文字の検索・コピーはできなくなります。")}
            </Help>
          </div>
        </section>
      </div>
    </div>
  );
}
