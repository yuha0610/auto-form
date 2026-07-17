# 週次サブ目標 設計

## 背景

[[2026-07-17-goal-progress-tracking-design.md]] で「進捗」シートの目標件数・期限に対する累計進捗をSlack通知するようにした。しかし「1000件/10営業日」のような目標は期間が長く、日々の通知だけでは「今週ペース通りに進んでいるか」が分かりにくい。全体の目標を週単位の小目標に分解し、既存の進捗通知にその週の状況を追記する。

## 週の定義

月曜日〜日曜日のカレンダー週とする。祝日は考慮しない(既存の営業日計算と同じ方針、土日のみ非営業日として扱う)。

## 今週の目標件数の計算

既存の`buildProgressMessage`が計算する「必要ペース」(全体の残り件数 ÷ 全体の残り営業日、切り上げ)に、「今日から今週の日曜日までの営業日数(今日を含む)」を掛けたものを「今週の残り目標」とする。

例: 必要ペースが85件/日で、今日が金曜日(今週の残り営業日は今日1日のみ)の場合、今週の残り目標は85件。

この値は日々変動する(前日までの遅れ/進みが必要ペースに反映され、その必要ペースに今週の残り営業日数を掛けるため)。固定の週間ノルマではなく、「あと何件当たれば全体のペースに追いつくか」の目安として使う。

## 今週の実績

「フォーム営業 1回目」列の日付が、今週の月曜日から今日までの範囲(両端含む)に入っている行数。

## メッセージ形式

`buildProgressMessage`に5番目の引数`thisWeekSent: number`を追加する。通常時(未達成かつ期限内)のメッセージにのみ、以下の1行を追記する。目標達成済み・期限切れの文言には追記しない(達成/期限切れの状態では週次の遅れ具合を気にする意味が薄いため)。

```
累計(1回目): 156件 / 目標1000件(残り844件)
残り営業日: 9日
必要ペース: 94件/日
今週(07/13週): 12件 / 週残り目標85件
```

「07/13週」はその週の月曜日の日付(`MM/DD`)。

## 変更: `src/lib/progressGoal.ts`

新規追加する関数:

```ts
export function getWeekStart(date: Date): Date
export function countBusinessDaysInclusive(from: Date, to: Date): number
export function countSentThisWeek(rows: SheetRowData[], weekStart: Date, today: Date): number
```

- `getWeekStart(date)`: `date`が属するカレンダー週の月曜日(00:00)を返す。`date`の曜日が日曜日(`getDay() === 0`)の場合は6日前、それ以外は`(getDay() - 1)`日前が月曜日になる。
- `countBusinessDaysInclusive(from, to)`: `from`から`to`まで(両端含む)を1日ずつ数え、土日でない日をカウントする。`from`が`to`より後の場合は`0`を返す。
- `countSentThisWeek(rows, weekStart, today)`: 各行の`firstSentAt`をパースし、`weekStart`(00:00)以上`today`(その日の00:00)以下の範囲に入っていればカウントする。

既存の`buildProgressMessage`のシグネチャを変更する。「今週の残り営業日数」の計算には`today`が必要だが、`buildProgressMessage`は日付を自分で取得しない(既存の`remainingBusinessDays`も呼び出し側で計算済みの値を受け取る設計に合わせる)ため、`thisWeekRemainingBusinessDays`も呼び出し側で計算して渡す。メッセージ中の「07/13週」ラベルの元になる週の月曜日(`weekStart`)も同様に呼び出し側から渡す:

```ts
export function buildProgressMessage(
  totalSent: number,
  goal: Goal,
  remainingBusinessDays: number,
  thisWeekSent: number,
  thisWeekRemainingBusinessDays: number,
  weekStart: Date,
): string
```

週残り目標 = `Math.ceil(remainingCount / remainingBusinessDays) * thisWeekRemainingBusinessDays`(`remainingBusinessDays`が0の場合は期限切れメッセージが先に返るため、この行には到達しない)。

## 変更: `src/index.ts`

既存の進捗通知呼び出しを以下に置き換える:

```ts
const goal = await fetchGoal(sheetsClient, spreadsheetId);
if (goal) {
  const today = new Date();
  const totalSent = countFirstSent(countRows);
  const remainingBusinessDays = countRemainingBusinessDays(today, goal.deadline);

  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const thisWeekSent = countSentThisWeek(countRows, weekStart, today);
  const thisWeekRemainingBusinessDays = countBusinessDaysInclusive(today, weekEnd);

  await notifySlackText(
    buildProgressMessage(
      totalSent,
      goal,
      remainingBusinessDays,
      thisWeekSent,
      thisWeekRemainingBusinessDays,
      weekStart,
    ),
  );
}
```

## テスト

`tests/progressGoal.test.ts`に追加する:

- `getWeekStart`: 週の途中の平日から月曜日を返すこと、日曜日から6日前(前週月曜)ではなく同じ週の月曜日を返すこと、月曜日自身を渡すとその日をそのまま返すこと
- `countBusinessDaysInclusive`: 両端が平日の場合に正しくカウントすること、`from`と`to`が同じ平日なら1を返すこと、土日を挟む場合に正しく除外すること、`from`が`to`より後なら0を返すこと
- `countSentThisWeek`: 週の範囲内の日付はカウントし、範囲外(前週・来週・空欄)はカウントしないこと
- `buildProgressMessage`: 通常時に週次行が追記されること、達成済み・期限切れの文言には追記されないこと

既存の`buildProgressMessage`呼び出し元テスト(3パターン)は新しい2引数を渡すよう更新する。

## スコープ外

- 週替わり(月曜日)に自動で「先週の振り返り」を送る機能
- 週単位の目標を「進捗」シートで個別に上書き設定する機能(あくまで全体目標からの均等按分)
- 日本の祝日を考慮した週内営業日計算
