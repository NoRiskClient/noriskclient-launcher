# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class gg.norisk.NoRiskClientLauncherV3.* {
  native <methods>;
}

-keep class gg.norisk.NoRiskClientLauncherV3.WryActivity {
  public <init>(...);

  void setWebView(gg.norisk.NoRiskClientLauncherV3.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class gg.norisk.NoRiskClientLauncherV3.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class gg.norisk.NoRiskClientLauncherV3.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class gg.norisk.NoRiskClientLauncherV3.RustWebChromeClient,gg.norisk.NoRiskClientLauncherV3.RustWebViewClient {
  public <init>(...);
}
