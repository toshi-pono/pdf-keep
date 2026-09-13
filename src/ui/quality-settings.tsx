import type { PluginUI } from "./use-plugin-ui";
import { Help } from "./help";
import { QUALITY_FACTORS } from "../shared/resolution";
export function QualitySettings({ ui }: { ui: PluginUI }) {
  const { t, state, patch, busy } = ui;
  const adjust = (delta: number) => {
    const value = Number(state.scale);
    patch({
      scale: String(
        Math.max(
          0.01,
          (Number.isFinite(value) && value > 0 ? value : 1) + delta,
        ),
      ),
    });
  };
  return (
    <section className="quality-section">
      <h2>{t("画像の画質")}</h2>
      <div className="scale-presets" role="group" aria-label={t("画像の画質")}>
        {(["sharp", "medium", "light", "manual"] as const).map((value) => (
          <button
            type="button"
            key={value}
            data-quality={value}
            aria-pressed={state.quality === value}
            disabled={busy}
            onClick={() => patch({ quality: value })}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div
        className="setting-row scale-custom"
        hidden={state.quality !== "manual"}
      >
        <label htmlFor="scale">{t("倍率を指定")}</label>
        <div className="stepper">
          <button
            aria-label={t("倍率を下げる")}
            disabled={busy}
            onClick={() => adjust(-0.25)}
          >
            −
          </button>
          <input
            id="scale"
            aria-label={t("倍率を指定")}
            type="number"
            min="0.01"
            step="any"
            placeholder={state.scale === "custom" ? t("px指定") : "1"}
            value={state.scale === "custom" ? "" : state.scale}
            disabled={busy}
            onChange={(e) => patch({ scale: e.currentTarget.value })}
          />
          <span aria-hidden="true">×</span>
          <button
            aria-label={t("倍率を上げる")}
            disabled={busy}
            onClick={() => adjust(0.25)}
          >
            +
          </button>
        </div>
      </div>
      <div className="output-summary" aria-live="polite">
        {state.quality !== "manual" && (
          <div className="quality-reference">
            {state.paper} {t(state.orientation === "portrait" ? "縦" : "横")} ·{" "}
            {300 * QUALITY_FACTORS[state.quality]} dpi {t("目標")}
            {ui.qualityLimited && (
              <span> · {t("拡大・画像サイズ上限で調整")}</span>
            )}
          </div>
        )}
        <div id="scale-hint" className="muted">
          {ui.scaleHint}
        </div>
        <div id="pdf-size-estimate" hidden={!ui.sizeLabel}>
          <span id="pdf-size">{ui.sizeLabel}</span>
          <Help label={t("推定容量について")}>
            <span id="pdf-size-note">{ui.sizeNote}</span>
          </Help>
        </div>
      </div>
    </section>
  );
}
