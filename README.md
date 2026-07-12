# auto-form

お問い合わせフォームへの自動営業ツール。対象企業のフォームURLを読み込み、テンプレートの文面を自動入力（オプションで送信）し、結果を記録する。

## 構成

- `data/targets.csv` — 対象リスト（企業名・フォームURL・ステータス・備考）
- `data/templates/*.json` — 営業文面テンプレート（会社名・氏名・連絡先・件名・本文）
- `data/results.csv` — 送信結果ログ（実行時に自動生成、gitでは追跡しない）
- `src/lib/formSubmitter.ts` — フォーム項目をラベル/name/placeholderのキーワードから推測して入力
- `src/index.ts` — CLIエントリーポイント

## セットアップ

```bash
npm install
npm run playwright:install
```

## 使い方

```bash
# 入力のみ確認（送信ボタンは押さない、既定動作）
npm run dev -- --targets data/targets.csv --template data/templates/default.json

# 送信まで自動実行
npm run dev -- --submit

# ブラウザを表示して動作確認
npm run dev -- --headed
```

## 注意事項

- フォーム構造はサイトごとに異なるため、フィールドの自動検出には限界がある。未検出フィールドは実行時にログ出力される。
- `--submit` を付けない限り送信ボタンはクリックされず、入力結果の確認のみ行われる。
- 送信先サイトの利用規約やスクレイピング/自動送信に関するポリシーを事前に確認すること。
- 過度な連続アクセスは相手サーバーに負荷をかけるため、対象件数や実行間隔に配慮すること。
