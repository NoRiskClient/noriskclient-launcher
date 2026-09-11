import AppKit
import AVFoundation
import ScreenCaptureKit
import VideoToolbox

func emit(_ type: String, _ fields: [String: Any] = [:]) {
    var message = fields; message["type"] = type
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data + Data([10]))
}
private let outputLock = NSLock()
func report(_ error: Error, code: String = "internal", recoverable: Bool = true) {
    emit("error", ["code": code, "message": error.localizedDescription, "recoverable": recoverable])
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
func keyframe(_ sample: CMSampleBuffer) -> Bool {
    let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
    return attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
}

struct Settings: Decodable {
    var width: Int = 1920, height: Int = 1080, fps: Int = 60, bitrate_kbps: Int = 20_000
    var buffer_seconds: Int = 30, gop_seconds: Double = 2
    var codec: String = "h264", encoder: String = "auto", capture_audio: Bool = true
    var audio_source: String = "system", capture_microphone: Bool = false
    var microphone_device_id: String?, audio_device_id: String?
    var game_volume: Int = 100, other_volume: Int = 100, microphone_volume: Int = 100
    var output_dir: String = ""
}

final class Samples {
    var video: [CMSampleBuffer] = []
    var audio: [String: [CMSampleBuffer]] = [:]
    var bytes = 0
    var playbackOffset = 0.0
    func append(_ sample: CMSampleBuffer, label: String?, retain: Double) {
        if let label = label { audio[label, default: []].append(sample) } else { video.append(sample) }
        bytes += CMSampleBufferGetTotalSampleSize(sample)
        guard let last = video.last else { return }
        let cutoff = time(last) - retain
        while video.count > 1, let next = video.dropFirst().firstIndex(where: keyframe),
              time(video[next]) <= cutoff || bytes > 512 * 1024 * 1024 {
            for sample in video[..<next] { bytes -= CMSampleBufferGetTotalSampleSize(sample) }
            video.removeFirst(next)
        }
        let start = video.first.map(time) ?? cutoff
        for label in audio.keys {
            let count = audio[label]!.prefix { time($0) < start }.count
            for sample in audio[label]!.prefix(count) { bytes -= CMSampleBufferGetTotalSampleSize(sample) }
            audio[label]!.removeFirst(count)
        }
    }
    func snapshot(from start: Double, through end: Double) throws -> Samples {
        guard let first = video.indices.last(where: { time(video[$0]) <= start && keyframe(video[$0]) }) ?? video.indices.first(where: { keyframe(video[$0]) }) else { throw failure("The replay buffer is empty.") }
        let result = Samples()
        result.video = Array(video[first...].prefix { time($0) <= end })
        guard !result.video.isEmpty else { throw failure("The replay buffer is empty.") }
        let beginning = time(result.video[0])
        result.playbackOffset = max(0, start - beginning)
        result.audio = audio.mapValues { $0.filter { time($0) >= beginning && time($0) <= end } }
        return result
    }
}

@available(macOS 15.0, *)
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "nrc.capture")
    var config = Settings()
    var stream: SCStream?, audioStream: SCStream?
    var compression: VTCompressionSession?
    var ring = Samples()
    var pid: Int32?, enabled = true, generation = 0
    var state = "idle", codec = "h264", encoder = "video_toolbox"
    var width = 1920, height = 1080, frames = 0, dropped = 0
    var latencies: [Double] = []
    var lastFrames = 0, lastReport = ProcessInfo.processInfo.systemUptime
    var timer: DispatchSourceTimer?
    var frameTimer: DispatchSourceTimer?
    var latestImage: CVPixelBuffer?
    var pendingSaves = 0
    var encoding = false
    @MainActor var attachment: Task<Void, Never>?
    var saveRetention: [UUID: Double] = [:]
    var retainSeconds: Double { max(Double(config.buffer_seconds), saveRetention.values.max() ?? 0) }

    func ready() {
        let capabilities: [[String: Any]] = ["h264", "h265", "av1"].flatMap { codec in
            ["video_toolbox", "software"].map { encoder in
                ["codec": codec, "encoder": encoder, "available": supportsCodec(codec, hardware: encoder == "video_toolbox"), "hardware": encoder == "video_toolbox"]
            }
        }
        let microphones = AVCaptureDevice.devices(for: .audio).map { device in
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
        lastFrames = frames; lastReport = now
        let latency = latencies.sorted()
        let p99 = latency.isEmpty ? 0 : latency[Int(Double(latency.count - 1) * 0.99)]
        emit("status", ["state": state, "buffer_fill_seconds": max(0, (ring.video.last.map(time) ?? 0) - (ring.video.first.map(time) ?? 0)),
            "buffer_bytes": ring.bytes, "capture_fps": fps, "encode_fps": fps, "dropped_frames": dropped,
            "dropped_before_keyframe": 0, "encode_latency_ms_p99": p99,
            "capture_method": "screencapturekit", "active_codec": codec, "active_encoder": encoder])
    }

    @MainActor func handle(_ message: [String: Any]) async {
        do {
            switch message["type"] as? String {
            case "configure":
                let next = try JSONDecoder().decode(Settings.self, from: JSONSerialization.data(withJSONObject: message))
                await stop()
                queue.sync { config = next }
                startAttachment()
            case "attach_window":
                guard let pid = message["pid"] as? Int32 else { return }
                await stop(); queue.sync { self.pid = pid }
                startAttachment()
            case "detach_window": await stop(); queue.sync { pid = nil; state = "idle" }
            case "set_buffer_enabled":
                let enabled = message["enabled"] as? Bool ?? false
                await stop(); queue.sync { self.enabled = enabled; state = enabled ? "idle" : "paused" }
                startAttachment()
            case "save_clip": queue.async { self.save(message) }
            case "trim_clip", "export_vertical", "prepare_audio_preview":
                Task { do { try await editMedia(message) } catch { report(error, code: "clip_write") } }
            default: break
            }
        } catch {
            report(error)
        }
    }

    @MainActor func startAttachment() {
        guard let pid = queue.sync(execute: { self.pid }), queue.sync(execute: { enabled }) else { return }
        let generation = queue.sync { self.generation }
        attachment = Task {
            do { try await attach(pid) }
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
        let old = queue.sync { () -> (SCStream?, SCStream?) in
            generation += 1
            frameTimer?.cancel(); frameTimer = nil; latestImage = nil
            let old = (stream, audioStream); stream = nil; audioStream = nil
            if let session = compression { VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid); VTCompressionSessionInvalidate(session) }
            compression = nil; encoding = false
            state = nextState ?? (enabled ? "idle" : "paused")
            return old
        }
        try? await old.0?.stopCapture(); try? await old.1?.stopCapture()
    }

    @MainActor func attach(_ pid: Int32) async throws {
        try Task.checkCancellation()
        queue.sync { state = "attaching" }
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            throw CaptureFailure(code: "paused", message: "Allow screen recording for the app shown in the permission prompt in System Settings > Privacy & Security > Screen & System Audio Recording, then enable clips again.")
        }
        let config = queue.sync { self.config }
        if config.capture_microphone {
            guard await AVCaptureDevice.requestAccess(for: .audio) else { throw CaptureFailure(code: "paused", message: "Allow microphone access for the app shown in the permission prompt in System Settings > Privacy & Security > Microphone, then enable clips again.") }
        }
        try Task.checkCancellation()
        var content: SCShareableContent?
        var target: SCWindow?
        for _ in 0..<120 {
            try Task.checkCancellation()
            let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            try Task.checkCancellation()
            target = current.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width >= 128 && $0.frame.height >= 128 }
                .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
            content = current
            if target != nil { break }
            if kill(pid, 0) != 0 { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        guard let window = target, let content = content else { throw CaptureFailure(code: "window_not_found", message: "No capturable game window was found for process \(pid). Open the game window and enable clips again.") }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let pixelWidth = window.frame.width * Double(filter.pointPixelScale)
        let pixelHeight = window.frame.height * Double(filter.pointPixelScale)
        let ratio = min(Double(config.width) / pixelWidth, Double(config.height) / pixelHeight, 1)
        let width = max(2, Int(pixelWidth * ratio) / 2 * 2)
        let height = max(2, Int(pixelHeight * ratio) / 2 * 2)
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
        sc.capturesAudio = config.capture_audio && config.audio_source != "system"
        sc.sampleRate = 48000; sc.channelCount = 2
        sc.captureMicrophone = config.capture_microphone
        sc.microphoneCaptureDeviceID = config.microphone_device_id
        let stream = SCStream(filter: filter, configuration: sc, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if sc.capturesAudio { try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
        if sc.captureMicrophone { try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue) }
        var audioStream: SCStream?
        if config.capture_audio && config.audio_source != "game_only", let display = content.displays.first {
            let audio = SCStreamConfiguration()
            audio.width = 2; audio.height = 2; audio.minimumFrameInterval = CMTime(seconds: 1, preferredTimescale: 1)
            audio.capturesAudio = true; audio.sampleRate = 48000; audio.channelCount = 2; audio.excludesCurrentProcessAudio = true
            let excluded = config.audio_source == "both" ? content.applications.filter { $0.processID == pid } : []
            let other = SCStream(filter: SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []), configuration: audio, delegate: self)
            try other.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            audioStream = other
        }
        queue.sync {
            ring = Samples(); self.width = width; self.height = height; self.codec = codec
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
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in
            guard queue.sync(execute: { stream === self.stream || stream === self.audioStream }) else { return }
            await captureFailed(error)
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sample.isValid, stream === self.stream || stream === audioStream else { return }
        if type == .screen {
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let raw = attachments.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw) else { return }
            if status == .complete, let image = CMSampleBufferGetImageBuffer(sample) {
                latestImage = image
                if state == "paused" && enabled { state = "buffering" }
            } else if status == .blank || status == .suspended {
                latestImage = nil
                if state == "buffering" { state = "paused" }
            }
        } else {
            guard state == "buffering" else { return }
            let label = type == .microphone ? "Microphone" : (stream === audioStream ? (config.audio_source == "both" ? "Other" : "System") : "Game")
            if !ring.video.isEmpty { ring.append(sample, label: label, retain: retainSeconds) }
        }
    }

    func encodeFrame() {
        guard state == "buffering", let image = latestImage, let session = compression else { return }
        if encoding { dropped += 1; return }
        encoding = true
        let began = ProcessInfo.processInfo.systemUptime
        let generation = self.generation
        let status = VTCompressionSessionEncodeFrame(session, imageBuffer: image, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), duration: CMTime(value: 1, timescale: CMTimeScale(config.fps)), frameProperties: nil, infoFlagsOut: nil) { [weak self] status, _, compressed in
            guard let self = self else { return }
            self.queue.async {
                guard generation == self.generation else { return }
                self.encoding = false
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
            encoding = false; state = "failed"
            report(failure("VideoToolbox encoding failed (\(status))."), code: "encoder_unavailable", recoverable: false)
        }
    }

    func save(_ request: [String: Any]) {
        guard pendingSaves < 3 else { report(failure("Wait for the pending clips to finish saving."), code: "clip_write"); return }
        guard let last = ring.video.last else { report(failure("The replay buffer is empty."), code: "buffer_empty"); return }
        let pre = Double(request["pre_roll_seconds"] as? Int ?? 30)
        let post = Double(request["post_roll_seconds"] as? Int ?? 0)
        let end = time(last) + (state == "buffering" ? post : 0)
        let start = time(last) - pre
        let ring = self.ring, config = self.config, width = self.width, height = self.height
        let reason = request["reason"] as? [String: Any] ?? ["type": "manual"]
        pendingSaves += 1
        let id = UUID()
        saveRetention[id] = pre + post + config.gop_seconds
        queue.asyncAfter(deadline: .now() + (state == "buffering" ? post : 0)) {
            self.saveRetention[id] = nil
            do {
                let snapshot = try ring.snapshot(from: start, through: end)
                Task {
                    do { try await saveMedia(snapshot, config: config, width: width, height: height, reason: reason) }
                    catch { report(error, code: "clip_write") }
                    self.queue.async { self.pendingSaves -= 1 }
                }
            } catch { self.pendingSaves -= 1; report(error, code: "buffer_empty") }
        }
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
func supportsCodec(_ codec: String, hardware: Bool) -> Bool {
    guard codec != "av1", let session = try? makeEncoder(width: 1920, height: 1080, codec: codec, hardware: hardware) else { return false }
    VTCompressionSessionInvalidate(session); return true
}
func set(_ session: VTCompressionSession, _ key: CFString, _ value: CFTypeRef) throws {
    let result = VTSessionSetProperty(session, key: key, value: value)
    if result != noErr { throw CaptureFailure(code: "encoder_unavailable", message: "VideoToolbox setting \(key) failed (\(result)).") }
}

@_cdecl("nrc_capture_main")
func captureMain() {
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
                if message["type"] as? String == "shutdown" { exit(0) }
                continuation.yield(message)
            }
            exit(0)
        }
    }
    Task { for await command in commands { await capture.handle(command) } }
    application.run()
}
