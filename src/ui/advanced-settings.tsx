import { languages, supportedLanguages } from "../i18n/languages";
import { msg } from "../shared/messages";
import { FontSettings } from "./font-settings";
import type { PluginUI } from "./use-plugin-ui";
import { PAPER_SIZES, type PaperSize } from "../shared/resolution";
import { Help } from "./help";
export function AdvancedSettings({ ui }: { ui: PluginUI }) {
  const { t, state, patch, busy } = ui;
  return (
    <>
      <FontSettings ui={ui} />
      <section className="settings-section">
        <h2>
          {t(msg("quality.reference"))}{" "}
          <Help label={t(msg("quality.paperHelp"))}>
            {t(msg("quality.paperDescription"))}
          </Help>
        </h2>
        <div className="setting-row">
          <label htmlFor="paper-size">{t(msg("quality.paperSize"))}</label>
          <select
            id="paper-size"
            value={state.paper}
            disabled={busy}
            onChange={(e) =>
              patch({ paper: e.currentTarget.value as PaperSize })
            }
          >
            {Object.entries(PAPER_SIZES).map(([name, size]) => (
              <option key={name} value={name}>
                {name} · {size[0]} × {size[1]} mm
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row paper-orientation">
          <label htmlFor="paper-orientation">
            {t(msg("quality.orientation"))}
          </label>
          <select
            id="paper-orientation"
            value={state.orientation}
            disabled={busy}
            onChange={(e) =>
              patch({
                orientation:
                  e.currentTarget.value === "landscape"
                    ? "landscape"
                    : "portrait",
              })
            }
          >
            <option value="portrait">{t(msg("quality.portrait"))}</option>
            <option value="landscape">{t(msg("quality.landscape"))}</option>
          </select>
        </div>
      </section>
      <section className="settings-section">
        <h2>{t(msg("quality.imageSize"))}</h2>
        <label className="check">
          <input
            id="pixel-mode"
            type="checkbox"
            checked={state.quality === "manual" && state.scale === "custom"}
            disabled={busy}
            onChange={(e) =>
              patch({
                quality: "manual",
                scale: e.currentTarget.checked ? "custom" : "1",
              })
            }
          />
          {t(msg("quality.longestEdge"))}
        </label>
        <div
          id="custom-resolution"
          hidden={state.quality !== "manual" || state.scale !== "custom"}
        >
          <div className="pixel-field">
            <input
              id="long-edge"
              aria-label={t(msg("quality.backgroundEdge"))}
              type="number"
              min="1"
              max="16384"
              step="1"
              value={state.longEdge}
              disabled={busy}
              onChange={(e) => patch({ longEdge: e.currentTarget.value })}
            />
            <span>px</span>
          </div>
        </div>
      </section>
      <section className="settings-section setting-row">
        <label htmlFor="language">{t(msg("settings.language"))}</label>
        <select
          id="language"
          value={ui.language}
          onChange={(e) => ui.changeLanguage(e.currentTarget.value)}
        >
          {supportedLanguages.map((language) => (
            <option key={language} value={language}>
              {languages[language].label}
            </option>
          ))}
        </select>
      </section>
    </>
  );
}
