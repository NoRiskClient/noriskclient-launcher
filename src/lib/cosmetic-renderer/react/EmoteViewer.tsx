"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";

import { useFrame } from "@react-three/fiber";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { applyEmoteToRig } from "../core/applyEmoteToRig";
import { buildBoneTree, type BoneTree } from "../core/buildBoneTree";
import { EmotePlayer, type KeyframeListener } from "../core/emotePlayer";
import type { EmoteAssetUrls, EmoteRenderConfig, LoadedEmote } from "../core/loadEmote";
import { ParticleSystem } from "../core/particles";

import {
  STEVE_GEO,
  STEVE_HEIGHT_PX,
  STEVE_WORLD_SCALE,
} from "../core/steveGeo";

import { useEmote } from "./useEmote";

interface Props {
  /** Resolved URLs for the emote's asset files. Stable-ref this. */
  urls: EmoteAssetUrls;
  /** Pipeline knobs. Default `negateX: true`. */
  config?: EmoteRenderConfig;
  /** Auto-restart when a non-looping emote finishes. Default true (preview UX). */
  autoRestart?: boolean;
  /** Listener for particle/sound keyframes — your hook for actually rendering effects. */
  keyframeListener?: KeyframeListener;
  /** Y-axis spin around the rig in rad/s. 0 disables. */
  spinSpeed?: number;
  className?: string;
}

/**
 * Drop-in `<canvas>` component that renders one emote played on a Steve
 * mannequin, with the optional prop attached at `armorBody`.
 *
 * Stable-ref `urls` (e.g. `useMemo`). The Steve rig is created and torn down
 * with the emote, so swapping emotes between views is safe.
 */
export function EmoteViewer({
  urls,
  config,
  autoRestart = true,
  keyframeListener,
  spinSpeed = 0.6,
  className,
}: Props) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "100%",
      }}
    >
      <Canvas
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 3, 2]} intensity={1.2} />
        <directionalLight position={[-2, 2, 2]} intensity={0.6} />
        <Suspense fallback={null}>
          <EmoteScene
            urls={urls}
            config={config}
            autoRestart={autoRestart}
            keyframeListener={keyframeListener}
            spinSpeed={spinSpeed}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

interface SceneProps {
  urls: EmoteAssetUrls;
  config?: EmoteRenderConfig;
  autoRestart: boolean;
  keyframeListener?: KeyframeListener;
  spinSpeed: number;
}

function EmoteScene({
  urls,
  config,
  autoRestart,
  keyframeListener,
  spinSpeed,
}: SceneProps) {
  const state = useEmote(urls, config);
  if (state.status !== "ready") return null;
  return (
    <EmoteStage
      emote={state.data}
      autoRestart={autoRestart}
      keyframeListener={keyframeListener}
      spinSpeed={spinSpeed}
      negateX={config?.negateX ?? true}
    />
  );
}

interface StageProps {
  emote: LoadedEmote;
  autoRestart: boolean;
  keyframeListener?: KeyframeListener;
  spinSpeed: number;
  negateX: boolean;
}

function EmoteStage({
  emote,
  autoRestart,
  keyframeListener,
  spinSpeed,
  negateX,
}: StageProps) {
  const spinRef = useRef<THREE.Group>(null);

  // Build a fresh Steve rig per loaded emote. We disable armorOnly so all
  // Steve cubes (head/body/limbs) actually render — they're the visible body.
  const steve = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xb0b0b8,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
    });
    const tree: BoneTree = buildBoneTree(STEVE_GEO, material, {
      armorOnly: false,
      negateX,
    });
    return { tree, material };
  }, [negateX]);

  useEffect(() => {
    return () => {
      steve.tree.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      steve.material.dispose();
    };
  }, [steve]);

  // Mount the prop as a sibling of Steve at the wrap's local origin, not
  // under Steve.armorBody. The prop's geo authors a full biped* hierarchy
  // rooted at (0,0,0) — stacking it under Steve.armorBody would double the
  // body pivot and float the prop up to head height. applyEmoteToRig writes
  // the same snapshot into both trees so they animate in lockstep.
  const propMountRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!emote.prop) return;
    const mount = propMountRef.current;
    if (!mount) return;
    mount.add(emote.prop.tree.root);
    return () => {
      mount.remove(emote.prop!.tree.root);
    };
  }, [emote]);

  // Particle system: one per loaded emote. Registers all parsed effects so
  // KeyframeListener can `system.spawn(effectId, ...)` synchronously when an
  // animation timeline event fires.
  const particleSystem = useMemo(() => {
    if (emote.particleEffects.size === 0) return null;
    const sys = new ParticleSystem();
    for (const [id, lp] of emote.particleEffects) sys.register(id, lp);
    return sys;
  }, [emote]);

  useEffect(() => {
    return () => {
      particleSystem?.dispose();
    };
  }, [particleSystem]);

  // Build the merged listener: caller's hooks fire first, then ours spawns
  // particles for `onParticleKeyframe`. Caller can short-circuit by NOT
  // wiring keyframeListener to the particle system themselves.
  const mergedListener = useMemo<KeyframeListener>(() => {
    return {
      onParticleKeyframe: (emoteId, time, kf) => {
        keyframeListener?.onParticleKeyframe?.(emoteId, time, kf);
        if (!particleSystem || !particleSystem.hasEffect(kf.effectId)) return;
        const bone =
          steve.tree.bones.get(kf.locator) ??
          emote.prop?.tree.bones.get(kf.locator) ??
          null;
        if (!bone && kf.locator) return;
        let positionProvider: THREE.Vector3 | (() => THREE.Vector3);
        if (kf.bindToActor && bone) {
          positionProvider = () => bone.getWorldPosition(new THREE.Vector3());
        } else {
          const fixed = new THREE.Vector3();
          if (bone) bone.getWorldPosition(fixed);
          else steve.tree.root.getWorldPosition(fixed);
          positionProvider = fixed;
        }
        particleSystem.spawn(kf.effectId, {
          positionProvider,
          forceLifetime: "once",
        });
      },
      onSoundKeyframe: keyframeListener?.onSoundKeyframe,
      onEmoteFinished: keyframeListener?.onEmoteFinished,
    };
  }, [emote, keyframeListener, particleSystem, steve]);

  const player = useMemo(() => {
    const p = new EmotePlayer({ keyframeListener: mergedListener });
    p.play(emote.emote, 0);
    return p;
  }, [emote, mergedListener]);

  useEffect(() => {
    player.setKeyframeListener(mergedListener);
  }, [player, mergedListener]);

  useFrame((stateCtx, delta) => {
    const t = stateCtx.clock.elapsedTime;

    if (autoRestart && !player.isPlaying(emote.emote.id)) {
      player.play(emote.emote, t);
    }
    player.update(t);
    applyEmoteToRig(player, steve.tree, {
      negateX,
      propTree: emote.prop?.tree,
    });

    // Step prop's animated PNG (rare but supported).
    const propAnim = emote.prop?.textureAnimation;
    if (emote.prop && propAnim) {
      const frameSeconds = propAnim.frametime * 0.001;
      const idxInArray =
        Math.floor(t / frameSeconds) % propAnim.frames.length;
      const frameIndex = propAnim.frames[idxInArray];
      const offset = frameIndex * propAnim.frameUvHeight;
      if (emote.prop.texture.offset.y !== offset) {
        emote.prop.texture.offset.y = offset;
      }
    }

    // Particles after rig animation so the locator-based positionProviders
    // resolve to the post-animation bone positions.
    particleSystem?.tick(t, delta);

    if (spinSpeed !== 0 && spinRef.current) {
      spinRef.current.rotation.y = t * spinSpeed;
    }
  });

  return (
    <>
      <group
        scale={STEVE_WORLD_SCALE}
        position={[0, -(STEVE_HEIGHT_PX / 2) * STEVE_WORLD_SCALE, 0]}
      >
        <group ref={spinRef}>
          <primitive object={steve.tree.root} />
          <group ref={propMountRef} />
        </group>
      </group>
      {/* Particle system at scene root (no scaling/spin). The shader takes
          `iPosition` as world-space and `bone.getWorldPosition` already
          returns post-transform coords, so particles land at the right
          visual location relative to the rig. */}
      {particleSystem && <primitive object={particleSystem.root} />}
    </>
  );
}
