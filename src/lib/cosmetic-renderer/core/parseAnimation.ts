import type {
  AnimationChannel,
  AnimationKeyframe,
  LerpMode,
  ParsedAnimation,
  ParsedAnimationFile,
  ParsedBoneAnimation,
  ScalarExpr,
  Vec3Expr,
} from "./types";

/**
 * Parse a Bedrock/GeckoLib .animation.json file (format 1.8.0).
 *
 * Channels can appear in many shapes:
 *   - bare vector:        [x, y, z]
 *   - vector wrapper:     { vector: [x, y, z] }
 *   - constant scalar:    42                     (broadcast to [42,42,42])
 *   - keyed:              { "0.0": [...], "0.5": [...] }
 *   - keyed full:         { "0.0": { post: [...], lerp_mode: "linear" } }
 *   - keyed pre/post:     { "0.0": { pre: [...], post: [...] } }
 */
export function parseAnimationFile(json: unknown): ParsedAnimationFile {
  const root = json as {
    format_version?: string;
    animations?: Record<string, unknown>;
  };

  const animations: ParsedAnimation[] = [];
  const map = root.animations ?? {};
  for (const [name, raw] of Object.entries(map)) {
    animations.push(parseAnimation(name, raw));
  }

  return {
    formatVersion: root.format_version ?? "1.8.0",
    animations,
  };
}

function parseAnimation(name: string, raw: unknown): ParsedAnimation {
  const obj = (raw ?? {}) as {
    loop?: boolean | string;
    animation_length?: number;
    bones?: Record<string, unknown>;
  };

  const loop = obj.loop === true || obj.loop === "true" || obj.loop === "hold_on_last_frame";
  const length =
    typeof obj.animation_length === "number" && obj.animation_length > 0
      ? obj.animation_length
      : 1.0;

  const bones: Record<string, ParsedBoneAnimation> = {};
  const boneMap = obj.bones ?? {};
  for (const [boneName, boneRaw] of Object.entries(boneMap)) {
    bones[boneName] = parseBoneAnimation(boneRaw);
  }

  return { name, loop, length, bones };
}

function parseBoneAnimation(raw: unknown): ParsedBoneAnimation {
  const obj = (raw ?? {}) as {
    rotation?: unknown;
    position?: unknown;
    scale?: unknown;
  };

  const out: ParsedBoneAnimation = {};
  if (obj.rotation !== undefined) out.rotation = parseChannel(obj.rotation);
  if (obj.position !== undefined) out.position = parseChannel(obj.position);
  if (obj.scale !== undefined) out.scale = parseChannel(obj.scale);
  return out;
}

function parseChannel(raw: unknown): AnimationChannel {
  if (Array.isArray(raw) || typeof raw === "number" || typeof raw === "string") {
    const v = toVec3Expr(raw);
    return {
      hasExpression: vec3HasExpression(v),
      keyframes: [{ time: 0, pre: v, post: v, lerp: "linear" }],
    };
  }

  if (raw === null || typeof raw !== "object") {
    return { hasExpression: false, keyframes: [] };
  }

  const obj = raw as Record<string, unknown>;

  if ("vector" in obj && !looksLikeTimeKeyMap(obj)) {
    const v = toVec3Expr(obj.vector);
    return {
      hasExpression: vec3HasExpression(v),
      keyframes: [{ time: 0, pre: v, post: v, lerp: "linear" }],
    };
  }

  const keyframes: AnimationKeyframe[] = [];
  let hasExpression = false;
  for (const [key, val] of Object.entries(obj)) {
    const time = Number.parseFloat(key);
    if (!Number.isFinite(time)) continue;
    const kf = parseKeyValue(time, val);
    if (vec3HasExpression(kf.pre) || vec3HasExpression(kf.post)) {
      hasExpression = true;
    }
    keyframes.push(kf);
  }
  keyframes.sort((a, b) => a.time - b.time);

  return { hasExpression, keyframes };
}

function looksLikeTimeKeyMap(obj: Record<string, unknown>): boolean {
  for (const k of Object.keys(obj)) {
    if (Number.isFinite(Number.parseFloat(k))) return true;
  }
  return false;
}

function parseKeyValue(time: number, raw: unknown): AnimationKeyframe {
  if (Array.isArray(raw) || typeof raw === "number" || typeof raw === "string") {
    const v = toVec3Expr(raw);
    return { time, pre: v, post: v, lerp: "linear" };
  }

  if (raw === null || typeof raw !== "object") {
    const zero: Vec3Expr = [0, 0, 0];
    return { time, pre: zero, post: zero, lerp: "linear" };
  }

  const obj = raw as {
    pre?: unknown;
    post?: unknown;
    vector?: unknown;
    lerp_mode?: string;
  };

  const lerp = parseLerpMode(obj.lerp_mode);
  const post = obj.post !== undefined ? toVec3Expr(obj.post) : obj.vector !== undefined ? toVec3Expr(obj.vector) : ([0, 0, 0] as Vec3Expr);
  const pre = obj.pre !== undefined ? toVec3Expr(obj.pre) : post;

  return { time, pre, post, lerp };
}

function parseLerpMode(raw: unknown): LerpMode {
  if (raw === "catmullrom") return "catmullrom";
  if (raw === "step") return "step";
  return "linear";
}

function toVec3Expr(raw: unknown): Vec3Expr {
  if (Array.isArray(raw)) {
    const a = raw[0];
    const b = raw[1];
    const c = raw[2];
    return [toScalar(a), toScalar(b), toScalar(c)];
  }
  if (typeof raw === "number" || typeof raw === "string") {
    const s = toScalar(raw);
    return [s, s, s];
  }
  if (raw && typeof raw === "object" && "vector" in (raw as Record<string, unknown>)) {
    return toVec3Expr((raw as Record<string, unknown>).vector);
  }
  return [0, 0, 0];
}

function toScalar(raw: unknown): ScalarExpr {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && /^-?[\d.]+$/.test(raw.trim())) return n;
    return raw;
  }
  return 0;
}

function vec3HasExpression(v: Vec3Expr): boolean {
  return typeof v[0] === "string" || typeof v[1] === "string" || typeof v[2] === "string";
}
