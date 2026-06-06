import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export const ComplementaryOutlineShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 100.0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    strength: { value: 2.0 },
    thickness: { value: 3 },
    sensitivity: { value: 0.25 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform vec2 resolution;
    uniform float strength;
    uniform int thickness;
    uniform float sensitivity;
    varying vec2 vUv;

    float perspectiveDepthToViewZ(float d) {
      float z = d * 2.0 - 1.0;
      return (2.0 * cameraNear * cameraFar) /
             (cameraFar + cameraNear - z * (cameraFar - cameraNear));
    }
    vec2 promoOffset(int i) {
      if (i == 0) return vec2(-1.0, 1.0);
      if (i == 1) return vec2( 0.0, 1.0);
      if (i == 2) return vec2( 1.0, 1.0);
      return vec2( 1.0, 0.0);
    }

    void main() {
      vec2 invRes = 1.0 / resolution;
      float z = perspectiveDepthToViewZ(texture2D(tDepth, vUv).r);
      float outlined = 1.0;
      float totalz = 0.0;
      float maxz = 0.0;
      const int MAX_SAMPLES = 16;
      int count = thickness * 4;
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= count) break;
        float ring = 1.0 + floor(float(i) / 4.0);
        vec2 off = ring * invRes * promoOffset(i - (i / 4) * 4);
        float zA = perspectiveDepthToViewZ(texture2D(tDepth, vUv + off).r);
        float zB = perspectiveDepthToViewZ(texture2D(tDepth, vUv - off).r);
        if (i < 4) maxz = max(maxz, max(zA, zB));
        outlined *= clamp(1.0 - ((zA + zB) - z * 2.0) * 32.0 * sensitivity / z, 0.0, 1.0);
        totalz += zA + zB;
      }
      float outlinea = 1.0 - clamp((z * 8.0 - totalz) * 64.0 * sensitivity / z, 0.0, 1.0) *
                       clamp(1.0 - ((z * 8.0 - totalz) * 32.0 * sensitivity - 1.0) / z, 0.0, 1.0);
      float outlineb = clamp(1.0 + 8.0 * sensitivity * (z - maxz) / z, 0.0, 1.0);
      float outAB = pow(outlinea * outlineb, 0.1);
      float outlinec = clamp(1.0 + 64.0 * sensitivity * (z - maxz) / z, 0.0, 1.0);
      float outline = (0.35 * outAB + 0.65) *
                      (0.75 * (1.0 - outlined) * outlinec + 1.0);
      float outlinePower = strength / float(thickness);
      if (outline < 1.0) outlinePower = strength;
      outline = pow(outline, outlinePower);
      outline = abs(outline - 1.0) + 1.0;
      vec4 baseColor = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(baseColor.rgb * outline, baseColor.a);
    }
  `,
};

export interface PromoOutlineConfig {
  strength: number;
  thickness: number;
  sensitivity: number;
}

export const PROMO_OUTLINE_DEFAULTS: PromoOutlineConfig = {
  strength: 2.8,
  thickness: 2,
  sensitivity: 0.4,
};

export interface OutlinePipeline {
  composer: EffectComposer;
  depthRT: THREE.WebGLRenderTarget;
  outlinePass: ShaderPass;
}

export function setupOutlinePipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): OutlinePipeline {
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  const depthTexture = new THREE.DepthTexture(w, h);
  depthTexture.type = THREE.UnsignedShortType;
  const depthRT = new THREE.WebGLRenderTarget(w, h, {
    depthTexture,
    depthBuffer: true,
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const outlinePass = new ShaderPass(ComplementaryOutlineShader);
  outlinePass.uniforms.tDepth.value = depthTexture;
  outlinePass.uniforms.cameraNear.value = camera.near;
  outlinePass.uniforms.cameraFar.value = camera.far;
  outlinePass.uniforms.resolution.value = new THREE.Vector2(w, h);
  composer.addPass(outlinePass);

  composer.addPass(new OutputPass());

  return { composer, depthRT, outlinePass };
}

export function applyOutlineConfig(
  pipeline: OutlinePipeline,
  config: Partial<PromoOutlineConfig>
): void {
  const merged = { ...PROMO_OUTLINE_DEFAULTS, ...config };
  pipeline.outlinePass.uniforms.strength.value = merged.strength;
  pipeline.outlinePass.uniforms.thickness.value = merged.thickness;
  pipeline.outlinePass.uniforms.sensitivity.value = merged.sensitivity;
}

export function renderOutlineFrame(
  pipeline: OutlinePipeline,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  overlayLayer?: number
): void {
  const prevBg = scene.background;
  scene.background = null;
  renderer.setRenderTarget(pipeline.depthRT);
  renderer.clear(false, true, false);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.background = prevBg;
  pipeline.composer.render();

  if (overlayLayer != null) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    camera.layers.set(overlayLayer);
    renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.autoClear = prevAutoClear;
  }
}

export function resizeOutlinePipeline(
  pipeline: OutlinePipeline,
  width: number,
  height: number
): void {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  pipeline.composer.setSize(w, h);
  pipeline.depthRT.setSize(w, h);
  pipeline.outlinePass.uniforms.resolution.value.set(w, h);
}
