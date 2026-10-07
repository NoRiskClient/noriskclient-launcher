import type { NrcCommandError } from "../../utils/nrc-error-translations";

export type CapeUploadRecovery = "retry" | "blocked" | "review";

const permanentKeys = new Set([
  "Inappropriate Content", "Copyright", "Incomplete",
  "Image does not fit the required resolution",
  "nrc.cosmetics.custom_cape.error.no_hash_provided",
  "nrc.cosmetics.custom_cape.error.cape_not_found",
  "nrc.cosmetics.custom_cape.error.deletion_not_allowed",
  "nrc.cosmetics.custom_cape.error.max_cape_limit_reached",
  "nrc.core.error.user_not_found",
]);

/** Manual retry only. Validation/moderation/auth failures need a changed input
 * or resolved account issue; a review response must never resubmit a cape. */
export function getCapeUploadRecovery(error: unknown): CapeUploadRecovery {
  const structured = error && typeof error === "object" ? error as NrcCommandError : undefined;
  const message = typeof error === "string" ? error : typeof structured?.message === "string" ? structured.message : "";
  let key = typeof structured?.translatable_key === "string" ? structured.translatable_key : undefined;
  if (!key) {
    const json = message.match(/\{[\s\S]*"translatableKey"[\s\S]*\}/)?.[0];
    if (json) {
      try {
        const body = JSON.parse(json);
        if (typeof body?.translatableKey === "string") key = body.translatableKey;
      } catch { /* Unknown legacy error remains manually retryable. */ }
    }
  }
  const review = (key ?? message.trim()).toLowerCase();
  if (review === "in review" || review.includes("in_review")) return "review";
  if (permanentKeys.has(key ?? message.trim())) return "blocked";

  // Non-API CommandError.kind is Rust Debug output (e.g. ImageProcessingError(...)).
  const kind = typeof structured?.kind === "string" ? structured.kind : "";
  if (/^(?:ImageProcessingError|InvalidInput|FileNotFound|NoCredentialsError)\b/.test(kind)) return "blocked";
  const status = typeof structured?.status === "number" ? structured.status : Number(message.match(/Request failed with status\s+(\d{3})\b/i)?.[1]);
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return "blocked";
  return "retry";
}
