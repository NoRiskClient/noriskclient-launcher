Name: fullrisk-launcher
Version: 0.6.21
Release: 1%{?dist}
Summary: FullRiskClient Launcher
License: MIT
URL: https://github.com/SirKnubble/fullriskclient-launcher
Source0: %{name}-%{version}.tar.gz
BuildRequires: cargo nodejs yarn rpm-build libwebkit2gtk-devel libayatana-appindicator3-devel librsvg2-dev patchelf
Requires: libwebkit2gtk libayatana-appindicator3 librsvg
%description
FullRiskClient Launcher is a Tauri-based launcher for Minecraft clients with full Norisk integration.

%prep
%autosetup

%build
yarn install --immutable
yarn tauri build --release

%install
mkdir -p %{buildroot}/opt/fullrisk-launcher
cp -r src-tauri/target/release/bundle/* %{buildroot}/opt/fullrisk-launcher/
cat > %{buildroot}/usr/bin/fullrisk-launcher <<'EOF'
#!/bin/sh
exec /opt/fullrisk-launcher/FullriskLauncher-Linux.AppImage "$@"
EOF
chmod +x %{buildroot}/usr/bin/fullrisk-launcher
install -Dm644 gg.norisk.NoRiskClientLauncherV3.desktop %{buildroot}/usr/share/applications/gg.norisk.NoRiskClientLauncherV3.desktop
install -Dm644 src-tauri/icons/128x128.png %{buildroot}/usr/share/icons/hicolor/128x128/apps/gg.norisk.NoRiskClientLauncherV3.png

%files
/opt/fullrisk-launcher
/usr/bin/fullrisk-launcher
/usr/share/applications/gg.norisk.NoRiskClientLauncherV3.desktop
/usr/share/icons/hicolor/128x128/apps/gg.norisk.NoRiskClientLauncherV3.png

%changelog
