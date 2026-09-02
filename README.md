# FullRiskClient Launcher

[![Latest Build](https://img.shields.io/github/actions/workflow/status/SirKnubble/fullriskclient-launcher/build.yml?event=push&label=latest%20release%20build)](https://github.com/SirKnubble/fullriskclient-launcher/actions/workflows/build.yml)
[![Latest Release](https://img.shields.io/github/v/release/SirKnubble/fullriskclient-launcher?label=latest%20release)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest)
[![Total Downloads](https://img.shields.io/github/downloads/sirknubble/fullriskclient-launcher/total)](https://img.shields.io/github/downloads/sirknubble/fullriskclient-launcher/total)

This Repository includes all bugfixes and suggested features of NoRiskClient/issues by @SirKnubble, aswell as the custom servers feature & FullRisk Theme in Launcher Settings, which is based on an overhaul of the original NoRiskClient look by @TimLohrer.

⚠️ I´m aware of most appearing issues (like artifacts by newssection & background), as they will be fixed in the future.
I´m using this version myself rather than the original, so hopefully there won´t be any data loss while using. 🙏

<3

<img width="1600" height="1000" alt="Launcher Preview (Fullrisk Theme)" src="https://github.com/user-attachments/assets/5ca280e8-4e15-40d7-9754-4d192fdfe2ca" />

## Downloads

All links point to the newest GitHub release.

| OS                   |    Support    | Download                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | :-----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11        | :green_heart: | [Installer (.exe)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Windows-Setup.exe)                                                                                                                                                                                                                                            |
| Linux x64            | :green_heart: | [AppImage](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Linux.AppImage) / [Debian package (.deb)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Linux.deb)                                                                                                                  |
| macOS Apple Silicon  | :green_heart: | [Disk image (.dmg)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-macOS-arm64.dmg)                                                                                                                                                                                                                                             |
| macOS Intel          | :green_heart: | [Disk image (.dmg)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-macOS-x86_64.dmg)                                                                                                                                                                                                                                            |
| Other Linux Packages |      🚧       | Flatpak / [Snap package](https://github.com/SirKnubble/fullriskclient-launcher/blob/fullrisk/packaging/snap/snapcraft.yaml) / [RPM package (.rpm)](https://github.com/SirKnubble/fullriskclient-launcher/releases/latest/download/FullriskLauncher-Linux.rpm) / [AUR package (arch)](https://github.com/SirKnubble/fullriskclient-launcher/blob/fullrisk/packaging/aur/PKGBUILD) |

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

## Disclaimer

This project is not affiliated, associated, endorsed by, or in any way connected to FullRisk.
