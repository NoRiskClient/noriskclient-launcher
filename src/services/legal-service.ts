import { invoke } from "@tauri-apps/api/core";
import type { LegalLocale } from "../config/legal";

export type LegalDocumentKind = "consent" | "notice" | "reference";

export interface PendingLegalDocument {
  slug: string;
  locale: string;
  title: string;
  updatedAt: number;
  changeSummary: string | null;
  kind: LegalDocumentKind;
}

export interface LegalPrompt {
  firstTime: boolean;
  documents: PendingLegalDocument[];
}

export interface LegalStatus {
  prompt: LegalPrompt | null;
  notice: PendingLegalDocument | null;
}

export function getLegalStatus(locale: LegalLocale, acceptedLegacyTerms: boolean): Promise<LegalStatus> {
  return invoke<LegalStatus>("get_legal_status", { locale, acceptedLegacyTerms });
}

export function acknowledgeLegalDocuments(): Promise<void> {
  return invoke<void>("acknowledge_legal_documents");
}

export function acknowledgeLegalNotice(): Promise<void> {
  return invoke<void>("acknowledge_legal_notice");
}
