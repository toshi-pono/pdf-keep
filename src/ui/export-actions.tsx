import { NotificationCard } from "./notification-card";
import type { PluginUI } from "./use-plugin-ui";

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />
    </svg>
  );
}

export function ExportActions({ ui }: { ui: PluginUI }) {
  const { state, t } = ui;
  return (
    <footer className="export-footer">
      <NotificationCard ui={ui} />
      <div className="actions">
        <button
          id="create-frame"
          disabled={ui.frameDisabled}
          onClick={() => ui.start("frame")}
        >
          {t("Frame に変換")}
        </button>
        <button
          id="export"
          className="primary save-pdf"
          hidden={!!state.download}
          disabled={ui.pdfDisabled}
          onClick={() => ui.start("pdf")}
        >
          <DownloadIcon />
          {t("PDF を保存")}
        </button>
        <a
          id="download"
          className="primary download-button save-pdf"
          href={state.download?.url}
          download={state.download?.name}
          hidden={!state.download}
        >
          <DownloadIcon />
          {t("PDF を保存")}
        </a>
      </div>
    </footer>
  );
}
