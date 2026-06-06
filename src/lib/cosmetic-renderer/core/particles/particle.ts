import * as THREE from "three";

/**
 * Per-particle state. Pure data record — all behaviour lives in `Emitter`.
 *
 * Position is always world-space at the time of the latest tick.
 * `velocity` and `acceleration` are per-second deltas. `rotation` is degrees;
 * `rotationRate` is degrees/sec. `random` is the four `particle_random_*`
 * variables, fixed at spawn time.
 *
 * The fields after `random` are derived each tick — they're cached on the
 * particle so the renderer can read them without re-evaluating Molang.
 */
export class Particle {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  /** Cached for `query.particle_speed`. Updated once per tick. */
  speed = 0;
  rotation = 0;
  rotationRate = 0;
  age = 0;
  lifetime = 1;
  random: [number, number, number, number] = [0, 0, 0, 0];
  /** Per-particle variable scope (inherits emitter's at spawn). */
  variables = new Map<string, number>();

  /** Computed each tick by the emitter — read directly by the renderer. */
  size: [number, number] = [1, 1];
  color: [number, number, number, number] = [1, 1, 1, 1];
  uvOffset: [number, number] = [0, 0];
  uvScale: [number, number] = [1, 1];

  alive = true;
}
