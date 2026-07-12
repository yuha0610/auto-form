export type TargetStatus = "pending" | "success" | "failed" | "skipped";

export interface Target {
  company: string;
  url: string;
  status: TargetStatus;
  note: string;
}

export interface Template {
  name: string;
  senderCompany: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  subject: string;
  message: string;
}

export interface SubmissionResult {
  company: string;
  url: string;
  status: TargetStatus;
  detail: string;
  timestamp: string;
}
