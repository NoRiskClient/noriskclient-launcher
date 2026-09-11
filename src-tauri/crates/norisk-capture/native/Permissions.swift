import AppKit
import AVFoundation

@_cdecl("nrc_input_monitoring")
func inputMonitoring(_ request: Bool) -> Bool {
    func check() -> Bool {
        if CGPreflightListenEventAccess() { return true }
        return request && CGRequestListenEventAccess()
    }
    if Thread.isMainThread { return check() }
    return DispatchQueue.main.sync { check() }
}

@_cdecl("nrc_open_permission_settings")
func openPermissionSettings(_ permission: UInt8) -> Bool {
    let pane: String
    switch permission {
    case 0: pane = "Privacy_ScreenCapture"
    case 1: pane = "Privacy_Microphone"
    case 2: pane = "Privacy_ListenEvent"
    default: return false
    }
    let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
    if Thread.isMainThread { return NSWorkspace.shared.open(url) }
    return DispatchQueue.main.sync { NSWorkspace.shared.open(url) }
}

@MainActor func permissionCommand() async {
    if let index = CommandLine.arguments.firstIndex(of: "--request-permission"),
       index + 1 < CommandLine.arguments.count {
        switch CommandLine.arguments[index + 1] {
        case "screen_recording":
            if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
        case "microphone":
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .audio)
            }
        default: break
        }
    }
    emit("permissions", ["screen_recording": CGPreflightScreenCaptureAccess(),
        "microphone": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized])
}
