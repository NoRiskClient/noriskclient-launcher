package gg.norisk.NoRiskClientLauncherV3

import android.app.Activity
import android.graphics.Color
import android.view.Gravity
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout

/**
 * Hosts a fullscreen SurfaceView overlay for the in-process Minecraft JVM.
 *
 * libpojavexec is deliberately NOT loaded on the ART side (its JNI_OnLoad
 * expects Zalith's whole bridge class layer). Instead Rust — which already
 * holds libpojavexec via RTLD_GLOBAL for the guest JVM — pulls the Surface
 * from here and calls setupBridgeWindow directly. So this class only manages
 * the view and exposes the live Surface.
 */
object GameBridge {
    @Volatile
    private var activity: Activity? = null

    @Volatile
    @JvmStatic
    var surface: Surface? = null
        private set

    private var surfaceView: SurfaceView? = null

    fun attachActivity(a: Activity) {
        activity = a
    }

    /** Called from Rust (JNI) just before the MC JVM boots. */
    @JvmStatic
    fun requestGameSurfaceFromNative() {
        val a = activity ?: return
        a.runOnUiThread { showSurface(a) }
    }

    // Rust polls the auto-generated static getSurface() until non-null, then
    // hands the Surface to setupBridgeWindow.

    private fun showSurface(a: Activity) {
        surfaceView?.let {
            it.visibility = SurfaceView.VISIBLE
            return
        }
        val sv = SurfaceView(a)
        sv.setBackgroundColor(Color.BLACK)
        sv.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surface = holder.surface
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                surface = holder.surface
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                surface = null
            }
        })
        val params = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER,
        )
        a.addContentView(sv, params)
        surfaceView = sv

        // The WebView (Chrome) keeps its own EGL/GPU context alive in this
        // process. onPause doesn't stop its Viz GPU thread, so once Minecraft's
        // gl4es context goes current the WebView thread hits "no current
        // context" and SIGSEGVs. Fully tear it down - the SurfaceView owns the
        // screen now (PoC: no way back to the launcher UI after this).
        val webView = findWebView(a.window.decorView)
        webView?.let { wv ->
            wv.onPause()
            wv.pauseTimers()
            wv.loadUrl("about:blank")
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.destroy()
        }
    }

    private fun findWebView(root: View): WebView? {
        if (root is WebView) return root
        if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                findWebView(root.getChildAt(i))?.let { return it }
            }
        }
        return null
    }
}
