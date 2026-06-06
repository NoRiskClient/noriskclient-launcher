"use client";

import { useEffect, useMemo, useRef } from "react";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { applyCosmeticTransform } from "../core/applyCosmeticTransform";
import { buildBoneTree } from "../core/buildBoneTree";
import type { LoadedCosmetic } from "../core/loadCosmetic";
import { ParticleSystem, type EmitterHandle } from "../core/particles";
import type { BedrockBone, BedrockCube, Vec3 } from "../core/types";

import { STEVE_GEO, STEVE_HEIGHT_PX, STEVE_WORLD_SCALE } from "../core/steveGeo";

import { CosmeticGeoModel } from "./CosmeticGeoModel";

const STEVE_CENTER_PX = STEVE_HEIGHT_PX / 2;
/** Bbox-dim cap. Cosmetics whose extents (e.g. gold_katana's swept blade) blow
 * past this get scaled down via the outer wrap. Camera at z=3 fov=40 sees
 * ~2.18 units vertical; 1.8 leaves padding for the spin orbit. Kept high so
 * normal cosmetics (wings ~1.8) don't trigger and the Steve mannequin renders
 * at a consistent scale across cards — consumers add camera distance for
 * additional framing padding. */
const VIEWPORT_TARGET = 1.8;
const ROTATION_MORPH_SPEED = 4.5;

interface Props {
  cosmetic: LoadedCosmetic;
  animationName?: string;
  spinSpeed?: number;
  rotationY?: number;
  steveTextureUrl?: string | null;
  onSteveTextureLoaded?: () => void;
  /** When true, the Steve mannequin is rendered invisible — cosmetic still
   * uses Steve's coordinate frame for positioning, so it appears exactly
   * where it would when worn ingame, just without the player visible. */
  hideSteve?: boolean;
  /** When false, skips the bbox-fit safety net that scales the wrap when the
   * cosmetic exceeds VIEWPORT_TARGET. Use for grids/uniform previews where
   * consistent Steve size matters more than auto-fitting outliers; framing
   * is then the consumer's responsibility (camera distance / fov). */
  fitToViewport?: boolean;
}

/**
 * Mounts a cosmetic on a default Steve mannequin.
 *
 * Both rigs share the Bedrock pixel coordinate system, so we render them at
 * world origin and the cosmetic's standard biped/armor bones line up with
 * Steve's. Cosmetic plays its own idle; Steve stays still. Cosmetic-internal
 * "preview Steve" bones (commonly `bb_main`) are auto-hidden so we don't
 * render two players on top of each other.
 */
export function SteveRig({
  cosmetic,
  animationName,
  spinSpeed = 0.6,
  rotationY = 0,
  steveTextureUrl,
  onSteveTextureLoaded,
  hideSteve = false,
  fitToViewport = true,
}: Props) {
  const spinRef = useRef<THREE.Group>(null);
  const wrapRef = useRef<THREE.Group>(null);
  const rotationYRef = useRef(rotationY);

  // Held-item cosmetics (SHIELDs etc.) have no `armor*` bones — they don't
  // attach to the player skeleton at all. Skip the Steve mount entirely and
  // bbox-center the cosmetic so it shows up in the preview frame.
  const useSteveAnchor = cosmetic.hasArmorBones;

  const steve = useMemo(() => {
    if (!useSteveAnchor) return null;
    const material = new THREE.MeshStandardMaterial({
      color: 0xb0b0b8,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      roughness: 0.9,
      metalness: 0,
    });
    // Steve's cubes live on `bipedHead`/`bipedBody`/etc, so disable the
    // armor-only filter that the cosmetic renderer uses by default.
    const tree = buildBoneTree(STEVE_GEO, material, { armorOnly: false });
    return { tree, material };
  }, [useSteveAnchor]);

  useEffect(() => {
    if (!steve) return;
    return () => {
      steve.tree.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      steve.material.map?.dispose();
      steve.material.dispose();
    };
  }, [steve]);

  useEffect(() => {
    if (!steve || !steveTextureUrl) {
      onSteveTextureLoaded?.();
      return;
    }
    let alive = true;
    let loadedTexture: THREE.Texture | null = null;

    new THREE.TextureLoader().load(
      steveTextureUrl,
      (texture) => {
        if (!alive) {
          texture.dispose();
          return;
        }
        loadedTexture = texture;
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        steve.material.map?.dispose();
        steve.material.map = texture;
        steve.material.color.set(0xffffff);
        steve.material.needsUpdate = true;
        onSteveTextureLoaded?.();
      },
      undefined,
      () => onSteveTextureLoaded?.()
    );

    return () => {
      alive = false;
      if (!loadedTexture) return;
      if (steve.material.map === loadedTexture) {
        steve.material.map = null;
        steve.material.needsUpdate = true;
      }
      loadedTexture.dispose();
    };
  }, [steve, steveTextureUrl, onSteveTextureLoaded]);

  useEffect(() => {
    if (!steve) return;
    steve.tree.root.visible = !hideSteve;
  }, [steve, hideSteve]);

  useEffect(() => {
    if (!useSteveAnchor) return;
    const hidden: THREE.Group[] = [];
    for (const bone of cosmetic.geo.bones) {
      if (!isPlayerBodyBone(bone)) continue;
      const group = cosmetic.tree.bones.get(bone.name);
      if (group) {
        group.visible = false;
        hidden.push(group);
      }
    }
    return () => {
      for (const g of hidden) g.visible = true;
    };
  }, [cosmetic, useSteveAnchor]);

  // Per-armor-bone cosmetic.scale + offset — must NOT be applied as an outer
  // wrapper because that scales bipedBody's (0,24,0) pivot too, dropping
  // anything with scale<1 to floor level (gold_katana scale=0.4 was visibly
  // sunken into the ground without this). No-op for held-item cosmetics.
  useEffect(() => {
    if (useSteveAnchor) applyCosmeticTransform(cosmetic);
  }, [cosmetic, useSteveAnchor]);

  // Bbox-center for held-item cosmetics so the model sits at world origin
  // (no player skeleton to anchor on).
  useEffect(() => {
    if (useSteveAnchor) return;
    cosmetic.tree.root.position.set(0, 0, 0);
    cosmetic.tree.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cosmetic.tree.root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      cosmetic.tree.root.position.sub(center);
    }
  }, [cosmetic, useSteveAnchor]);

  // Bbox-fit safety net. Measured once after mount (+ cosmetic / hideSteve
  // changes); covers outliers like gold_katana whose 44-px swept blade exceeds
  // a normal Steve silhouette. Scales the outermost wrap, preserving the
  // Steve-anchor relationship at world origin.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.scale.setScalar(STEVE_WORLD_SCALE);
    if (!fitToViewport) return;
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > VIEWPORT_TARGET) {
      wrap.scale.multiplyScalar(VIEWPORT_TARGET / maxDim);
    }
  }, [cosmetic, hideSteve, useSteveAnchor, fitToViewport]);

  // Continuous-emit any particle effects attached to the cosmetic. Each
  // effect anchors to a bone on the cosmetic's tree (or the tree.root when
  // no anchor was specified). Function-form positionProvider tracks bone
  // motion as the cosmetic animates.
  const particleSystem = useMemo(() => {
    if (cosmetic.particleEffects.length === 0) return null;
    const sys = new ParticleSystem();
    for (const pe of cosmetic.particleEffects) {
      sys.register(pe.loaded.effect.identifier, pe.loaded);
    }
    return sys;
  }, [cosmetic]);

  useEffect(() => {
    if (!particleSystem) return;
    const handles: EmitterHandle[] = [];
    for (const pe of cosmetic.particleEffects) {
      const anchor = pe.entry.anchor;
      const bone = anchor ? cosmetic.tree.bones.get(anchor) : undefined;
      const target: THREE.Object3D = bone ?? cosmetic.tree.root;
      handles.push(
        particleSystem.spawn(pe.loaded.effect.identifier, {
          positionProvider: () => target.getWorldPosition(new THREE.Vector3()),
          forceLifetime: "looping",
        })
      );
    }
    return () => {
      for (const h of handles) h.stop();
      particleSystem.dispose();
    };
  }, [particleSystem, cosmetic]);

  useFrame((state, delta) => {
    if (spinRef.current) {
      rotationYRef.current = THREE.MathUtils.damp(
        rotationYRef.current,
        rotationY,
        ROTATION_MORPH_SPEED,
        delta
      );
      spinRef.current.rotation.y =
        rotationYRef.current +
        (spinSpeed !== 0 ? state.clock.elapsedTime * spinSpeed : 0);
    }
    particleSystem?.tick(state.clock.elapsedTime, delta);
  });

  return (
    <>
      <group
        ref={wrapRef}
        scale={STEVE_WORLD_SCALE}
        position={
          useSteveAnchor ? [0, -STEVE_CENTER_PX * STEVE_WORLD_SCALE, 0] : [0, 0, 0]
        }
      >
        <group ref={spinRef}>
          {steve && <primitive object={steve.tree.root} />}
          <CosmeticGeoModel cosmetic={cosmetic} animationName={animationName} />
        </group>
      </group>
      {/* Particle system at scene root — see EmoteViewer for the same rationale. */}
      {particleSystem && <primitive object={particleSystem.root} />}
    </>
  );
}

const STEVE_BODY_CUBES: ReadonlyArray<{ origin: Vec3; size: Vec3 }> = [
  { origin: [-4, 24, -4], size: [8, 8, 8] },
  { origin: [-4, 12, -2], size: [8, 12, 4] },
  { origin: [-8, 12, -2], size: [4, 12, 4] },
  { origin: [4, 12, -2], size: [4, 12, 4] },
  { origin: [-4, 0, -2], size: [4, 12, 4] },
  { origin: [0, 0, -2], size: [4, 12, 4] },
];

// Names known to be cosmetic-internal "preview Steve" wrappers. Conservative
// — generic names like `body` are also used as legitimate transform anchors.
const PREVIEW_BODY_NAME_BLOCKLIST = new Set(["bb_main", "b_b_main"]);

function isPlayerBodyBone(bone: BedrockBone): boolean {
  if (!bone.cubes || bone.cubes.length === 0) return false;
  if (PREVIEW_BODY_NAME_BLOCKLIST.has(bone.name.toLowerCase())) return true;
  let matches = 0;
  for (const ref of STEVE_BODY_CUBES) {
    if (bone.cubes.some((c) => cubeShapeMatches(c, ref.origin, ref.size))) {
      matches++;
      if (matches >= 3) return true;
    }
  }
  return false;
}

function cubeShapeMatches(cube: BedrockCube, origin: Vec3, size: Vec3): boolean {
  return (
    !!cube.origin &&
    !!cube.size &&
    cube.origin[0] === origin[0] &&
    cube.origin[1] === origin[1] &&
    cube.origin[2] === origin[2] &&
    cube.size[0] === size[0] &&
    cube.size[1] === size[1] &&
    cube.size[2] === size[2]
  );
}
