import AppKit
import AVFoundation
import ScreenCaptureKit
import VideoToolbox

private var captureLogger: (@convention(c) (UnsafePointer<CChar>) -> Void)?
func captureLog(_ message: String) {
    if let logger = captureLogger { message.withCString(logger) }
    else { FileHandle.standardError.write(Data((message + "\n").utf8)) }
}
func emit(_ type: String, _ fields: [String: Any] = [:]) {
    if !["status", "pong", "export_progress"].contains(type) { captureLog("Event: \(type)") }
    var message = fields; message["type"] = type
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data + Data([10]))
}
private let outputLock = NSLock()
func report(_ error: Error, code: String = "internal", recoverable: Bool = true, source: String? = nil, destination: String? = nil) {
    captureLog("Error [\(code)]: \(error.localizedDescription)")
    var fields: [String: Any] = ["code": code, "message": error.localizedDescription, "recoverable": recoverable]
    if let source { fields["source"] = source }
    if let destination { fields["destination"] = destination }
    emit("error", fields)
}
func failure(_ message: String) -> NSError { NSError(domain: "NoRiskCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
struct CaptureFailure: LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
    var recoverable: Bool { ["window_not_found", "paused", "audio_device"].contains(code) }
}
func seconds(_ value: Double) -> CMTime { CMTime(seconds: value, preferredTimescale: 1_000_000) }
func time(_ sample: CMSampleBuffer) -> Double { CMSampleBufferGetPresentationTimeStamp(sample).seconds }
func withAudioBuffers<T>(_ sample: CMSampleBuffer, _ body: (UnsafeMutablePointer<AudioBufferList>) -> T?) -> T? {
    var size = 0
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil) == noErr else { return nil }
    let list = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { list.deallocate() }
    let buffers = list.assumingMemoryBound(to: AudioBufferList.self)
    var block: CMBlockBuffer?
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil, bufferListOut: buffers, bufferListSize: size,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block) == noErr else { return nil }
    return withExtendedLifetime(block) { body(buffers) }
}
func detached(_ sample: CMSampleBuffer) -> CMSampleBuffer? {
    guard let format = CMSampleBufferGetFormatDescription(sample) else { return nil }
    return withAudioBuffers(sample) { buffers -> CMSampleBuffer? in
        var copy: CMSampleBuffer?
        guard CMAudioSampleBufferCreateWithPacketDescriptions(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil,
                formatDescription: format, sampleCount: CMSampleBufferGetNumSamples(sample),
                presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(sample), packetDescriptions: nil, sampleBufferOut: &copy) == noErr,
              let copy, CMSampleBufferSetDataBufferFromAudioBufferList(copy, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
                flags: 0, bufferList: buffers) == noErr else { return nil }
        return copy
    }
}
@available(macOS 15.0, *)
func audioExclusions(_ content: SCShareableContent, executable: String?) -> [SCRunningApplication] {
    guard let executable = executable?.trimmingCharacters(in: .whitespaces), !executable.isEmpty else { return [] }
    let bundle = executable.range(of: ".app/").map { String(executable[..<$0.upperBound]) } ?? executable
    return content.applications.filter { app in
        guard let path = NSRunningApplication(processIdentifier: app.processID)?.executableURL?.path else { return false }
        return path == executable || path.hasPrefix(bundle)
    }
}
func hostSeconds() -> Double { CMClockGetTime(CMClockGetHostTimeClock()).seconds }
func outputSize(_ frame: CGRect, scale: Double, config: Settings) -> (width: Int, height: Int) {
    let pixelWidth = frame.width * scale, pixelHeight = frame.height * scale
    let ratio = min(Double(config.width) / pixelWidth, Double(config.height) / pixelHeight, 1)
    return (max(2, Int(pixelWidth * ratio) / 2 * 2), max(2, Int(pixelHeight * ratio) / 2 * 2))
}
func sameFormat(_ first: CMSampleBuffer, _ second: CMSampleBuffer) -> Bool {
    guard let one = CMSampleBufferGetFormatDescription(first), let two = CMSampleBufferGetFormatDescription(second) else { return false }
    return CMFormatDescriptionEqual(one, otherFormatDescription: two)
}
func keyframe(_ sample: CMSampleBuffer) -> Bool {
    let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
    return attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
}

struct Settings: Decodable {
    var width: Int = 1920, height: Int = 1080, fps: Int = 60, bitrate_kbps: Int = 20_000
    var buffer_seconds: Int = 30, gop_seconds: Double = 2
    var codec: String = "h264", encoder: String = "auto", capture_audio: Bool = true
    var audio_source: String = "system", capture_microphone: Bool = false, microphone_denoise: Bool = false
    var microphone_device_id: String?, audio_device_id: String?, excluded_audio_executable: String?
    var game_volume: Int = 100, other_volume: Int = 100, microphone_volume: Int = 100
    var output_dir: String = ""
}

func needsRestart(_ current: Settings, _ next: Settings) -> Bool {
    current.width != next.width || current.height != next.height || current.fps != next.fps
        || current.bitrate_kbps != next.bitrate_kbps || current.gop_seconds != next.gop_seconds
        || current.codec != next.codec || current.encoder != next.encoder
        || current.capture_audio != next.capture_audio || current.audio_source != next.audio_source
        || current.capture_microphone != next.capture_microphone || current.microphone_device_id != next.microphone_device_id
        || current.microphone_denoise != next.microphone_denoise || current.excluded_audio_executable != next.excluded_audio_executable
}

final class Samples {
    var video: [CMSampleBuffer] = []
    var audio: [String: [CMSampleBuffer]] = [:]
    var bytes = 0, droppedBeforeKeyframe = 0
    private var keyframes: [Int] = []
    var playbackOffset = 0.0
    var retired: Samples?, retiredAt = 0.0, spoiledAfter: Double?
    var seconds: Double { video.isEmpty ? 0 : time(video.last!) - time(video.first!) }
    func retire() {
        let old = Samples()
        if let cut = spoiledAfter {
            let kept = video.prefix { time($0) <= cut }.count
            old.video = Array(video.prefix(kept)); old.keyframes = keyframes.filter { $0 < kept }
            old.audio = audio.mapValues { $0.filter { time($0) <= cut } }
        } else {
            old.video = video; old.keyframes = keyframes; old.audio = audio
        }
        retired = old.video.isEmpty ? nil : old; retiredAt = hostSeconds(); spoiledAfter = nil
        video.removeAll(); keyframes.removeAll(); audio.removeAll(); bytes = 0
    }
    func append(_ sample: CMSampleBuffer, label: String?, retain: Double) {
        if retired != nil, hostSeconds() - retiredAt > 130 { retired = nil }
        if let label = label {
            if let last = audio[label]?.last, !sameFormat(last, sample) {
                for old in audio[label]! { bytes -= CMSampleBufferGetTotalSampleSize(old) }
                audio[label] = nil
            }
            audio[label, default: []].append(sample)
        } else {
            if let last = video.last, !sameFormat(last, sample) { retire() }
            let sync = keyframe(sample)
            if video.isEmpty && !sync { droppedBeforeKeyframe += 1; return }
            if sync { keyframes.append(video.count) }
            video.append(sample)
        }
        bytes += CMSampleBufferGetTotalSampleSize(sample)
        guard let last = video.last else { return }
        let cutoff = time(last) - retain
        while keyframes.count > 1,
              time(video[keyframes[1]]) <= cutoff || bytes > 512 * 1024 * 1024 {
            let next = keyframes[1]
            for sample in video[..<next] { bytes -= CMSampleBufferGetTotalSampleSize(sample) }
            video.removeFirst(next)
            keyframes = keyframes.dropFirst().map { $0 - next }
        }
        let start = video.first.map(time) ?? cutoff
        for label in audio.keys {
            let count = audio[label]!.prefix { time($0) < start }.count
            for sample in audio[label]!.prefix(count) { bytes -= CMSampleBufferGetTotalSampleSize(sample) }
            audio[label]!.removeFirst(count)
        }
    }
    func snapshot(from start: Double, through end: Double) throws -> Samples {
        guard let first = keyframes.last(where: { time(video[$0]) <= start }) ?? keyframes.first else { throw failure("The replay buffer is empty.") }
        let result = Samples()
        result.video = Array(video[first...].prefix { time($0) <= end })
        result.keyframes = keyframes.filter { $0 >= first && $0 < first + result.video.count }.map { $0 - first }
        guard !result.video.isEmpty else { throw failure("The replay buffer is empty.") }
        let beginning = time(result.video[0])
        result.playbackOffset = max(0, start - beginning)
        result.audio = audio.mapValues { $0.filter { time($0) >= beginning && time($0) <= end } }
        return result
    }
}

enum Aim {
    case window(Int32)
    case screen(CGDirectDisplayID)
}

@available(macOS 15.0, *)
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "nrc.capture")
    var config = Settings()
    var stream: SCStream?, audioStream: SCStream?
    var compression: VTCompressionSession?
    var ring = Samples()
    var pid: Int32?, screen: CGDirectDisplayID?, enabled = true, generation = 0, audioSource = "system"
    var denoiser: Denoiser?
    var state = "idle", codec = "h264", encoder = "video_toolbox"
    var width = 1920, height = 1080, frames = 0, captured = 0, dropped = 0
    var latencies: [Double] = []
    var lastFrames = 0, lastCaptured = 0, lastReport = ProcessInfo.processInfo.systemUptime
    var timer: DispatchSourceTimer?
    var frameTimer: DispatchSourceTimer?
    var latestImage: CVPixelBuffer?
    var pendingSaves = 0
    let pendingMedia = DispatchGroup()
    var scheduledSaves: [UUID: DispatchWorkItem] = [:]
    var framesInFlight = 0
    @MainActor var attachment: Task<Void, Never>?
    @MainActor var exclusionWatch: Task<Void, Never>?
    @MainActor var retry: Task<Void, Never>?
    @MainActor var resizeWatch: Task<Void, Never>?
    @MainActor var failures: [Double] = []
    @MainActor var rests = 0
    @MainActor var bufferingSince: Double?
    var saveRetention: [UUID: Double] = [:]
    var retainSeconds: Double { max(Double(config.buffer_seconds), saveRetention.values.max() ?? 0) }

    func ready() {
        let capabilities: [[String: Any]] = ["h264", "h265", "av1"].flatMap { codec in
            ["video_toolbox", "software"].map { encoder in
                ["codec": codec, "encoder": encoder, "available": supportsCodec(codec, hardware: encoder == "video_toolbox"), "hardware": encoder == "video_toolbox"]
            }
        }
        let microphones = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices.map { device in
            ["id": device.uniqueID, "name": device.localizedName, "is_default": device.uniqueID == AVCaptureDevice.default(for: .audio)?.uniqueID] as [String: Any]
        }
        emit("ready", ["protocol_version": 1, "engine_version": "0.1.0", "adapter": "Apple VideoToolbox",
            "available_encoders": ["video_toolbox", "software"], "capabilities": capabilities,
            "audio_devices": [], "microphones": microphones, "supports_game_only_audio": true])
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: 1)
        timer.setEventHandler { [weak self] in self?.status() }
        timer.resume(); self.timer = timer
    }

    func status() {
        let now = ProcessInfo.processInfo.systemUptime
        let fps = Double(frames - lastFrames) / max(0.001, now - lastReport)
        let captureFPS = Double(captured - lastCaptured) / max(0.001, now - lastReport)
        lastFrames = frames; lastCaptured = captured; lastReport = now
        let latency = latencies.sorted()
        let p99 = latency.isEmpty ? 0 : latency[Int(Double(latency.count - 1) * 0.99)]
        emit("status", ["state": state, "buffer_fill_seconds": max(0, (ring.video.last.map(time) ?? 0) - (ring.video.first.map(time) ?? 0)),
            "buffer_bytes": ring.bytes, "capture_fps": captureFPS, "encode_fps": fps, "dropped_frames": dropped,
            "dropped_before_keyframe": ring.droppedBeforeKeyframe, "encode_latency_ms_p99": p99,
            "capture_method": "screencapturekit", "active_codec": codec, "active_encoder": encoder])
    }

    @MainActor func handle(_ message: [String: Any]) async {
        captureLog("Command: \(message["type"] as? String ?? "unknown")")
        do {
            switch message["type"] as? String {
            case "configure":
                let next = try JSONDecoder().decode(Settings.self, from: JSONSerialization.data(withJSONObject: message))
                if queue.sync(execute: { stream == nil || needsRestart(config, next) }) {
                    await stop()
                    queue.sync { config = next }
                    startAttachment(keepingBuffer: true)
                } else {
                    queue.sync { config = next }
                }
            case "attach_window":
                guard let pid = message["pid"] as? Int32 else { return }
                await stop(); queue.sync { self.pid = pid; screen = nil }
                startAttachment()
            case "attach_screen":
                guard let device = message["device"] as? String, let display = CGDirectDisplayID(device) else { return }
                await stop(); queue.sync { pid = nil; screen = display }
                startAttachment()
            case "detach_window": await stop(); queue.sync { pid = nil; screen = nil; state = "idle" }
            case "set_buffer_enabled":
                let enabled = message["enabled"] as? Bool ?? false
                await stop(); queue.sync { self.enabled = enabled; state = enabled ? "idle" : "paused" }
                startAttachment()
            case "save_clip": queue.async { self.save(message) }
            case "trim_clip", "export_vertical", "prepare_audio_preview":
                pendingMedia.enter()
                Task {
                    defer { pendingMedia.leave() }
                    do { try await editMedia(message) } catch {
                        report(error, code: "clip_write", source: message["source"] as? String, destination: message["destination"] as? String)
                    }
                }
            case "export_gif":
                pendingMedia.enter()
                Task {
                    defer { pendingMedia.leave() }
                    do { try await exportGif(message) } catch {
                        report(error, code: "clip_write", source: message["source"] as? String, destination: message["destination"] as? String)
                    }
                }
            default: break
            }
        } catch {
            report(error)
        }
    }

    @MainActor func startAttachment(keepingBuffer: Bool = false) {
        guard let aim = queue.sync(execute: { self.screen.map(Aim.screen) ?? self.pid.map(Aim.window) }), queue.sync(execute: { enabled }) else { return }
        let generation = queue.sync { self.generation }
        attachment = Task {
            do { try await attach(aim, keepingBuffer: keepingBuffer) }
            catch {
                guard !Task.isCancelled, queue.sync(execute: { self.generation == generation }) else { return }
                await captureFailed(error)
            }
        }
    }

    @MainActor func captureFailed(_ error: Error) async {
        let native = error as NSError
        let issue: CaptureFailure
        if let typed = error as? CaptureFailure {
            issue = typed
        } else if native.domain == SCStreamErrorDomain {
            switch SCStreamError.Code(rawValue: native.code) {
            case .userDeclined, .userStopped, .systemStoppedStream:
                issue = CaptureFailure(code: "paused", message: "Capture was stopped or not permitted. Check Screen & System Audio Recording in System Settings > Privacy & Security, then enable clips again.")
            case .noCaptureSource, .noWindowList:
                issue = CaptureFailure(code: "window_not_found", message: "No capturable game window was found. Open the game window and enable clips again.")
            case .failedToStartAudioCapture, .failedToStartMicrophoneCapture:
                issue = CaptureFailure(code: "audio_device", message: error.localizedDescription)
            default:
                issue = CaptureFailure(code: "graphics_device", message: error.localizedDescription)
            }
        } else {
            issue = CaptureFailure(code: "graphics_device", message: error.localizedDescription)
        }
        report(issue, code: issue.code, recoverable: issue.recoverable)
        await stop(state: issue.recoverable ? "paused" : "failed")
    }

    @MainActor func stop(state nextState: String? = nil) async {
        attachment?.cancel(); attachment = nil
        exclusionWatch?.cancel(); exclusionWatch = nil
        retry?.cancel(); retry = nil; bufferingSince = nil
        resizeWatch?.cancel(); resizeWatch = nil
        let old = queue.sync { () -> (SCStream?, SCStream?) in
            generation += 1
            frameTimer?.cancel(); frameTimer = nil; latestImage = nil
            let old = (stream, audioStream); stream = nil; audioStream = nil
            if let session = compression { VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid); VTCompressionSessionInvalidate(session) }
            compression = nil; framesInFlight = 0; denoiser = nil
            state = nextState ?? (enabled ? "idle" : "paused")
            return old
        }
        try? await old.0?.stopCapture(); try? await old.1?.stopCapture()
    }

    @MainActor func attach(_ aim: Aim, keepingBuffer: Bool) async throws {
        try Task.checkCancellation()
        queue.sync { state = "attaching" }
        guard CGPreflightScreenCaptureAccess() else {
            throw CaptureFailure(code: "paused", message: "Allow screen recording from Settings > Clips > macOS permissions, then retry capture.")
        }
        let config = queue.sync { self.config }
        if config.capture_microphone {
            guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { throw CaptureFailure(code: "paused", message: "Allow microphone access from Settings > Clips > macOS permissions, then retry capture.") }
        }
        try Task.checkCancellation()
        var content: SCShareableContent?
        var filter: SCContentFilter?
        var frame = CGRect.zero
        var pid: Int32?, windowID: CGWindowID?
        switch aim {
        case .window(let wanted):
            pid = wanted
            for _ in 0..<120 {
                try Task.checkCancellation()
                let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
                try Task.checkCancellation()
                content = current
                if let window = current.windows.filter({ $0.owningApplication?.processID == wanted && $0.windowLayer == 0 && $0.frame.width >= 128 && $0.frame.height >= 128 })
                    .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) {
                    filter = SCContentFilter(desktopIndependentWindow: window); frame = window.frame; windowID = window.windowID
                    break
                }
                if kill(wanted, 0) != 0 { break }
                try await Task.sleep(nanoseconds: 500_000_000)
            }
            guard filter != nil else { throw CaptureFailure(code: "window_not_found", message: "No capturable game window was found for process \(wanted). Open the game window and enable clips again.") }
        case .screen(let wanted):
            let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            try Task.checkCancellation()
            content = current
            guard let display = current.displays.first(where: { $0.displayID == wanted }) else {
                throw CaptureFailure(code: "window_not_found", message: "Screen \(wanted) is not connected. Plug it in or pick another screen.")
            }
            filter = SCContentFilter(display: display, excludingWindows: []); frame = display.frame
        }
        guard let filter, let content else { throw CaptureFailure(code: "window_not_found", message: "Nothing to record was found.") }
        let (width, height) = outputSize(frame, scale: Double(filter.pointPixelScale), config: config)
        let source = pid == nil ? "system" : config.audio_source
        let hardware = config.encoder != "software"
        let codec = supportsCodec(config.codec, hardware: hardware) ? config.codec : "h264"
        let session = try makeEncoder(width: width, height: height, codec: codec, hardware: hardware)
        var installed = false
        defer { if !installed { VTCompressionSessionInvalidate(session) } }
        try set(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        try set(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        try set(session, kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: config.bitrate_kbps * 1000))
        try set(session, kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: config.fps))
        try set(session, kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, NSNumber(value: config.gop_seconds))
        guard VTCompressionSessionPrepareToEncodeFrames(session) == noErr else { throw CaptureFailure(code: "encoder_unavailable", message: "VideoToolbox could not prepare the encoder.") }
        let sc = SCStreamConfiguration()
        sc.width = width; sc.height = height
        sc.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(config.fps))
        sc.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        sc.queueDepth = 4; sc.showsCursor = false; sc.scalesToFit = true
        sc.capturesAudio = config.capture_audio && source != "system"
        sc.sampleRate = 48000; sc.channelCount = 2
        sc.captureMicrophone = config.capture_microphone
        sc.microphoneCaptureDeviceID = config.microphone_device_id
        let stream = SCStream(filter: filter, configuration: sc, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if sc.capturesAudio { try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
        if sc.captureMicrophone { try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue) }
        var audioStream: SCStream?
        if config.capture_audio && source != "game_only", let display = content.displays.first {
            let audio = SCStreamConfiguration()
            audio.width = 2; audio.height = 2; audio.minimumFrameInterval = CMTime(seconds: 1, preferredTimescale: 1)
            audio.capturesAudio = true; audio.sampleRate = 48000; audio.channelCount = 2; audio.excludesCurrentProcessAudio = false
            let excluded = source == "both" ? content.applications.filter { $0.processID == pid }
                : audioExclusions(content, executable: config.excluded_audio_executable)
            let other = SCStream(filter: SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []), configuration: audio, delegate: self)
            try other.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            audioStream = other
        }
        queue.sync {
            if !keepingBuffer { ring = Samples() }
            audioSource = source
            denoiser = config.capture_microphone && config.microphone_denoise ? Denoiser() : nil
            self.width = width; self.height = height; self.codec = codec
            self.encoder = hardware ? "video_toolbox" : "software"; compression = session
            self.stream = stream; self.audioStream = audioStream
        }
        installed = true
        do {
            try await stream.startCapture()
            try Task.checkCancellation()
            try await audioStream?.startCapture()
            try Task.checkCancellation()
        } catch {
            // A cancelled start can finish after stop() has already detached this stream.
            try? await stream.stopCapture(); try? await audioStream?.stopCapture()
            throw error
        }
        queue.sync {
            state = "buffering"
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now(), repeating: .nanoseconds(1_000_000_000 / max(1, config.fps)))
            timer.setEventHandler { [weak self] in self?.encodeFrame() }
            timer.resume(); frameTimer = timer
        }
        bufferingSince = ProcessInfo.processInfo.systemUptime
        watchSize(aim, windowID: windowID, scale: Double(filter.pointPixelScale), config: config, recording: (width, height))
        if source == "system", config.capture_audio, let other = queue.sync(execute: { audioStream }), let display = content.displays.first {
            watchExclusions(other, display: display, executable: config.excluded_audio_executable,
                            current: Set(audioExclusions(content, executable: config.excluded_audio_executable).map(\.processID)))
        }
    }

    @MainActor func watchExclusions(_ stream: SCStream, display: SCDisplay, executable: String?, current: Set<pid_t>) {
        guard let executable, !executable.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        exclusionWatch = Task {
            var excluded = current
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled, let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false) else { continue }
                let apps = audioExclusions(content, executable: executable)
                let pids = Set(apps.map(\.processID))
                guard pids != excluded, !Task.isCancelled else { continue }
                do {
                    try await stream.updateContentFilter(SCContentFilter(display: display, excludingApplications: apps, exceptingWindows: []))
                    excluded = pids
                    captureLog("Keeping \(apps.count) process(es) of \(executable) out of the system audio")
                } catch {
                    captureLog("Could not update the excluded audio program: \(error.localizedDescription)")
                }
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in
            guard queue.sync(execute: { stream === self.stream || stream === self.audioStream }) else { return }
            await streamBroke(error)
        }
    }

    @MainActor func streamBroke(_ error: Error) async {
        let native = error as NSError
        let code = native.domain == SCStreamErrorDomain ? SCStreamError.Code(rawValue: native.code) : nil
        guard code != .userDeclined, code != .userStopped,
              let aim = queue.sync(execute: { self.screen.map(Aim.screen) ?? self.pid.map(Aim.window) }) else {
            await captureFailed(error); return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if let since = bufferingSince, now - since >= 120 { failures.removeAll(); rests = 0 }
        failures = failures.filter { now - $0 < 120 } + [now]
        await stop(state: "attaching")
        if failures.count >= 3 {
            let rest = 60 * Double(1 << min(rests, 3))
            rests += 1; failures.removeAll()
            report(failure("Recording keeps failing, so it waits \(Int(rest)) s before trying again: \(error.localizedDescription)"), code: "graphics_device")
            queue.sync { state = "paused" }
            retryAttachment(aim, after: rest)
        } else if failures.count == 1 {
            report(failure("Recording broke (\(error.localizedDescription)); it is starting again."), code: "graphics_device")
            startAttachment(keepingBuffer: true)
        } else {
            captureLog("Recording broke again (\(error.localizedDescription)); trying again in 2 s")
            retryAttachment(aim, after: 2)
        }
    }

    @MainActor func watchSize(_ aim: Aim, windowID: CGWindowID?, scale: Double, config: Settings, recording: (width: Int, height: Int)) {
        resizeWatch = Task {
            var pending: (width: Int, height: Int)?, since = 0.0, began: Double?
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled, let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false) else { continue }
                let frame: CGRect?
                switch aim {
                case .window: frame = content.windows.first { $0.windowID == windowID }?.frame
                case .screen(let id): frame = content.displays.first { $0.displayID == id }?.frame
                }
                guard let frame, frame.width >= 128, frame.height >= 128 else { pending = nil; began = nil; continue }
                let wanted = outputSize(frame, scale: scale, config: config)
                guard wanted != recording else { pending = nil; began = nil; continue }
                let now = hostSeconds()
                if began == nil { began = now - 1 }
                guard let settling = pending, settling == wanted else { pending = wanted; since = now; continue }
                guard now - since >= 2, !Task.isCancelled else { continue }
                captureLog("Size settled; recording \(wanted.width)x\(wanted.height) instead of \(recording.width)x\(recording.height)")
                let spoiled = began
                queue.sync { ring.spoiledAfter = spoiled }
                await stop()
                startAttachment(keepingBuffer: true)
                return
            }
        }
    }

    @MainActor func retryAttachment(_ aim: Aim, after delay: Double) {
        let generation = queue.sync { self.generation }
        retry = Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, queue.sync(execute: { self.generation == generation }) else { return }
            startAttachment(keepingBuffer: true)
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sample.isValid, stream === self.stream || stream === audioStream else { return }
        if type == .screen {
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let raw = attachments.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw) else { return }
            if status == .complete, let image = CMSampleBufferGetImageBuffer(sample) {
                captured += 1
                latestImage = image
                if state == "paused" && enabled { state = "buffering" }
            } else if status == .blank || status == .suspended {
                latestImage = nil
                if state == "buffering" { state = "paused" }
            }
        } else {
            guard state == "buffering" else { return }
            let label = type == .microphone ? "Microphone" : (stream === audioStream ? (audioSource == "both" ? "Other" : "System") : "Game")
            if !ring.video.isEmpty, let copy = detached(sample) {
                if type == .microphone { denoiser?.clean(copy) }
                ring.append(copy, label: label, retain: retainSeconds)
            }
        }
    }

    func encodeFrame() {
        guard state == "buffering", let image = latestImage, let session = compression else { return }
        guard framesInFlight < 4 else { dropped += 1; return }
        framesInFlight += 1
        let began = ProcessInfo.processInfo.systemUptime
        let generation = self.generation
        let status = VTCompressionSessionEncodeFrame(session, imageBuffer: image, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), duration: CMTime(value: 1, timescale: CMTimeScale(config.fps)), frameProperties: nil, infoFlagsOut: nil) { [weak self] status, _, compressed in
            guard let self = self else { return }
            self.queue.async {
                guard generation == self.generation else { return }
                self.framesInFlight -= 1
                guard status == noErr else {
                    self.state = "failed"
                    report(failure("VideoToolbox encoding failed (\(status))."), code: "encoder_unavailable", recoverable: false)
                    return
                }
                guard let compressed = compressed else { self.dropped += 1; return }
                self.latencies.append((ProcessInfo.processInfo.systemUptime - began) * 1000)
                if self.latencies.count > 240 { self.latencies.removeFirst() }
                self.frames += 1; self.ring.append(compressed, label: nil, retain: self.retainSeconds)
            }
        }
        if status != noErr {
            framesInFlight -= 1; state = "failed"
            report(failure("VideoToolbox encoding failed (\(status))."), code: "encoder_unavailable", recoverable: false)
        }
    }

    func save(_ request: [String: Any]) {
        guard pendingSaves < 3 else { report(failure("Wait for the pending clips to finish saving."), code: "clip_write"); return }
        let older = self.ring.retired.flatMap { old in
            self.ring.seconds < 5 && hostSeconds() - self.ring.retiredAt <= 130 && old.seconds > self.ring.seconds + 0.1 ? old : nil
        }
        let ring = older ?? self.ring
        guard let last = ring.video.last else { report(failure("The replay buffer is empty."), code: "buffer_empty"); return }
        let pre = Double(request["pre_roll_seconds"] as? Int ?? 30)
        let post = older == nil && state == "buffering" ? Double(request["post_roll_seconds"] as? Int ?? 0) : 0
        let end = time(last) + post
        let start = time(last) - pre
        let config = self.config
        let reason = request["reason"] as? [String: Any] ?? ["type": "manual"]
        let named = clipDestination(config: config, reason: reason)
        pendingSaves += 1; pendingMedia.enter()
        let id = UUID()
        saveRetention[id] = pre + post + config.gop_seconds
        let work = DispatchWorkItem {
            guard self.scheduledSaves.removeValue(forKey: id) != nil else { return }
            self.saveRetention[id] = nil
            do {
                let snapshot = try ring.snapshot(from: start, through: end)
                Task {
                    let size = snapshot.video.first.flatMap(CMSampleBufferGetFormatDescription).map(CMVideoFormatDescriptionGetDimensions)
                    do { try await saveMedia(snapshot, config: config, width: Int(size?.width ?? 0), height: Int(size?.height ?? 0), reason: reason, to: named) }
                    catch { report(error, code: "clip_write", source: named.url.path) }
                    self.queue.async { self.pendingSaves -= 1; self.pendingMedia.leave() }
                }
            } catch { self.pendingSaves -= 1; self.pendingMedia.leave(); report(error, code: "buffer_empty") }
        }
        scheduledSaves[id] = work
        queue.asyncAfter(deadline: .now() + (state == "buffering" ? post : 0), execute: work)
    }

    @MainActor func shutdown() async -> Bool {
        captureLog("Shutting down; finishing pending media jobs")
        await stop(state: "paused")
        queue.sync {
            for work in Array(scheduledSaves.values) { work.perform(); work.cancel() }
        }
        let finished = await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: self.pendingMedia.wait(timeout: .now() + 30) == .success)
            }
        }
        if !finished { captureLog("Timed out waiting for pending media jobs") }
        return finished
    }
}

func makeEncoder(width: Int, height: Int, codec: String, hardware: Bool) throws -> VTCompressionSession {
    let type = codec == "h265" ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264
    var session: VTCompressionSession?
    let spec: [CFString: Any] = [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: hardware,
        kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: hardware]
    let status = VTCompressionSessionCreate(allocator: nil, width: Int32(width), height: Int32(height), codecType: type,
        encoderSpecification: spec as CFDictionary, imageBufferAttributes: nil, compressedDataAllocator: nil,
        outputCallback: nil, refcon: nil, compressionSessionOut: &session)
    guard status == noErr, let session = session else { throw CaptureFailure(code: "encoder_unavailable", message: "VideoToolbox encoder is unavailable (\(status)).") }
    return session
}
private let videoEncoders: [[CFString: Any]] = {
    var encoders: CFArray?
    guard VTCopyVideoEncoderList(nil, &encoders) == noErr else { return [] }
    return encoders as? [[CFString: Any]] ?? []
}()
func supportsCodec(_ codec: String, hardware: Bool) -> Bool {
    guard codec == "h264" || codec == "h265" else { return false }
    let type = codec == "h265" ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264
    return videoEncoders.contains {
        ($0[kVTVideoEncoderList_CodecType] as? NSNumber)?.uint32Value == type &&
        ($0[kVTVideoEncoderList_IsHardwareAccelerated] as? Bool ?? false) == hardware
    }
}
func set(_ session: VTCompressionSession, _ key: CFString, _ value: CFTypeRef) throws {
    let result = VTSessionSetProperty(session, key: key, value: value)
    if result != noErr { throw CaptureFailure(code: "encoder_unavailable", message: "VideoToolbox setting \(key) failed (\(result)).") }
}

@_cdecl("nrc_capture_main")
func captureMain(_ logger: @escaping @convention(c) (UnsafePointer<CChar>) -> Void) {
    captureLogger = logger
    captureLog("macOS capture engine starting")
    if CommandLine.arguments.contains("--permissions") {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        Task { @MainActor in await permissionCommand(); exit(0) }
        application.run()
        return
    }
    guard #available(macOS 15.0, *) else { report(failure("Clips require macOS 15 or newer."), recoverable: false); exit(1) }
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    let capture = Capture()
    capture.queue.async { capture.ready() }
    let commands = AsyncStream<[String: Any]> { continuation in
        DispatchQueue.global().async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8), let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                if message["type"] as? String == "ping" { emit("pong", ["seq": message["seq"] ?? 0]); continue }
                continuation.yield(message)
                if message["type"] as? String == "shutdown" { break }
            }
            continuation.finish()
        }
    }
    Task {
        for await command in commands {
            if command["type"] as? String == "shutdown" { break }
            await capture.handle(command)
        }
        exit(await capture.shutdown() ? 0 : 1)
    }
    application.run()
}
