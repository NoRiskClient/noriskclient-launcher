import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  SkinSnapshotRenderer,
  type SkinSnapshotRequest,
} from "@noriskclient/nrc-skin-renderer/snapshot";

const RENDERER_VERSION =
  typeof __SKIN_RENDERER_VERSION__ === "string"
    ? __SKIN_RENDERER_VERSION__
    : "dev";
const RENDER_VERSION = `${RENDERER_VERSION}-idle3`;
const IDLE_DISPOSE_MS = 15_000;
const RENDER_WIDTH = 280;
const RENDER_HEIGHT = 560;
const FIT_MARGIN = 1.04;
const POSE_EMOTE = "/emotes/launcheridle3.animation.json";
const POSE_EMOTE_TIME = 2;
const CROP_PADDING = 0.02;

const FORMATS = {
  png: { mimeType: "image/png", extension: "png" },
  webp: { mimeType: "image/webp", extension: "webp" },
} as const;

export type SkinPreviewFormat = keyof typeof FORMATS;

export interface SkinPreviewOptions {
  width?: number;
  height?: number;
  format?: SkinPreviewFormat;
  quality?: number;
  cacheKey?: string;
}

interface SizedRenderer {
  renderer: SkinSnapshotRenderer;
  disposeTimer: ReturnType<typeof setTimeout> | null;
  inFlight: number;
}

const renderers = new Map<string, SizedRenderer>();

const resolved = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(",")}}`;
}

const assetHashes = new Map<string, Promise<string>>();

function hashAsset(url: string): Promise<string> {
  let hash = assetHashes.get(url);
  if (!hash) {
    hash = fetch(url)
      .then((res) => res.text())
      .then(sha1)
      .catch(() => "missing");
    assetHashes.set(url, hash);
  }
  return hash;
}

async function sha1(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function skinPreviewKey(
  request: SkinSnapshotRequest,
  options: SkinPreviewOptions = {},
): Promise<string> {
  if (options.cacheKey) return options.cacheKey;

  const { textureUrl, cosmetics, emote, ...rest } = request;
  return sha1(
    canonical({
      v: RENDER_VERSION,
      emote: emote?.animation ? await hashAsset(emote.animation) : null,
      w: options.width ?? RENDER_WIDTH,
      h: options.height ?? RENDER_HEIGHT,
      format: options.format ?? "png",
      skin: await sha1(textureUrl),
      cosmetics: (cosmetics ?? []).map((c) => ({
        id: c.id,
        geo: c.urls.geo,
        texture: c.urls.texture,
      })),
      ...rest,
    }),
  );
}

async function readFromDisk(
  key: string,
  extension: string,
): Promise<string | null> {
  const path = await invoke<string | null>("get_cached_skin_render", {
    cacheKey: key,
    extension,
  });
  return path ? convertFileSrc(path) : null;
}

async function writeToDisk(
  key: string,
  extension: string,
  blob: Blob,
): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  const path = await invoke<string>("store_skin_render", {
    cacheKey: key,
    extension,
    base64Data: btoa(binary),
  });
  return convertFileSrc(path);
}

function getRenderer(width: number, height: number): SizedRenderer {
  const size = `${width}x${height}`;
  let entry = renderers.get(size);

  if (!entry) {
    entry = {
      renderer: new SkinSnapshotRenderer(width, height),
      disposeTimer: null,
      inFlight: 0,
    };
    renderers.set(size, entry);
  }

  if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
  return entry;
}

function releaseRenderer(entry: SizedRenderer, size: string): void {
  entry.inFlight -= 1;
  if (entry.inFlight > 0) return;

  if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
  entry.disposeTimer = setTimeout(() => {
    if (entry.inFlight > 0) return;
    entry.renderer.dispose();
    renderers.delete(size);
  }, IDLE_DISPOSE_MS);
}

export async function getSkinPreview(
  request: SkinSnapshotRequest,
  options: SkinPreviewOptions = {},
): Promise<string> {
  const format = FORMATS[options.format ?? "png"];
  const given = Object.fromEntries(
    Object.entries(request).filter(([, value]) => value !== undefined),
  ) as SkinSnapshotRequest;
  const framed: SkinSnapshotRequest = {
    fit: FIT_MARGIN,
    crop: CROP_PADDING,
    emote: { animation: POSE_EMOTE },
    emoteTime: POSE_EMOTE_TIME,
    ...given,
  };
  const key = await skinPreviewKey(framed, options);

  const known = resolved.get(key);
  if (known) return known;

  const running = pending.get(key);
  if (running) return running;

  const task = (async () => {
    const cached = await readFromDisk(key, format.extension).catch(() => null);
    if (cached) {
      resolved.set(key, cached);
      return cached;
    }

    const width = options.width ?? RENDER_WIDTH;
    const height = options.height ?? RENDER_HEIGHT;
    const size = `${width}x${height}`;
    const entry = getRenderer(width, height);
    entry.inFlight += 1;

    let blob: Blob;
    try {
      blob = await entry.renderer.snapshot(framed, {
        mimeType: format.mimeType,
        quality: options.quality,
      });
    } finally {
      releaseRenderer(entry, size);
    }

    const url = await writeToDisk(key, format.extension, blob).catch(
      (error: unknown) => {
        console.warn("[SkinPreview] Failed to cache render on disk:", error);
        return URL.createObjectURL(blob);
      },
    );

    resolved.set(key, url);
    return url;
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, task);
  return task;
}

