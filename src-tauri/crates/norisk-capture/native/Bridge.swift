import AppKit
import Foundation

@_cdecl("nrc_open_apps")
func openApps(_ foreground: Bool) -> UnsafeMutablePointer<CChar>? {
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    var seen = Set<Int32>()
    let apps: [[String: Any]] = windows.compactMap { window in
        guard let pid = window[kCGWindowOwnerPID as String] as? Int32,
              pid != ProcessInfo.processInfo.processIdentifier,
              !foreground || pid == front,
              window[kCGWindowLayer as String] as? Int == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
              (bounds["Width"] ?? 0) >= 128, (bounds["Height"] ?? 0) >= 128,
              seen.insert(pid).inserted,
              let app = NSRunningApplication(processIdentifier: pid),
              let executable = app.executableURL?.path else { return nil }
        return ["pid": pid, "executable": executable,
                "name": app.localizedName ?? URL(fileURLWithPath: executable).lastPathComponent]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: apps),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return strdup(json)
}

@_cdecl("nrc_free_string")
func freeString(_ value: UnsafeMutablePointer<CChar>?) { free(value) }

private var eventTap: CFMachPort?
private var tapSource: CFRunLoopSource?
private var bindings: [(String, UInt8)] = []
private var onHotkey: (@convention(c) (UInt8) -> Void)?

private let keyNames: [Int64: String] = [
    0:"KeyA",1:"KeyS",2:"KeyD",3:"KeyF",4:"KeyH",5:"KeyG",6:"KeyZ",7:"KeyX",8:"KeyC",9:"KeyV",11:"KeyB",
    12:"KeyQ",13:"KeyW",14:"KeyE",15:"KeyR",16:"KeyY",17:"KeyT",18:"Digit1",19:"Digit2",20:"Digit3",
    21:"Digit4",22:"Digit6",23:"Digit5",24:"Equal",25:"Digit9",26:"Digit7",27:"Minus",28:"Digit8",
    29:"Digit0",30:"BracketRight",31:"KeyO",32:"KeyU",33:"BracketLeft",34:"KeyI",35:"KeyP",36:"Enter",
    37:"KeyL",38:"KeyJ",39:"Quote",40:"KeyK",41:"Semicolon",42:"Backslash",43:"Comma",44:"Slash",
    45:"KeyN",46:"KeyM",47:"Period",48:"Tab",49:"Space",50:"Backquote",51:"Backspace",53:"Escape",
    65:"NumpadDecimal",67:"NumpadMultiply",69:"NumpadAdd",75:"NumpadDivide",76:"NumpadEnter",
    78:"NumpadSubtract",81:"NumpadEqual",82:"Numpad0",83:"Numpad1",84:"Numpad2",85:"Numpad3",
    86:"Numpad4",87:"Numpad5",88:"Numpad6",89:"Numpad7",91:"Numpad8",92:"Numpad9",
    64:"F17",79:"F18",80:"F19",90:"F20",96:"F5",97:"F6",98:"F7",99:"F3",100:"F8",101:"F9",
    103:"F11",105:"F13",106:"F16",107:"F14",109:"F10",111:"F12",113:"F15",114:"Insert",115:"Home",
    116:"PageUp",117:"Delete",118:"F4",119:"End",120:"F2",121:"PageDown",122:"F1",
    123:"ArrowLeft",124:"ArrowRight",125:"ArrowDown",126:"ArrowUp"
]

@_cdecl("nrc_hotkeys")
func installHotkeys(_ json: UnsafePointer<CChar>, _ callback: @escaping @convention(c) (UInt8) -> Void) -> Bool {
    guard let data = String(cString: json).data(using: .utf8),
          let specs = try? JSONDecoder().decode([String].self, from: data) else { return false }
    func install() -> Bool {
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
        if let source = tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        eventTap = nil; tapSource = nil; bindings = []; onHotkey = callback
        for (index, spec) in specs.enumerated() where !spec.isEmpty {
            let parts = spec.split(separator: "+").map(String.init)
            let modifiers = ["Ctrl", "Control", "Shift", "Alt", "Super", "Meta", "Cmd"]
            let keys = parts.filter { !modifiers.contains($0) }
            guard keys.count == 1, keyNames.values.contains(keys[0]) || ["MouseMiddle", "MouseX1", "MouseX2"].contains(keys[0]) else { return false }
            bindings.append((spec, UInt8(index)))
        }
        if bindings.isEmpty { return true }
        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.otherMouseDown.rawValue)
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
            options: .listenOnly, eventsOfInterest: CGEventMask(mask), callback: { _, type, event, _ in
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
                    return Unmanaged.passUnretained(event)
                }
                if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 && type == .keyDown { return Unmanaged.passUnretained(event) }
                let key: String?
                if type == .otherMouseDown {
                    key = [2:"MouseMiddle",3:"MouseX1",4:"MouseX2"][event.getIntegerValueField(.mouseEventButtonNumber)]
                } else { key = keyNames[event.getIntegerValueField(.keyboardEventKeycode)] }
                if let key = key {
                    for (spec, tag) in bindings {
                        let parts = Set(spec.split(separator: "+").map(String.init))
                        if parts.contains(key),
                           event.flags.contains(.maskControl) == !parts.isDisjoint(with: ["Ctrl", "Control"]),
                           event.flags.contains(.maskShift) == parts.contains("Shift"),
                           event.flags.contains(.maskAlternate) == parts.contains("Alt"),
                           event.flags.contains(.maskCommand) == !parts.isDisjoint(with: ["Super", "Meta", "Cmd"]) { onHotkey?(tag) }
                    }
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: nil) else { CGRequestListenEventAccess(); return false }
        eventTap = tap
        tapSource = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), tapSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }
    if Thread.isMainThread { return install() }
    return DispatchQueue.main.sync { install() }
}
