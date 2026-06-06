/**
 * Public API of the particle module.
 *
 * Usage:
 *   import {
 *     ParticleSystem,
 *     loadParticle,
 *     parseParticle,
 *   } from "nrc-cosmetic-renderer/core";
 *
 *   const system = new ParticleSystem();
 *   scene.add(system.root);
 *
 *   const loaded = await loadParticle(jsonUrl, (texRef) => resolveTextureUrl(texRef));
 *   system.register(loaded.effect.identifier, loaded);
 *
 *   const handle = system.spawn(loaded.effect.identifier, {
 *     positionProvider: () => bone.getWorldPosition(new THREE.Vector3()),
 *   });
 *
 *   // each frame:
 *   system.tick(elapsedSeconds, deltaSeconds);
 *
 *   // teardown:
 *   handle.stop();
 *   system.dispose();
 */

export { parseParticle } from "./parseParticle";
export {
  loadParticle,
  disposeLoadedParticle,
  type LoadedParticleEffect,
  type ParticleAssetEntry,
} from "./loadParticle";
export {
  ParticleSystem,
  type SpawnOptions,
  type EmitterHandle,
} from "./particleSystem";
export { Emitter, type EmitterOptions, type PositionProvider } from "./emitter";
export { Particle } from "./particle";
export {
  createBillboardMaterial,
  FACING_MODE_INDEX,
  INSTANCE_ATTRS,
} from "./billboardMaterial";

export type {
  ParticleMaterial,
  FacingMode,
  EmitterRate,
  EmitterLifetime,
  EmitterShape,
  DirectionSpec,
  EmitterLocalSpace,
  EmitterInitialization,
  ParticleLifetime,
  ParticleMotion,
  FlipbookSpec,
  StaticUvSpec,
  ParticleAppearanceBillboard,
  ParticleTinting,
  ParticleInitialSpin,
  ParticleInitialization,
  ParticleEvent,
  ParticleCurve,
  ParsedParticleEffect,
} from "./types";
