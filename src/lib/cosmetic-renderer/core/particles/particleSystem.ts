import * as THREE from "three";

import { createBillboardMaterial, FACING_MODE_INDEX, INSTANCE_ATTRS } from "./billboardMaterial";
import { Emitter, type EmitterOptions, type PositionProvider } from "./emitter";

import type { LoadedParticleEffect } from "./loadParticle";
import type { ParsedParticleEffect } from "./types";

/**
 * Top-level particle container. Instantiate once per scene, hang
 * `system.root` in your Three.js graph, register all known effects, then call
 * `spawn(effectId, opts)` whenever a keyframe / cosmetic mount fires.
 *
 * Rendering: one `InstancedMesh` per registered effect. All emitter instances
 * of that effect share the same mesh — we compact every emitter's live
 * particles into the shared instance buffer each `tick()`.
 *
 * Why one mesh per effect (vs one per (mat, tex) combo): per-effect lets us
 * keep texture + material 1:1 with the InstancedMesh and avoid texture-array
 * shader complexity. The downside is more draw calls for scenes with many
 * effects; for our use case (~5 effects per emote, ~1-2 per cosmetic) this is
 * fine.
 */
export class ParticleSystem {
  /** Mount this on your scene. */
  readonly root = new THREE.Group();

  /** Default per-effect instance capacity. Caller may override per-effect via register options. */
  private readonly maxInstancesDefault: number;

  private readonly effects = new Map<string, RegisteredEffect>();
  private readonly emitters: EmitterEntry[] = [];

  /** Reusable sentinel so we don't allocate a Vector3 every emitter spawn. */
  private static readonly SCRATCH_V3 = new THREE.Vector3();

  constructor(opts?: { maxInstancesPerEffect?: number }) {
    this.maxInstancesDefault = opts?.maxInstancesPerEffect ?? 256;
    this.root.name = "ParticleSystem";
  }

  /**
   * Register a loaded particle effect. The `effectId` should be the
   * `description.identifier` from the JSON (e.g. `noriskclient-cosmetics:flower`)
   * — whatever string the keyframe / cosmetic-attach uses to refer to it.
   */
  register(
    effectId: string,
    loaded: LoadedParticleEffect,
    options: { maxInstances?: number } = {}
  ): void {
    if (this.effects.has(effectId)) return;
    const max = options.maxInstances ?? this.maxInstancesDefault;
    const entry = createRegisteredEffect(loaded.effect, loaded.texture, max);
    this.root.add(entry.mesh);
    this.effects.set(effectId, entry);
  }

  /** Look up a registered effect — handy for the caller to verify before spawn(). */
  hasEffect(effectId: string): boolean {
    return this.effects.has(effectId);
  }

  /** Spawn a new emitter instance of the given effect at world or attached position. */
  spawn(effectId: string, opts: SpawnOptions): EmitterHandle {
    const reg = this.effects.get(effectId);
    if (!reg) {
      // Soft-fail: return a no-op handle so callers don't have to check.
      return DEAD_HANDLE;
    }
    const emitter = new Emitter(reg.effect, opts as EmitterOptions);
    const entry: EmitterEntry = { emitter, reg };
    this.emitters.push(entry);
    return {
      stop: () => emitter.stop(),
      finish: () => emitter.finish(),
      isAlive: () => !emitter.isFinished(),
    };
  }

  /**
   * Per-frame update. Call from your render loop with monotonically-increasing
   * `elapsed` and the time delta since the previous tick.
   */
  tick(elapsed: number, deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;

    // Tick all emitters; drop finished ones.
    let writeIdx = 0;
    for (let i = 0; i < this.emitters.length; i++) {
      const entry = this.emitters[i];
      entry.emitter.tick(elapsed, deltaSeconds);
      if (entry.emitter.isFinished()) continue;
      if (i !== writeIdx) this.emitters[writeIdx] = entry;
      writeIdx++;
    }
    this.emitters.length = writeIdx;

    // Per registered effect: gather live particles from every emitter of that
    // effect, write into the InstancedMesh attribute buffers, set instance
    // count, mark needsUpdate.
    for (const reg of this.effects.values()) {
      reg.activeCount = 0;
    }

    for (const entry of this.emitters) {
      const reg = entry.reg;
      const e = entry.emitter;
      const baseFacing = FACING_MODE_INDEX[reg.effect.appearance.facingMode] ?? 0;
      const cap = reg.maxInstances;
      for (let i = 0; i < e.particleCount; i++) {
        if (reg.activeCount >= cap) break;
        const p = e.particles[i];
        if (!p.alive) continue;
        const slot = reg.activeCount * 1;
        const pos = reg.attrPosition;
        const vel = reg.attrVelocity;
        const sz = reg.attrSize;
        const uv = reg.attrUvOffset;
        const us = reg.attrUvScale;
        const col = reg.attrColor;
        const rot = reg.attrRotation;
        const fm = reg.attrFacingMode;
        pos[slot * 3 + 0] = p.position.x;
        pos[slot * 3 + 1] = p.position.y;
        pos[slot * 3 + 2] = p.position.z;
        vel[slot * 3 + 0] = p.velocity.x;
        vel[slot * 3 + 1] = p.velocity.y;
        vel[slot * 3 + 2] = p.velocity.z;
        sz[slot * 2 + 0] = p.size[0];
        sz[slot * 2 + 1] = p.size[1];
        uv[slot * 2 + 0] = p.uvOffset[0];
        uv[slot * 2 + 1] = p.uvOffset[1];
        us[slot * 2 + 0] = p.uvScale[0];
        us[slot * 2 + 1] = p.uvScale[1];
        col[slot * 4 + 0] = p.color[0];
        col[slot * 4 + 1] = p.color[1];
        col[slot * 4 + 2] = p.color[2];
        col[slot * 4 + 3] = p.color[3];
        // Rotation is degrees in the engine, radians in the shader.
        rot[slot] = (p.rotation * Math.PI) / 180;
        fm[slot] = baseFacing;
        reg.activeCount++;
      }
    }

    for (const reg of this.effects.values()) {
      // InstancedBufferGeometry doesn't have `instanceCount` on InstancedMesh —
      // we use a custom geometry on a Mesh. Three.js draws as many instances as
      // the smallest meshPerAttribute count; we manually clamp via
      // `geometry.instanceCount` available on InstancedBufferGeometry.
      reg.geometry.instanceCount = reg.activeCount;
      reg.attrPositionRef.needsUpdate = true;
      reg.attrVelocityRef.needsUpdate = true;
      reg.attrSizeRef.needsUpdate = true;
      reg.attrRotationRef.needsUpdate = true;
      reg.attrUvOffsetRef.needsUpdate = true;
      reg.attrUvScaleRef.needsUpdate = true;
      reg.attrColorRef.needsUpdate = true;
      reg.attrFacingModeRef.needsUpdate = true;
      reg.mesh.visible = reg.activeCount > 0;
    }
  }

  dispose(): void {
    for (const reg of this.effects.values()) {
      reg.geometry.dispose();
      reg.material.dispose();
      reg.texture.dispose();
      this.root.remove(reg.mesh);
    }
    this.effects.clear();
    this.emitters.length = 0;
    // Remove from parent (if mounted) so the caller doesn't have to.
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

// ---------- Public types ----------

export interface SpawnOptions {
  /** World-space position OR a callback evaluated each tick (for `bind_to_actor: true`). */
  positionProvider: PositionProvider;
  /** Override the parsed lifetime — useful for one-shot keyframes. */
  forceLifetime?: "once" | "looping";
  /** Pre-effect Molang from the spawning context (set variables before init). */
  preEffectExpression?: string;
}

export interface EmitterHandle {
  stop(): void;
  finish(): void;
  isAlive(): boolean;
}

const DEAD_HANDLE: EmitterHandle = {
  stop() {},
  finish() {},
  isAlive: () => false,
};

// ---------- Internals ----------

interface RegisteredEffect {
  effect: ParsedParticleEffect;
  texture: THREE.Texture;
  material: THREE.ShaderMaterial;
  geometry: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  maxInstances: number;
  activeCount: number;

  /** Backing typed arrays — written every tick. */
  attrPosition: Float32Array;
  attrVelocity: Float32Array;
  attrSize: Float32Array;
  attrRotation: Float32Array;
  attrUvOffset: Float32Array;
  attrUvScale: Float32Array;
  attrColor: Float32Array;
  attrFacingMode: Float32Array;

  /** The wrapping InstancedBufferAttribute objects (so we can `needsUpdate = true`). */
  attrPositionRef: THREE.InstancedBufferAttribute;
  attrVelocityRef: THREE.InstancedBufferAttribute;
  attrSizeRef: THREE.InstancedBufferAttribute;
  attrRotationRef: THREE.InstancedBufferAttribute;
  attrUvOffsetRef: THREE.InstancedBufferAttribute;
  attrUvScaleRef: THREE.InstancedBufferAttribute;
  attrColorRef: THREE.InstancedBufferAttribute;
  attrFacingModeRef: THREE.InstancedBufferAttribute;
}

interface EmitterEntry {
  emitter: Emitter;
  reg: RegisteredEffect;
}

function createRegisteredEffect(
  effect: ParsedParticleEffect,
  texture: THREE.Texture,
  max: number
): RegisteredEffect {
  // Plane in the XY plane, sized [-0.5, +0.5] — vertex shader scales/orients.
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", planeGeo.attributes.position);
  geometry.setAttribute("uv", planeGeo.attributes.uv);
  geometry.setIndex(planeGeo.index);

  const attrPosition = new Float32Array(max * 3);
  const attrVelocity = new Float32Array(max * 3);
  const attrSize = new Float32Array(max * 2);
  const attrRotation = new Float32Array(max * 1);
  const attrUvOffset = new Float32Array(max * 2);
  const attrUvScale = new Float32Array(max * 2);
  const attrColor = new Float32Array(max * 4);
  const attrFacingMode = new Float32Array(max * 1);

  const attrPositionRef = new THREE.InstancedBufferAttribute(attrPosition, 3);
  const attrVelocityRef = new THREE.InstancedBufferAttribute(attrVelocity, 3);
  const attrSizeRef = new THREE.InstancedBufferAttribute(attrSize, 2);
  const attrRotationRef = new THREE.InstancedBufferAttribute(attrRotation, 1);
  const attrUvOffsetRef = new THREE.InstancedBufferAttribute(attrUvOffset, 2);
  const attrUvScaleRef = new THREE.InstancedBufferAttribute(attrUvScale, 2);
  const attrColorRef = new THREE.InstancedBufferAttribute(attrColor, 4);
  const attrFacingModeRef = new THREE.InstancedBufferAttribute(attrFacingMode, 1);

  // Mark each as dynamic-usage so the GPU driver knows to expect frequent updates.
  attrPositionRef.setUsage(THREE.DynamicDrawUsage);
  attrVelocityRef.setUsage(THREE.DynamicDrawUsage);
  attrSizeRef.setUsage(THREE.DynamicDrawUsage);
  attrRotationRef.setUsage(THREE.DynamicDrawUsage);
  attrUvOffsetRef.setUsage(THREE.DynamicDrawUsage);
  attrUvScaleRef.setUsage(THREE.DynamicDrawUsage);
  attrColorRef.setUsage(THREE.DynamicDrawUsage);
  attrFacingModeRef.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute(INSTANCE_ATTRS.position, attrPositionRef);
  geometry.setAttribute(INSTANCE_ATTRS.velocity, attrVelocityRef);
  geometry.setAttribute(INSTANCE_ATTRS.size, attrSizeRef);
  geometry.setAttribute(INSTANCE_ATTRS.rotation, attrRotationRef);
  geometry.setAttribute(INSTANCE_ATTRS.uvOffset, attrUvOffsetRef);
  geometry.setAttribute(INSTANCE_ATTRS.uvScale, attrUvScaleRef);
  geometry.setAttribute(INSTANCE_ATTRS.color, attrColorRef);
  geometry.setAttribute(INSTANCE_ATTRS.facingMode, attrFacingModeRef);

  geometry.instanceCount = 0;

  const material = createBillboardMaterial({ texture, material: effect.material });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // Particles can be large/distant; cheaper to always draw.
  mesh.visible = false;

  // Don't dispose `planeGeo` — its `position`/`uv`/index BufferAttributes are
  // referenced by `geometry`. Disposing it would dispatch a `dispose` event
  // that frees the underlying GPU buffers Three.js shares between geometries.

  return {
    effect,
    texture,
    material,
    geometry,
    mesh,
    maxInstances: max,
    activeCount: 0,
    attrPosition,
    attrVelocity,
    attrSize,
    attrRotation,
    attrUvOffset,
    attrUvScale,
    attrColor,
    attrFacingMode,
    attrPositionRef,
    attrVelocityRef,
    attrSizeRef,
    attrRotationRef,
    attrUvOffsetRef,
    attrUvScaleRef,
    attrColorRef,
    attrFacingModeRef,
  };
}
