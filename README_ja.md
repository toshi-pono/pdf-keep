# PDF Keep

[![CI](https://github.com/toshi-pono/pdf-keep/actions/workflows/ci.yml/badge.svg)](https://github.com/toshi-pono/pdf-keep/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![PDF Keep — 画像をひとつに。余計な情報を残さず、軽い PDF に。](assets/teaser-en.png)

Figma の画像・図形を一枚の背景にまとめ、対応する文字を検索・コピー可能なまま残すプラグインです。背景の解像度調整と埋め込みフォントの軽量化で、元の背景画像や個別の背景レイヤーを持ち込まずに、共有しやすい PDF を作成します。容量の削減量はデザインと設定によって異なります。

[English](README.md)

## How it works

1. Figma で**フレームを一つ選び**、**PDF Keep** を起動します。
2. **Sharp・Medium（既定）・Light・Manual**から画質を選びます。Medium は A4 幅・300 dpi を基準に最大3倍まで拡大します。A0・A1 ポスターなどの用紙サイズは「詳細設定」で変更できます。
3. **PDF を保存**を押すと、生成後に保存を自動開始します。または **Frame に変換**で、背景画像と編集可能な文字を持つ新しいフレームを作り、Figma 標準の PDF Export を使います。

トリミングや不透明な図形による目隠しを背景画像に焼き込み、その上に対応する文字を配置します。未対応の文字はアウトラインに切り替えられます。元のフレームは変更しません。文書の文字・画像は端末内で処理し、フォントの自動取得時のみ Google Fonts の公式配信元へ接続します。その他のフォントは静的 TTF を追加できます。

アウトライン化・画像化した文字は検索・コピーできません。保持した文字は取り出せるため、文字の秘匿・墨消し用ではありません。Figma 標準 PDF の文字の扱いは Figma の出力仕様に依存します。

## Development

Node.js 22.13 以降と npm が必要です。

```sh
npm ci
npm run build
```

Figma デスクトップ版の **Plugins → Development → Import plugin from manifest…** で、このリポジトリの `manifest.json` を選び、**PDF Keep** を起動します。

コードの整形は `npm run format`、全検証は `npm run check`、配布 ZIP の作成は `npm run package` で実行します。ブラウザテストに必要なツール、構成、CI は[開発手順](docs/development.md)を参照してください。

## Acknowledgement

PDF Keep は [React](https://github.com/facebook/react)、[jsPDF](https://github.com/parallax/jsPDF)、[pdf-lib](https://github.com/Hopding/pdf-lib)、[svg2pdf.js](https://github.com/yWorks/svg2pdf.js)、[opentype.js](https://github.com/opentypejs/opentype.js)、[HarfBuzz](https://github.com/harfbuzz/harfbuzz) / [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs)、[fast-png](https://github.com/image-js/fast-png)、[fast-text-encoding](https://github.com/samthor/fast-text-encoding) を利用しています。

依存ライブラリのライセンスは [licenses](licenses/)、回帰テスト用フォントのライセンスはソースリポジトリ内の各素材に同梱しています。
