export interface SupportRequestInfo {
  code: string;
  requestId: string;
  ticketId: string;
  ticketNumber: number;
  category: string;
  requestedBy: {
    displayName: string;
    avatarUrl?: string | null;
    minecraftUuid?: string | null;
  };
  items: { type: string; params?: Record<string, string> }[];
  note?: string | null;
  createdAt: string;
  expiresAt: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxUploadBytes: number;
  maxFiles: number;
  account: { id: string; ign: string };
  capabilities: string[];
}

export interface PreparedItem {
  index: number;
  type: string;
  category: "COLLECT" | "ACTION";
  supported: boolean;
  available: boolean;
  summary?: string | null;
  sizeBytes?: number | null;
  truncated: boolean;
  preview?: string | null;
  previewIsExcerpt: boolean;
  action?: {
    description: string;
    from?: string | null;
    to?: string | null;
    fromName?: string | null;
    toName?: string | null;
  } | null;
  error?: string | null;
}

export interface PrepareSupportRequestResult {
  items: PreparedItem[];
}

export interface PrepareStep {
  index: number;
  total: number;
  itemType: string;
}

export interface SupportActionResult {
  status: "DONE" | "FAILED";
  message?: string | null;
  data?: unknown;
}

export interface SupportSubmitResult {
  messageId: string;
}

export const SUPPORT_ERROR_KINDS = [
  "not_logged_in",
  "not_found",
  "gone",
  "offline",
  "rate_limited",
  "too_large",
  "invalid_code",
  "discord_not_linked",
  "busy",
  "unknown",
] as const;

export type SupportErrorKind = (typeof SUPPORT_ERROR_KINDS)[number];
