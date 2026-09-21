import { msg } from "../shared/messages";
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
        aria-label={ui.t(msg("navigation.views"))}
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
            {ui.t(
              value === "convert"
                ? msg("navigation.convert")
                : msg("navigation.settings"),
            )}
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
                ? ui.t(msg("outlines.someText"))
                : ui.fontWarning}{" "}
              <span aria-hidden="true">→</span>
            </button>
          )}
          {ui.state.raster && (
            <p className="mode-notice">{ui.t(msg("raster.summary"))}</p>
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
