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
  durationSeconds: number | null;
  game: string | null;
  thumbnail: string | null;
  favourite: boolean;
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

export interface OpenApp {
  pid: number;
  executable: string;
  name: string;
}

export async function saveClipThumbnail(path: string, jpeg: Uint8Array): Promise<string> {
  return invoke<string>("clip_save_thumbnail", { path, jpeg: Array.from(jpeg) });
}

export interface PreviewTrack {
  stream: number;
  label: string;
  path: string;
}

export async function prepareClipPreview(path: string): Promise<void> {
  return invoke("clip_prepare_preview", { path });
}

export interface ExportProgress {
  source: string;
  done: number;
  total: number;
}

export interface ExportedClip {
  path: string;
  source: string;
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
}

export async function exportVertical(path: string): Promise<string> {
  return invoke<string>("clip_export_vertical", { path });
}

export async function listOpenApps(): Promise<OpenApp[]> {
  return invoke<OpenApp[]>("clip_open_apps");
}

export async function setClipFavourite(path: string, favourite: boolean): Promise<void> {
  return invoke("clip_set_favourite", { path, favourite });
}

export async function renameClip(path: string, name: string): Promise<string> {
  return invoke<string>("clip_rename", { path, name });
}

export interface TrimmedClip {
  path: string;
  source: string;
  durationSeconds: number;
  sizeBytes: number;
  startSeconds: number;
  endSeconds: number;
}

export interface ClipAudioTrack {
  label: string;
  stream: number;
  adjustable: boolean;
  peaks: number[];
}

export interface ClipDetails {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  peakStepMs: number;
  audioTracks: ClipAudioTrack[];
}

export async function getClipDetails(path: string): Promise<ClipDetails | null> {
  return invoke<ClipDetails | null>("clip_details", { path });
}

export interface TrackLevel {
  stream: number;
  volume: number;
}

export async function trimClip(
  path: string,
  startSeconds: number,
  endSeconds: number,
  levels?: TrackLevel[],
): Promise<string> {
  return invoke<string>("clip_trim", { path, startSeconds, endSeconds, levels });
}
