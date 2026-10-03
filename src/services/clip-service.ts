import { invoke } from "@tauri-apps/api/core";
import type { CaptureRuntimeState, CaptureStatus, EncoderCapability } from "../types/launcherConfig";

export function runtimeDownloadPercent(runtime: CaptureRuntimeState): number {
  if (runtime.state !== "downloading" || !runtime.total) return 0;
  return Math.min(100, Math.round((runtime.downloaded / runtime.total) * 100));
}

export async function applyClipSettings(restart = false): Promise<string[]> {
  return invoke<string[]>("capture_apply_settings", { restart });
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

export async function openClipEditor(path: string, name: string): Promise<void> {
  return invoke("clip_open_editor", { path, name });
}

export interface EditorClip {
  path: string;
  name: string;
}

export async function getEditorClip(): Promise<EditorClip | null> {
  return invoke<EditorClip | null>("clip_editor_current");
}

export async function closeClipEditor(): Promise<void> {
  return invoke("clip_editor_close");
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

export type ClipShape = "original" | "vertical" | "square" | "wide";

export type ClipCorner = "top_left" | "top_right" | "bottom_left" | "bottom_right";

export interface ClipOverlayBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  startSeconds: number;
  endSeconds: number;
}

export interface ClipBlurOverlay extends ClipOverlayBounds {
  kind: "blur";
  strength: number;
}

export interface ClipBoxOverlay extends ClipOverlayBounds {
  kind: "box";
  colour: number;
}

export interface ClipArrowOverlay extends ClipOverlayBounds {
  kind: "arrow";
  colour: number;
  thickness: number;
  towards: ClipCorner;
}

export interface ClipTextOverlay extends ClipOverlayBounds {
  kind: "text";
  content: string;
  size: number;
  colour: number;
}

export type ClipOverlay =
  | ClipBlurOverlay
  | ClipBoxOverlay
  | ClipArrowOverlay
  | ClipTextOverlay;

export async function exportVertical(
  path: string,
  shape?: ClipShape,
  overlays?: ClipOverlay[],
  cut?: ClipCut,
): Promise<string> {
  return invoke<string>("clip_export_vertical", {
    path,
    shape,
    overlays,
    ...(cut ? cutArgs(cut) : {}),
    removed: cut?.removed ?? [],
    blanked: cut?.blanked ?? [],
    muted: cut?.muted ?? [],
  });
}

export interface ExportedGif {
  path: string;
  source: string;
  width: number;
  height: number;
  frames: number;
  durationSeconds: number;
  sizeBytes: number;
  truncated: boolean;
}

export async function exportGif(path: string): Promise<string> {
  return invoke<string>("clip_export_gif", { path });
}

export async function listOpenApps(): Promise<OpenApp[]> {
  return invoke<OpenApp[]>("clip_open_apps");
}

export interface ScreenInfo {
  device: string;
  width: number;
  height: number;
  primary: boolean;
}

export async function listScreens(): Promise<ScreenInfo[]> {
  return invoke<ScreenInfo[]>("clip_list_screens");
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
  offsetSeconds: number;
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface Span {
  startSeconds: number;
  endSeconds: number;
}

export interface TrackCut extends Span {
  stream: number;
}

export interface ClipCut {
  startSeconds: number;
  endSeconds: number;
  levels?: TrackLevel[];
  videoStartSeconds?: number | null;
  videoEndSeconds?: number | null;
  removed?: Span[];
  blanked?: Span[];
  muted?: TrackCut[];
}

function cutArgs(cut: ClipCut) {
  return {
    startSeconds: cut.startSeconds,
    endSeconds: cut.endSeconds,
    videoStartSeconds: cut.videoStartSeconds ?? null,
    videoEndSeconds: cut.videoEndSeconds ?? null,
    levels: cut.levels,
  };
}

export async function trimClip(
  path: string,
  startSeconds: number,
  endSeconds: number,
  levels?: TrackLevel[],
  videoStartSeconds?: number | null,
  videoEndSeconds?: number | null,
): Promise<string> {
  return invoke<string>("clip_trim", {
    path,
    ...cutArgs({ startSeconds, endSeconds, levels, videoStartSeconds, videoEndSeconds }),
  });
}

export type CapturePermission = "screen_recording" | "microphone" | "input_monitoring";
export type CapturePermissions = Record<CapturePermission, boolean> & {
  microphone_denied: boolean;
  microphone_required: boolean;
};

export async function getCapturePermissions(request?: CapturePermission): Promise<CapturePermissions | null> {
  return invoke("capture_permissions", { request: request ?? null });
}

export async function openCapturePermissionSettings(permission: CapturePermission): Promise<void> {
  return invoke("capture_open_permission_settings", { permission });
}

export function errorKey(code: string): string {
  return code
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export function samePath(a: string, b: string): boolean {
  const flatten = (path: string) => path.replace(/\\/g, "/").toLowerCase();
  return flatten(a) === flatten(b);
}
