/**
 * Bedrock-format particle (.particle.json, format `1.10.0+`) — typed shapes.
 *
 * The runtime parses a `.particle.json` into a `ParsedParticleEffect`. All
 * Molang fields are stored as `ScalarExpr` / `Vec3Expr` (number | string)
 * and evaluated per-particle/per-frame against a `MolangContext`.
 *
 * Spec coverage matches the components actually emitted by Snowstorm and the
 * NRC asset library. Some niche components (`particle_motion_collision`'s
 * collision drag against world geometry, `particle_appearance_lighting` block
 * lighting) are typed but with simplified runtime behaviour — see emitter.ts.
 */

import type { ScalarExpr, Vec3Expr } from "../types";

// ---------- Render parameters ----------

export type ParticleMaterial = "alpha" | "blend" | "add" | "opaque";

/** How each billboard quad orients itself. Drives the vertex shader's branch. */
export type FacingMode =
  | "rotate_xyz"           // fully camera-facing, rotates with camera roll
  | "rotate_xz"            // camera-facing on Y but locked upright
  | "lookat_xyz"           // points at camera position (perspective-correct)
  | "lookat_xz"            // looks at camera, Y locked
  | "lookat_direction"     // forward = velocity direction; otherwise like lookat_xyz
  | "direction_x"          // axis-aligned to world X
  | "direction_y"          // axis-aligned to world Y
  | "direction_z"          // axis-aligned to world Z
  | "emitter_transform_xy" // axis-aligned to emitter's local XY plane
  | "emitter_transform_xz" // local XZ
  | "emitter_transform_yz"; // local YZ

// ---------- Emitter components ----------

/** How fast / when particles get spawned. */
export type EmitterRate =
  | { kind: "instant"; numParticles: ScalarExpr }
  | { kind: "steady"; spawnRate: ScalarExpr; maxParticles: ScalarExpr }
  | { kind: "manual"; maxParticles: ScalarExpr };

/** When the EMITTER itself stops emitting. */
export type EmitterLifetime =
  | { kind: "once"; activeTime: ScalarExpr }
  | { kind: "looping"; activeTime: ScalarExpr; sleepTime: ScalarExpr }
  | { kind: "expression"; activation: ScalarExpr; expiration: ScalarExpr };

/** Initial spawn direction relative to the shape. */
export type DirectionSpec =
  | { kind: "outwards" }
  | { kind: "inwards" }
  | { kind: "vector"; vector: Vec3Expr };

/** Emitter spawn volume. `surfaceOnly` makes spawns sit on the surface only. */
export type EmitterShape =
  | { kind: "point"; offset: Vec3Expr; direction: DirectionSpec }
  | {
      kind: "sphere";
      offset: Vec3Expr;
      radius: ScalarExpr;
      surfaceOnly: boolean;
      direction: DirectionSpec;
    }
  | {
      kind: "box";
      offset: Vec3Expr;
      halfDimensions: Vec3Expr;
      surfaceOnly: boolean;
      direction: DirectionSpec;
    }
  | {
      kind: "disc";
      offset: Vec3Expr;
      planeNormal: Vec3Expr;
      radius: ScalarExpr;
      surfaceOnly: boolean;
      direction: DirectionSpec;
    }
  | { kind: "entity_aabb"; surfaceOnly: boolean; direction: DirectionSpec }
  | { kind: "custom"; offset: Vec3Expr; direction: DirectionSpec };

export interface EmitterLocalSpace {
  /** When true, particle positions are relative to the emitter's transform. */
  position: boolean;
  /** When true, particle velocities track emitter rotation. */
  rotation: boolean;
  /** When true, emitter velocity is added to particle velocity at spawn. */
  velocity: boolean;
}

export interface EmitterInitialization {
  /** Run once at emitter creation (variable.* assignments etc.). */
  creation?: ScalarExpr;
  /** Run every emitter tick. */
  perUpdate?: ScalarExpr;
}

// ---------- Particle components ----------

/** When the particle expires. */
export type ParticleLifetime =
  | { kind: "expression"; maxLifetime: ScalarExpr; expiration?: ScalarExpr }
  | {
      kind: "events";
      creationEvent?: string;
      expirationEvent?: string;
      timeline: Record<number, string[]>;
    };

/** Per-particle physics + integration model. */
export type ParticleMotion =
  | {
      kind: "dynamic";
      linearAcceleration: Vec3Expr;
      linearDrag: ScalarExpr;
      rotationAcceleration: ScalarExpr;
      rotationDrag: ScalarExpr;
    }
  | {
      kind: "parametric";
      relativePosition?: Vec3Expr;
      direction?: Vec3Expr;
      rotation?: ScalarExpr;
    }
  | { kind: "static" }
  | {
      kind: "collision";
      radius: ScalarExpr;
      drag: ScalarExpr;
      restitution: ScalarExpr;
      expireOnContact: boolean;
      events: string[];
    };

/** Texture-atlas frame layout (flipbook over particle lifetime). */
export interface FlipbookSpec {
  /** Top-left UV in pixels. May be Molang. */
  baseUv: [ScalarExpr, ScalarExpr];
  /** Frame size in pixels. */
  sizeUv: [number, number];
  /** Pixels added to baseUv to advance one frame. */
  stepUv: [number, number];
  framesPerSecond: number;
  maxFrame: ScalarExpr;
  /** When true, animation length stretches to fit particle lifetime. */
  stretchToLifetime: boolean;
  loop: boolean;
}

/** Static UV — no animation, just a fixed sub-rect on the texture. */
export interface StaticUvSpec {
  offset: [ScalarExpr, ScalarExpr];
  size: [ScalarExpr, ScalarExpr];
}

export interface ParticleAppearanceBillboard {
  /** Quad world-space size [w, h]. */
  size: [ScalarExpr, ScalarExpr];
  facingMode: FacingMode;
  /** Used when facingMode is `lookat_direction` — overrides velocity-based dir. */
  customDirection?: Vec3Expr;
  /** Texture atlas dimensions in pixels (defaults: image-derived). */
  textureWidth: number;
  textureHeight: number;
  uv: { kind: "static"; spec: StaticUvSpec } | { kind: "flipbook"; spec: FlipbookSpec };
}

/** Per-particle color. */
export type ParticleTinting =
  | { kind: "constant"; color: [number, number, number, number] }
  | {
      kind: "gradient";
      colors: Array<{ time: number; rgba: [number, number, number, number] }>;
      interpolant: ScalarExpr;
    }
  | {
      kind: "expression";
      rgba: [ScalarExpr, ScalarExpr, ScalarExpr, ScalarExpr];
    };

export interface ParticleInitialSpin {
  /** Initial rotation around facing axis (degrees). */
  rotation: ScalarExpr;
  /** Rotation rate (degrees/sec). */
  rotationRate: ScalarExpr;
}

export interface ParticleInitialization {
  /** Run every particle tick. */
  perUpdate?: ScalarExpr;
  /** Run before each render — can affect appearance without changing simulation state. */
  perRender?: ScalarExpr;
}

// ---------- Events ----------

/**
 * A named event that can fire from emitter/particle keyframes. Can spawn
 * other particles, play sounds, set variables, randomise between sub-events,
 * or run a sequence of sub-events.
 */
export interface ParticleEvent {
  particleEffect?: {
    effect: string;
    type: "emitter" | "emitter_bound" | "particle";
    preEffectExpression?: ScalarExpr;
  };
  particleEffectOnEntity?: {
    effect: string;
    preEffectExpression?: ScalarExpr;
  };
  soundEffect?: { eventName: string };
  setExpressions?: Record<string, ScalarExpr>;
  randomize?: Array<{ weight: number; event: string }>;
  sequence?: string[];
  /** Side-effect expression — `variable.x = 5` etc. */
  expression?: ScalarExpr;
}

// ---------- Curves ----------

export interface ParticleCurve {
  type: "linear" | "bezier" | "bezier_chain" | "catmull_rom";
  /** Molang expression that produces the input value (typically `query.particle_age`). */
  input: ScalarExpr;
  /** [min, max] of the input that maps to the node array. */
  range: [ScalarExpr, ScalarExpr];
  /** Optional override of `range`. Bedrock has both fields; if present, takes precedence. */
  horizontalRange?: [ScalarExpr, ScalarExpr];
  /** Output values at evenly-spaced positions across the input range. */
  nodes: number[];
}

// ---------- Top-level ----------

export interface ParsedParticleEffect {
  formatVersion: string;
  identifier: string;
  material: ParticleMaterial;
  /** Raw Bedrock texture reference like `noriskclient-cosmetics:flower/heart.particle`.
   *  Caller resolves to a fetchable URL via the `resolveTexture` callback. */
  textureRef: string;

  rate: EmitterRate;
  emitterLifetime: EmitterLifetime;
  shape: EmitterShape;
  localSpace: EmitterLocalSpace;
  emitterInit: EmitterInitialization;

  particleLifetime: ParticleLifetime;
  initialSpeed: ScalarExpr;
  initialSpin: ParticleInitialSpin;
  motion: ParticleMotion;
  appearance: ParticleAppearanceBillboard;
  tinting: ParticleTinting;
  environmentLighting: boolean;
  particleInit: ParticleInitialization;

  events: Record<string, ParticleEvent>;
  curves: Record<string, ParticleCurve>;
}
