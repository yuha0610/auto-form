# 送信文面のパーソナライズと内容刷新 設計

## 背景

現行の送信文面(`data/templates/default.json`)は完全な定型文で、企業名など送信先固有の情報が一切差し込まれない。`src/index.ts`は送信対象ごとに`target.row.companyName`を把握しているにもかかわらず、それが文面に反映される経路が無く、受け手からは「うちの会社を見ずに送っている」ことが伝わりやすい状態になっている。

返信率向上のため、(1) 企業名を文面に差し込めるようにする仕組みを追加し、(2) 実績のある参考文面をベースに件名・本文を刷新する。

## 変更1: `src/lib/templates.ts` に `renderTemplate` を追加

```ts
export function renderTemplate(template: Template, companyName: string): Template {
  const value = companyName.trim() || "貴社";
  const replace = (s: string) => s.split("{{companyName}}").join(value);
  return { ...template, subject: replace(template.subject), message: replace(template.message) };
}
```

- `{{companyName}}`という単純なトークンを、渡された企業名の文字列置換でsubject/messageにのみ適用する(senderCompany等の他フィールドは対象外)。
- `companyName`が空文字の場合は「貴社」にフォールバックする(既存の文面でも「貴社」は使われており違和感がないため)。
- 正規表現ではなく`split/join`によるリテラル置換とする(企業名に正規表現特殊文字が含まれても壊れないため)。

## 変更2: `src/index.ts` の呼び出し箇所

163行目付近、`fillFormWithDiscovery(page, template)`を呼ぶ直前で、その回の対象行の企業名を使って文面をレンダリングしてから渡す。

```ts
const personalizedTemplate = renderTemplate(template, target.row.companyName);
const { filledFields, missingFields, fieldCandidates, navigatedTo } =
  await fillFormWithDiscovery(page, personalizedTemplate);
```

呼び出し箇所は1箇所のみ。`template`自体(ファイルから読み込んだ元テンプレート)は変更せず、行ごとに都度レンダリングする。

## 変更3: `data/templates/default.json` の文面刷新

社内で実績のある参考文面をベースに、件名・本文を全面的に書き換える。構成要素:

- 件名: `{{companyName}}様へ|スタートアップ特化の採用スカウトサービスのご案内`
- 書き出し: 定型の挨拶+自己紹介の後、`{{companyName}}様のプロダクト・事業を拝見し、高い親和性を感じてご連絡させていただきました。`という一文で個別感を出す(元の参考文面にあった「SusHi Tech Tokyo 2026にご出展されていたため」は特定イベント出展企業限定の接触理由であり、本ツールが送る対象は特定イベントに紐づかないため、汎用的な企業名差し込みの一文に置き換える)
- `■スタクラとは`: サービス説明。SaaS・テック領域に加えて**ディープテック領域**への支援を明記(必須要件)。返信率13%・スカウト効率80通あたり1名・審査通過率50%の実績数値を含める
- `■プランについて`: 成功報酬型・代行プランの2つを説明
- `■日程調整はこちら`: 30分/Google meetの日程調整リンクと、求職者データベース閲覧・審査制に関する注記
- `■弊社情報`: サービス資料リンク
- `■最後に`: 審査制・厳選されたスタートアップのみが利用できる旨を改めて伝え、締めの挨拶

本文全文(`message`フィールドの値、`\n`で改行):

```
はじめまして。
株式会社スタートアップクラス(スタクラ)の川勝と申します。

弊社は、スタートアップに特化して人材マッチング支援をしております。

{{companyName}}様のプロダクト・事業を拝見し、高い親和性を感じてご連絡させていただきました。

■スタクラとは
「スタートアップ志望者のみが登録」している、採用スカウトサービスです。
SaaS・テック領域はもちろん、ディープテック領域まで幅広く支援しております。

スタートアップへの転職意欲が高い母集団に絞っているため、
一般的な転職サービスと比べてスカウトの歩留まりが大きく改善します。

・スカウト返信率:13%(一般的な媒体の2〜3倍水準)
・スカウト効率:80通あたり1名採用
・利用企業:審査通過率50%の厳選されたスタートアップのみ

■プランについて
成功報酬型:
・採用確定時のみ費用が発生するため、初期リスクを抑えてスタートできます

代行プラン:
・スカウト文面の作成・送付まで弊社が対応。リソースが限られている企業様に多くご利用いただいています

■日程調整はこちら(所要時間30分/Google meet)
ご関心がございましたら、以下より日程をご予約ください
https://meetings.hubspot.com/startupclass/form

※実際の求職者データベースをご覧いただけます。
※審査制のため掲載をお断りする場合があります。

■弊社情報
サービス資料
https://na2.hubs.ly/H0437Wc0

■最後に
スタクラは、社会を変えるスタートアップ企業の採用課題解決のために存在しています。
そのため、審査通過率50%と厳選されたスタートアップ企業様のみ利用できます。

審査通過企業様であれば、事業を成長させるコア人材に出会えるはずです。

スタッフ一同、お会いできることを心よりお待ちしております。
```

`senderCompany`/`senderName`/`senderEmail`/`senderPhone`/`senderTitle`は現行のまま変更しない。

## テスト

- `tests/templates.test.ts`を新規作成:
  - `renderTemplate`: `{{companyName}}`が渡した企業名に置換されること、subject/message両方に反映されること、senderCompany等の他フィールドは変更されないこと、companyNameが空文字の場合は「貴社」に置換されることを確認する。
  - 本文中に`{{companyName}}`という文字列が複数回出現するケース(件名+本文で複数箇所)も置換されることを確認する。

## スコープ外

- 検知シグナル(`signalType`/`signalSourceUrl`)を使った動的パーソナライズ(案C、将来対応)
- `{{companyName}}`以外のプレースホルダー(役職・氏名の差し込み等)
- A/Bテストの仕組み(複数テンプレートを切り替えて配信する機能)
- 文面内の実績数値(返信率13%等)の正確性検証・更新フロー
