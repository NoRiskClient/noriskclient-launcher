import * as THREE from "three";

import type { FacingMode, ParticleMaterial } from "./types";

/**
 * Custom ShaderMaterial that orients each instanced quad according to its
 * `instanceFacingMode` and per-instance rotation/size, multiplied by a
 * per-instance RGBA tint and per-instance UV rect.
 *
 * Why a custom shader: Three.js' built-in Sprite + InstancedMesh combos don't
 * give us per-instance rotation around the camera axis _plus_ per-instance UV
 * sub-rect _plus_ several different facing modes (rotate_xyz vs lookat_xyz vs
 * direction_*). A single shader with a small branch is the simplest path.
 *
 * Particles are billboarded in view-space: the vertex shader takes the
 * instance's world position, transforms to view-space, then offsets by a
 * rotated quad in the plane perpendicular to the camera (or the chosen
 * facing axis). This makes facing-camera modes correct under any camera
 * yaw/pitch/roll without per-frame CPU updates of bone matrices.
 *
 * Facing-mode encoding (`instanceFacingMode` is a float per instance):
 *   0  rotate_xyz             — quad fully camera-facing, can roll
 *   1  rotate_xz              — yaw camera-facing, locked upright
 *   2  lookat_xyz             — points toward camera position
 *   3  lookat_xz              — points toward camera but Y axis world-up
 *   4  lookat_direction       — perpendicular to (camera - particle), aligned to velocity
 *   5  direction_x            — locked to world X
 *   6  direction_y            — locked to world Y
 *   7  direction_z            — locked to world Z
 *   8  emitter_transform_xy   — world XY plane (no emitter-local available without extra data)
 *   9  emitter_transform_xz   — world XZ plane
 *  10  emitter_transform_yz   — world YZ plane
 */

export const FACING_MODE_INDEX: Record<FacingMode, number> = {
  rotate_xyz: 0,
  rotate_xz: 1,
  lookat_xyz: 2,
  lookat_xz: 3,
  lookat_direction: 4,
  direction_x: 5,
  direction_y: 6,
  direction_z: 7,
  emitter_transform_xy: 8,
  emitter_transform_xz: 9,
  emitter_transform_yz: 10,
};

export interface BillboardMaterialOptions {
  texture: THREE.Texture;
  material: ParticleMaterial;
}

export function createBillboardMaterial({
  texture,
  material,
}: BillboardMaterialOptions): THREE.ShaderMaterial {
  const blending = blendingFor(material);
  const transparent = material !== "opaque";
  const depthWrite = material === "opaque";
  const alphaTest = material === "alpha" ? 0.01 : 0.0;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      alphaTest: { value: alphaTest },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent,
    depthWrite,
    depthTest: true,
    blending,
    side: THREE.DoubleSide,
  });

  return mat;
}

function blendingFor(m: ParticleMaterial): THREE.Blending {
  switch (m) {
    case "alpha":
    case "blend":
      return THREE.NormalBlending;
    case "add":
      return THREE.AdditiveBlending;
    case "opaque":
      return THREE.NoBlending;
  }
}

/**
 * Per-instance attribute names (consumed by the vertex shader).
 * Uploaded by `ParticleSystem` from each tick's particle pool.
 */
export const INSTANCE_ATTRS = {
  position: "iPosition",         // vec3 — world-space
  size: "iSize",                 // vec2 — quad half-width/height in world units
  rotation: "iRotation",         // float — radians around facing axis
  uvOffset: "iUvOffset",         // vec2
  uvScale: "iUvScale",           // vec2
  color: "iColor",               // vec4
  facingMode: "iFacingMode",     // float (index into FACING_MODE_INDEX)
  velocity: "iVelocity",         // vec3 — for lookat_direction
} as const;

const VERTEX_SHADER = /* glsl */ `
attribute vec3 iPosition;
attribute vec2 iSize;
attribute float iRotation;
attribute vec2 iUvOffset;
attribute vec2 iUvScale;
attribute vec4 iColor;
attribute float iFacingMode;
attribute vec3 iVelocity;

varying vec2 vUv;
varying vec4 vColor;

void main() {
  // Quad corner in [-0.5, +0.5] on each axis (Plane geometry comes pre-centered).
  vec2 corner = position.xy;

  // Apply per-instance rotation around the facing axis (in quad-local space).
  float c = cos(iRotation);
  float s = sin(iRotation);
  corner = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);

  // Scale by per-instance size.
  corner *= iSize;

  vec3 worldOffset;
  int mode = int(iFacingMode + 0.5);

  // Modes 0-1: rotate_xyz / rotate_xz — camera-facing in view space.
  if (mode == 0) {
    // rotate_xyz: quad lies in camera's right/up plane (full camera-facing).
    // viewMatrix transforms world→view; we want a vector in view space
    // converted back to world: invert the rotation by transposing the
    // view's 3x3 rotation block.
    mat3 invView = mat3(
      viewMatrix[0].xyz,
      viewMatrix[1].xyz,
      viewMatrix[2].xyz
    );
    // invView * (right, up, 0) where right=(1,0,0), up=(0,1,0) in view-space.
    vec3 right = vec3(invView[0][0], invView[1][0], invView[2][0]);
    vec3 up    = vec3(invView[0][1], invView[1][1], invView[2][1]);
    worldOffset = right * corner.x + up * corner.y;
  } else if (mode == 1) {
    // rotate_xz: camera-facing but Y locked upright (only yaw).
    vec3 toCam = cameraPosition - iPosition;
    toCam.y = 0.0;
    if (length(toCam) < 1e-5) toCam = vec3(0.0, 0.0, 1.0);
    vec3 forward = normalize(toCam);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, forward));
    worldOffset = right * corner.x + up * corner.y;
  } else if (mode == 2) {
    // lookat_xyz: identical to rotate_xyz for our purposes (perspective-correct camera-facing).
    mat3 invView = mat3(
      viewMatrix[0].xyz,
      viewMatrix[1].xyz,
      viewMatrix[2].xyz
    );
    vec3 right = vec3(invView[0][0], invView[1][0], invView[2][0]);
    vec3 up    = vec3(invView[0][1], invView[1][1], invView[2][1]);
    worldOffset = right * corner.x + up * corner.y;
  } else if (mode == 3) {
    // lookat_xz: like rotate_xz.
    vec3 toCam = cameraPosition - iPosition;
    toCam.y = 0.0;
    if (length(toCam) < 1e-5) toCam = vec3(0.0, 0.0, 1.0);
    vec3 forward = normalize(toCam);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, forward));
    worldOffset = right * corner.x + up * corner.y;
  } else if (mode == 4) {
    // lookat_direction: face camera, but quad's "up" follows velocity.
    vec3 toCam = normalize(cameraPosition - iPosition);
    vec3 vel = iVelocity;
    if (length(vel) < 1e-5) vel = vec3(0.0, 1.0, 0.0);
    vec3 up = normalize(vel - dot(vel, toCam) * toCam);
    if (length(up) < 1e-5) up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, toCam));
    worldOffset = right * corner.x + up * corner.y;
  } else if (mode == 5) {
    // direction_x: quad in YZ plane (face along world X).
    worldOffset = vec3(0.0, corner.y, corner.x);
  } else if (mode == 6) {
    // direction_y: quad in XZ plane.
    worldOffset = vec3(corner.x, 0.0, corner.y);
  } else if (mode == 7) {
    // direction_z: quad in XY plane.
    worldOffset = vec3(corner.x, corner.y, 0.0);
  } else if (mode == 8) {
    // emitter_transform_xy: world XY plane (no per-emitter rotation tracked).
    worldOffset = vec3(corner.x, corner.y, 0.0);
  } else if (mode == 9) {
    // emitter_transform_xz: world XZ plane.
    worldOffset = vec3(corner.x, 0.0, corner.y);
  } else if (mode == 10) {
    // emitter_transform_yz: world YZ plane.
    worldOffset = vec3(0.0, corner.x, corner.y);
  } else {
    worldOffset = vec3(corner.x, corner.y, 0.0);
  }

  vec3 worldPos = iPosition + worldOffset;
  vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // UV: incoming 'uv' is [0,1] across the plane geometry — map it onto the
  // sub-rect (offset, scale) for this particle (flipbook frame or static UV).
  vUv = iUvOffset + uv * iUvScale;
  vColor = iColor;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
uniform float alphaTest;

varying vec2 vUv;
varying vec4 vColor;

void main() {
  vec4 tex = texture2D(map, vUv);
  vec4 color = tex * vColor;
  if (color.a < alphaTest) discard;
  gl_FragColor = color;
}
`;
