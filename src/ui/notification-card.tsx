import { blocks } from "../shared/protocol";
import type { PluginUI } from "./use-plugin-ui";

export function NotificationCard({ ui }: { ui: PluginUI }) {
  const { state, t } = ui;
  const diagnostics = (
    state.download?.diagnostics ??
    state.selection?.diagnostics ??
    []
  ).map((d) => {
    const outlined = ui.canOutline && blocks(d, "pdf");
    return `${t(outlined ? "PDF: 該当範囲をアウトラインで保持" : d.severity === "warning" ? "警告（変換可能）" : "エラー")} · ${d.nodeId ? d.name : t(d.name)}: ${t(d.reason)}`;
  });
  const messages = state.status.map(t);
  const hasStatus = messages.length > 0;
  const statusText = messages.join("");
  const items = [
    ...new Set([
      ...diagnostics,
      ...state.warnings.map(t),
      ...(!state.download && ui.resolutionError ? [ui.resolutionError] : []),
      ...(!state.download && !state.raster && ui.fontWarning
        ? [ui.fontWarning]
        : []),
      ...(hasStatus &&
      !state.download &&
      !ui.busy &&
      (statusText.includes("\n") || statusText.length > 90)
        ? [statusText]
        : []),
    ]),
  ];
  const severity = ui.busy
    ? "progress"
    : state.noticeKind === "error"
      ? "error"
      : state.download || state.noticeKind === "success"
        ? "success"
        : items.length
          ? "warning"
          : "info";
  const title = hasStatus
    ? statusText.split("\n")[0]
    : items.length
      ? t(`確認事項 ${items.length}件`)
      : "";
  return (
    <section
      className={`notification-card ${severity}`}
      hidden={!title && !items.length}
      aria-label={t("処理状況")}
    >
      <div className="notification-heading">
        <span className="notification-icon" aria-hidden="true">
          {severity === "success"
            ? "✓"
            : severity === "progress"
              ? "↻"
              : severity === "warning" || severity === "error"
                ? "!"
                : "i"}
        </span>
        <div className="notification-copy">
          <div id="status" role="status" aria-live="polite" title={title}>
            {title}
          </div>
          {state.download && (
            <div className="notification-file" title={state.download.name}>
              {state.download.name} · {state.download.size}
            </div>
          )}
        </div>
        {state.download && (
          <button
            id="regenerate"
            className="icon-button"
            disabled={ui.pdfDisabled}
            onClick={() => ui.start("pdf")}
            aria-label={t("PDFを再生成して保存")}
            title={t("PDFを再生成して保存")}
          >
            ↻
          </button>
        )}
        {ui.busy && (
          <button id="cancel" className="quiet" onClick={ui.cancel}>
            {t("キャンセル")}
          </button>
        )}
      </div>
      {items.length > 0 && (
        <details className="notification-details">
          <summary>
            <span>
              {hasStatus ? t(`確認事項 ${items.length}件`) : t("詳細を表示")}
            </span>
            <span className="disclosure-chevron" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <ul id="diagnostics">
            {items.map((item, i) => (
              <li key={`${i}:${item}`}>{item}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
