export interface Template {
  name: string;
  senderCompany: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  senderTitle?: string;
  subject: string;
  message: string;
}

export const COLUMNS = {
  companyName: "企業名",
  companyUrl: "企業URL",
  formUrl: "フォームURL",
  note: "備考",
  dealStatus: "商談 確定日",
  firstSent: "フォーム営業 1回目",
  secondSent: "フォーム営業 2回目",
  thirdSent: "フォーム営業 3回目",
  email: "メールアドレス",
} as const;

export interface SheetRowData {
  rowIndex: number;
  companyName: string;
  companyUrl: string;
  formUrl: string;
  note: string;
  dealStatus: string;
  firstSentAt: string | null;
  secondSentAt: string | null;
  thirdSentAt: string | null;
  email: string;
}

export type AttemptNumber = 1 | 2 | 3;

export interface EligibleTarget {
  row: SheetRowData;
  attemptNumber: AttemptNumber;
}
