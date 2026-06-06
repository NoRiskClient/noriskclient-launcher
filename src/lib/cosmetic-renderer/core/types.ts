/**
 * Typed shapes for Bedrock-format Minecraft model + animation JSON.
 * Only the fields nrc-cosmetics actually use — there are many more in the spec.
 *
 * Sources of truth in nrc-assets:
 *   .geo.json       — format_version "1.12.0"
 *   .animation.json — format_version "1.8.0"
 */

export type Vec3 = [number, number, number];

/** A scalar that may be a number literal or a Molang expression string. */
export type ScalarExpr = number | string;
export type Vec3Expr = [ScalarExpr, ScalarExpr, ScalarExpr];

// ---------- .geo.json ----------

export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";

export interface BedrockFaceUv {
  uv: [number, number];
  uv_size?: [number, number];
}

export type BedrockCubeUv =
  | [number, number]
  | Partial<Record<FaceName, BedrockFaceUv>>;

export interface BedrockCube {
  origin?: Vec3;
  size?: Vec3;
  pivot?: Vec3;
  rotation?: Vec3;
  uv?: BedrockCubeUv;
  inflate?: number;
  mirror?: boolean;
}

export interface BedrockBone {
  name: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  inflate?: number;
  cubes?: BedrockCube[];
}

export interface BedrockGeoDescription {
  identifier: string;
  texture_width?: number;
  texture_height?: number;
  visible_bounds_width?: number;
  visible_bounds_height?: number;
  visible_bounds_offset?: Vec3;
}

export interface BedrockGeometry {
  description: BedrockGeoDescription;
  bones?: BedrockBone[];
}

export interface BedrockGeoFile {
  format_version: string;
  "minecraft:geometry"?: BedrockGeometry[];
}

// ---------- .animation.json ----------

export type LerpMode = "linear" | "catmullrom" | "step";

/** A timestamped keyframe value. */
export interface AnimationKeyframe {
  time: number;
  pre: Vec3Expr;
  post: Vec3Expr;
  lerp: LerpMode;
}

/** Per-channel (rotation/position/scale) animation data. */
export interface AnimationChannel {
  /** True when at least one keyframe value is a Molang string. */
  hasExpression: boolean;
  keyframes: AnimationKeyframe[];
}

export interface ParsedBoneAnimation {
  rotation?: AnimationChannel;
  position?: AnimationChannel;
  scale?: AnimationChannel;
}

export interface ParsedAnimation {
  name: string;
  loop: boolean;
  /** Duration in seconds. Falls back to 1.0 when unset. */
  length: number;
  bones: Record<string, ParsedBoneAnimation>;
}

export interface ParsedAnimationFile {
  formatVersion: string;
  animations: ParsedAnimation[];
}

// ---------- normalised geo ----------

export interface ParsedGeo {
  identifier: string;
  textureWidth: number;
  textureHeight: number;
  bones: BedrockBone[];
}

// ---------- .png.mcmeta (animated textures) ----------

/**
 * Minecraft-style animated texture metadata.
 *
 * The PNG is a vertical strip of frames; each frame is `frameWidth × frameHeight`
 * pixels. Frametime is in **ticks** — 1 tick = 50 ms (20 fps). Some files omit
 * width/height (= square frames sized to the texture's width).
 */
export interface TextureAnimationInfo {
  /** Frame width in pixels. When undefined, defaults to the texture image width. */
  frameWidth?: number;
  /** Frame height in pixels. When undefined, defaults to frameWidth. */
  frameHeight?: number;
  /** Ticks per frame (50 ms each). */
  frametime: number;
  /** When true, cross-fade between frames. */
  interpolate: boolean;
  /** Optional explicit frame order; sequential 0..N-1 when absent. */
  frames?: number[];
}

// ---------- .norisk.json (subset relevant for rendering) ----------

export interface NoriskCosmeticMeta {
  id: string;
  name: string;
  type: string;
  path: string;
  creator: string | null;
  rarity: string | null;
  supportedBones: string[];
  defaultSettings: NoriskDefaultSettings;
}

export interface NoriskDefaultSettings {
  scale: number;
  previewScale: number;
  offset: Vec3;
  previewOffset: Vec3;
}

// ---------- emotes (.animation.json + emote-specific keys) ----------

/**
 * A particle effect spawn declared at a specific animation time.
 *
 * The web renderer doesn't render `.particle.json` itself — it just emits
 * `KeyframeListener.onParticleKeyframe` events so the caller can hook in
 * their own particle system (or no-op for previews).
 */
export interface ParticleKeyframe {
  /** Resource id like `noriskclient-cosmetics:flower`. */
  effectId: string;
  /** Bone whose world position should anchor the spawn. Empty string when not specified. */
  locator: string;
  /** When true, the effect should follow the actor as it moves. */
  bindToActor: boolean;
  /** Optional Molang expression evaluated before each spawn. Empty string when absent. */
  preEffectScript?: string;
}

/**
 * A sound effect declared at a specific animation time.
 *
 * Like particles, the web renderer doesn't actually play these — it emits
 * `KeyframeListener.onSoundKeyframe` so callers can wire up WebAudio.
 */
export interface SoundKeyframe {
  soundId: string;
  volume: number;
  pitch: number;
}

/**
 * Emote-specific metadata that lives alongside the standard animation block
 * in an emote `.animation.json`. None of these affect the bone tracks
 * themselves — they're behavioural flags + side-channel keyframes.
 */
export interface EmoteMeta {
  disableOnMove: boolean;
  disableOnHit: boolean;
  /** Metadata-only in the web port (no first-person rendering yet). */
  firstPerson: boolean;
  /** Metadata-only. */
  stayInFirstPerson: boolean;
  /** Metadata-only. */
  immersiveCamera: boolean;
  /**
   * Map of bone name → whether the vanilla animation for that bone should be
   * suppressed. In the web port there is no "vanilla" animation, so consumers
   * use this for diagnostics; the renderer just exposes locked-bone names.
   */
  lockVanillaBones: Record<string, boolean>;
  /** Animation time (seconds) → particle spawns at that time. */
  particleEffects: Record<number, ParticleKeyframe[]>;
  /** Animation time (seconds) → sound triggers at that time. */
  soundEffects: Record<number, SoundKeyframe[]>;
}

export interface ParsedEmote {
  id: string;
  displayName: string;
  meta: EmoteMeta;
  animation: ParsedAnimation;
}

export interface ParsedEmoteFile {
  formatVersion: string;
  emotes: ParsedEmote[];
}
