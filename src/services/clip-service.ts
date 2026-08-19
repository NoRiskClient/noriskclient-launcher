import { invoke } from "@tauri-apps/api/core";
import type { CaptureStatus, EncoderCapability } from "../types/launcherConfig";

export async function applyClipSettings(): Promise<string[]> {
  return invoke<string[]>("capture_apply_settings");
}

export async function releaseHotkeys(): Promise<void> {
  return invoke("capture_release_hotkeys");
}

export async function getCaptureStatus(): Promise<CaptureStatus> {
  return invoke<CaptureStatus>("capture_status");
}

export async function getEncoderCapabilities(): Promise<EncoderCapability[]> {
  return invoke<EncoderCapability[]>("capture_encoder_capabilities");
}

export interface ClipEntry {
  path: string;
  name: string;
  sizeBytes: number;
  createdAt: number;
}

export interface ClipStorageUsage {
  usedBytes: number;
  limitBytes: number;
  clipCount: number;
}

export async function listClips(): Promise<ClipEntry[]> {
  return invoke<ClipEntry[]>("clip_list");
}

export async function getClipStorageUsage(): Promise<ClipStorageUsage> {
  return invoke<ClipStorageUsage>("clip_storage_usage");
}

export async function deleteClip(path: string): Promise<void> {
  return invoke("clip_delete", { path });
}

export async function revealClip(path: string): Promise<void> {
  return invoke("clip_reveal", { path });
}

export async function openClipFolder(): Promise<void> {
  return invoke("clip_open_folder");
}

export interface TrimmedClip {
  path: string;
  source: string;
  durationSeconds: number;
  sizeBytes: number;
  startSeconds: number;
  endSeconds: number;
}

export async function trimClip(
  path: string,
  startSeconds: number,
  endSeconds: number,
): Promise<string> {
  return invoke<string>("clip_trim", { path, startSeconds, endSeconds });
}
