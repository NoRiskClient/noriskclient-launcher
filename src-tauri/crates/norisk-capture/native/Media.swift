import AVFoundation

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
            if let source = progress { emit("export_progress", ["source": source, "done": Int(session.progress * 1000), "total": 1000]) }
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
    }
    await session.export(); poll.cancel()
    guard session.status == .completed else { try? FileManager.default.removeItem(at: url); throw session.error ?? failure("The export did not finish.") }
    if let source = progress { emit("export_progress", ["source": source, "done": 1000, "total": 1000]) }
}

func addTrack(_ track: AVAssetTrack, to composition: AVMutableComposition, range: CMTimeRange) throws -> AVMutableCompositionTrack {
    guard let result = composition.addMutableTrack(withMediaType: track.mediaType, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw failure("Could not create a media track.") }
    let intersection = CMTimeRangeGetIntersection(range, otherRange: track.timeRange)
    if intersection.duration > .zero {
        do { try result.insertTimeRange(intersection, of: track, at: intersection.start - range.start) }
        catch { throw failure("Could not insert a clip track: \(error.localizedDescription)") }
    }
    result.preferredTransform = track.preferredTransform
    return result
}

func makeMix(_ tracks: [AVAssetTrack], range: CMTimeRange, gains: [Float], to url: URL) async throws {
    let composition = AVMutableComposition()
    let mix = AVMutableAudioMix()
    mix.inputParameters = try tracks.enumerated().map { index, track in
        let copy = try addTrack(track, to: composition, range: range)
        let parameters = AVMutableAudioMixInputParameters(track: copy)
        parameters.setVolume(gains[index], at: .zero)
        return parameters
    }
    try await export(composition, to: url, preset: AVAssetExportPresetAppleM4A, mix: mix)
}

func temporaryDirectory() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nrc-clip-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

func saveMedia(_ samples: Samples, config: Settings, width: Int, height: Int, reason: [String: Any]) async throws {
    let temp = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: temp) }
    let raw = temp.appendingPathComponent("capture.mov")
    let labels = try await writeSamples(samples, to: raw)
    let asset = AVURLAsset(url: raw)
    defer { withExtendedLifetime(asset) {} }
    let fullRange = CMTimeRange(start: .zero, duration: asset.duration)
    let range = CMTimeRange(start: seconds(samples.playbackOffset), end: asset.duration)
    let composition = AVMutableComposition()
    for track in asset.tracks(withMediaType: .video) { _ = try addTrack(track, to: composition, range: range) }
    var audio = asset.tracks(withMediaType: .audio)
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
            guard let track = adjustedAsset.tracks(withMediaType: .audio).first else { throw failure("An audio stem could not be adjusted.") }
            audio[index] = track
        }
        let mixed = temp.appendingPathComponent("mix.m4a")
        try await makeMix(audio, range: fullRange, gains: audio.map { _ in Float(1) }, to: mixed)
        let mixedAsset = AVURLAsset(url: mixed)
        defer { withExtendedLifetime(mixedAsset) {} }
        for track in mixedAsset.tracks(withMediaType: .audio) { _ = try addTrack(track, to: composition, range: range) }
        for track in audio {
            let stem = try addTrack(track, to: composition, range: range)
            stem.isEnabled = false
        }
    }
    let dir = URL(fileURLWithPath: config.output_dir, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let stamp = String(Int(Date().timeIntervalSince1970))
    let slug = (reason["value"] as? String ?? "clip").map { $0.isASCII && $0.isLetter || $0.isNumber ? String($0).lowercased() : "_" }.joined()
    let destination = dir.appendingPathComponent("\(stamp)_\(slug)-\(UUID().uuidString.prefix(8)).mp4")
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
                peak = max(peak, abs(value)); count += 1
                if count == 1920 { peaks.append(UInt8(min(255, peak * 255))); peak = 0; count = 0 }
            }
        }
    }
    if count > 0 { peaks.append(UInt8(min(255, peak * 255))) }
    return peaks
}

func editMedia(_ message: [String: Any]) async throws {
    guard let source = message["source"] as? String else { throw failure("The clip source is missing.") }
    let asset = AVURLAsset(url: URL(fileURLWithPath: source))
    defer { withExtendedLifetime(asset) {} }
    let audio = asset.tracks(withMediaType: .audio)
    let duration = asset.duration.seconds
    guard duration.isFinite, duration > 0 else { throw failure("The clip has no readable duration.") }
    if message["type"] as? String == "prepare_audio_preview" {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nrc-clip-preview")
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var tracks: [[String: Any]] = []
        for (index, track) in audio.enumerated() {
            let composition = AVMutableComposition()
            _ = try addTrack(track, to: composition, range: CMTimeRange(start: .zero, duration: asset.duration))
            let destination = dir.appendingPathComponent("\(UUID().uuidString)-\(index).m4a")
            try await export(composition, to: destination, preset: AVAssetExportPresetAppleM4A)
            tracks.append(["stream": index, "label": trackName(track, index: index), "path": destination.path])
        }
        emit("audio_preview_ready", ["source": source, "tracks": tracks]); return
    }
    guard let path = message["destination"] as? String else { throw failure("The export destination is missing.") }
    let destination = URL(fileURLWithPath: path)
    let vertical = message["type"] as? String == "export_vertical"
    let start = vertical ? 0 : (message["start_seconds"] as? NSNumber)?.doubleValue ?? 0
    let end = vertical ? duration : min(duration, (message["end_seconds"] as? NSNumber)?.doubleValue ?? duration)
    guard start.isFinite, end.isFinite, start >= 0, end > start else { throw failure("The trim range is outside the clip.") }
    let range = CMTimeRange(start: seconds(start), end: seconds(end))
    let composition = AVMutableComposition()
    guard let sourceVideo = asset.tracks(withMediaType: .video).first else { throw failure("The clip has no video track.") }
    let video = try addTrack(sourceVideo, to: composition, range: range)
    let temp = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: temp) }
    let levels = message["levels"] as? [[String: Int]] ?? []
    let changed = levels.contains { $0["volume"] != 100 }
    if changed && !audio.isEmpty {
        let stems = audio.count > 1 ? Array(audio.dropFirst()) : audio
        let offset = audio.count > 1 ? 1 : 0
        let gains = stems.indices.map { index -> Float in
            Float(min(200, max(0, levels.first { $0["stream"] == index + offset }?["volume"] ?? 100))) / 100
        }
        let mixed = temp.appendingPathComponent("mix.m4a")
        try await makeMix(stems, range: range, gains: gains, to: mixed)
        let mixedAsset = AVURLAsset(url: mixed)
        defer { withExtendedLifetime(mixedAsset) {} }
        for track in mixedAsset.tracks(withMediaType: .audio) {
            _ = try addTrack(track, to: composition, range: CMTimeRange(start: .zero, duration: range.duration))
        }
    } else if let master = audio.first { _ = try addTrack(master, to: composition, range: range) }
    var videoComposition: AVMutableVideoComposition?
    var width = Int(sourceVideo.naturalSize.width), height = Int(sourceVideo.naturalSize.height)
    if vertical {
        width = min(width, height * 9 / 16) / 2 * 2; height = min(height, width * 16 / 9) / 2 * 2
        let vc = AVMutableVideoComposition()
        vc.renderSize = CGSize(width: width, height: height)
        vc.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, sourceVideo.nominalFrameRate)))
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
        layer.setTransform(CGAffineTransform(translationX: -(sourceVideo.naturalSize.width - CGFloat(width)) / 2,
            y: -(sourceVideo.naturalSize.height - CGFloat(height)) / 2), at: .zero)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: range.duration); instruction.layerInstructions = [layer]
        vc.instructions = [instruction]; videoComposition = vc
    }
    try await export(composition, to: destination, preset: vertical ? AVAssetExportPresetHighestQuality : AVAssetExportPresetPassthrough,
        video: videoComposition, progress: vertical ? source : nil)
    var result: [String: Any] = ["path": path, "source": source, "duration_seconds": range.duration.seconds, "size_bytes": fileSize(destination)]
    if vertical { result["width"] = width; result["height"] = height } else { result["start_seconds"] = start; result["end_seconds"] = end }
    emit(vertical ? "clip_exported" : "clip_trimmed", result)
}
