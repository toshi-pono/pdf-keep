import { useState, type KeyboardEvent } from "react";
import { AdvancedSettings } from "./advanced-settings";
import { ExportActions } from "./export-actions";
import { QualitySettings } from "./quality-settings";
import { Selection } from "./selection";
import { usePluginUI } from "./use-plugin-ui";

type Tab = "convert" | "settings";
export function App() {
  const ui = usePluginUI();
  const [tab, setTab] = useState<Tab>("convert");
  const tabs = ["convert", "settings"] as const;
  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "convert"
        : event.key === "End"
          ? "settings"
          : tab === "convert"
            ? "settings"
            : "convert";
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
  return (
    <main>
      <nav
        className="tabs"
        role="tablist"
        aria-label={ui.t("プラグインの画面")}
      >
        {tabs.map((value) => (
          <button
            key={value}
            id={`tab-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onKeyDown={navigate}
            onClick={() => setTab(value)}
          >
            {ui.t(value === "convert" ? "変換" : "詳細設定")}
          </button>
        ))}
      </nav>
      <div className="content">
        <section
          id="panel-convert"
          role="tabpanel"
          aria-labelledby="tab-convert"
          hidden={tab !== "convert"}
        >
          <Selection ui={ui} />
          <QualitySettings ui={ui} />
          {!ui.state.raster && (ui.needsOutline || ui.fontWarning) && (
            <button
              className="settings-link"
              onClick={() => {
                setTab("settings");
                document.getElementById("tab-settings")?.focus();
              }}
            >
              {ui.needsOutline
                ? ui.t("一部の文字をアウトラインで出力")
                : ui.fontWarning}{" "}
              <span aria-hidden="true">→</span>
            </button>
          )}
          {ui.state.raster && (
            <p className="mode-notice">
              {ui.t("画像のみの PDF · 文字の検索・コピー不可")}
            </p>
          )}
        </section>
        <section
          id="panel-settings"
          role="tabpanel"
          aria-labelledby="tab-settings"
          hidden={tab !== "settings"}
        >
          <AdvancedSettings ui={ui} />
        </section>
      </div>
      <ExportActions ui={ui} />
    </main>
  );
}
