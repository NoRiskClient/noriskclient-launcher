# Minecraft on Android — in-process PoC testing

**Status:** proof-of-concept. Minecraft runs *inside the launcher's own Android
process* (no system JVM, no `exec()`): the JVM is `dlopen`'ed and started via
`JNI_CreateJavaVM`, LWJGL is swapped for the Pojav/Zalith fork, and the game
renders onto a fullscreen `SurfaceView` overlay through libpojavexec.

Everything up to active GL rendering is proven working on an x86_64 emulator
(JVM boot, in-process launch, GL context, texture atlases, surface blit). A
**visible frame needs a real device**: the emulator has no GPU that is both
stable and GLES-3.1+ capable, so the last render step stalls/crashes there.
On real arm64 hardware (Adreno/Mali: real EGL + GLES 3.2) it should render.

## Prerequisites

The full Android toolchain (Android SDK + NDK, JDK 17+, Rust android targets,
`adb`, env vars) is in **[mobile-dev-setup.md](./mobile-dev-setup.md)** — set
that up first. Then, from the repo root:

```sh
yarn install                       # or npm install
yarn tauri android dev             # hot-reload run on a connected device/emulator
```

`yarn tauri android dev` builds the app, installs it, and launches it on the
connected device — use it for the first run to confirm the launcher itself
starts. The MC-on-Android bits below need the extra artifacts + a debug APK
(`yarn tauri android build`, see below). `src-tauri/gen/android/` is already
committed, so no `tauri android init` is needed.

## What you need on the device

The launcher expects three adb-pushed artifact sets under
`/data/data/gg.norisk.NoRiskClientLauncherV3/files/` (later these get bundled/
downloaded; for the PoC they are pushed manually):

| Path (under `files/`) | What | ABI-specific? |
|---|---|---|
| `natives-android/*.so` | Pojav native libs (gl4es, libpojavexec, libOSMesa, freetype, driver_helper, jnidispatch, …) | **yes — arm64-v8a** |
| `lwjgl3/lwjgl-glfw-classes.jar` | Pojav LWJGL fork + patched `CallbackBridge` | no (pure Java) |
| `nrc-jre21.tar.gz` | OpenJDK 21 Android build, extracted on first "JVM test" | **yes — arm64** |
| `renderer.txt` | `gl4es` or `vulkan_zink` (renderer choice) | no |
| `mc_test_version.txt` | optional MC version override (e.g. `1.21.11`) | no |

### Getting the arm64 artifacts

The native libs + JRE come from **ZalithLauncher (arm64-v8a build)** — a
GPLv3 project (mind the license). Extract from its APK:

- `lib/arm64-v8a/*.so` → `natives-android/`
- an arm64 OpenJDK-21 runtime component → repack as `nrc-jre21.tar.gz`
  (tar.gz of the JRE root, so `bin/java` is at `jre21/bin/java` after extract).

The **fork jar is ABI-agnostic** — reuse the one built for the emulator, or
rebuild: take Zalith's `assets/components/lwjgl3/lwjgl-glfw-classes.jar` and
replace `org/lwjgl/glfw/CallbackBridge.class` with the android-free patched
version (`javac --release 17` then `jar uf`). Needed because Zalith's
CallbackBridge imports android classes the guest OpenJDK doesn't have.

## Build + install (arm64)

```sh
yarn tauri android build --apk --target aarch64 --debug
adb install -r -d src-tauri/gen/android/app/build/outputs/apk/**/debug/*.apk
```

(`--target aarch64` = arm64-v8a, the ABI of essentially all real phones. If
`adb install` fails with `INSTALL_FAILED_VERSION_DOWNGRADE`, uninstall first:
`adb uninstall gg.norisk.NoRiskClientLauncherV3`.)

## Push artifacts + configure

App-private dir is only writable via `run-as` on a debug build:

```sh
PKG=gg.norisk.NoRiskClientLauncherV3
adb shell run-as $PKG mkdir -p files files/natives-android files/lwjgl3

# stage in /data/local/tmp, then run-as cp into files/
adb push natives-android/. /data/local/tmp/nat
adb shell "run-as $PKG sh -c 'cp /data/local/tmp/nat/*.so files/natives-android/ && chmod 755 files/natives-android/*.so'"
adb push lwjgl-glfw-classes.jar /data/local/tmp/fj.jar
adb shell "run-as $PKG cp /data/local/tmp/fj.jar files/lwjgl3/lwjgl-glfw-classes.jar"
adb push nrc-jre21.tar.gz /data/local/tmp/jre.tgz
adb shell "run-as $PKG cp /data/local/tmp/jre.tgz files/nrc-jre21.tar.gz"

# renderer: gl4es is Zalith's default for real GLES hardware
adb shell "run-as $PKG sh -c 'printf %s gl4es > files/renderer.txt'"
```

## Run

1. Open the app → **Play** tab.
2. Tap **JVM test** once — installs/extracts the JRE, boots the in-process JVM
   (`java.version=21`). The JVM is once-per-process, so:
3. Force-stop and reopen the app (`adb shell am force-stop $PKG`), then tap
   **MC test** — runs the full install→launch pipeline in-process.

Progress lands in
`files/../data/noriskclientv3/meta/logs/mc-android.log` (pull via
`adb shell run-as $PKG cat ...`). Watch logcat for `GLBridge`,
`Reloading ResourceManager`, texture atlas creation, and the first frame.

## Renderer notes (what fails where)

- **gl4es** (`renderer.txt=gl4es`) — GL→GLES via the system driver. Needs a
  working EGL context on the surface. **Best on real hardware.** On the
  emulator it either crashes the GL translator (host GPU) or can't make the
  EGL context current (SwiftShader).
- **vulkan_zink** (`renderer.txt=vulkan_zink`) — Mesa GL over Vulkan, blitted
  via ANativeWindow (no EGL context). Needs real hardware Vulkan; on the
  emulator it falls back to software and is far too slow to draw a frame. If
  gl4es misbehaves on a specific GPU, this is the fallback (and vice-versa).

If MC 1.21 shaders fail on a weaker GLES, try an older version via
`mc_test_version.txt` (e.g. `1.12.2`, LWJGL2 / fixed-function GL).
