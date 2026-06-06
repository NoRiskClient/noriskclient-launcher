import * as THREE from "three";

import { evalMolang, evalMolangBoolean, type MolangContext } from "../molang";

import { Particle } from "./particle";

import type {
  DirectionSpec,
  EmitterShape,
  ParsedParticleEffect,
  ParticleEvent,
  ParticleTinting,
} from "./types";

/**
 * Resolved at every tick, not at spawn — needed for `bind_to_actor: true`
 * (the emitter follows a moving bone).
 */
export type PositionProvider = THREE.Vector3 | (() => THREE.Vector3);

export interface EmitterOptions {
  positionProvider: PositionProvider;
  /** Force `once` when an emote keyframe should burst, regardless of the JSON's lifetime. */
  forceLifetime?: "once" | "looping";
  /** Pre-effect Molang from the spawning keyframe. Runs once before emitter init. */
  preEffectExpression?: string;
}

/**
 * One running instance of a `ParsedParticleEffect`.
 *
 * Owns its own Molang variable scope, particle pool, and lifecycle. Spawned by
 * `ParticleSystem.spawn(effectId, opts)`. The system calls `tick()` once per
 * frame and reads `particles` after — the renderer doesn't run any Molang on
 * its own.
 *
 * The emitter is finished when:
 *   - lifetime says so (once: activeTime elapsed; looping: never; expression: expiration true)
 *   - AND no live particles remain
 *
 * Once both conditions are true, `isFinished()` returns true and the system
 * GCs the instance.
 */
export class Emitter {
  /** Live particles, plus dead slots for reuse. `particleCount` is the live count. */
  private pool: Particle[] = [];
  /** Number of slots in `pool` currently alive. Dead slots may be re-used. */
  particleCount = 0;

  /** Wall time since `start()`. */
  age = 0;
  /** Emitter scope variables — lives across all particle spawns from this emitter. */
  variables = new Map<string, number>();
  /** Fixed at start: `variable.emitter_random_1..4`. */
  emitterRandom: [number, number, number, number] = [0, 0, 0, 0];
  /** Currently-active emitting? Looping toggles on/off across active/sleep. */
  emitting = true;
  /** Cached active-time / current-loop-time scalars (recomputed once per tick). */
  private activeTime = 0;
  /** Per-tick spawn accumulator for `steady` rate (carries fractional spawns across frames). */
  private spawnAccumulator = 0;
  /** Set true once `manual` rate has fired its initial spawn (to avoid auto-spawning). */
  private manualSpawned = false;
  /** Set true once any expiration condition has triggered — emitter stops emitting. */
  private expired = false;
  /** Set false on `finish()` — stops further spawning, lets live particles die naturally. */
  private softFinish = false;
  /** Set true on `stop()` — hard stop, particles cleared next tick. */
  private hardStop = false;

  /** Cached worldPosition of the emitter, refreshed each tick. */
  worldPosition = new THREE.Vector3();
  /** Position last tick — drives `localSpace.position` translation deltas. */
  private lastWorldPosition = new THREE.Vector3();

  constructor(
    public readonly effect: ParsedParticleEffect,
    private readonly options: EmitterOptions
  ) {
    for (let i = 0; i < 4; i++) this.emitterRandom[i] = Math.random();
    this.refreshWorldPosition();
    this.lastWorldPosition.copy(this.worldPosition);

    // Pre-effect: caller-supplied side-effect expression (e.g. `variable.x = 5`).
    if (options.preEffectExpression) {
      evalMolang(options.preEffectExpression, this.emitterCtx());
    }
    if (effect.emitterInit.creation) {
      evalMolang(effect.emitterInit.creation, this.emitterCtx());
    }

    // Instant-rate emits its full burst on first tick(); manual rate emits on
    // first tick() too unless an external API trigger gates it. Steady spawns
    // continuously while `emitting`.
  }

  /** External early-stop: kills every particle next tick + halts spawning. */
  stop(): void {
    this.hardStop = true;
    this.softFinish = true;
  }

  /** Soft stop: stop spawning, let live particles play out. */
  finish(): void {
    this.softFinish = true;
  }

  isFinished(): boolean {
    if (this.hardStop) return true;
    return this.expired && this.particleCount === 0;
  }

  /** Live particles only — caller must check `i < particleCount` to skip dead slots. */
  get particles(): readonly Particle[] {
    return this.pool;
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  tick(_elapsed: number, deltaSeconds: number): void {
    if (this.hardStop) {
      this.particleCount = 0;
      return;
    }

    this.age += deltaSeconds;
    this.refreshWorldPosition();

    // Apply local-space position translation to existing particles (they
    // follow the emitter when localSpace.position is true).
    if (this.effect.localSpace.position && this.particleCount > 0) {
      const dx = this.worldPosition.x - this.lastWorldPosition.x;
      const dy = this.worldPosition.y - this.lastWorldPosition.y;
      const dz = this.worldPosition.z - this.lastWorldPosition.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        for (let i = 0; i < this.particleCount; i++) {
          const p = this.pool[i];
          if (!p.alive) continue;
          p.position.x += dx;
          p.position.y += dy;
          p.position.z += dz;
        }
      }
    }
    this.lastWorldPosition.copy(this.worldPosition);

    // Run emitter-level per-update.
    if (this.effect.emitterInit.perUpdate) {
      evalMolang(this.effect.emitterInit.perUpdate, this.emitterCtx());
    }

    // Update emitter lifetime — sets `emitting` and `expired` flags.
    this.tickEmitterLifetime();

    // Spawn new particles if still emitting and not soft-finished.
    if (this.emitting && !this.softFinish) {
      this.spawnTick(deltaSeconds);
    }

    // Tick each live particle.
    this.tickParticles(deltaSeconds);
  }

  // -----------------------------------------------------------------------
  // Lifetime
  // -----------------------------------------------------------------------

  private tickEmitterLifetime(): void {
    if (this.options.forceLifetime === "once") {
      // Force-once: treat the JSON lifetime as `once`, using its activeTime
      // when available so steady-rate effects still fire for their full
      // duration. expression-lifetimes (rare) fall back to 1s.
      const lt = this.effect.emitterLifetime;
      let active = 1;
      if (lt.kind === "once" || lt.kind === "looping") {
        active = scalar(lt.activeTime, this.emitterCtx());
      }
      if (this.age >= active) {
        this.emitting = false;
        this.expired = true;
      }
      return;
    }
    if (this.options.forceLifetime === "looping") {
      // Loop forever; never expire on lifetime alone.
      this.emitting = true;
      return;
    }

    const lt = this.effect.emitterLifetime;
    switch (lt.kind) {
      case "once": {
        const active = scalar(lt.activeTime, this.emitterCtx());
        if (this.age >= active) {
          this.emitting = false;
          this.expired = true;
        }
        break;
      }
      case "looping": {
        const active = scalar(lt.activeTime, this.emitterCtx());
        const sleep = Math.max(0, scalar(lt.sleepTime, this.emitterCtx()));
        const cycle = active + sleep;
        if (cycle <= 0) {
          this.emitting = active > 0;
        } else {
          const phase = this.age % cycle;
          this.emitting = phase < active;
        }
        // looping never expires on its own
        break;
      }
      case "expression": {
        const ctx = this.emitterCtx();
        const active = evalMolangBoolean(lt.activation, ctx);
        const expire = evalMolangBoolean(lt.expiration, ctx);
        this.emitting = active && !expire;
        if (expire) this.expired = true;
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Spawning
  // -----------------------------------------------------------------------

  private spawnTick(deltaSeconds: number): void {
    const rate = this.effect.rate;
    if (rate.kind === "instant") {
      if (this.age - deltaSeconds <= 0) {
        // First tick — emit the burst.
        const n = Math.max(0, Math.floor(scalar(rate.numParticles, this.emitterCtx())));
        for (let i = 0; i < n; i++) this.spawnOne();
      }
      return;
    }
    if (rate.kind === "steady") {
      const ctx = this.emitterCtx();
      const spawnRate = Math.max(0, scalar(rate.spawnRate, ctx));
      const maxParticles = Math.max(0, Math.floor(scalar(rate.maxParticles, ctx)));
      this.spawnAccumulator += spawnRate * deltaSeconds;
      while (this.spawnAccumulator >= 1 && this.particleCount < maxParticles) {
        this.spawnAccumulator -= 1;
        this.spawnOne();
      }
      return;
    }
    if (rate.kind === "manual") {
      if (!this.manualSpawned) {
        this.manualSpawned = true;
        const n = Math.max(0, Math.floor(scalar(rate.maxParticles, this.emitterCtx())));
        for (let i = 0; i < n; i++) this.spawnOne();
      }
    }
  }

  /** Pick a slot in `pool`, init the particle in-place. */
  private spawnOne(): Particle {
    let p: Particle;
    if (this.particleCount < this.pool.length) {
      // Reuse the last dead slot or extend.
      p = this.pool[this.particleCount];
      if (!p) {
        p = new Particle();
        this.pool[this.particleCount] = p;
      }
    } else {
      p = new Particle();
      this.pool.push(p);
    }
    this.particleCount++;
    p.alive = true;

    // Per-particle randoms and variable scope (inherits emitter snapshot).
    p.random[0] = Math.random();
    p.random[1] = Math.random();
    p.random[2] = Math.random();
    p.random[3] = Math.random();
    p.variables.clear();
    for (const [k, v] of this.variables) p.variables.set(k, v);

    // Sample shape for spawn position + outward direction.
    const localPos = new THREE.Vector3();
    const localDir = new THREE.Vector3();
    sampleShape(this.effect.shape, this.emitterCtx(), localPos, localDir);

    // Spawn position: emitter origin + shape offset (always world-space at this point).
    p.position.set(
      this.worldPosition.x + localPos.x,
      this.worldPosition.y + localPos.y,
      this.worldPosition.z + localPos.z
    );

    // Direction → velocity at initialSpeed.
    const speed = scalar(this.effect.initialSpeed, this.emitterCtx());
    if (localDir.lengthSq() < 1e-9) {
      p.velocity.set(0, 0, 0);
    } else {
      localDir.normalize().multiplyScalar(speed);
      p.velocity.copy(localDir);
    }
    p.speed = p.velocity.length();

    p.rotation = scalar(this.effect.initialSpin.rotation, this.emitterCtx());
    p.rotationRate = scalar(this.effect.initialSpin.rotationRate, this.emitterCtx());
    p.age = 0;

    // Lifetime — only `expression` kind is fully supported; events kind sets a
    // long lifetime and relies on the timeline to expire it (not implemented).
    if (this.effect.particleLifetime.kind === "expression") {
      p.lifetime = scalar(this.effect.particleLifetime.maxLifetime, this.particleCtx(p));
    } else {
      p.lifetime = 5; // fallback for events-mode; renderer will let it tick out
    }
    if (p.lifetime <= 0) p.lifetime = 1;

    // Snap initial computed appearance so the very first frame renders correctly.
    this.computeAppearance(p);

    return p;
  }

  // -----------------------------------------------------------------------
  // Per-particle tick
  // -----------------------------------------------------------------------

  private tickParticles(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;

      p.age += dt;

      // Lifetime
      let expired = p.age >= p.lifetime;
      if (this.effect.particleLifetime.kind === "expression" && this.effect.particleLifetime.expiration) {
        if (evalMolangBoolean(this.effect.particleLifetime.expiration, this.particleCtx(p))) {
          expired = true;
        }
      }
      if (expired) {
        p.alive = false;
        continue;
      }

      // per_update particle expression
      if (this.effect.particleInit.perUpdate) {
        evalMolang(this.effect.particleInit.perUpdate, this.particleCtx(p));
      }

      // Motion integration
      this.integrateMotion(p, dt);

      // Per-render expression (runs even though we don't have a separate render pass).
      if (this.effect.particleInit.perRender) {
        evalMolang(this.effect.particleInit.perRender, this.particleCtx(p));
      }

      // Recompute size, color, UV from current age / random / variables.
      this.computeAppearance(p);

      if (i !== writeIdx) {
        // Compact: swap live particle into the previous gap.
        const tmp = this.pool[writeIdx];
        this.pool[writeIdx] = p;
        this.pool[i] = tmp;
      }
      writeIdx++;
    }
    this.particleCount = writeIdx;
  }

  private integrateMotion(p: Particle, dt: number): void {
    const motion = this.effect.motion;
    switch (motion.kind) {
      case "static":
        // No movement. Rotation rate still ticks if non-zero — matches Bedrock.
        p.rotation += p.rotationRate * dt;
        break;

      case "dynamic": {
        const ctx = this.particleCtx(p);
        const accel = vec3(motion.linearAcceleration, ctx);
        const drag = scalar(motion.linearDrag, ctx);
        // Drag is exponential (matches Wintersky/Bedrock).
        const dragMul = Math.max(0, 1 - drag * dt);

        p.velocity.x = (p.velocity.x + accel[0] * dt) * dragMul;
        p.velocity.y = (p.velocity.y + accel[1] * dt) * dragMul;
        p.velocity.z = (p.velocity.z + accel[2] * dt) * dragMul;

        p.position.x += p.velocity.x * dt;
        p.position.y += p.velocity.y * dt;
        p.position.z += p.velocity.z * dt;
        p.speed = p.velocity.length();

        const rotAccel = scalar(motion.rotationAcceleration, ctx);
        const rotDrag = scalar(motion.rotationDrag, ctx);
        const rotDragMul = Math.max(0, 1 - rotDrag * dt);
        p.rotationRate = (p.rotationRate + rotAccel * dt) * rotDragMul;
        p.rotation += p.rotationRate * dt;
        break;
      }

      case "parametric": {
        const ctx = this.particleCtx(p);
        if (motion.relativePosition) {
          const rp = vec3(motion.relativePosition, ctx);
          p.position.set(
            this.worldPosition.x + rp[0],
            this.worldPosition.y + rp[1],
            this.worldPosition.z + rp[2]
          );
        }
        if (motion.direction) {
          const d = vec3(motion.direction, ctx);
          p.velocity.set(d[0], d[1], d[2]);
          p.speed = p.velocity.length();
        }
        if (typeof motion.rotation !== "undefined") {
          p.rotation = scalar(motion.rotation, ctx);
        }
        break;
      }

      case "collision": {
        // Simplified: Y=0 ground plane (no real world geometry in the renderer).
        const ctx = this.particleCtx(p);
        const drag = scalar(motion.drag, ctx);
        const restitution = scalar(motion.restitution, ctx);
        const dragMul = Math.max(0, 1 - drag * dt);
        p.velocity.y -= 9.81 * dt; // gravity, matches Bedrock default
        p.velocity.x *= dragMul;
        p.velocity.z *= dragMul;
        p.position.x += p.velocity.x * dt;
        p.position.y += p.velocity.y * dt;
        p.position.z += p.velocity.z * dt;
        if (p.position.y < 0) {
          p.position.y = 0;
          p.velocity.y = -p.velocity.y * restitution;
          if (motion.expireOnContact) p.alive = false;
        }
        p.speed = p.velocity.length();
        p.rotation += p.rotationRate * dt;
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Per-particle appearance
  // -----------------------------------------------------------------------

  private computeAppearance(p: Particle): void {
    const ctx = this.particleCtx(p);

    // Size
    p.size[0] = scalar(this.effect.appearance.size[0], ctx);
    p.size[1] = scalar(this.effect.appearance.size[1], ctx);

    // Color / tinting
    const tintColor = sampleTinting(this.effect.tinting, ctx);
    p.color[0] = tintColor[0];
    p.color[1] = tintColor[1];
    p.color[2] = tintColor[2];
    p.color[3] = tintColor[3];

    // UV — flipbook over particle age, OR static UV per the spec.
    const app = this.effect.appearance;
    const tw = app.textureWidth || 1;
    const th = app.textureHeight || 1;
    if (app.uv.kind === "flipbook") {
      const fb = app.uv.spec;
      const baseU = scalar(fb.baseUv[0], ctx);
      const baseV = scalar(fb.baseUv[1], ctx);
      const maxFrame = Math.max(1, Math.floor(scalar(fb.maxFrame, ctx)));
      let frame = 0;
      if (fb.stretchToLifetime) {
        const t = p.lifetime > 0 ? p.age / p.lifetime : 0;
        frame = Math.floor(t * maxFrame);
        if (fb.loop) frame = ((frame % maxFrame) + maxFrame) % maxFrame;
        else frame = Math.min(frame, maxFrame - 1);
      } else {
        frame = Math.floor(p.age * fb.framesPerSecond);
        if (fb.loop) frame = ((frame % maxFrame) + maxFrame) % maxFrame;
        else frame = Math.min(frame, maxFrame - 1);
      }
      const u0 = (baseU + fb.stepUv[0] * frame) / tw;
      const v0 = (baseV + fb.stepUv[1] * frame) / th;
      const us = fb.sizeUv[0] / tw;
      const vs = fb.sizeUv[1] / th;
      p.uvOffset[0] = u0;
      p.uvOffset[1] = v0;
      p.uvScale[0] = us;
      p.uvScale[1] = vs;
    } else {
      const sp = app.uv.spec;
      const u0 = scalar(sp.offset[0], ctx) / tw;
      const v0 = scalar(sp.offset[1], ctx) / th;
      const us = scalar(sp.size[0], ctx) / tw;
      const vs = scalar(sp.size[1], ctx) / th;
      p.uvOffset[0] = u0;
      p.uvOffset[1] = v0;
      p.uvScale[0] = us;
      p.uvScale[1] = vs;
    }
  }

  // -----------------------------------------------------------------------
  // Molang contexts
  // -----------------------------------------------------------------------

  private emitterCtx(): MolangContext {
    return {
      animTime: this.age,
      emitterAge: this.age,
      emitterLifetime: this.cachedEmitterLifetime(),
      emitterRandom: this.emitterRandom,
      variables: this.variables,
      curves: this.effect.curves,
    };
  }

  private particleCtx(p: Particle): MolangContext {
    return {
      animTime: p.age,
      particleAge: p.age,
      particleLifetime: p.lifetime,
      particleSpeed: p.speed,
      particleRandom: p.random,
      emitterAge: this.age,
      emitterLifetime: this.cachedEmitterLifetime(),
      emitterRandom: this.emitterRandom,
      variables: p.variables,
      curves: this.effect.curves,
    };
  }

  private cachedEmitterLifetime(): number {
    if (this.activeTime > 0) return this.activeTime;
    const lt = this.effect.emitterLifetime;
    let val = 1;
    if (lt.kind === "once") val = scalar(lt.activeTime, { variables: this.variables, curves: this.effect.curves });
    else if (lt.kind === "looping") val = scalar(lt.activeTime, { variables: this.variables, curves: this.effect.curves });
    else val = 1;
    this.activeTime = val;
    return val;
  }

  private refreshWorldPosition(): void {
    const provider = this.options.positionProvider;
    if (typeof provider === "function") {
      const v = provider();
      this.worldPosition.copy(v);
    } else {
      this.worldPosition.copy(provider);
    }
  }
}

// ---------- Helpers ----------

function scalar(expr: number | string, ctx: MolangContext): number {
  return evalMolang(expr, ctx);
}

function vec3(
  v: readonly [number | string, number | string, number | string],
  ctx: MolangContext
): [number, number, number] {
  return [scalar(v[0], ctx), scalar(v[1], ctx), scalar(v[2], ctx)];
}

/** Sample a spawn position + outward direction from the shape. Writes into the out vectors. */
function sampleShape(
  shape: EmitterShape,
  ctx: MolangContext,
  outPos: THREE.Vector3,
  outDir: THREE.Vector3
): void {
  switch (shape.kind) {
    case "point": {
      const off = vec3(shape.offset, ctx);
      outPos.set(off[0], off[1], off[2]);
      applyDirection(shape.direction, ctx, outPos, outDir);
      return;
    }
    case "sphere": {
      const off = vec3(shape.offset, ctx);
      const r = scalar(shape.radius, ctx);
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * 2 * Math.PI;
      const sample = new THREE.Vector3(
        Math.sqrt(1 - u * u) * Math.cos(phi),
        u,
        Math.sqrt(1 - u * u) * Math.sin(phi)
      );
      const dist = shape.surfaceOnly ? r : r * Math.cbrt(Math.random());
      sample.multiplyScalar(dist);
      outPos.set(off[0] + sample.x, off[1] + sample.y, off[2] + sample.z);
      applyDirection(shape.direction, ctx, outPos, outDir, off);
      return;
    }
    case "box": {
      const off = vec3(shape.offset, ctx);
      const half = vec3(shape.halfDimensions, ctx);
      let x: number, y: number, z: number;
      if (shape.surfaceOnly) {
        // Pick a face uniformly weighted by area, then a random point on it.
        const ax = half[1] * half[2];
        const ay = half[0] * half[2];
        const az = half[0] * half[1];
        const total = (ax + ay + az) * 2;
        const r = Math.random() * total;
        if (r < ax) {
          x = half[0];
          y = (Math.random() * 2 - 1) * half[1];
          z = (Math.random() * 2 - 1) * half[2];
        } else if (r < 2 * ax) {
          x = -half[0];
          y = (Math.random() * 2 - 1) * half[1];
          z = (Math.random() * 2 - 1) * half[2];
        } else if (r < 2 * ax + ay) {
          y = half[1];
          x = (Math.random() * 2 - 1) * half[0];
          z = (Math.random() * 2 - 1) * half[2];
        } else if (r < 2 * ax + 2 * ay) {
          y = -half[1];
          x = (Math.random() * 2 - 1) * half[0];
          z = (Math.random() * 2 - 1) * half[2];
        } else if (r < 2 * ax + 2 * ay + az) {
          z = half[2];
          x = (Math.random() * 2 - 1) * half[0];
          y = (Math.random() * 2 - 1) * half[1];
        } else {
          z = -half[2];
          x = (Math.random() * 2 - 1) * half[0];
          y = (Math.random() * 2 - 1) * half[1];
        }
      } else {
        x = (Math.random() * 2 - 1) * half[0];
        y = (Math.random() * 2 - 1) * half[1];
        z = (Math.random() * 2 - 1) * half[2];
      }
      outPos.set(off[0] + x, off[1] + y, off[2] + z);
      applyDirection(shape.direction, ctx, outPos, outDir, off);
      return;
    }
    case "disc": {
      const off = vec3(shape.offset, ctx);
      const normal = new THREE.Vector3(...vec3(shape.planeNormal, ctx));
      if (normal.lengthSq() < 1e-9) normal.set(0, 1, 0);
      normal.normalize();
      const r = scalar(shape.radius, ctx);
      const dist = shape.surfaceOnly ? r : r * Math.sqrt(Math.random());
      const angle = Math.random() * 2 * Math.PI;
      // Build orthonormal basis around normal.
      const up = Math.abs(normal.y) < 0.99
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const tangent = new THREE.Vector3().crossVectors(up, normal).normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
      const sample = new THREE.Vector3()
        .copy(tangent).multiplyScalar(Math.cos(angle) * dist)
        .addScaledVector(bitangent, Math.sin(angle) * dist);
      outPos.set(off[0] + sample.x, off[1] + sample.y, off[2] + sample.z);
      applyDirection(shape.direction, ctx, outPos, outDir, off);
      return;
    }
    case "entity_aabb": {
      // No real entity AABB in the web renderer — degenerate to a unit cube around origin.
      const x = (Math.random() * 2 - 1) * 0.5;
      const y = Math.random();
      const z = (Math.random() * 2 - 1) * 0.5;
      outPos.set(x, y, z);
      applyDirection(shape.direction, ctx, outPos, outDir, [0, 0.5, 0]);
      return;
    }
    case "custom": {
      const off = vec3(shape.offset, ctx);
      outPos.set(off[0], off[1], off[2]);
      applyDirection(shape.direction, ctx, outPos, outDir);
      return;
    }
  }
}

/**
 * Resolve the direction spec relative to the spawn point. `outwards`/`inwards`
 * use the vector from the shape origin to the spawn position; explicit vectors
 * are used as-is. When there's no meaningful direction (point shape, or any
 * shape where the spawn happens to land at the origin), we generate a uniform
 * random unit vector — Wintersky's behaviour.
 */
function applyDirection(
  direction: DirectionSpec,
  ctx: MolangContext,
  spawnPos: THREE.Vector3,
  outDir: THREE.Vector3,
  shapeOrigin: [number, number, number] = [0, 0, 0]
): void {
  if (direction.kind === "vector") {
    const v = vec3(direction.vector, ctx);
    outDir.set(v[0], v[1], v[2]);
    return;
  }
  outDir.set(spawnPos.x - shapeOrigin[0], spawnPos.y - shapeOrigin[1], spawnPos.z - shapeOrigin[2]);
  if (direction.kind === "inwards") outDir.multiplyScalar(-1);
  if (outDir.lengthSq() < 1e-9) {
    // No outward direction available (typical for point shapes). Use a
    // uniform random unit vector so particles fan out in all directions.
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(1 - u * u);
    outDir.set(r * Math.cos(phi), u, r * Math.sin(phi));
  }
}

/**
 * Evaluate the tinting block to a single RGBA value. Gradient picks the two
 * surrounding stops by interpolant, lerps between them.
 */
function sampleTinting(
  tinting: ParticleTinting,
  ctx: MolangContext
): [number, number, number, number] {
  if (tinting.kind === "constant") {
    return [...tinting.color];
  }
  if (tinting.kind === "expression") {
    return [
      scalar(tinting.rgba[0], ctx),
      scalar(tinting.rgba[1], ctx),
      scalar(tinting.rgba[2], ctx),
      scalar(tinting.rgba[3], ctx),
    ];
  }
  // Gradient
  const t = scalar(tinting.interpolant, ctx);
  const stops = tinting.colors;
  if (stops.length === 0) return [1, 1, 1, 1];
  if (stops.length === 1 || t <= stops[0].time) return [...stops[0].rgba];
  if (t >= stops[stops.length - 1].time) return [...stops[stops.length - 1].rgba];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const u = span === 0 ? 0 : (t - a.time) / span;
      return [
        a.rgba[0] + (b.rgba[0] - a.rgba[0]) * u,
        a.rgba[1] + (b.rgba[1] - a.rgba[1]) * u,
        a.rgba[2] + (b.rgba[2] - a.rgba[2]) * u,
        a.rgba[3] + (b.rgba[3] - a.rgba[3]) * u,
      ];
    }
  }
  return [...stops[stops.length - 1].rgba];
}

// Re-export ParticleEvent so consumers don't need a separate import.
export type { ParticleEvent };
