# PDF Keep

[![CI](https://github.com/toshi-pono/pdf-keep/actions/workflows/ci.yml/badge.svg)](https://github.com/toshi-pono/pdf-keep/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![PDF Keep — flatten backgrounds and keep useful text](assets/teaser-en.png)

A Figma plugin that combines images and shapes into one background while keeping supported text searchable and copyable. Adjust the background resolution and subset embedded fonts to create smaller PDFs without carrying over original background images or separate background layers. File-size savings depend on the design and settings.

[日本語](README_ja.md)

## How it works

1. **Select one frame** in Figma and open **PDF Keep**.
2. **Choose image quality**: Sharp, Medium (default), Light, or Manual. Medium targets A4 width at 300 dpi, up to 3× enlargement. Change the paper size (including A0/A1 posters) in **Settings**.
3. **Save PDF** to generate the file and start downloading it, or **Convert to Frame** to create a new frame with a flattened background and editable text, then use Figma’s native PDF export.

Crops and opaque shape covers are baked into the background. Supported text is placed above it; unsupported text can fall back to outlines. The original frame stays intact. Document text and images are processed locally; automatic font downloads connect to Google Fonts’ official CDN. Other fonts can be added as static TTF files.

Outlined or rasterized text cannot be searched or copied. This is not a text-redaction tool: retained text remains extractable. Native Figma PDF export follows Figma’s own text-export behavior.

## Development

Requires Node.js 22.13+ and npm.

```sh
npm ci
npm run build
```

In Figma Desktop, choose **Plugins → Development → Import plugin from manifest…**, select this repository’s `manifest.json`, and run **PDF Keep**.

Use `npm run format` to format code, `npm run check` for the full validation suite, and `npm run package` to create a distribution ZIP. See the [development guide](docs/development.md) for browser-test dependencies, project structure, and CI.

## Languages

The UI supports Japanese, English, and Korean. Change **Settings → Language** to save a preference on this device. Startup uses the saved choice, then the browser language, then English. Regional codes such as `ko-KR` use their base language. A failed read uses the browser language; a failed save keeps the current choice active and shows a notice. Language changes also update existing progress, warnings, and errors without restarting an export.

Translations are bundled with i18next/react-i18next; no translation server is needed. To add a language, register its code and native label in `src/i18n/languages.ts`, add a typed resource in `src/i18n/locales/`, and register it in `src/ui/i18n.ts`. Add new messages under stable semantic keys in each resource, with named `{{parameters}}` and `_one`/`_other` forms for counts. Use the typed `msg(key, params)` helper; keep messages structured through errors, callbacks, and worker/plugin communication, and render them only in the UI. External text and document names remain opaque strings. Run `npm run check` to validate resource completeness, parameters, persistence, and switching behavior.

## Acknowledgement

PDF Keep builds on [React](https://github.com/facebook/react), [i18next](https://github.com/i18next/i18next), [react-i18next](https://github.com/i18next/react-i18next), [jsPDF](https://github.com/parallax/jsPDF), [pdf-lib](https://github.com/Hopding/pdf-lib), [svg2pdf.js](https://github.com/yWorks/svg2pdf.js), [opentype.js](https://github.com/opentypejs/opentype.js), [HarfBuzz](https://github.com/harfbuzz/harfbuzz) / [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs), [fast-png](https://github.com/image-js/fast-png), and [fast-text-encoding](https://github.com/samthor/fast-text-encoding).

Thanks to Google Fonts and the M PLUS, Inter, and Source Sans contributors. Third-party notices are in [licenses](licenses/), and regression-test font licenses are included alongside their fixtures in the source repository.
