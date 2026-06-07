"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import {
  setupOutlinePipeline,
  applyOutlineConfig,
  renderOutlineFrame,
  resizeOutlinePipeline,
  type PromoOutlineConfig,
} from "../../lib/cosmetic-renderer/postfx/promoOutline";

import {
  applyCosmeticTransform,
  applyEmoteToRig,
  buildBoneTree,
  steveGeoForVariant,
  EmotePlayer,
  STEVE_HEIGHT_PX,
  STEVE_WORLD_SCALE,
  ParticleSystem,
  type BoneTree,
  type EmoteAssetUrls,
  type EmitterHandle,
  type SteveModelVariant,
} from "../../lib/cosmetic-renderer/core";
import {
  CosmeticGeoModel,
  useCosmeticGeo,
  useEmote,
} from "../../lib/cosmetic-renderer/react";
import type { ResolvedCosmetic } from "../../lib/cosmetics/cosmeticRendererAssets";
import { useIdleEmote } from "../../hooks/useIdleEmote";

const STEVE_CENTER_PX = STEVE_HEIGHT_PX / 2;
const DOWN_SHIFT = 0.18;
const POSE_ROTATION_Y = Math.PI + 0.4;
const NAMETAG_PX_Y = 36;
const NAMETAG_HAT_EXTRA_Y = 3;
const NAMETAG_CAP_PX = 2.4;
const DRAG_SENSITIVITY = 0.012;
const NAMETAG_LAYER = 1;

function buildNametagMesh(
  name: string,
  iconUrl: string | null,
  iconPlus: boolean
): THREE.Mesh {
  const SS = 4;
  const fontPx = 48;
  const padX = 18;
  const padY = 16;
  const iconGap = 12;
  const fontSpec = `${fontPx}px "MinecraftTen", "Minecraft", sans-serif`;
  const text = name;

  const canvas = document.createElement("canvas");
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.y = Math.PI;
  mesh.layers.set(NAMETAG_LAYER);
  material.depthTest = false;

  let iconImg: HTMLImageElement | null = null;

  const paint = () => {
    let ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = fontSpec;
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent || fontPx * 0.72;
    const textW = Math.ceil(m.width);
    const iconSize = iconImg ? Math.round(ascent * 1.3) : 0;
    const iconBlock = iconImg ? iconSize + iconGap : 0;
    const contentH = Math.ceil(ascent);
    const w = iconBlock + textW + padX * 2;
    const h = contentH + padY * 2;
    canvas.width = w * SS;
    canvas.height = h * SS;
    ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(SS, SS);
    ctx.font = fontSpec;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);

    if (iconImg) {
      const frame = Math.min(iconImg.naturalWidth, iconImg.naturalHeight);
      const frameY = iconPlus && iconImg.naturalHeight >= frame * 2 ? frame : 0;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        iconImg,
        0,
        frameY,
        frame,
        frame,
        padX,
        (h - iconSize) / 2,
        iconSize,
        iconSize
      );
    }

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(text, padX + iconBlock, padY + ascent + (contentH - ascent) / 2);

    material.map?.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    material.map = tex;
    material.needsUpdate = true;
    const unit = NAMETAG_CAP_PX / ascent;
    mesh.scale.set(w * unit, h * unit, 1);
  };

  paint();
  document.fonts?.load(fontSpec, text).then(paint).catch(() => {});
  if (iconUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      iconImg = img;
      paint();
    };
    img.src = iconUrl;
  }
  return mesh;
}

function Nametag({
  name,
  iconUrl,
  iconPlus,
  y,
}: {
  name: string;
  iconUrl: string | null;
  iconPlus: boolean;
  y: number;
}) {
  const mesh = useMemo(
    () => buildNametagMesh(name, iconUrl, iconPlus),
    [name, iconUrl, iconPlus]
  );
  useEffect(() => {
    return () => {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    };
  }, [mesh]);
  return <primitive object={mesh} position={[0, y, 0]} />;
}

function EmoteDriver({ tree, urls }: { tree: BoneTree; urls: EmoteAssetUrls }) {
  const state = useEmote(urls, { negateX: true });
  const playerRef = useRef<EmotePlayer | null>(null);

  useEffect(() => {
    if (state.status === "ready") {
      const p = new EmotePlayer();
      p.play(state.data.emote, 0);
      playerRef.current = p;
    }
    return () => {
      playerRef.current = null;
    };
  }, [state]);

  useFrame((st) => {
    if (state.status !== "ready" || !playerRef.current) return;
    const player = playerRef.current;
    const t = st.clock.elapsedTime;
    if (!player.isPlaying(state.data.emote.id)) {
      player.play(state.data.emote, t);
    }
    player.update(t);
    applyEmoteToRig(player, tree, {
      negateX: true,
      propTree: state.data.prop?.tree,
    });
  });

  if (state.status === "ready" && state.data.prop) {
    return <primitive object={state.data.prop.tree.root} />;
  }
  return null;
}

interface Steve {
  tree: BoneTree;
  material: THREE.MeshStandardMaterial;
}

interface SteveBodyProps {
  steve: Steve;
  textureUrl: string | null;
  emoteUrls?: EmoteAssetUrls | null;
}

function SteveBody({ steve, textureUrl, emoteUrls }: SteveBodyProps) {
  useEffect(() => {
    if (!textureUrl) return;
    let alive = true;
    let loaded: THREE.Texture | null = null;

    new THREE.TextureLoader().load(textureUrl, (texture) => {
      if (!alive) {
        texture.dispose();
        return;
      }
      loaded = texture;
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      steve.material.map?.dispose();
      steve.material.map = texture;
      steve.material.needsUpdate = true;
    });

    return () => {
      alive = false;
      if (loaded && steve.material.map === loaded) {
        steve.material.map = null;
        steve.material.needsUpdate = true;
      }
      loaded?.dispose();
    };
  }, [steve, textureUrl]);

  return (
    <>
      <primitive object={steve.tree.root} />
      {emoteUrls && <EmoteDriver tree={steve.tree} urls={emoteUrls} />}
    </>
  );
}

function MountedCosmetic({
  cosmetic,
  anchorRef,
  steveTree,
}: {
  cosmetic: ResolvedCosmetic;
  anchorRef: React.RefObject<THREE.Group>;
  steveTree: BoneTree;
}) {
  const state = useCosmeticGeo(cosmetic.urls);
  const sysRef = useRef<ParticleSystem | null>(null);

  useEffect(() => {
    if (state.status !== "ready") return;
    applyCosmeticTransform(state.data);

    const moved: Array<{ parent: THREE.Group; child: THREE.Object3D }> = [];
    for (const [name, cosBone] of state.data.tree.bones) {
      if (!name.toLowerCase().startsWith("armor")) continue;
      if (cosBone.children.length === 0) continue;
      let steveBone = steveTree.bones.get(name);
      if (!steveBone) steveBone = steveTree.bones.get(name.replace(/Slim$/i, ""));
      if (!steveBone) continue;
      steveBone.add(cosBone);
      moved.push({ parent: steveBone, child: cosBone });
    }
    return () => {
      for (const m of moved) m.parent.remove(m.child);
    };
  }, [state, steveTree]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const anchor = anchorRef.current;
    const data = state.data;
    if (!anchor || data.particleEffects.length === 0) return;

    const sys = new ParticleSystem();
    for (const pe of data.particleEffects) {
      sys.register(pe.loaded.effect.identifier, pe.loaded);
    }
    const tmp = new THREE.Vector3();
    const handles: EmitterHandle[] = [];
    for (const pe of data.particleEffects) {
      const bone = pe.entry.anchor
        ? data.tree.bones.get(pe.entry.anchor)
        : undefined;
      const target: THREE.Object3D = bone ?? data.tree.root;
      handles.push(
        sys.spawn(pe.loaded.effect.identifier, {
          positionProvider: () =>
            anchor.worldToLocal(target.getWorldPosition(tmp)).clone(),
          forceLifetime: "looping",
        })
      );
    }
    anchor.add(sys.root);
    sysRef.current = sys;
    return () => {
      for (const h of handles) h.stop();
      anchor.remove(sys.root);
      sys.dispose();
      sysRef.current = null;
    };
  }, [state, anchorRef]);

  useFrame((st, delta) => {
    sysRef.current?.tick(st.clock.elapsedTime, delta);
  });

  if (state.status !== "ready") return null;
  if (!state.data.hasArmorBones && state.data.particleEffects.length === 0) {
    return null;
  }
  return <CosmeticGeoModel cosmetic={state.data} />;
}

interface RigContentProps {
  textureUrl: string | null;
  variant: SteveModelVariant;
  cosmetics: ResolvedCosmetic[];
  spinSpeed: number;
  dragRef: React.MutableRefObject<number>;
  playerName?: string | null;
  iconUrl?: string | null;
  iconPlus?: boolean;
}

function RigContent({ textureUrl, variant, cosmetics, spinSpeed, dragRef, playerName, iconUrl, iconPlus }: RigContentProps) {
  const spinRef = useRef<THREE.Group>(null);
  const emoteUrls = useIdleEmote();

  const steve = useMemo<Steve>(() => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      roughness: 0.9,
      metalness: 0,
    });
    const tree = buildBoneTree(steveGeoForVariant(variant), material, {
      armorOnly: false,
    });
    return { tree, material };
  }, [variant]);

  useEffect(() => {
    return () => {
      steve.tree.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      steve.material.map?.dispose();
      steve.material.dispose();
    };
  }, [steve]);

  useFrame((state) => {
    if (!spinRef.current) return;
    spinRef.current.rotation.y =
      spinSpeed !== 0
        ? state.clock.elapsedTime * spinSpeed
        : POSE_ROTATION_Y + dragRef.current;
  });

  return (
    <>
      <group
        scale={STEVE_WORLD_SCALE}
        position={[0, -STEVE_CENTER_PX * STEVE_WORLD_SCALE - DOWN_SHIFT, 0]}
      >
        <group ref={spinRef} rotation={[0, POSE_ROTATION_Y, 0]}>
          <SteveBody steve={steve} textureUrl={textureUrl} emoteUrls={emoteUrls} />
          {cosmetics.map((c) => (
            <MountedCosmetic
              key={c.cosmeticId}
              cosmetic={c}
              anchorRef={spinRef}
              steveTree={steve.tree}
            />
          ))}
          {playerName && (
            <Nametag
              name={playerName}
              iconUrl={iconUrl ?? null}
              iconPlus={iconPlus ?? false}
              y={
                cosmetics.some((c) => c.type?.toUpperCase() === "HAT")
                  ? NAMETAG_PX_Y + NAMETAG_HAT_EXTRA_Y
                  : NAMETAG_PX_Y
              }
            />
          )}
        </group>
      </group>
    </>
  );
}

function makeShimmerMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: color.clone() },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uRes;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        vec2 p = gl_FragCoord.xy / uRes;
        float diag = (p.x + p.y) * 0.5;
        float sweep = fract(uTime * 1.2) * 2.0 - 0.5;
        float band = smoothstep(0.22, 0.0, abs(diag - sweep));
        vec3 base = uColor * 0.18;
        vec3 hi = uColor;
        gl_FragColor = vec4(mix(base, hi, band), uOpacity);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

const SKELETON_FADE_S = 0.4;

function SkeletonContent({
  variant,
  dragRef,
  hasName,
  accentColor,
  fadeOut,
}: {
  variant: SteveModelVariant;
  dragRef: React.MutableRefObject<number>;
  hasName: boolean;
  accentColor?: string;
  fadeOut: boolean;
}) {
  const spinRef = useRef<THREE.Group>(null);
  const dbSize = useRef(new THREE.Vector2());
  const fadeStart = useRef<number | null>(null);

  const { steve, nametag, material } = useMemo(() => {
    const color = new THREE.Color().setStyle(accentColor || "#a78bfa");
    const mat = makeShimmerMaterial(color);
    const tree = buildBoneTree(steveGeoForVariant(variant), mat, {
      armorOnly: false,
    });
    tree.root.traverse((o) => {
      o.renderOrder = 998;
    });
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    tag.rotation.y = Math.PI;
    tag.layers.set(NAMETAG_LAYER);
    tag.scale.set(22, 5, 1);
    tag.renderOrder = 999;
    return { steve: { tree }, nametag: { mesh: tag }, material: mat };
  }, [variant, accentColor]);

  useEffect(() => {
    return () => {
      steve.tree.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      nametag.mesh.geometry.dispose();
      material.dispose();
    };
  }, [steve, nametag, material]);

  useFrame((st) => {
    const t = st.clock.elapsedTime;
    st.gl.getDrawingBufferSize(dbSize.current);
    material.uniforms.uTime.value = t;
    material.uniforms.uRes.value.copy(dbSize.current);
    if (fadeOut) {
      if (fadeStart.current === null) fadeStart.current = t;
      material.uniforms.uOpacity.value = Math.max(
        0,
        1 - (t - fadeStart.current) / SKELETON_FADE_S
      );
    }
    if (spinRef.current) {
      spinRef.current.rotation.y = POSE_ROTATION_Y + dragRef.current;
    }
  });

  return (
    <group
      scale={STEVE_WORLD_SCALE}
      position={[0, -STEVE_CENTER_PX * STEVE_WORLD_SCALE - DOWN_SHIFT, 0]}
    >
      <group ref={spinRef} rotation={[0, POSE_ROTATION_Y, 0]}>
        <primitive object={steve.tree.root} />
        {hasName && <primitive object={nametag.mesh} position={[0, NAMETAG_PX_Y, 0]} />}
      </group>
    </group>
  );
}

function PromoOutline(config: Partial<PromoOutlineConfig>) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const pipeline = useMemo(
    () =>
      setupOutlinePipeline(
        gl,
        scene,
        camera as THREE.PerspectiveCamera,
        size.width,
        size.height
      ),
    [gl, scene, camera]
  );

  useEffect(() => {
    applyOutlineConfig(pipeline, config);
  }, [pipeline, config.strength, config.thickness, config.sensitivity]);

  useEffect(() => {
    resizeOutlinePipeline(pipeline, size.width, size.height);
  }, [pipeline, size.width, size.height]);

  useEffect(() => {
    return () => {
      pipeline.depthRT.dispose();
      pipeline.composer.dispose();
    };
  }, [pipeline]);

  useFrame(() => {
    renderOutlineFrame(pipeline, gl, scene, camera, NAMETAG_LAYER);
  }, 1);

  return null;
}

export interface PlayerCosmeticRigProps {
  textureUrl: string | null;
  variant: SteveModelVariant;
  cosmetics: ResolvedCosmetic[];
  spinSpeed?: number;
  playerName?: string | null;
  iconUrl?: string | null;
  iconPlus?: boolean;
  loading?: boolean;
  accentColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function PlayerCosmeticRig({
  textureUrl,
  variant,
  cosmetics,
  spinSpeed = 0,
  playerName,
  iconUrl,
  iconPlus,
  loading = false,
  accentColor,
  className,
  style,
}: PlayerCosmeticRigProps) {
  const dragRef = useRef(0);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startRot = useRef(0);

  const [skeletonMounted, setSkeletonMounted] = useState(true);
  useEffect(() => {
    if (loading) {
      setSkeletonMounted(true);
      return;
    }
    const id = setTimeout(() => setSkeletonMounted(false), SKELETON_FADE_S * 1000 + 60);
    return () => clearTimeout(id);
  }, [loading]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startRot.current = dragRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragRef.current = startRot.current + (e.clientX - startX.current) * DRAG_SENSITIVITY;
  };
  const endDrag = (e: React.PointerEvent) => {
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      void 0;
    }
  };

  return (
    <div className={className} style={{ ...style, position: style?.position ?? "relative" }}>
      <Canvas
        style={{ width: "100%", height: "100%", pointerEvents: "none" }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        camera={{ position: [0, 0, 4.6], fov: 40 }}
      >
        <ambientLight intensity={0.85} />
        <hemisphereLight intensity={0.35} />
        <directionalLight position={[3, 3, 2]} intensity={1.1} />
        {!loading && (
          <RigContent
            textureUrl={textureUrl}
            variant={variant}
            cosmetics={cosmetics}
            spinSpeed={spinSpeed}
            dragRef={dragRef}
            playerName={playerName}
            iconUrl={iconUrl}
            iconPlus={iconPlus}
          />
        )}
        {skeletonMounted && (
          <SkeletonContent
            variant={variant}
            dragRef={dragRef}
            hasName={!!playerName}
            accentColor={accentColor}
            fadeOut={!loading}
          />
        )}
        <PromoOutline />
      </Canvas>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(e) => e.preventDefault()}
        draggable={false}
        style={{
          position: "absolute",
          left: "50%",
          top: "14%",
          transform: "translateX(-50%)",
          width: "34%",
          height: "60%",
          cursor: "grab",
          pointerEvents: "auto",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      />
    </div>
  );
}
