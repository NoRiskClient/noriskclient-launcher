package gg.norisk.NoRiskClientLauncherV3

import android.os.Bundle

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Register with the game bridge so Rust can surface a GL overlay for
        // the in-process Minecraft JVM (PoC).
        GameBridge.attachActivity(this)
    }
}
