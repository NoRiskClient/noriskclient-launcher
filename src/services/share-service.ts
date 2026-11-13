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

/** Frames while converting (total 0 until the engine knows), bytes while uploading. */
export interface ShareProgress {
  id: string;
  phase: SharePhase;
  done: number;
  total: number;
}

export async function shareMedia(target: ShareTarget, progressId: string): Promise<Share> {
  if (target.kind === "clip") {
    return invoke<Share>("share_clip", { path: target.path, progressId });
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
  "nrc.share.error.rate_limited",
  "nrc.share.error.banned",
  "nrc.share.error.media",
  "nrc.share.error.server",
  "share.errors.convert_failed",
  "share.errors.converted_too_large",
]);

/** The translation key for a failed share. */
export function shareErrorKey(error: unknown): string {
  const err = (typeof error === "object" && error !== null ? error : {}) as NrcCommandError;
  if (err.translatable_key && KNOWN_ERRORS.has(err.translatable_key)) return err.translatable_key;
  if (err.status === 401 || err.kind === "NoCredentialsError") return "share.errors.signed_out";
  return "share.errors.generic";
}
