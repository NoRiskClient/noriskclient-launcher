/**
 * Public API of the nrc-cosmetic-renderer core (transport-agnostic, no React).
 *
 * Usage:
 *   import { loadCosmetic, cosmeticUrlsFor } from "nrc-cosmetic-renderer/core";
 *
 *   const urls = cosmeticUrlsFor("bowtie", (f) => `/api/cosmetic-asset?file=${f}`);
 *   const cosmetic = await loadCosmetic(urls);
 *   scene.add(cosmetic.tree.root);
 */

export {
  loadCosmetic,
  disposeLoadedCosmetic,
  cosmeticUrlsFor,
  type CosmeticAssetUrls,
  type LoadedCosmetic,
  type RenderConfig,
  type TextureAnimationState,
} from "./loadCosmetic";

export { applyCosmeticTransform } from "./applyCosmeticTransform";
export { CAPE_GEO } from "./capeGeo";
export { parseGeo } from "./parseGeo";
export { parseAnimationFile } from "./parseAnimation";
export { parseMcmeta } from "./parseMcmeta";
export { buildBoneTree, type BoneTree } from "./buildBoneTree";
export { buildCubeGeometry } from "./buildCubeGeometry";
export {
  applyRuntimeAnimation,
  buildRuntimeAnimations,
  sampleAnimationChannel,
  type RuntimeAnimation,
  type RuntimeAnimationOptions,
} from "./runtimeAnimation";
export { evalMolang, parseMolang, type MolangContext } from "./molang";

// ---------- emotes ----------

export { parseEmote, parseEmoteFile } from "./parseEmote";
export {
  loadEmote,
  disposeLoadedEmote,
  emoteUrlsFor,
  type EmoteAssetUrls,
  type EmoteRenderConfig,
  type LoadedEmote,
  type LoadedProp,
} from "./loadEmote";
export {
  EmotePlayer,
  type EmoteSnapshot,
  type KeyframeListener,
  type PlayEmoteOptions,
} from "./emotePlayer";
export {
  applyEmoteToRig,
  resetEmoteRigCache,
  type ApplyEmoteOptions,
} from "./applyEmoteToRig";
export {
  STEVE_GEO,
  STEVE_SLIM_GEO,
  steveGeoForVariant,
  STEVE_HEIGHT_PX,
  STEVE_WORLD_SCALE,
  type SteveModelVariant,
} from "./steveGeo";

// ---------- particles ----------

export * from "./particles";

export type {
  Vec3,
  Vec3Expr,
  ScalarExpr,
  FaceName,
  BedrockCube,
  BedrockBone,
  BedrockGeoFile,
  BedrockGeometry,
  BedrockGeoDescription,
  BedrockFaceUv,
  BedrockCubeUv,
  AnimationChannel,
  AnimationKeyframe,
  ParsedAnimation,
  ParsedAnimationFile,
  ParsedBoneAnimation,
  ParsedGeo,
  TextureAnimationInfo,
  NoriskCosmeticMeta,
  NoriskDefaultSettings,
  LerpMode,
  ParticleKeyframe,
  SoundKeyframe,
  EmoteMeta,
  ParsedEmote,
  ParsedEmoteFile,
} from "./types";
