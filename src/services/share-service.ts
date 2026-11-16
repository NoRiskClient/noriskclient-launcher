import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { NrcCommandError } from "../utils/nrc-error-translations";

export interface Share {
  slug: string;
  pageUrl: string;
}

export type ShareTarget =
  | { kind: "clip"; path: string }
  | { kind: "screenshot"; path: string; profileId: string };

export type SharePhase = "converting" | "uploading" | "checking";

/** How long a share stays up; nothing picked is payback's default. */
export interface ShareExpiry {
  days?: number;
  permanent?: boolean;
}

/** What payback lets the signed-in player pick; no choices while its flag is off for them. */
export interface ShareChoices {
  expiryDays: number;
  expiryChoices: number[];
  permanentChoice: boolean;
  maxPinned: number;
}

/** Frames while converting (total 0 until the engine knows), bytes while uploading. */
export interface ShareProgress {
  id: string;
  phase: SharePhase;
  done: number;
  total: number;
}

/** Redacts and, when too big, shortens the log in the launcher before it goes up. */
export async function shareLog(content: string, name: string): Promise<Share> {
  return invoke<Share>("share_log", { content, name });
}

export async function getShareChoices(): Promise<ShareChoices> {
  return invoke<ShareChoices>("share_choices");
}

export function offersChoice(choices: ShareChoices | null): choices is ShareChoices {
  return !!choices && (choices.expiryChoices.length > 0 || choices.permanentChoice);
}

export async function shareMedia(
  target: ShareTarget,
  progressId: string,
  expiry?: ShareExpiry,
): Promise<Share> {
  if (target.kind === "clip") {
    return invoke<Share>("share_clip", { path: target.path, progressId, expiry: expiry ?? null });
  }
  return invoke<Share>("share_screenshot", {
    profileId: target.profileId,
    path: target.path,
    progressId,
  });
}

export function onShareProgress(
  progressId: string,
  handle: (progress: ShareProgress) => void,
): Promise<UnlistenFn> {
  return listen<ShareProgress>("share_upload_progress", (event) => {
    if (event.payload.id === progressId) handle(event.payload);
  });
}

const KNOWN_ERRORS = new Set([
  "nrc.media.error.unsupported_type",
  "nrc.media.error.unsupported_video",
  "nrc.media.error.unsupported_image",
  "nrc.media.error.too_large",
  "nrc.media.error.too_long",
  "nrc.media.error.broken_file",
  "nrc.media.error.rate_limited",
  "nrc.media.error.upload_missing",
  "nrc.media.error.unsupported_text",
  "nrc.share.error.rate_limited",
  "nrc.share.error.banned",
  "nrc.share.error.media",
  "nrc.share.error.server",
  "nrc.share.error.pin_limit",
  "share.errors.convert_failed",
  "share.errors.converted_too_large",
  "share.errors.empty_log",
]);

/** The translation key for a failed share. */
export function shareErrorKey(error: unknown): string {
  const err = (typeof error === "object" && error !== null ? error : {}) as NrcCommandError;
  if (err.translatable_key && KNOWN_ERRORS.has(err.translatable_key)) return err.translatable_key;
  if (err.status === 401 || err.kind === "NoCredentialsError") return "share.errors.signed_out";
  return "share.errors.generic";
}
