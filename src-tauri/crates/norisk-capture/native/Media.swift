import AVFoundation
import CoreImage

func shifted(_ sample: CMSampleBuffer, by origin: CMTime) throws -> CMSampleBuffer {
    var count = 0
    CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
    var times = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
    CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: count, arrayToFill: &times, entriesNeededOut: nil)
    for i in times.indices {
        times[i].presentationTimeStamp = times[i].presentationTimeStamp - origin
        if times[i].decodeTimeStamp.isValid { times[i].decodeTimeStamp = times[i].decodeTimeStamp - origin }
    }
    var result: CMSampleBuffer?
    let status = CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: count, sampleTimingArray: &times, sampleBufferOut: &result)
    guard status == noErr, let result = result else { throw failure("Could not align clip timestamps (\(status)).") }
    return result
}

func title(_ name: String) -> AVMetadataItem {
    let item = AVMutableMetadataItem(); item.identifier = .commonIdentifierTitle; item.value = name as NSString
    return item
}
func trackName(_ track: AVAssetTrack, index: Int) -> String {
    AVMetadataItem.metadataItems(from: track.commonMetadata, filteredByIdentifier: .commonIdentifierTitle).first?.stringValue ?? (index == 0 ? "Mix" : "Audio \(index)")
}
func fileSize(_ url: URL) -> UInt64 { (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(UInt64.init) ?? 0 }

func writeSamples(_ samples: Samples, to url: URL) async throws -> [String] {
    guard let first = samples.video.first, let format = CMSampleBufferGetFormatDescription(first) else { throw failure("The replay buffer has no video.") }
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    let video = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: format)
    video.expectsMediaDataInRealTime = false; writer.add(video)
    var inputs: [(AVAssetWriterInput, [CMSampleBuffer])] = [(video, samples.video)]
    let labels = ["Game", "System", "Other", "Microphone"].filter { !(samples.audio[$0] ?? []).isEmpty }
    for label in labels {
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192000])
        input.metadata = [title(label)]; input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { throw failure("Could not create the \(label) audio track.") }
        writer.add(input); inputs.append((input, samples.audio[label]!))
    }
    guard writer.startWriting() else { throw writer.error ?? failure("Could not open the clip writer.") }
    writer.startSession(atSourceTime: .zero)
    let origin = CMSampleBufferGetPresentationTimeStamp(first)
    do {
        try await withThrowingTaskGroup(of: Void.self) { group in
            for (input, buffers) in inputs {
                group.addTask {
                    for buffer in buffers {
                        while !input.isReadyForMoreMediaData {
                            guard writer.status == .writing else { throw writer.error ?? failure("The clip writer stopped.") }
                            try await Task.sleep(nanoseconds: 1_000_000)
                        }
                        guard input.append(try shifted(buffer, by: origin)) else { throw writer.error ?? failure("Could not write a clip sample.") }
                    }
                    input.markAsFinished()
                }
            }
            try await group.waitForAll()
        }
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? failure("Could not finish the clip.") }
    } catch { writer.cancelWriting(); throw error }
    return labels
}

func export(_ asset: AVAsset, to url: URL, preset: String = AVAssetExportPresetPassthrough,
            mix: AVAudioMix? = nil, video: AVVideoComposition? = nil, progress: String? = nil) async throws {
    guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { throw failure("The clip cannot be exported in this format.") }
    session.outputURL = url; session.outputFileType = url.pathExtension == "m4a" ? .m4a : .mp4
    session.audioMix = mix; session.videoComposition = video; session.shouldOptimizeForNetworkUse = url.pathExtension != "m4a"
    let poll = Task {
        while !Task.isCancelled {
            if let source = progress { emit("export_progress", ["source": source, "done": Int((session.progress.isFinite ? min(1, max(0, session.progress)) : 0) * 1000), "total": 1000]) }
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
    }
    await session.export(); poll.cancel()
    guard session.status == .completed else { try? FileManager.default.removeItem(at: url); throw session.error ?? failure("The export did not finish.") }
    if let source = progress { emit("export_progress", ["source": source, "done": 1000, "total": 1000]) }
}

@available(macOS 15.0, *)
func addTrack(_ track: AVAssetTrack, to composition: AVMutableComposition, range: CMTimeRange) async throws -> AVMutableCompositionTrack {
    guard let result = composition.addMutableTrack(withMediaType: track.mediaType, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw failure("Could not create a media track.") }
    let intersection = CMTimeRangeGetIntersection(range, otherRange: try await track.load(.timeRange))
    if intersection.duration > .zero {
        do { try result.insertTimeRange(intersection, of: track, at: intersection.start - range.start) }
        catch { throw failure("Could not insert a clip track: \(error.localizedDescription)") }
    }
    result.preferredTransform = try await track.load(.preferredTransform)
    return result
}

@available(macOS 15.0, *)
func makeMix(_ tracks: [AVAssetTrack], range: CMTimeRange, gains: [Float], to url: URL) async throws {
    let composition = AVMutableComposition()
    let mix = AVMutableAudioMix()
    var parameters: [AVMutableAudioMixInputParameters] = []
    for (index, track) in tracks.enumerated() {
        let copy = try await addTrack(track, to: composition, range: range)
        let input = AVMutableAudioMixInputParameters(track: copy)
        input.setVolume(gains[index], at: .zero)
        parameters.append(input)
    }
    mix.inputParameters = parameters
    try await export(composition, to: url, preset: AVAssetExportPresetAppleM4A, mix: mix)
}

func temporaryDirectory() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nrc-clip-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

func clipDestination(config: Settings, reason: [String: Any]) -> (url: URL, stamp: String) {
    let dir = URL(fileURLWithPath: config.output_dir, isDirectory: true)
    let stamp = String(Int(Date().timeIntervalSince1970))
    let slug = (reason["value"] as? String ?? "clip").map { $0.isASCII && ($0.isLetter || $0.isNumber) ? String($0).lowercased() : "_" }.joined()
    return (dir.appendingPathComponent("\(stamp)_\(slug)-\(UUID().uuidString.prefix(8)).mp4"), stamp)
}

@available(macOS 15.0, *)
func saveMedia(_ samples: Samples, config: Settings, width: Int, height: Int, reason: [String: Any],
               to named: (url: URL, stamp: String)) async throws {
    let temp = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: temp) }
    let raw = temp.appendingPathComponent("capture.mov")
    let labels = try await writeSamples(samples, to: raw)
    let asset = AVURLAsset(url: raw)
    defer { withExtendedLifetime(asset) {} }
    let duration = try await asset.load(.duration)
    let fullRange = CMTimeRange(start: .zero, duration: duration)
    let range = CMTimeRange(start: seconds(samples.playbackOffset), end: duration)
    let composition = AVMutableComposition()
    for track in try await asset.loadTracks(withMediaType: .video) { _ = try await addTrack(track, to: composition, range: range) }
    var audio = try await asset.loadTracks(withMediaType: .audio)
    var stemAssets: [AVAsset] = []
    defer { withExtendedLifetime(stemAssets) {} }
    if !audio.isEmpty {
        let gains = labels.map { label -> Float in
            let volume = label == "Microphone" ? config.microphone_volume : (label == "Other" ? config.other_volume : config.game_volume)
            return Float(min(200, max(0, volume))) / 100
        }
        for index in audio.indices where gains[index] != 1 {
            let adjusted = temp.appendingPathComponent("stem-\(index).m4a")
            try await makeMix([audio[index]], range: fullRange, gains: [gains[index]], to: adjusted)
            let adjustedAsset = AVURLAsset(url: adjusted)
            stemAssets.append(adjustedAsset)
            guard let track = (try await adjustedAsset.loadTracks(withMediaType: .audio)).first else { throw failure("An audio stem could not be adjusted.") }
            audio[index] = track
        }
        let mixed = temp.appendingPathComponent("mix.m4a")
        try await makeMix(audio, range: fullRange, gains: audio.map { _ in Float(1) }, to: mixed)
        let mixedAsset = AVURLAsset(url: mixed)
        defer { withExtendedLifetime(mixedAsset) {} }
        for track in try await mixedAsset.loadTracks(withMediaType: .audio) { _ = try await addTrack(track, to: composition, range: range) }
        for track in audio {
            let stem = try await addTrack(track, to: composition, range: range)
            stem.isEnabled = false
        }
    }
    let (destination, stamp) = named
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    try await export(composition, to: destination)
    let tracks: [[String: Any]] = audio.isEmpty ? [] : [["label": "Mix", "stream": 0, "adjustable": false, "peaks": []]] + labels.enumerated().map { index, label in
        ["label": label, "stream": index + 1, "adjustable": true, "peaks": audioPeaks(audio[index])]
    }
    emit("clip_saved", ["path": destination.path, "duration_seconds": range.duration.seconds, "width": width, "height": height,
        "fps": config.fps, "bitrate_kbps": config.bitrate_kbps, "size_bytes": fileSize(destination), "reason": reason,
        "created_at": stamp, "audio_tracks": tracks])
}

func audioPeaks(_ track: AVAssetTrack) -> [UInt8] {
    guard let asset = track.asset, let reader = try? AVAssetReader(asset: asset) else { return [] }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false,
        AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2])
    reader.add(output); guard reader.startReading() else { return [] }
    var peaks: [UInt8] = [], peak: Float = 0, count = 0
    while let sample = output.copyNextSampleBuffer(), let data = CMSampleBufferGetDataBuffer(sample) {
        var bytes = [UInt8](repeating: 0, count: CMBlockBufferGetDataLength(data))
        CMBlockBufferCopyDataBytes(data, atOffset: 0, dataLength: bytes.count, destination: &bytes)
        bytes.withUnsafeBytes { raw in
            for value in raw.bindMemory(to: Float.self) {
                if value.isFinite { peak = max(peak, min(1, abs(value))) }; count += 1
                if count == 1920 { peaks.append(UInt8(min(255, peak * 255))); peak = 0; count = 0 }
            }
        }
    }
    if count > 0 { peaks.append(UInt8(min(255, peak * 255))) }
    return peaks
}

@available(macOS 15.0, *)
func editMedia(_ message: [String: Any]) async throws {
    guard let source = message["source"] as? String else { throw failure("The clip source is missing.") }
    let asset = AVURLAsset(url: URL(fileURLWithPath: source))
    defer { withExtendedLifetime(asset) {} }
    let audio = try await asset.loadTracks(withMediaType: .audio)
    let assetDuration = try await asset.load(.duration)
    let duration = assetDuration.seconds
    guard duration.isFinite, duration > 0 else { throw failure("The clip has no readable duration.") }
    if message["type"] as? String == "prepare_audio_preview" {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nrc-clip-preview")
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var tracks: [[String: Any]] = []
        for (index, track) in audio.enumerated() {
            let composition = AVMutableComposition()
            _ = try await addTrack(track, to: composition, range: CMTimeRange(start: .zero, duration: assetDuration))
            let destination = dir.appendingPathComponent("\(UUID().uuidString)-\(index).m4a")
            try await export(composition, to: destination, preset: AVAssetExportPresetAppleM4A)
            tracks.append(["stream": index, "label": trackName(track, index: index), "path": destination.path])
        }
        emit("audio_preview_ready", ["source": source, "tracks": tracks]); return
    }
    guard let path = message["destination"] as? String else { throw failure("The export destination is missing.") }
    let destination = URL(fileURLWithPath: path)
    let render = message["type"] as? String == "export_vertical"
    let start = max(0, message.number("start_seconds") ?? 0), end = min(duration, message.number("end_seconds") ?? duration)
    guard end - start >= 0.5 else { throw failure("A trimmed clip has to be at least 0.5 seconds long.") }
    let timeline = Timeline(start: start, end: end, removed: render ? spans(message["removed"]) : [])
    let pictureStart = min(max(message.number("video_start_seconds") ?? start, start), end)
    let pictureEnd = max(min(max(message.number("video_end_seconds") ?? end, start), end), pictureStart)
    let composition = AVMutableComposition()
    guard let sourceVideo = (try await asset.loadTracks(withMediaType: .video)).first,
          let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw failure("The clip has no video track.") }
    let pieces = timeline.kept(pictureStart, pictureEnd)
    for piece in pieces {
        try await place(sourceVideo, into: video, from: piece.from, to: piece.to, at: timeline.out(piece.from))
    }
    guard !video.segments.isEmpty else { throw failure("No frames fall inside the trimmed range.") }
    let temp = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: temp) }
    var mixed: AVAsset?
    defer { withExtendedLifetime(mixed) {} }
    if !audio.isEmpty {
        mixed = try await soundtrack(audio, levels: trackLevels(message["levels"]), muted: render ? message["muted"] : nil,
                                     timeline: timeline, into: composition, temp: temp)
    }
    let sourceTransform = try await sourceVideo.load(.preferredTransform)
    video.preferredTransform = sourceTransform
    var videoComposition: AVMutableVideoComposition?
    var width = 0, height = 0
    if render {
        let sourceBounds = CGRect(origin: .zero, size: try await sourceVideo.load(.naturalSize)).applying(sourceTransform)
        let ratio = shapeRatio(message["shape"] as? String) ?? (Int(sourceBounds.width), Int(sourceBounds.height))
        let crop = centreCrop(width: Int(sourceBounds.width), height: Int(sourceBounds.height), ratio: ratio)
        guard crop.width > 0, crop.height > 0 else { throw failure("The video is too small for a \(ratio.0):\(ratio.1) crop.") }
        width = crop.width; height = crop.height
        let fps = try await sourceVideo.load(.nominalFrameRate)
        let painter = Painter(overlays: message["overlays"], blanked: spans(message["blanked"]),
                              width: Int(sourceBounds.width), height: Int(sourceBounds.height))
        let frame = CGRect(x: crop.left, y: Int(sourceBounds.height) - crop.top - crop.height, width: crop.width, height: crop.height)
        let black = CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: frame.size))
        let vc = try await AVMutableVideoComposition.videoComposition(with: composition) { request in
            let at = request.compositionTime.seconds
            guard let piece = pieces.first(where: { at >= timeline.out($0.from) && at < timeline.out($0.from) + $0.to - $0.from }) else {
                return request.finish(with: black, context: nil)
            }
            let painted = painter.paint(request.sourceImage, at: piece.from + at - timeline.out(piece.from))
            request.finish(with: painted.cropped(to: frame).transformed(by: CGAffineTransform(translationX: -frame.minX, y: -frame.minY)), context: nil)
        }
        vc.renderSize = CGSize(width: width, height: height)
        vc.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps.isFinite && fps >= 1 ? fps.rounded() : 60))
        videoComposition = vc
    }
    try await export(composition, to: destination, preset: render ? AVAssetExportPresetHighestQuality : AVAssetExportPresetPassthrough,
        video: videoComposition, progress: render ? source : nil)
    var result: [String: Any] = ["path": path, "source": source, "duration_seconds": composition.duration.seconds, "size_bytes": fileSize(destination)]
    if render { result["width"] = width; result["height"] = height } else { result["start_seconds"] = start; result["end_seconds"] = end }
    emit(render ? "clip_exported" : "clip_trimmed", result)
}

extension Double {
    var finite: Double? { isFinite ? self : nil }
}

extension Dictionary where Key == String, Value == Any {
    func number(_ key: String) -> Double? { (self[key] as? NSNumber)?.doubleValue.finite }
}

struct Span { var from: Double, to: Double }

func spans(_ value: Any?, stream: Int? = nil) -> [Span] {
    (value as? [[String: Any]] ?? []).compactMap { span in
        if let stream, (span["stream"] as? NSNumber)?.intValue != stream { return nil }
        guard let from = span.number("startSeconds"), let to = span.number("endSeconds"), to > from else { return nil }
        return Span(from: from, to: to)
    }
}

func merged(_ spans: [Span]) -> [Span] {
    var result: [Span] = []
    for span in spans.filter({ $0.to > $0.from }).sorted(by: { $0.from < $1.from }) {
        if let last = result.last, span.from <= last.to { result[result.count - 1].to = max(last.to, span.to) } else { result.append(span) }
    }
    return result
}

struct Timeline {
    let start: Double, end: Double, gaps: [Span]

    init(start: Double, end: Double, removed: [Span]) {
        self.start = start; self.end = end
        gaps = merged(removed.map { Span(from: max($0.from, start), to: min($0.to, end)) })
    }

    func out(_ time: Double) -> Double {
        var removed = 0.0
        for gap in gaps {
            if time < gap.from { break }
            if time < gap.to { return gap.from - removed - start }
            removed += gap.to - gap.from
        }
        return time - removed - start
    }

    func kept(_ from: Double, _ to: Double) -> [Span] {
        var pieces: [Span] = [], cursor = from
        for gap in gaps where gap.to > cursor && gap.from < to {
            if gap.from > cursor { pieces.append(Span(from: cursor, to: gap.from)) }
            cursor = gap.to
        }
        if to > cursor { pieces.append(Span(from: cursor, to: to)) }
        return pieces
    }
}

struct Level {
    let stream: Int, volume: Int, offset: Double, from: Double?, to: Double?
    var gain: Float { Float(min(200, max(0, volume))) / 100 }
    var changesAnything: Bool { volume != 100 || offset != 0 || from != nil || to != nil }
}

func trackLevels(_ value: Any?) -> [Level] {
    (value as? [[String: Any]] ?? []).compactMap { level in
        guard let stream = (level["stream"] as? NSNumber)?.intValue, let volume = (level["volume"] as? NSNumber)?.intValue else { return nil }
        return Level(stream: stream, volume: volume, offset: level.number("offsetSeconds") ?? 0,
                     from: level.number("startSeconds"), to: level.number("endSeconds"))
    }
}

func shapeRatio(_ shape: String?) -> (Int, Int)? {
    switch shape {
    case "original": return nil
    case "square": return (1, 1)
    case "wide": return (21, 9)
    default: return (9, 16)
    }
}

func centreCrop(width: Int, height: Int, ratio: (Int, Int)) -> (left: Int, top: Int, width: Int, height: Int) {
    let (across, down) = ratio
    guard across > 0, down > 0 else { return (0, 0, 0, 0) }
    if (height * across / down) & ~1 >= width {
        let keepWidth = width & ~1
        let keepHeight = min(keepWidth * down / across, height) & ~1
        return (0, ((height - keepHeight) / 2) & ~1, keepWidth, keepHeight)
    }
    let keepHeight = height & ~1
    let keepWidth = (keepHeight * across / down) & ~1
    return (((width - keepWidth) / 2) & ~1, 0, keepWidth, keepHeight)
}

@available(macOS 15.0, *)
func place(_ track: AVAssetTrack, into target: AVMutableCompositionTrack, from: Double, to: Double, at: Double) async throws {
    let wanted = CMTimeRange(start: seconds(from), end: seconds(to))
    let range = CMTimeRangeGetIntersection(wanted, otherRange: try await track.load(.timeRange))
    guard range.duration > .zero else { return }
    var when = seconds(at) + (range.start - wanted.start)
    let tail = target.timeRange.end
    if !target.segments.isEmpty, abs((when - tail).seconds) < 0.001 { when = tail }
    do { try target.insertTimeRange(range, of: track, at: when) }
    catch { throw failure("Could not insert a clip track: \(error.localizedDescription)") }
}

func hush(_ input: AVMutableAudioMixInputParameters, gain: Float, spans: [Span], until end: Double) {
    let ramp = { (from: Double, to: Double, start: Float, finish: Float) in
        guard to > from else { return }
        input.setVolumeRamp(fromStartVolume: start, toEndVolume: finish, timeRange: CMTimeRange(start: seconds(from), end: seconds(to)))
    }
    var cursor = 0.0
    for span in spans where span.to > cursor {
        let from = max(span.from, cursor), fade = min(0.005, (span.to - from) / 2)
        ramp(cursor, from, gain, gain)
        ramp(from, from + fade, gain, 0)
        ramp(from + fade, span.to - fade, 0, 0)
        ramp(span.to - fade, span.to, 0, gain)
        cursor = span.to
    }
    ramp(cursor, max(cursor, end), gain, gain)
}

@available(macOS 15.0, *)
func soundtrack(_ audio: [AVAssetTrack], levels: [Level], muted: Any?, timeline: Timeline,
                into composition: AVMutableComposition, temp: URL) async throws -> AVAsset? {
    let master = { () async throws -> AVAsset? in
        guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw failure("Could not create a media track.")
        }
        for piece in timeline.kept(timeline.start, timeline.end) {
            try await place(audio[0], into: track, from: piece.from, to: piece.to, at: timeline.out(piece.from))
        }
        if track.segments.isEmpty { composition.removeTrack(track) }
        return nil
    }
    let hushed = !spans(muted).isEmpty
    guard hushed || levels.contains(where: \.changesAnything) else { return try await master() }
    let stems: [(stream: Int, track: AVAssetTrack)] = audio.count > 1
        ? audio.indices.dropFirst().map { ($0, audio[$0]) }
        : (spans(muted, stream: 0).isEmpty ? [] : [(0, audio[0])])
    let mixing = AVMutableComposition()
    var parameters: [AVMutableAudioMixInputParameters] = []
    for (stream, source) in stems {
        let level = levels.first { $0.stream == stream }
        let gain = level?.gain ?? 1
        guard gain > 0, let track = mixing.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
        let offset = level?.offset ?? 0
        let from = max(level?.from ?? timeline.start, timeline.start), to = min(level?.to ?? timeline.end, timeline.end)
        for piece in timeline.kept(from, max(from, to)) {
            try await place(source, into: track, from: piece.from - offset, to: piece.to - offset, at: timeline.out(piece.from))
        }
        guard !track.segments.isEmpty else { mixing.removeTrack(track); continue }
        let input = AVMutableAudioMixInputParameters(track: track)
        let hushes = merged(spans(muted, stream: stream).map { Span(from: timeline.out($0.from), to: timeline.out($0.to)) })
        hush(input, gain: gain, spans: hushes, until: track.timeRange.end.seconds)
        parameters.append(input)
    }
    guard !parameters.isEmpty else { return try await master() }
    let mix = AVMutableAudioMix(); mix.inputParameters = parameters
    let url = temp.appendingPathComponent("mix.m4a")
    try await export(mixing, to: url, preset: AVAssetExportPresetAppleM4A, mix: mix)
    let mixed = AVURLAsset(url: url)
    guard let track = try await mixed.loadTracks(withMediaType: .audio).first,
          let target = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw failure("The rebuilt mix has no audio.") }
    let range = try await track.load(.timeRange)
    try target.insertTimeRange(range, of: track, at: range.start)
    return mixed
}

@available(macOS 15.0, *)
func exportGif(_ message: [String: Any]) async throws {
    guard let source = message["source"] as? String, let path = message["destination"] as? String else {
        throw failure("The GIF source or destination is missing.")
    }
    let asset = AVURLAsset(url: URL(fileURLWithPath: source))
    let duration = try await asset.load(.duration).seconds
    guard duration.isFinite, duration > 0, let video = try await asset.loadTracks(withMediaType: .video).first else {
        throw failure("The clip has no readable video.")
    }
    let delay = 8, interval = Double(delay) / 100, budget = 1000 / delay
    let needed = max(1, Int((duration / interval).rounded(.up)))
    let count = min(needed, budget)
    let bounds = CGRect(origin: .zero, size: try await video.load(.naturalSize)).applying(try await video.load(.preferredTransform))
    let sourceWidth = max(1, Int(bounds.width)), sourceHeight = max(1, Int(bounds.height))
    let width = min(400, sourceWidth), height = sourceWidth <= 400 ? sourceHeight : max(1, sourceHeight * 400 / sourceWidth)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: width, height: height)
    generator.requestedTimeToleranceBefore = seconds(interval / 2)
    generator.requestedTimeToleranceAfter = seconds(interval / 2)
    let destination = URL(fileURLWithPath: path)
    let part = destination.appendingPathExtension("part")
    try? FileManager.default.removeItem(at: part)
    guard let gif = CGImageDestinationCreateWithURL(part as CFURL, UTType.gif.identifier as CFString, count, nil) else {
        throw failure("Could not create the GIF.")
    }
    CGImageDestinationSetProperties(gif, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
    let frame = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: interval, kCGImagePropertyGIFUnclampedDelayTime: interval]] as CFDictionary
    let times = (0..<count).map { CMTime(seconds: min(Double($0) * interval, duration - 0.001), preferredTimescale: 600) }
    var written = 0
    for await result in generator.images(for: times) {
        guard let image = try? result.image else { continue }
        CGImageDestinationAddImage(gif, image, frame)
        written += 1
        emit("export_progress", ["source": source, "done": written, "total": count])
    }
    guard written > 0 else { throw failure("The clip produced no frames to turn into a GIF.") }
    guard CGImageDestinationFinalize(gif) else { try? FileManager.default.removeItem(at: part); throw failure("Could not finish the GIF.") }
    try? FileManager.default.removeItem(at: destination)
    try FileManager.default.moveItem(at: part, to: destination)
    emit("gif_exported", ["path": path, "source": source, "width": width, "height": height, "frames": written,
                          "durationSeconds": Double(written) * interval, "sizeBytes": fileSize(destination), "truncated": needed > budget])
}
