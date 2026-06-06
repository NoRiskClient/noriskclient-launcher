/**
 * Parser for Bedrock `.particle.json` (Snowstorm-format) files.
 *
 * The structure looks like:
 *
 * ```jsonc
 * {
 *   "format_version": "1.10.0",
 *   "particle_effect": {
 *     "description": {
 *       "identifier": "namespace:name",
 *       "basic_render_parameters": { "material": "...", "texture": "..." }
 *     },
 *     "components": { "minecraft:emitter_rate_steady": { ... }, ... },
 *     "events":     { "myEvent": { ... } },
 *     "curves":     { "myCurve": { ... } }
 *   }
 * }
 * ```
 *
 * The component map is the bulk of the spec — each `minecraft:*` key maps to a
 * tagged variant of one of the union types in `./types.ts`. Defaults match
 * Wintersky's behaviour so files that omit fields produce sensible runtime
 * state.
 */

import type {
  DirectionSpec,
  EmitterInitialization,
  EmitterLifetime,
  EmitterLocalSpace,
  EmitterRate,
  EmitterShape,
  FacingMode,
  FlipbookSpec,
  ParsedParticleEffect,
  ParticleAppearanceBillboard,
  ParticleCurve,
  ParticleEvent,
  ParticleInitialSpin,
  ParticleInitialization,
  ParticleLifetime,
  ParticleMaterial,
  ParticleMotion,
  ParticleTinting,
  StaticUvSpec,
} from "./types";
import type { ScalarExpr, Vec3Expr } from "../types";

export function parseParticle(json: unknown): ParsedParticleEffect {
  const root = (json ?? {}) as {
    format_version?: string;
    particle_effect?: Record<string, unknown>;
  };

  const effect = (root.particle_effect ?? {}) as Record<string, unknown>;
  const description = (effect.description ?? {}) as Record<string, unknown>;
  const renderParams = (description.basic_render_parameters ?? {}) as Record<string, unknown>;
  const components = (effect.components ?? {}) as Record<string, unknown>;
  const eventsRaw = (effect.events ?? {}) as Record<string, unknown>;
  const curvesRaw = (effect.curves ?? {}) as Record<string, unknown>;

  return {
    formatVersion: typeof root.format_version === "string" ? root.format_version : "1.10.0",
    identifier: typeof description.identifier === "string" ? description.identifier : "",
    material: parseMaterial(renderParams.material),
    textureRef: typeof renderParams.texture === "string" ? renderParams.texture : "",

    rate: parseRate(components),
    emitterLifetime: parseEmitterLifetime(components),
    shape: parseShape(components),
    localSpace: parseLocalSpace(components),
    emitterInit: parseEmitterInit(components),

    particleLifetime: parseParticleLifetime(components),
    initialSpeed: parseScalar(components["minecraft:particle_initial_speed"], 0),
    initialSpin: parseInitialSpin(components),
    motion: parseMotion(components),
    appearance: parseAppearance(components),
    tinting: parseTinting(components),
    environmentLighting: "minecraft:particle_appearance_lighting" in components,
    particleInit: parseParticleInit(components),

    events: parseEvents(eventsRaw),
    curves: parseCurves(curvesRaw),
  };
}

// ---------- material ----------

function parseMaterial(raw: unknown): ParticleMaterial {
  switch (raw) {
    case "particles_alpha":
      return "alpha";
    case "particles_blend":
      return "blend";
    case "particles_add":
      return "add";
    case "particles_opaque":
      return "opaque";
  }
  return "alpha";
}

// ---------- rate ----------

function parseRate(comps: Record<string, unknown>): EmitterRate {
  const instant = comps["minecraft:emitter_rate_instant"] as Record<string, unknown> | undefined;
  if (instant) {
    return { kind: "instant", numParticles: parseScalar(instant.num_particles, 0) };
  }
  const steady = comps["minecraft:emitter_rate_steady"] as Record<string, unknown> | undefined;
  if (steady) {
    return {
      kind: "steady",
      spawnRate: parseScalar(steady.spawn_rate, 1),
      maxParticles: parseScalar(steady.max_particles, 50),
    };
  }
  const manual = comps["minecraft:emitter_rate_manual"] as Record<string, unknown> | undefined;
  if (manual) {
    return { kind: "manual", maxParticles: parseScalar(manual.max_particles, 50) };
  }
  // Fallback: behave like a 0-particle steady so runtime cleanly idles.
  return { kind: "steady", spawnRate: 0, maxParticles: 0 };
}

// ---------- emitter lifetime ----------

function parseEmitterLifetime(comps: Record<string, unknown>): EmitterLifetime {
  const once = comps["minecraft:emitter_lifetime_once"] as Record<string, unknown> | undefined;
  if (once) {
    return { kind: "once", activeTime: parseScalar(once.active_time, 1) };
  }
  const looping = comps["minecraft:emitter_lifetime_looping"] as Record<string, unknown> | undefined;
  if (looping) {
    return {
      kind: "looping",
      activeTime: parseScalar(looping.active_time, 1),
      sleepTime: parseScalar(looping.sleep_time, 0),
    };
  }
  const expr = comps["minecraft:emitter_lifetime_expression"] as Record<string, unknown> | undefined;
  if (expr) {
    return {
      kind: "expression",
      activation: parseScalar(expr.activation_expression, 1),
      expiration: parseScalar(expr.expiration_expression, 0),
    };
  }
  return { kind: "looping", activeTime: 1, sleepTime: 0 };
}

// ---------- shape ----------

function parseShape(comps: Record<string, unknown>): EmitterShape {
  const point = comps["minecraft:emitter_shape_point"] as Record<string, unknown> | undefined;
  if (point) {
    return {
      kind: "point",
      offset: parseVec3(point.offset, [0, 0, 0]),
      direction: parseDirection(point.direction),
    };
  }
  const sphere = comps["minecraft:emitter_shape_sphere"] as Record<string, unknown> | undefined;
  if (sphere) {
    return {
      kind: "sphere",
      offset: parseVec3(sphere.offset, [0, 0, 0]),
      radius: parseScalar(sphere.radius, 1),
      surfaceOnly: sphere.surface_only === true,
      direction: parseDirection(sphere.direction),
    };
  }
  const box = comps["minecraft:emitter_shape_box"] as Record<string, unknown> | undefined;
  if (box) {
    return {
      kind: "box",
      offset: parseVec3(box.offset, [0, 0, 0]),
      halfDimensions: parseVec3(box.half_dimensions, [1, 1, 1]),
      surfaceOnly: box.surface_only === true,
      direction: parseDirection(box.direction),
    };
  }
  const disc = comps["minecraft:emitter_shape_disc"] as Record<string, unknown> | undefined;
  if (disc) {
    return {
      kind: "disc",
      offset: parseVec3(disc.offset, [0, 0, 0]),
      planeNormal: parseVec3(disc.plane_normal, [0, 1, 0]),
      radius: parseScalar(disc.radius, 1),
      surfaceOnly: disc.surface_only === true,
      direction: parseDirection(disc.direction),
    };
  }
  const aabb = comps["minecraft:emitter_shape_entity_aabb"] as Record<string, unknown> | undefined;
  if (aabb) {
    return {
      kind: "entity_aabb",
      surfaceOnly: aabb.surface_only === true,
      direction: parseDirection(aabb.direction),
    };
  }
  const custom = comps["minecraft:emitter_shape_custom"] as Record<string, unknown> | undefined;
  if (custom) {
    return {
      kind: "custom",
      offset: parseVec3(custom.offset, [0, 0, 0]),
      direction: parseDirection(custom.direction),
    };
  }
  return { kind: "point", offset: [0, 0, 0], direction: { kind: "outwards" } };
}

function parseDirection(raw: unknown): DirectionSpec {
  if (raw === "outwards" || raw === undefined) return { kind: "outwards" };
  if (raw === "inwards") return { kind: "inwards" };
  if (Array.isArray(raw) && raw.length === 3) {
    return { kind: "vector", vector: parseVec3(raw, [0, 1, 0]) };
  }
  return { kind: "outwards" };
}

function parseLocalSpace(comps: Record<string, unknown>): EmitterLocalSpace {
  const ls = comps["minecraft:emitter_local_space"] as Record<string, unknown> | undefined;
  if (!ls) return { position: false, rotation: false, velocity: false };
  return {
    position: ls.position === true,
    rotation: ls.rotation === true,
    velocity: ls.velocity === true,
  };
}

function parseEmitterInit(comps: Record<string, unknown>): EmitterInitialization {
  const init = comps["minecraft:emitter_initialization"] as Record<string, unknown> | undefined;
  if (!init) return {};
  return {
    creation: typeof init.creation_expression !== "undefined"
      ? parseScalar(init.creation_expression, 0)
      : undefined,
    perUpdate: typeof init.per_update_expression !== "undefined"
      ? parseScalar(init.per_update_expression, 0)
      : undefined,
  };
}

// ---------- particle lifetime ----------

function parseParticleLifetime(comps: Record<string, unknown>): ParticleLifetime {
  const expr = comps["minecraft:particle_lifetime_expression"] as Record<string, unknown> | undefined;
  if (expr) {
    return {
      kind: "expression",
      maxLifetime: parseScalar(expr.max_lifetime, 1),
      expiration: typeof expr.expiration_expression !== "undefined"
        ? parseScalar(expr.expiration_expression, 0)
        : undefined,
    };
  }
  const events = comps["minecraft:particle_lifetime_events"] as Record<string, unknown> | undefined;
  if (events) {
    const tlRaw = (events.timeline ?? {}) as Record<string, unknown>;
    const timeline: Record<number, string[]> = {};
    for (const [timeKey, value] of Object.entries(tlRaw)) {
      const t = Number.parseFloat(timeKey);
      if (!Number.isFinite(t)) continue;
      if (typeof value === "string") timeline[t] = [value];
      else if (Array.isArray(value)) {
        timeline[t] = value.filter((v): v is string => typeof v === "string");
      }
    }
    return {
      kind: "events",
      creationEvent: typeof events.creation_event === "string" ? events.creation_event : undefined,
      expirationEvent: typeof events.expiration_event === "string" ? events.expiration_event : undefined,
      timeline,
    };
  }
  return { kind: "expression", maxLifetime: 1 };
}

function parseInitialSpin(comps: Record<string, unknown>): ParticleInitialSpin {
  const spin = comps["minecraft:particle_initial_spin"] as Record<string, unknown> | undefined;
  if (!spin) return { rotation: 0, rotationRate: 0 };
  return {
    rotation: parseScalar(spin.rotation, 0),
    rotationRate: parseScalar(spin.rotation_rate, 0),
  };
}

// ---------- motion ----------

function parseMotion(comps: Record<string, unknown>): ParticleMotion {
  const dyn = comps["minecraft:particle_motion_dynamic"] as Record<string, unknown> | undefined;
  if (dyn) {
    return {
      kind: "dynamic",
      linearAcceleration: parseVec3(dyn.linear_acceleration, [0, 0, 0]),
      linearDrag: parseScalar(dyn.linear_drag_coefficient, 0),
      rotationAcceleration: parseScalar(dyn.rotation_acceleration, 0),
      rotationDrag: parseScalar(dyn.rotation_drag_coefficient, 0),
    };
  }
  const par = comps["minecraft:particle_motion_parametric"] as Record<string, unknown> | undefined;
  if (par) {
    return {
      kind: "parametric",
      relativePosition: par.relative_position
        ? parseVec3(par.relative_position, [0, 0, 0])
        : undefined,
      direction: par.direction ? parseVec3(par.direction, [0, 0, 0]) : undefined,
      rotation: typeof par.rotation !== "undefined" ? parseScalar(par.rotation, 0) : undefined,
    };
  }
  if ("minecraft:particle_motion_static" in comps) return { kind: "static" };
  const col = comps["minecraft:particle_motion_collision"] as Record<string, unknown> | undefined;
  if (col) {
    return {
      kind: "collision",
      radius: parseScalar(col.collision_radius, 0.05),
      drag: parseScalar(col.collision_drag, 0),
      restitution: parseScalar(col.coefficient_of_restitution, 1),
      expireOnContact: col.expire_on_contact === true,
      events: Array.isArray(col.events)
        ? (col.events as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
    };
  }
  // Default: linear motion with no acceleration/drag.
  return {
    kind: "dynamic",
    linearAcceleration: [0, 0, 0],
    linearDrag: 0,
    rotationAcceleration: 0,
    rotationDrag: 0,
  };
}

// ---------- appearance ----------

function parseAppearance(comps: Record<string, unknown>): ParticleAppearanceBillboard {
  const bb = (comps["minecraft:particle_appearance_billboard"] ?? {}) as Record<string, unknown>;
  const sizeRaw = bb.size as unknown;
  const size: [ScalarExpr, ScalarExpr] = Array.isArray(sizeRaw) && sizeRaw.length >= 2
    ? [parseScalar(sizeRaw[0], 1), parseScalar(sizeRaw[1], 1)]
    : [1, 1];

  const facing = parseFacingMode(bb.facing_camera_mode);

  const dirRaw = bb.direction as unknown;
  let customDirection: Vec3Expr | undefined;
  if (Array.isArray(dirRaw) && dirRaw.length === 3) {
    customDirection = parseVec3(dirRaw, [0, 0, 0]);
  } else if (
    dirRaw &&
    typeof dirRaw === "object" &&
    (dirRaw as Record<string, unknown>).mode === "custom_direction"
  ) {
    const cd = (dirRaw as Record<string, unknown>).custom_direction;
    if (Array.isArray(cd)) customDirection = parseVec3(cd, [0, 0, 0]);
  }

  const uvRaw = (bb.uv ?? {}) as Record<string, unknown>;
  const textureWidth = typeof uvRaw.texture_width === "number" ? uvRaw.texture_width : 1;
  const textureHeight = typeof uvRaw.texture_height === "number" ? uvRaw.texture_height : 1;

  let uv: ParticleAppearanceBillboard["uv"];
  const flipbookRaw = uvRaw.flipbook as Record<string, unknown> | undefined;
  if (flipbookRaw) {
    uv = { kind: "flipbook", spec: parseFlipbook(flipbookRaw) };
  } else {
    const uvOff = uvRaw.uv as unknown;
    const uvSize = uvRaw.uv_size as unknown;
    const off: [ScalarExpr, ScalarExpr] = Array.isArray(uvOff) && uvOff.length >= 2
      ? [parseScalar(uvOff[0], 0), parseScalar(uvOff[1], 0)]
      : [0, 0];
    const sz: [ScalarExpr, ScalarExpr] = Array.isArray(uvSize) && uvSize.length >= 2
      ? [parseScalar(uvSize[0], textureWidth), parseScalar(uvSize[1], textureHeight)]
      : [textureWidth, textureHeight];
    uv = { kind: "static", spec: { offset: off, size: sz } as StaticUvSpec };
  }

  return {
    size,
    facingMode: facing,
    customDirection,
    textureWidth,
    textureHeight,
    uv,
  };
}

function parseFacingMode(raw: unknown): FacingMode {
  switch (raw) {
    case "rotate_xyz":
    case "rotate_xz":
    case "lookat_xyz":
    case "lookat_xz":
    case "lookat_direction":
    case "direction_x":
    case "direction_y":
    case "direction_z":
    case "emitter_transform_xy":
    case "emitter_transform_xz":
    case "emitter_transform_yz":
      return raw;
  }
  return "rotate_xyz";
}

function parseFlipbook(raw: Record<string, unknown>): FlipbookSpec {
  const baseRaw = raw.base_UV as unknown;
  const baseUv: [ScalarExpr, ScalarExpr] = Array.isArray(baseRaw) && baseRaw.length >= 2
    ? [parseScalar(baseRaw[0], 0), parseScalar(baseRaw[1], 0)]
    : [0, 0];
  const sizeRaw = raw.size_UV as unknown;
  const sizeUv: [number, number] = Array.isArray(sizeRaw) && sizeRaw.length >= 2
    ? [Number(sizeRaw[0]) || 0, Number(sizeRaw[1]) || 0]
    : [0, 0];
  const stepRaw = raw.step_UV as unknown;
  const stepUv: [number, number] = Array.isArray(stepRaw) && stepRaw.length >= 2
    ? [Number(stepRaw[0]) || 0, Number(stepRaw[1]) || 0]
    : [0, 0];
  return {
    baseUv,
    sizeUv,
    stepUv,
    framesPerSecond: typeof raw.frames_per_second === "number" ? raw.frames_per_second : 1,
    maxFrame: parseScalar(raw.max_frame, 1),
    stretchToLifetime: raw.stretch_to_lifetime === true,
    loop: raw.loop === true,
  };
}

// ---------- tinting ----------

function parseTinting(comps: Record<string, unknown>): ParticleTinting {
  const t = comps["minecraft:particle_appearance_tinting"] as Record<string, unknown> | undefined;
  if (!t) return { kind: "constant", color: [1, 1, 1, 1] };
  const colorRaw = t.color as unknown;

  // Static [R, G, B, A] (0–1).
  if (Array.isArray(colorRaw) && colorRaw.length >= 3 && typeof colorRaw[0] === "number") {
    const r = numOrZero(colorRaw[0]);
    const g = numOrZero(colorRaw[1]);
    const b = numOrZero(colorRaw[2]);
    const a = numOrOne(colorRaw[3]);
    return { kind: "constant", color: [r, g, b, a] };
  }

  // Expression [r, g, b, a] strings/Molang.
  if (Array.isArray(colorRaw) && colorRaw.length >= 3) {
    return {
      kind: "expression",
      rgba: [
        parseScalar(colorRaw[0], 1),
        parseScalar(colorRaw[1], 1),
        parseScalar(colorRaw[2], 1),
        parseScalar(colorRaw[3], 1),
      ],
    };
  }

  // Gradient { interpolant, gradient: { "0.0": [r,g,b,a], "1.0": [...] } }.
  if (colorRaw && typeof colorRaw === "object") {
    const obj = colorRaw as Record<string, unknown>;
    const grad = (obj.gradient ?? {}) as Record<string, unknown>;
    const colors: Array<{ time: number; rgba: [number, number, number, number] }> = [];
    for (const [k, v] of Object.entries(grad)) {
      const time = Number.parseFloat(k);
      if (!Number.isFinite(time) || !Array.isArray(v)) continue;
      colors.push({
        time,
        rgba: [numOrZero(v[0]), numOrZero(v[1]), numOrZero(v[2]), numOrOne(v[3])],
      });
    }
    colors.sort((a, b) => a.time - b.time);
    return {
      kind: "gradient",
      colors,
      interpolant: parseScalar(obj.interpolant, 0),
    };
  }

  return { kind: "constant", color: [1, 1, 1, 1] };
}

// ---------- particle init ----------

function parseParticleInit(comps: Record<string, unknown>): ParticleInitialization {
  const init = comps["minecraft:particle_initialization"] as Record<string, unknown> | undefined;
  if (!init) return {};
  return {
    perUpdate: typeof init.per_update_expression !== "undefined"
      ? parseScalar(init.per_update_expression, 0)
      : undefined,
    perRender: typeof init.per_render_expression !== "undefined"
      ? parseScalar(init.per_render_expression, 0)
      : undefined,
  };
}

// ---------- events ----------

function parseEvents(raw: Record<string, unknown>): Record<string, ParticleEvent> {
  const out: Record<string, ParticleEvent> = {};
  for (const [name, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object") continue;
    out[name] = parseSingleEvent(val as Record<string, unknown>);
  }
  return out;
}

function parseSingleEvent(obj: Record<string, unknown>): ParticleEvent {
  const ev: ParticleEvent = {};
  const peObj = obj.particle_effect as Record<string, unknown> | undefined;
  if (peObj && typeof peObj === "object") {
    const type =
      peObj.type === "emitter" ||
      peObj.type === "emitter_bound" ||
      peObj.type === "particle"
        ? peObj.type
        : "emitter";
    ev.particleEffect = {
      effect: typeof peObj.effect === "string" ? peObj.effect : "",
      type,
      preEffectExpression: typeof peObj.pre_effect_expression !== "undefined"
        ? parseScalar(peObj.pre_effect_expression, 0)
        : undefined,
    };
  }
  const peeObj = obj.particle_effect_on_entity as Record<string, unknown> | undefined;
  if (peeObj && typeof peeObj === "object") {
    ev.particleEffectOnEntity = {
      effect: typeof peeObj.effect === "string" ? peeObj.effect : "",
      preEffectExpression: typeof peeObj.pre_effect_expression !== "undefined"
        ? parseScalar(peeObj.pre_effect_expression, 0)
        : undefined,
    };
  }
  const seObj = obj.sound_effect as Record<string, unknown> | undefined;
  if (seObj && typeof seObj === "object") {
    ev.soundEffect = {
      eventName: typeof seObj.event_name === "string" ? seObj.event_name : "",
    };
  }
  const expr = obj.expression;
  if (typeof expr !== "undefined") {
    ev.expression = parseScalar(expr, 0);
  }
  const setObj = obj.set as Record<string, unknown> | undefined;
  if (setObj && typeof setObj === "object") {
    const out: Record<string, ScalarExpr> = {};
    for (const [k, v] of Object.entries(setObj)) out[k] = parseScalar(v, 0);
    ev.setExpressions = out;
  }
  const rand = obj.randomize as unknown;
  if (Array.isArray(rand)) {
    ev.randomize = [];
    for (const r of rand) {
      if (!r || typeof r !== "object") continue;
      const ro = r as Record<string, unknown>;
      ev.randomize.push({
        weight: typeof ro.weight === "number" ? ro.weight : 1,
        event: typeof ro.event === "string" ? ro.event : "",
      });
    }
  }
  const seq = obj.sequence as unknown;
  if (Array.isArray(seq)) {
    ev.sequence = (seq as unknown[]).filter((v): v is string => typeof v === "string");
  }
  return ev;
}

// ---------- curves ----------

function parseCurves(raw: Record<string, unknown>): Record<string, ParticleCurve> {
  const out: Record<string, ParticleCurve> = {};
  for (const [name, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object") continue;
    const obj = val as Record<string, unknown>;
    const type =
      obj.type === "linear" ||
      obj.type === "bezier" ||
      obj.type === "bezier_chain" ||
      obj.type === "catmull_rom"
        ? obj.type
        : "linear";

    let nodes: number[] = [];
    if (Array.isArray(obj.nodes)) {
      nodes = (obj.nodes as unknown[]).map((n) => Number(n) || 0);
    }

    const range = parseRange(obj.range, [0, 1]);
    const horizontalRange = obj.horizontal_range
      ? parseRange(obj.horizontal_range, [0, 1])
      : undefined;

    out[name] = {
      type,
      input: parseScalar(obj.input, 0),
      range,
      horizontalRange,
      nodes,
    };
  }
  return out;
}

function parseRange(raw: unknown, fallback: [ScalarExpr, ScalarExpr]): [ScalarExpr, ScalarExpr] {
  if (Array.isArray(raw) && raw.length >= 2) {
    return [parseScalar(raw[0], fallback[0]), parseScalar(raw[1], fallback[1])];
  }
  return fallback;
}

// ---------- atomic helpers ----------

function parseScalar(raw: unknown, fallback: ScalarExpr): ScalarExpr {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return fallback;
    // Pure-number strings collapse to numbers so the runtime skips Molang-eval.
    const asNum = Number(trimmed);
    if (!Number.isNaN(asNum) && /^-?[\d.]+$/.test(trimmed)) return asNum;
    return raw;
  }
  return fallback;
}

function parseVec3(raw: unknown, fallback: Vec3Expr): Vec3Expr {
  if (Array.isArray(raw)) {
    return [
      parseScalar(raw[0], fallback[0]),
      parseScalar(raw[1], fallback[1]),
      parseScalar(raw[2], fallback[2]),
    ];
  }
  return fallback;
}

function numOrZero(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}
function numOrOne(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
}
