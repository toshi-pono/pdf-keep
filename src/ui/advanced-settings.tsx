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
          {t("画質の基準")}{" "}
          <Help label={t("用紙サイズについて")}>
            {t(
              "画像解像度の基準です。PDF のページサイズは元の Frame を保ちます。Medium は用紙幅 300 dpi・最大3倍、Sharp は1.3倍、Light は0.7倍。画像サイズ上限では自動調整します。",
            )}
          </Help>
        </h2>
        <div className="setting-row">
          <label htmlFor="paper-size">{t("用紙サイズ")}</label>
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
          <label htmlFor="paper-orientation">{t("用紙の向き")}</label>
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
            <option value="portrait">{t("縦")}</option>
            <option value="landscape">{t("横")}</option>
          </select>
        </div>
      </section>
      <section className="settings-section">
        <h2>{t("画像サイズ")}</h2>
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
          {t("長辺を指定")}
        </label>
        <div
          id="custom-resolution"
          hidden={state.quality !== "manual" || state.scale !== "custom"}
        >
          <div className="pixel-field">
            <input
              id="long-edge"
              aria-label={t("背景画像の長辺")}
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
        <label htmlFor="language">{t("言語")}</label>
        <select
          id="language"
          value={state.language}
          onChange={(e) =>
            patch({ language: e.currentTarget.value === "ja" ? "ja" : "en" })
          }
        >
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </section>
    </>
  );
}
