# Development

## Setup

Use Node.js 22.13 or later and npm. Run commands from the repository root.

```sh
npm ci
npm run build
```

Import the root `manifest.json` through **Plugins → Development → Import plugin from manifest…** in Figma Desktop. Select one frame and run **PDF Keep**. Rebuild after changing source files, then reopen the plugin to load the new bundle.

The build produces `dist/code.js` for the Figma sandbox and a self-contained `dist/ui.html` for the React UI. No development server or API key is required. Opening the HTML alone previews the interface; frame selection and export require Figma messages.

## Validation

Unit and integration tests run without Figma, browsers, or network access:

```sh
npm test
```

Browser tests use Playwright’s Chromium and Poppler for PDF rendering, text extraction, and font/image inspection. Install them once:

```sh
npx playwright install chromium
# macOS
brew install poppler
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y poppler-utils
```

Then run the complete validation suite:

```sh
npm run check
```

This runs ESLint, Prettier’s formatting check, TypeScript, unit and integration tests, the build, and browser/PDF tests. Browser tests use committed inputs under `tests/fixtures/`; they do not depend on local work notes or manual capture tools.

| Command                    | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `npm run format`           | Format maintained source and documentation               |
| `npm run lint:fix`         | Apply automatic ESLint fixes                             |
| `npm run typecheck`        | Check TypeScript types                                   |
| `npm run test:unit`        | Test pure functions and selection inspection             |
| `npm run test:integration` | Test Figma messages and export lifecycles with mocks     |
| `npm run test:ui`          | Test UI controls, languages, cancellation, and downloads |
| `npm run test:browser`     | Run all UI and PDF regression tests                      |
| `npm run test:network`     | Optional live Google Fonts download/PDF test             |

Build before running a browser command directly. Use `PLAYWRIGHT_CHANNEL=chrome` to test with an installed Chrome instead of Playwright’s Chromium. Set `POPPLER_BIN` to override the Poppler executable directory; macOS also checks `/opt/homebrew/opt/poppler/bin`.

The shared browser harness disables font hinting so Linux screen-pixel adjustments do not change glyph advances relative to the PDF's scalable font metrics. Visual tests still check glyph coverage, decoration placement, and layout; the opacity comparison allows a difference of up to three 8-bit color levels between Chromium and Poppler.

Screenshots, comparisons, and extracted data go to `tmp/qa/`; generated PDFs go to `output/pdf/`. Both are ignored by Git.

## Project structure

| Directory                                             | Responsibility                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `src/plugin/`                                         | Figma API calls, selection inspection, frame/PDF export          |
| `src/ui/`                                             | React components, UI state, translations, and styles             |
| `src/pdf/`                                            | PDF generation, text layout, glyph matching, and searchable text |
| `src/fonts/`                                          | Google Fonts lookup and font subsetting                          |
| `src/shared/`                                         | Message types, resolution limits, geometry, and error handling   |
| `src/types/`                                          | External module declarations                                     |
| `tests/unit/`, `tests/integration/`, `tests/browser/` | Automated test suites                                            |
| `tests/helpers/`, `tests/fixtures/`                   | Shared harnesses and reproducible inputs                         |
| `tests/network/`                                      | Optional tests that use real network requests                    |
| `scripts/`                                            | Build, packaging, and font-catalog maintenance                   |
| `assets/`                                             | Published logo and README teaser images                          |
| `licenses/`                                           | Third-party notices                                              |

Japanese, English, and Korean translations live in `src/i18n/locales/`. Supported languages and labels are centralized in `src/i18n/languages.ts`; `src/ui/i18n.ts` initializes i18next/react-i18next. Application messages use typed keys and named parameters from `src/shared/messages.ts` throughout plugin/worker communication. Language preferences are stored separately from fonts in Figma client storage. See the README’s Languages section for the extension workflow. The UI entry point is `src/ui/index.tsx`; the Figma sandbox entry point is `src/plugin/main.ts`.

## Save flow and UI feedback

The primary **Save PDF** action generates the PDF and initiates the host's download flow. The host controls whether it opens a save-location dialog or downloads to a configured folder. The completed file remains available through the same large Save PDF action, including when automatic downloads are blocked. Changing output settings, fonts, or the selection invalidates the cached file.

The plugin uses a Blob download link in its embedded UI. The native `showSaveFilePicker` API is not used: it requires transient user activation and can be blocked by the same-origin policy ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)). The browser tests exercise automatic downloads from a sandboxed iframe, cancellation, and late export responses.

Progress, completion, and warnings share one compact notification card. Detailed messages can be expanded. Font rows remain compact within a scrollable list. Help is shown in an overlay on hover or keyboard focus, and dismissed with Escape; it does not change the layout.

## Font catalog

The committed catalog lets normal builds run without fetching font metadata. To refresh the official font URLs, run:

```sh
node scripts/update-google-fonts.mjs
npm run build
npm test
```

The update uses network access. Review the catalog diff before committing. Automatic font downloads during plugin use connect only to the CDN allowed by `manifest.json`; document text and images are not uploaded.

Catalog generation queries each family separately and requests all of its advertised language subsets, excluding the tiny `menu` preview subset. Multi-family requests can return incomplete TTFs even when Japanese is requested (reproduced with M PLUS 1p). A Latin-only download can have the correct family name but lack Japanese or other glyphs. The generator rejects split CSS subsets rather than silently retaining the last URL, and reports weights that have no static TTF while keeping the available styles. Live PDF tests use native Japanese, Chinese, and Korean text to detect incomplete downloads.

Static TTFs can retain misleading legacy family names: for example, Google's Noto Sans JP Regular identifies its family as `Noto Sans JP Thin`. Font registration reads legacy, typographic, and WWS name pairs, checks the actual weight and slant, and handles standard weight suffixes, optical-size suffixes such as `12pt`, and known public-family renames. Width variants such as Condensed and Mono remain distinct, and unavailable weights are never replaced by the nearest available weight. Manual imports and saved fonts use the same registration rules; aliases share one parsed font to avoid duplicating large Japanese fonts in memory.

`tests/fixtures/fonts/google-font-metadata.json` preserves name and style metadata from 649 official static TTFs across 63 families, including their source URLs. The offline tests check matching and reject other weights/slants; this metadata coverage does not imply PDF rendering coverage for every style. The optional network test downloads representative Japanese and Latin fonts, registers them, embeds them in a PDF, and checks extracted text. Use `GOOGLE_FONT_TEST_FAMILY="Noto Sans JP" npm run test:network` to narrow a live run to one family.

Font input currently requires static TrueType `.ttf` files. Variable fonts, CFF-based OTFs, and font collections are not supported by the PDF pipeline.

When a registered font lacks a character (for example, Japanese text styled as Inter), Figma may draw it using a Noto fallback. The searchable exporter captures the visible vector shapes of each affected text run and embeds them in a Unicode-mapped Type 3 PDF font. Both the visible glyph and its text mapping belong to the font; this is not an invisible text overlay. Neighbouring runs use their native geometry too, so different fallback advances cannot shift later text. Font runs may be selected as a unit depending on the PDF viewer. Explicitly hidden source ranges remain excluded, and ordinary supported text continues to use TrueType embedding. This path does not require downloading or identifying Figma's fallback font.

## Image quality

Medium is the UI default: it targets the selected paper's width at 300 dpi (A4 portrait: 2481 px), with at most 3× enlargement. Sharp multiplies the Medium target and enlargement cap by 1.3; Light multiplies them by 0.7 (390 / 300 / 210 dpi targets). These factors apply to image width and height, not directly to file size. Settings offers A0–A5 and Letter, in portrait or landscape. These are raster resolution references; PDF page geometry and text remain based on the source frame.

Presets shrink oversized frames and automatically fit the existing 32 MP / 16384 px PDF limits, or the 4096 px image-fill limit for converted Figma frames. The UI shows the resulting PDF raster dimensions and flags capped quality. Paper-sized A0/A1 exports can therefore fall below the target dpi when a limit applies. File size remains content-dependent; this is a pixel budget, not a guaranteed byte limit. Manual preserves explicit scale and long-edge controls with validation. UI previews and export requests share `src/shared/resolution.ts`; presets send integer long-edge constraints so very large source frames can downsample below 0.01× reliably.

The searchable PDF exporter losslessly compresses its flattened RGB background with adaptive PNG filters and PDF Predictor 15. It compares complete image stream sizes (including the predictor dictionary) and keeps the original pdf-lib stream when that is smaller or optimization fails. Dimensions, RGB pixels and text remain unchanged. Filtering yields periodically for cancellation; zlib compression uses `CompressionStream` where available, with pdf-lib's encoder as a compatibility fallback. Raster/legacy exports already use jsPDF's PNG predictor compression. No compression option or extra font/image upload is required.

## Distribution and CI

The English Community gallery images are `assets/teaser-en.png` (cover) and `assets/subteaser-features-en.png` (feature overview), both 1920 × 1080 px. Run `npm run render:promo` to rebuild them with actual screenshots of the current English UI. This requires Playwright Chromium; temporary HTML and screenshots stay in the ignored `tmp/promo/` directory. Upload the cover first and the feature overview second when publishing to Figma Community.

```sh
npm run package
```

This creates `output/pdf-keep-plugin.zip` from an explicit set of runtime files, public READMEs, documentation, assets, and third-party notices. Test fixtures, experiments, and local work notes are excluded. Extract the ZIP before importing its manifest in Figma Desktop.

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes and pull requests. Separate jobs check source/build output and browser/PDF behavior. The workflow uploads build files and QA results as artifacts. Live-network tests remain opt-in.

## Figma Community publication

`manifest.json`'s `api: "1.0.0"` selects the Figma API version. It is independent of the product version in `package.json` and `package-lock.json`, currently both `0.1.1`. Do not copy the package version into `api` or add a product `version` field to the manifest. Use `npm version patch --no-git-tag-version` when intentionally bumping a patch release; this updates both package files. The npm `private: true` setting prevents npm publication and can stay enabled for a Figma plugin. See the [manifest specification](https://developers.figma.com/docs/plugins/manifest/).

Before the first Community submission:

1. Use the existing PDF Keep registration: `manifest.json` already contains its Figma-issued ID, `1681089320786833087`. Keep that ID for subsequent updates. If publishing an independent fork as a separate plugin, obtain your own ID from Figma and replace only the ID, preserving the build paths and other settings.
2. Enable two-factor authentication for the publishing account and prepare a support contact. Use the current English description, logo and gallery images in the publishing dialog; they are not manifest fields.
3. Run `npm run check` and verify PDF saving in the Figma Desktop development plugin. Confirm Google Fonts loading, searchable text and the exported appearance. Rebuild after changing source files.
4. Open **Plugins → Manage plugins → Publish** in Figma Desktop and submit the built plugin for review. Publishing the GitHub repository or creating a distribution ZIP does not submit to Community.

The existing `editorType: ["figma"]`, `documentAccess: "dynamic-page"`, and network allowlist restricted to `https://fonts.gstatic.com` match the current implementation. No additional user or team permissions are needed. Keep the existing font-storage key so future updates preserve saved fonts within the same plugin identity. See Figma's [publishing instructions](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community).
