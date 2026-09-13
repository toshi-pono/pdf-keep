# Regression test fixtures

These are versioned inputs used by automated tests. Keep them in the repository so a fresh clone can run the complete suite without downloading test fonts or accessing Figma.

| Input                                                 | Purpose and origin                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fonts/MPLUS1p-Regular.ttf`, `fonts/MPLUS1p-Bold.ttf` | Japanese text, mixed weights, subsetting, UI font upload, and fallback without dedicated script glyphs. M PLUS 1p; see `fonts/OFL.txt`.                                   |
| `fonts/Inter-Full-Regular.ttf`                        | Native OpenType script-glyph tests. Static Inter v3.19 release; see `fonts/Inter-Full-LICENSE.txt`.                                                                       |
| `fonts/SourceSans3-Regular.ttf`                       | Dedicated superscript/subscript glyph tests. Adobe Source Sans 3; see `fonts/SourceSans3-LICENSE.md`.                                                                     |
| `rich-text/figma-script-ranges.json`                  | Figma-generated reference outlines, formatting, and PNGs captured from a dedicated QA frame on 2026-09-14. Exercises lists and script text against the original geometry. |

The Figma reference was created for testing, not captured from a user document. Its subscript sample does not match the registered Inter font and intentionally exercises outline fallback. When replacing a fixture, preserve its intended case and inspect both rendered output and extracted Unicode with `npm run test:browser`.

Generated PDFs, screenshots, and one-off captures are not fixtures; write them under `tmp/` or `output/`.
