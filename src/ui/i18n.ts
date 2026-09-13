import translations from "./translations.json";

export type Language = "ja" | "en";
export function environmentLanguage(locale: string): Language {
  return /^ja(?:-|$)/i.test(locale) ? "ja" : "en";
}
let language: Language = "ja";
export function setLanguage(value: Language) {
  language = value;
}
export function getLanguage() {
  return language;
}
const exact = translations as Record<string, string>;
// Only these placeholders contain application messages; all others are user data.
const nestedMessages: Record<string, number> = {
  "フォントの軽量化に失敗したため完全なフォントを埋め込みました: {0}": 0,
  "「{0}」のリスト記号をアウトラインで保持しました: {1}": 1,
  "「{0}」のレイヤー全体をアウトラインで保持しました: {1}": 1,
  "「{0}」の{1}をアウトラインで保持しました: {2}": 2,
  "省略文字: {0} — {1}": 0,
  "省略文字の変換が制限時間を超えました（{0}）。処理を中止しました。": 0,
  "{0}: 軽量化できなかったため従来方式で埋め込みました（{1}）。": 1,
};
const patterns = Object.entries(exact)
  .filter(([source]) => /\{\d+\}/.test(source))
  .map(([source, target]) => ({
    nested: nestedMessages[source],
    pattern: new RegExp(
      "^" +
        source
          .split(/\{\d+\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("([\\s\\S]*?)") +
        "$",
    ),
    target,
  }));

/** Translate application messages; unknown messages and user content are preserved. */
export function t(source: string, locale: Language = language): string {
  if (locale === "ja") return source;
  if (Object.prototype.hasOwnProperty.call(exact, source)) return exact[source];
  for (const { pattern, target, nested } of patterns) {
    const match = pattern.exec(source);
    if (match)
      return target.replace(/\{(\d+)\}/g, (_, n) => {
        const value = match[Number(n) + 1];
        return Number(n) === nested ? t(value, locale) : value;
      });
  }
  if (source.startsWith("警告: "))
    return "Warning: " + t(source.slice(4), locale);
  if (source.startsWith("Error: "))
    return "Error: " + t(source.slice(7), locale);
  if (source.includes("\n"))
    return source
      .split("\n")
      .map((line) => t(line, locale))
      .join("\n");
  const errorStart = source.indexOf(": Error: ");
  if (errorStart >= 0)
    return (
      source.slice(0, errorStart + 2) + t(source.slice(errorStart + 2), locale)
    );
  return source;
}
