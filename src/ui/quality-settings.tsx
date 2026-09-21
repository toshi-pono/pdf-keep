import { msg } from "../shared/messages";
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
      <h2>{t(msg("quality.imageQuality"))}</h2>
      <div
        className="scale-presets"
        role="group"
        aria-label={t(msg("quality.imageQuality"))}
      >
        {(["sharp", "medium", "light", "manual"] as const).map((value) => (
          <button
            type="button"
            key={value}
            data-quality={value}
            aria-pressed={state.quality === value}
            disabled={busy}
            onClick={() => patch({ quality: value })}
          >
            {t(msg(`quality.${value}`))}
          </button>
        ))}
      </div>
      <div
        className="setting-row scale-custom"
        hidden={state.quality !== "manual"}
      >
        <label htmlFor="scale">{t(msg("quality.customScale"))}</label>
        <div className="stepper">
          <button
            aria-label={t(msg("quality.decrease"))}
            disabled={busy}
            onClick={() => adjust(-0.25)}
          >
            −
          </button>
          <input
            id="scale"
            aria-label={t(msg("quality.customScale"))}
            type="number"
            min="0.01"
            step="any"
            placeholder={
              state.scale === "custom" ? t(msg("quality.pixels")) : "1"
            }
            value={state.scale === "custom" ? "" : state.scale}
            disabled={busy}
            onChange={(e) => patch({ scale: e.currentTarget.value })}
          />
          <span aria-hidden="true">×</span>
          <button
            aria-label={t(msg("quality.increase"))}
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
            {state.paper}{" "}
            {t(
              state.orientation === "portrait"
                ? msg("quality.portrait")
                : msg("quality.landscape"),
            )}{" "}
            · {300 * QUALITY_FACTORS[state.quality]} dpi{" "}
            {t(msg("quality.target"))}
            {ui.qualityLimited && <span> · {t(msg("quality.limited"))}</span>}
          </div>
        )}
        <div id="scale-hint" className="muted">
          {ui.scaleHint}
        </div>
        <div id="pdf-size-estimate" hidden={!ui.sizeLabel}>
          <span id="pdf-size">{ui.sizeLabel}</span>
          <Help label={t(msg("estimate.help"))}>
            <span id="pdf-size-note">{ui.sizeNote}</span>
          </Help>
        </div>
      </div>
    </section>
  );
}
