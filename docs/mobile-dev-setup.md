# Mobile Dev Setup

How to build and run the launcher as a mobile app (Tauri 2).
Official guide: <https://v2.tauri.app/start/prerequisites/#configure-for-mobile-targets>

## Android

### Prerequisites

1. **Android Studio** — <https://developer.android.com/studio> (or the standalone
   [command-line tools](https://developer.android.com/studio#command-line-tools-only)).
   Install via *SDK Manager* (Settings → Languages & Frameworks → Android SDK):
   - SDK Platform (API 24+)
   - SDK Build-Tools
   - SDK Platform-Tools (`adb`)
   - **NDK (Side by side)** (tested with 29.x) — docs: <https://developer.android.com/ndk>
   - Emulator + a device image (optional, physical device works too)
2. **JDK 17+** — Android Studio's bundled JBR is fine; otherwise <https://adoptium.net/>.
3. **Rust** via rustup (<https://rustup.rs/>), then the Android targets:
   ```sh
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

### Environment variables

```
ANDROID_HOME = <sdk path>            e.g. %LOCALAPPDATA%\Android\Sdk
NDK_HOME     = <sdk path>\ndk\<ver>  e.g. %LOCALAPPDATA%\Android\Sdk\ndk\29.0.14206865
JAVA_HOME    = <jdk path>            e.g. C:\Program Files\Android\Android Studio\jbr
```

Do **not** set `WRY_ANDROID_*` or NDK compiler/linker vars manually — the Tauri CLI
sets those itself. Setting `WRY_ANDROID_KOTLIN_FILES_OUT_DIR` by hand generates
duplicate Kotlin files and breaks the Gradle build ("Redeclaration" errors).

### Build & run

```sh
# dev with hot reload (device/emulator must be connected)
yarn tauri android dev

# debug APK (bundles the frontend, no dev server needed)
yarn tauri android build --debug --target aarch64
# -> src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk

adb install -r <apk>
```

If `adb install` fails with `INSTALL_FAILED_VERSION_DOWNGRADE`, uninstall first:
`adb uninstall gg.norisk.NoRiskClientLauncherV3`.

`src-tauri/gen/android/` is the generated Android Studio project and is committed
(manifest, icons, gradle config live there). Build outputs and signing secrets are
excluded via its own `.gitignore`. If it is ever missing, regenerate with
`yarn tauri android init` — but note that regeneration discards local customizations.

### Code notes

- Mobile entry point is `run()` in `src-tauri/src/lib.rs` (`#[tauri::mobile_entry_point]`); `main.rs` is desktop-only.
- Desktop-only code (tray, updater, deep-link, CLI, single-instance, extra webview windows, Discord RPC) is gated with `#[cfg(desktop)]` / `#[cfg(mobile)]`.
- Capabilities are split: `capabilities/default.json` (desktop) and `capabilities/mobile.json`.
- `tauri.android.conf.json` overrides the window config on Android (starts visible, no updater flow).
- Frontend: `useIsMobile()` (`src/hooks/useIsMobile.ts`) switches to mobile layouts (e.g. `MobileBottomNav` instead of the sidebar).

## iOS

Not set up yet. Requires macOS + Xcode (<https://developer.apple.com/xcode/>);
scaffold with `yarn tauri ios init` — guide:
<https://v2.tauri.app/start/prerequisites/#ios>.
The `#[cfg(mobile)]` gates and `capabilities/mobile.json` already cover iOS.

## Further reading

- Tauri 2 Android development: <https://v2.tauri.app/develop/#developing-your-mobile-application>
- Tauri 2 Android distribution/signing: <https://v2.tauri.app/distribute/sign/android/>
- adb reference: <https://developer.android.com/tools/adb>
