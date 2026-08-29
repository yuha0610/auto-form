import type { AttemptNumber, EligibleTarget, SheetRowData } from "../types.js";
import { extractCompanyCoreName } from "./textNormalize.js";

/** 送り先として登録しない企業の印。フォーム無の再挑戦モードでも対象から外す。 */
export const NEVER_SEND_MARKER = "送信NG";

/**
 * 何度開き直しても結果が変わらない失敗の印。
 * これらを対象に残すと同じ企業が毎回バッチの先頭を占め続けてしまうため、1回で打ち切る。
 */
export const PERMANENT_FAILURE_MARKERS = [
  "URL不正(名前解決失敗)",
  "証明書エラー(URL要確認)",
  "読み込み失敗(要確認)",
];

/** 一時的な失敗(タイムアウト・接続エラー)が上限回数に達した行に付ける印。 */
export const REPEATED_FAILURE_MARKER = "接続不可";

/** 備考に含まれていれば送信対象から外す印。 */
export const SKIP_MARKERS = [
  "フォーム無",
  "Google Formで不可",
  "電話のみ",
  "サポートのみ",
  "リンク切れ",
  "メール",
  "CAPTCHA",
  "営業・セールスお断り",
  NEVER_SEND_MARKER,
  ...PERMANENT_FAILURE_MARKERS,
  REPEATED_FAILURE_MARKER,
];

const FOLLOW_UP_INTERVAL_DAYS = 14;

/**
 * 検知シグナルを「直近の動き」として優先する期間。
 * フォローアップ間隔(14日)とは別物なので定数を分けている
 * (同じ定数を使い回すと、この期間を延ばした途端に2回目送信の間隔まで延びてしまう)。
 */
const SIGNAL_RECENCY_DAYS = 30;

export function parseSheetDate(value: string | null): Date | null {
  if (!value) return null;
  const parts = value.split("/").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatSheetDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

const EMAIL_ON_FILE_REASON = "メールアドレス登録済み";

export function isSkipped(row: SheetRowData): boolean {
  return SKIP_MARKERS.some((marker) => row.note.includes(marker)) || row.email.trim() !== "";
}

export interface SkipSummary {
  reason: string;
  companies: string[];
}

/** スキップされた行を、備考に含まれるスキップ理由・メールアドレス登録済みかどうかごとに集計する。 */
export function summarizeSkipped(rows: SheetRowData[]): SkipSummary[] {
  const companiesByReason = new Map<string, string[]>();
  for (const row of rows) {
    const reason = SKIP_MARKERS.find((marker) => row.note.includes(marker));
    if (reason) {
      if (!companiesByReason.has(reason)) companiesByReason.set(reason, []);
      companiesByReason.get(reason)!.push(row.companyName);
      continue;
    }
    if (row.email.trim() !== "") {
      if (!companiesByReason.has(EMAIL_ON_FILE_REASON)) companiesByReason.set(EMAIL_ON_FILE_REASON, []);
      companiesByReason.get(EMAIL_ON_FILE_REASON)!.push(row.companyName);
    }
  }

  const reasons = [...SKIP_MARKERS, EMAIL_ON_FILE_REASON];
  return reasons.filter((reason) => companiesByReason.has(reason)).map((reason) => ({
    reason,
    companies: companiesByReason.get(reason)!,
  }));
}

function computeAttemptNumber(row: SheetRowData, today: Date): AttemptNumber | null {
  if (row.dealStatus.trim() !== "") return null;

  if (!row.firstSentAt) return 1;
  if (row.thirdSentAt) return null;

  if (!row.secondSentAt) {
    const first = parseSheetDate(row.firstSentAt);
    if (!first) return null;
    return daysBetween(first, today) >= FOLLOW_UP_INTERVAL_DAYS ? 2 : null;
  }

  const second = parseSheetDate(row.secondSentAt);
  if (!second) return null;
  return daysBetween(second, today) >= FOLLOW_UP_INTERVAL_DAYS ? 3 : null;
}

export function getNextAttempt(row: SheetRowData, today: Date): AttemptNumber | null {
  if (isSkipped(row)) return null;
  return computeAttemptNumber(row, today);
}

const FORM_MISSING_MARKER = "フォーム無";

/**
 * シグナルがある対象を先に、その中では検知日が新しい順に並べる比較関数。
 * それ以外は0を返し、安定ソートによってシートの並び順を保つ。
 */
function bySignalRecency(today: Date) {
  return (a: EligibleTarget, b: EligibleTarget): number => {
    const aHot = hasRecentSignal(a.row, today);
    const bHot = hasRecentSignal(b.row, today);
    if (aHot !== bHot) return aHot ? -1 : 1;
    if (!aHot) return 0;

    const aDate = parseSheetDate(a.row.signalDate)?.getTime() ?? 0;
    const bDate = parseSheetDate(b.row.signalDate)?.getTime() ?? 0;
    return bDate - aDate;
  };
}

/** 自動発見でフォームが見つからず(備考に「フォーム無」が付いて)スキップされている行を、手動確認用に再度対象にする。 */
export function selectFormMissingRetryTargets(
  rows: SheetRowData[],
  today: Date,
): EligibleTarget[] {
  const targets: EligibleTarget[] = [];
  for (const row of rows) {
    if (!row.note.includes(FORM_MISSING_MARKER)) continue;
    if (row.note.includes(NEVER_SEND_MARKER)) continue;
    const attemptNumber = computeAttemptNumber(row, today);
    if (attemptNumber !== null) {
      targets.push({ row, attemptNumber });
    }
  }
  return targets.sort(bySignalRecency(today));
}

export function hasRecentSignal(row: SheetRowData, today: Date): boolean {
  const signalDate = parseSheetDate(row.signalDate);
  if (!signalDate) return false;
  return daysBetween(signalDate, today) <= SIGNAL_RECENCY_DAYS;
}

export function attemptProgress(row: SheetRowData): number {
  if (row.thirdSentAt) return 3;
  if (row.secondSentAt) return 2;
  if (row.firstSentAt) return 1;
  return 0;
}

export function selectBatch(
  rows: SheetRowData[],
  batchSize: number,
  today: Date,
): EligibleTarget[] {
  const eligible: EligibleTarget[] = [];
  for (const row of rows) {
    const attemptNumber = getNextAttempt(row, today);
    if (attemptNumber !== null) {
      eligible.push({ row, attemptNumber });
    }
  }

  return eligible.sort(bySignalRecency(today)).slice(0, batchSize);
}

export interface CoolingCompany {
  companyName: string;
  lastSentAt: string;
}

export interface SendableRows {
  rows: SheetRowData[];
  /** 同一企業とみなしてまとめた結果、対象から外した重複行の数。 */
  duplicateRows: number;
  cooling: CoolingCompany[];
}

/**
 * 複数の企業が同じホストを共有しうるドメイン(共有ホスティング・フォームSaaS・
 * プレスリリース配信・SNS)。ここが一致しても同じ企業とは限らないので、
 * 企業の同一判定キーには使わない。
 * (企業URL欄にPR TIMESの記事URLやHubSpotの共有フォームURLが入っている行が実際にある)
 */
const NON_IDENTIFYING_HOSTS = [
  // 共有ホスティング・サイトビルダー
  "wixsite.com",
  "wixstudio.com",
  "jimdofree.com",
  "jimdo.com",
  "myshopify.com",
  "studio.site",
  "webnode.jp",
  "amebaownd.com",
  "goope.jp",
  "peraichi.com",
  "localinfo.jp",
  "crayonsite.com",
  "shopselect.net",
  "thebase.in",
  "base.shop",
  "stores.jp",
  "square.site",
  "weebly.com",
  "strikingly.com",
  "bindcloud.jp",
  "sakura.ne.jp",
  "xsrv.jp",
  "lolipop.jp",
  "netlify.app",
  "vercel.app",
  "github.io",
  "wordpress.com",
  // フォームSaaS
  "hsforms.com",
  "hubspot.com",
  "hubspotpagebuilder.com",
  "form.run",
  "formzu.net",
  "form-mailer.jp",
  "formmailer.jp",
  "typeform.com",
  "jotform.com",
  "tayori.com",
  "docs.google.com",
  "google.com",
  "forms.gle",
  // プレスリリース配信・メディア
  "prtimes.jp",
  "atpress.ne.jp",
  "valuepress.com",
  "kyodonewsprwire.jp",
  "jpubb.com",
  "note.com",
  "hatenablog.com",
  "thebridge.jp",
  // SNS・求人
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "wantedly.com",
  "en-gage.net",
  "herp.careers",
];

/** 企業URLのホスト(www.除去)。共有ホスティングのURLはnullを返す。 */
function companyHost(url: string): string | null {
  let host: string;
  try {
    host = new URL(url.trim()).host.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  if (!host) return null;
  const isShared = NON_IDENTIFYING_HOSTS.some(
    (shared) => host === shared || host.endsWith(`.${shared}`),
  );
  return isShared ? null : host;
}

/**
 * 同じ企業を指すと判断できるキー。
 * 社名のコア名(法人格の表記ゆれを吸収)と企業URLのホストの両方を見るので、
 * 旧社名のまま残っている行も新社名の行と同じ企業として扱える。
 */
function identityKeys(row: SheetRowData): string[] {
  const keys: string[] = [];
  const coreName = extractCompanyCoreName(row.companyName);
  if (coreName) keys.push(`name:${coreName}`);
  const host = companyHost(row.companyUrl);
  if (host) keys.push(`host:${host}`);
  return keys;
}

/** キーを1つでも共有する行を同一企業としてまとめる(Union-Find)。 */
function groupRowsByCompany(rows: SheetRowData[]): SheetRowData[][] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  const keysByRow = rows.map(identityKeys);
  for (const keys of keysByRow) {
    for (const key of keys) if (!parent.has(key)) parent.set(key, key);
    for (const key of keys.slice(1)) parent.set(find(keys[0]), find(key));
  }

  const groupByRoot = new Map<string, SheetRowData[]>();
  const groups: SheetRowData[][] = [];
  rows.forEach((row, index) => {
    const keys = keysByRow[index];
    if (keys.length === 0) {
      groups.push([row]);
      return;
    }
    const root = find(keys[0]);
    const existing = groupByRoot.get(root);
    if (existing) {
      existing.push(row);
      return;
    }
    const group = [row];
    groupByRoot.set(root, group);
    groups.push(group);
  });

  return groups;
}

function bestRowOf(group: SheetRowData[]): SheetRowData {
  return group.reduce((best, row) => (attemptProgress(row) > attemptProgress(best) ? row : best), group[0]);
}

/** グループ内の全行を通じた最終送信日。1度も送っていなければnull。 */
function lastSentAtOf(group: SheetRowData[]): string | null {
  let latest: { value: string; time: number } | null = null;
  for (const row of group) {
    for (const value of [row.firstSentAt, row.secondSentAt, row.thirdSentAt]) {
      const date = parseSheetDate(value);
      if (!date || !value) continue;
      if (!latest || date.getTime() > latest.time) latest = { value, time: date.getTime() };
    }
  }
  return latest?.value ?? null;
}

/**
 * 送信対象の候補となる行を返す。
 * 同一企業(社名のコア名または企業URLのホストが一致)が複数行ある場合は、
 * 送信が最も進んだ行だけを残す。さらに、別行での送信も含めて最終送信から
 * 14日経っていない企業はまとめて今回の対象から外す(二重送信・短期連投の防止)。
 */
export function selectSendableRows(rows: SheetRowData[], today: Date): SendableRows {
  const kept = new Set<SheetRowData>();
  const cooling: CoolingCompany[] = [];
  let duplicateRows = 0;

  for (const group of groupRowsByCompany(rows)) {
    duplicateRows += group.length - 1;
    const best = bestRowOf(group);
    const lastSentAt = lastSentAtOf(group);
    const lastSent = parseSheetDate(lastSentAt);
    if (lastSent && daysBetween(lastSent, today) < FOLLOW_UP_INTERVAL_DAYS) {
      if (computeAttemptNumber(best, today) !== null) {
        cooling.push({ companyName: best.companyName, lastSentAt: lastSentAt! });
      }
      continue;
    }
    kept.add(best);
  }

  return { rows: rows.filter((row) => kept.has(row)), duplicateRows, cooling };
}
