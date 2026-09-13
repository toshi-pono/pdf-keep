import type { PluginUI } from "./use-plugin-ui";
export function Selection({ ui }: { ui: PluginUI }) {
  const { state, t } = ui;
  return (
    <section className="selection-section">
      <h2>{t("選択中のフレーム")}</h2>
      <div className="selection-card">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="5" y="5" width="14" height="14" rx="1" />
          <path d="M5 2v6M2 5h6M19 2v6M16 5h6M5 16v6M2 19h6M19 16v6M16 19h6" />
        </svg>
        <div className="selection-info">
          <div id="selection">
            {state.selection?.valid
              ? state.selection.name
              : t(state.selection?.name ?? "Frame を一つ選択してください")}
          </div>
          <div id="dimensions" className="muted">
            {state.selection?.width && state.selection.height
              ? `${state.selection.width} × ${state.selection.height} px`
              : ""}
          </div>
        </div>
        <button
          id="refresh"
          className="icon-button"
          disabled={ui.busy}
          aria-label={t("選択を再検査")}
          title={t("選択を再検査")}
          onClick={ui.refresh}
        >
          ↻
        </button>
      </div>
    </section>
  );
}
