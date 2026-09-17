import { invoke } from "@tauri-apps/api/core";
import type { LegalLocale } from "../config/legal";

export type LegalDocumentKind = "consent" | "notice";

export interface PendingLegalDocument {
  slug: string;
  locale: string;
  title: string;
  version: number;
  updatedAt: number;
  changeSummary: string | null;
  kind: LegalDocumentKind;
}

export interface LegalPrompt {
  firstTime: boolean;
  documents: PendingLegalDocument[];
}

export function getPendingLegalDocuments(
  locale: LegalLocale,
  acceptedLegacyTerms: boolean,
): Promise<LegalPrompt> {
  return invoke<LegalPrompt>("get_pending_legal_documents", { locale, acceptedLegacyTerms });
}

export function acknowledgeLegalDocuments(): Promise<void> {
  return invoke<void>("acknowledge_legal_documents");
}
