import * as THREE from "three";

import type {
  BedrockCube,
  BedrockFaceUv,
  FaceName,
  ParsedGeo,
  Vec3,
} from "./types";

const FACE_NAMES: ReadonlyArray<FaceName> = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
];

interface FaceUVRect {
  /** pixel-space UV rect, top-left-origin (texture.flipY = false). Always u0<u1, v0<v1. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Per-face Bedrock UV-flip flags: emerge from `mirror` and negative `uv_size`. */
  flipU?: boolean;
  flipV?: boolean;
}

interface FaceCorners {
  /** Bottom-left, bottom-right, top-right, top-left, in CCW order viewed from outside. */
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  v3: Vec3;
  normal: Vec3;
}

export interface CubeBuildOptions {
  /**
   * NRC cosmetics are authored in V2 LER-scaled space (= scale(-1,-1,1) was
   * historically applied at render time). With `negateX: true` we mirror the
   * cube on its X axis at parse time, matching the reference's
   * `GeoModelParser.parse(geometry, negateX = true)`. Animations and bone
   * pivots/rotations get the matching X-flip in their own builders.
   */
  negateX?: boolean;
}

/**
 * Build a non-indexed BufferGeometry for one Bedrock cube.
 *
 * Vertex coordinates are emitted in cube-world space (no pivot translate yet —
 * that's the caller's job, so cube rotation can pivot around the cube's pivot).
 *
 * Inflate widens the cube uniformly in all directions; UVs stay anchored to the
 * declared `size`, matching Bedrock's overlay behaviour.
 */
export function buildCubeGeometry(
  cube: BedrockCube,
  geo: ParsedGeo,
  options: CubeBuildOptions = {}
): THREE.BufferGeometry {
  const negateX = options.negateX ?? true;
  const origin = cube.origin ?? [0, 0, 0];
  const size = cube.size ?? [0, 0, 0];
  const inflate = cube.inflate ?? 0;
  const mirror = cube.mirror === true;

  // Bedrock-native bounds.
  const bxLo = origin[0] - inflate;
  const bxHi = origin[0] + size[0] + inflate;
  // Negate X mirrors the cube on the X axis. min/max swap and negate.
  const x0 = negateX ? -bxHi : bxLo;
  const x1 = negateX ? -bxLo : bxHi;
  const y0 = origin[1] - inflate;
  const z0 = origin[2] - inflate;
  const y1 = origin[1] + size[1] + inflate;
  const z1 = origin[2] + size[2] + inflate;

  const corners = buildFaceCorners(x0, y0, z0, x1, y1, z1);
  const uvRects = resolveUvRects(cube, size, negateX);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const face of FACE_NAMES) {
    const rect = uvRects[face];
    if (!rect) continue;
    appendFace(positions, normals, uvs, indices, corners[face], rect, geo, mirror);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function appendFace(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  corners: FaceCorners,
  rect: FaceUVRect,
  geo: ParsedGeo,
  mirror: boolean
) {
  const baseIdx = positions.length / 3;

  positions.push(
    ...corners.v0,
    ...corners.v1,
    ...corners.v2,
    ...corners.v3
  );
  for (let i = 0; i < 4; i++) normals.push(...corners.normal);

  const tw = geo.textureWidth || 64;
  const th = geo.textureHeight || 64;
  const uA = rect.u0 / tw;
  const uB = rect.u1 / tw;
  const vA = rect.v0 / th;
  const vB = rect.v1 / th;

  // Per-face flips: cube.mirror flips U on every face (Bedrock spec); a negative
  // `uv_size` axis flips that single axis (XOR'd with mirror).
  const flipU = (rect.flipU ?? false) !== mirror;
  const flipV = rect.flipV ?? false;

  // Default emit order, vertex sequence = bottom-left, bottom-right, top-right, top-left.
  // UV pixel rect: (u0,v0)=top-left, (u1,v1)=bottom-right.
  let blU = uA, blV = vB;
  let brU = uB, brV = vB;
  let trU = uB, trV = vA;
  let tlU = uA, tlV = vA;

  if (flipU) {
    [blU, brU] = [brU, blU];
    [tlU, trU] = [trU, tlU];
  }
  if (flipV) {
    [blV, tlV] = [tlV, blV];
    [brV, trV] = [trV, brV];
  }

  uvs.push(blU, blV, brU, brV, trU, trV, tlU, tlV);

  indices.push(
    baseIdx, baseIdx + 1, baseIdx + 2,
    baseIdx, baseIdx + 2, baseIdx + 3
  );
}

function buildFaceCorners(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number
): Record<FaceName, FaceCorners> {
  return {
    north: {
      v0: [x1, y0, z0], v1: [x0, y0, z0], v2: [x0, y1, z0], v3: [x1, y1, z0],
      normal: [0, 0, -1],
    },
    south: {
      v0: [x0, y0, z1], v1: [x1, y0, z1], v2: [x1, y1, z1], v3: [x0, y1, z1],
      normal: [0, 0, 1],
    },
    east: {
      v0: [x1, y0, z1], v1: [x1, y0, z0], v2: [x1, y1, z0], v3: [x1, y1, z1],
      normal: [1, 0, 0],
    },
    west: {
      v0: [x0, y0, z0], v1: [x0, y0, z1], v2: [x0, y1, z1], v3: [x0, y1, z0],
      normal: [-1, 0, 0],
    },
    up: {
      v0: [x0, y1, z1], v1: [x1, y1, z1], v2: [x1, y1, z0], v3: [x0, y1, z0],
      normal: [0, 1, 0],
    },
    down: {
      v0: [x0, y0, z0], v1: [x1, y0, z0], v2: [x1, y0, z1], v3: [x0, y0, z1],
      normal: [0, -1, 0],
    },
  };
}

/**
 * Translate the BedrockCubeUv into a per-face pixel-space rect.
 *
 *   - Box form (`uv: [u, v]`): unfold the cube into the standard skin layout.
 *   - Per-face form (`uv: { north: { uv, uv_size }, ... }`): direct rects.
 */
function resolveUvRects(
  cube: BedrockCube,
  size: Vec3,
  negateX: boolean
): Partial<Record<FaceName, FaceUVRect>> {
  const uv = cube.uv;
  if (!uv) return {};

  const rects = Array.isArray(uv) ? boxUv(uv, size, negateX) : perFaceUv(uv);

  // Up/Down 180° UV fix-up under negateX.
  //
  // MC's GeoModelParser swaps `finalU0 = u1, finalU1 = u0` whenever
  // `negateX && !mirror` (`GeoModelParser.kt:487-500`). For N/S/E/W faces our
  // vertex emit order is already mirrored vs MC, so the missing swap cancels
  // out and the texture lands correctly. For UP/DOWN our vertex order isn't
  // mirrored the same way → the missing swap leaves UP/DOWN rotated 180°.
  // Visible on rice_hat (asymmetric brim segments) but invisible on Steve-head
  // and most hats whose top textures are rotationally symmetric.
  //
  // Compensate by rotating the UV rect 180° (swap u-edges + swap v-edges).
  if (negateX) {
    for (const face of ["up", "down"] as const) {
      const r = rects[face];
      if (!r) continue;
      rects[face] = {
        u0: r.u1,
        u1: r.u0,
        v0: r.v1,
        v1: r.v0,
        flipU: r.flipU,
        flipV: r.flipV,
      };
    }
  }

  return rects;
}

function boxUv(
  uv: [number, number],
  size: Vec3,
  negateX: boolean
): Record<FaceName, FaceUVRect> {
  const [sx, sy, sz] = size;
  const [u, v] = uv;
  // East/west columns are swapped under negateX: the face that sits at +X in
  // render space corresponds to the cosmetic-author's `west` face (because the
  // cube was X-mirrored), so it pulls from the first UV column.
  const eastU0 = negateX ? u : u + sz + sx;
  const westU0 = negateX ? u + sz + sx : u;
  return {
    up:    { u0: u + sz,           v0: v,      u1: u + sz + sx,        v1: v + sz },
    down:  { u0: u + sz + sx,      v0: v,      u1: u + sz + sx * 2,    v1: v + sz, flipV: true },
    west:  { u0: westU0,           v0: v + sz, u1: westU0 + sz,        v1: v + sz + sy },
    north: { u0: u + sz,           v0: v + sz, u1: u + sz + sx,        v1: v + sz + sy },
    east:  { u0: eastU0,           v0: v + sz, u1: eastU0 + sz,        v1: v + sz + sy },
    south: { u0: u + sz + sx + sz, v0: v + sz, u1: u + sz * 2 + sx * 2, v1: v + sz + sy },
  };
}

function perFaceUv(
  uv: Partial<Record<FaceName, BedrockFaceUv>>
): Partial<Record<FaceName, FaceUVRect>> {
  const out: Partial<Record<FaceName, FaceUVRect>> = {};
  // Per-face UVs are looked up by face name as-authored (no east↔west swap
  // under NEGATE_X). Reference: GeoModelParser.createPerFaceUvQuads uses
  // `mapping.east` for FACE_EAST regardless of negateX, unlike box-uv which
  // does swap UV columns. Cosmetic authors target the rendered face by name.
  for (const face of FACE_NAMES) {
    const f = uv[face];
    if (!f) continue;
    const [u, v] = f.uv;
    const [w, h] = f.uv_size ?? [0, 0];
    // Negative uv_size = Bedrock convention for axis flip on that face. Normalise
    // the rect to (u0<u1, v0<v1) and lift the flip into the explicit flag.
    out[face] = {
      u0: w < 0 ? u + w : u,
      v0: h < 0 ? v + h : v,
      u1: w < 0 ? u : u + w,
      v1: h < 0 ? v : v + h,
      flipU: w < 0 || undefined,
      flipV: h < 0 || undefined,
    };
  }
  return out;
}
