# FullRiskClient Launcher

[![Latest Release Build](https://img.shields.io/github/actions/workflow/status/SirKnubble/fullriskclient-launcher/build.yml?event=push&label=latest%20release%20build)](https://github.com/SirKnubble/fullriskclient-launcher/actions/workflows/build.yml)
[![Latest Release](https://img.shields.io/github/v/release/SirKnubble/fullriskclient-launcher?label=latest%20release)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest)

This Repository includes all bugfixes and suggested features of NoRiskClient/issues by @SirKnubble, aswell as the custom servers feature & FullRisk Theme in Launcher Settings, which is based on an overhaul of the original NoRiskClient look by @TimLohrer.

⚠️ I´m aware of most appearing issues (like artifacts by newssection & background), as they will be fixed in the future.
I´m using this version myself rather than the original, so hopefully there won´t be any data loss while using. 🙏

<3

<img width="1600" height="1000" alt="image" src="https://github.com/user-attachments/assets/f6a10260-fe81-4b13-9880-f9a6aa8bebbd" />

## Downloads

All links point to the newest GitHub release.

| OS                  |    Support    | Download                                                                                                                                                                                                                                                        |
| ------------------- | :-----------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11       | :green_heart: | [Installer (.exe)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Windows-Setup.exe)                                                                                                                           |
| Linux x64           | :green_heart: | [AppImage](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Linux.AppImage) / [Debian package (.deb)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Linux.deb) |
| macOS Apple Silicon | :green_heart: | [Disk image (.dmg)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-macOS-arm64.dmg)                                                                                                                            |
| macOS Intel         | :green_heart: | [Disk image (.dmg)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-macOS-x86_64.dmg)                                                                                                                           |

## Compile it yourself!

### Prerequisites

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/en/download)
- **Rust** (latest stable) - [Install here](https://www.rust-lang.org/tools/install)
- **Yarn** package manager - `npm install -g yarn`

### Setup Instructions

1. Clone the repository:

   ```bash
   git clone --recurse-submodules https://github.com/NoRiskClient/noriskclient-launcher
   cd noriskclient-launcher
   ```

2. Install dependencies:

   ```bash
   yarn install
   ```

3. Start development mode:

   ```bash
   yarn tauri dev
   ```

4. Build for production:
   ```bash
   yarn tauri build
   ```

### Optional Linux packaging

- Flatpak:
  ```bash
  yarn tauri build
  flatpak-builder --force-clean --repo=packaging/flatpak/repo packaging/flatpak/build-dir packaging/flatpak/gg.norisk.NoRiskClientLauncherV3.yaml
  flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo packaging/flatpak/repo src-tauri/target/release/bundle/flatpak/fullrisk-launcher.flatpak gg.norisk.NoRiskClientLauncherV3
  ```
- Snap:
  ```bash
  yarn tauri build
  cp src-tauri/target/release/bundle/appimage/FullriskLauncher-Linux.AppImage packaging/snap/
  cp gg.norisk.NoRiskClientLauncherV3.desktop packaging/snap/
  cd packaging/snap
  snapcraft --output ../../src-tauri/target/release/bundle/snap/fullrisk-launcher.snap
  ```
- AUR package metadata is available in `packaging/aur/PKGBUILD`.
- RPM spec metadata is available in `packaging/rpm/FullriskLauncher.spec`.

## Disclaimer

This project is not affiliated, associated, endorsed by, or in any way connected to FullRisk.
