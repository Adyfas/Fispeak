// fispeak system audio helper (05-audio-capture §2.2).
//
// Captures the audio that the Mac is playing and writes it to stdout in framed binary:
//
//   "FSPK" | uint32 little endian length | payload
//
// The first payload is a JSON frame (`info`) describing the PCM layout; every following frame
// carries interleaved Float32 PCM. JSON control frames always start with '{', so the reader can
// tell them apart from PCM (a Float32 sample starting with 0x7b would be ~3.5e36, never real).
//
// Two capture sources:
//   tap  - Core Audio process tap (macOS 14.2+). Captures the system mix of every process,
//          independent of displays/windows, and needs no Screen Recording permission.
//   sck  - ScreenCaptureKit (macOS 13+). Kept as a fallback; needs Screen Recording and only
//          delivers audio for the captured display.
//
// Usage:
//   fispeak-audio-helper [--check] [--source tap|sck|auto] [--probe] [--wav <path>]
//
//   swift build.sh -> resources/bin/darwin-<arch>/fispeak-audio-helper

import AVFoundation
import AudioToolbox
import CoreAudio
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

// MARK: - arguments

func argumentValue(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

let probe = CommandLine.arguments.contains("--probe")
let requestedSource = argumentValue("--source")
    ?? ProcessInfo.processInfo.environment["FISPEAK_AUDIO_SOURCE"]
    ?? "auto"
let wavPath = argumentValue("--wav") ?? ProcessInfo.processInfo.environment["FISPEAK_AUDIO_WAV"]

// MARK: - output

var infoSent = false
var pcmBufferCount = 0
var pcmByteCount = 0
var lastStatsAt = Date()
var wavHandle: FileHandle?
var wavBytes = 0
var readySampleRate = 48_000
var readyChannels = 2
let stdoutHandle = FileHandle.standardOutput

func logLine(_ message: String) {
    FileHandle.standardError.write(Data(("[fispeak-audio-helper] " + message + "\n").utf8))
}

func writeFrame(_ payload: Data) {
    var header = Data("FSPK".utf8)
    var length = UInt32(payload.count).littleEndian
    withUnsafeBytes(of: &length) { header.append(contentsOf: $0) }
    stdoutHandle.write(header)
    stdoutHandle.write(payload)
}

func writeJSON(_ object: [String: Any]) {
    // Sorted keys keep the output deterministic (handy when diffing logs).
    let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    writeFrame(data ?? Data("{}".utf8))
}

func emitInfo(sampleRate: Double, channels: Int, interleaved: Bool) {
    guard !infoSent else { return }
    infoSent = true
    readySampleRate = Int(sampleRate.rounded())
    readyChannels = channels
    writeJSON([
        "type": "info",
        "sampleRate": Int(sampleRate.rounded()),
        "channels": channels,
        "format": "f32le",
        "interleaved": interleaved
    ])
}

func emitPcm(_ data: Data) {
    guard !data.isEmpty else { return }
    pcmBufferCount += 1
    pcmByteCount += data.count
    writeFrame(data)

    if let handle = wavHandle {
        handle.write(data)
        wavBytes += data.count
    }

    if probe, Date().timeIntervalSince(lastStatsAt) >= 2 {
        lastStatsAt = Date()
        logLine("buffers=\(pcmBufferCount) bytes=\(pcmByteCount)")
    }
}

// MARK: - WAV dump (diagnostics only; never plays audio)

func openWavDump(path: String, sampleRate: Double, channels: Int) {
    FileManager.default.createFile(atPath: path, contents: nil)
    guard let handle = FileHandle(forWritingAtPath: path) else {
        logLine("cannot open wav dump at \(path)")
        return
    }
    wavHandle = handle
    // Placeholder header, rewritten by finalizeWav().
    handle.write(Data(count: 44))
}

func finalizeWav() {
    guard let handle = wavHandle else { return }
    wavHandle = nil
    let channels = 2
    let rate = 48_000
    let byteRate = rate * channels * 4
    let blockAlign = channels * 4
    var header = Data()
    header.append(Data("RIFF".utf8))
    var chunkSize = UInt32(36 + wavBytes).littleEndian
    withUnsafeBytes(of: &chunkSize) { header.append(contentsOf: $0) }
    header.append(Data("WAVE".utf8))
    header.append(Data("fmt ".utf8))
    var fmtSize = UInt32(16).littleEndian
    withUnsafeBytes(of: &fmtSize) { header.append(contentsOf: $0) }
    var format = UInt16(3).littleEndian  // WAVE_FORMAT_IEEE_FLOAT
    withUnsafeBytes(of: &format) { header.append(contentsOf: $0) }
    var channelCount = UInt16(channels).littleEndian
    withUnsafeBytes(of: &channelCount) { header.append(contentsOf: $0) }
    var sampleRate = UInt32(rate).littleEndian
    withUnsafeBytes(of: &sampleRate) { header.append(contentsOf: $0) }
    var bytesPerSecond = UInt32(byteRate).littleEndian
    withUnsafeBytes(of: &bytesPerSecond) { header.append(contentsOf: $0) }
    var align = UInt16(blockAlign).littleEndian
    withUnsafeBytes(of: &align) { header.append(contentsOf: $0) }
    var bits = UInt16(32).littleEndian
    withUnsafeBytes(of: &bits) { header.append(contentsOf: $0) }
    header.append(Data("data".utf8))
    var dataSize = UInt32(wavBytes).littleEndian
    withUnsafeBytes(of: &dataSize) { header.append(contentsOf: $0) }

    try? handle.seek(toOffset: 0)
    try? handle.write(contentsOf: header)
    try? handle.close()
    logLine("wav dump closed: \(wavBytes) bytes")
}

// MARK: - permission / availability

func screenRecordingGranted() -> Bool {
    CGPreflightScreenCaptureAccess()
}

func tapAvailable() -> Bool {
    if #available(macOS 14.2, *) { return true }
    return false
}

if CommandLine.arguments.contains("--check") {
    // A tap needs no permission at all; only the ScreenCaptureKit fallback needs Screen Recording.
    let tap = tapAvailable()
    let status: [String: Any] = [
        "type": "status",
        "granted": tap ? true : screenRecordingGranted(),
        "supported": true,
        "source": tap ? "tap" : "sck"
    ]
    let data = try? JSONSerialization.data(withJSONObject: status)
    FileHandle.standardOutput.write(data ?? Data("{}".utf8))
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

// MARK: - capture sources

protocol CaptureSource: AnyObject {
    func stop()
}

// MARK: - Core Audio process tap (macOS 14.2+)

enum HelperError: Error {
    case osStatus(String, OSStatus)
    case message(String)
}

func check(_ status: OSStatus, _ what: String) throws {
    if status != noErr { throw HelperError.osStatus(what, status) }
}

@available(macOS 14.2, *)
final class TapSource: CaptureSource {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private let queue = DispatchQueue(label: "fispeak.tap.io")
    private var channels = 2
    private var sampleRate = 48_000.0

    func start() throws {
        // 1. One tap that mixes every process except the ones listed (none).
        let description = CATapDescription(__stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.name = "fispeak system audio"
        description.muteBehavior = .unmuted
        description.isPrivate = true

        var tap = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateProcessTap(description, &tap), "AudioHardwareCreateProcessTap")
        tapID = tap

        // 2. Ask the tap for its stream format (float32, usually 48 kHz stereo).
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let formatStatus = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd)
        if formatStatus == noErr, asbd.mSampleRate > 0 {
            sampleRate = asbd.mSampleRate
            if asbd.mChannelsPerFrame > 0 { channels = Int(asbd.mChannelsPerFrame) }
            logLine("tap format: \(Int(sampleRate)) Hz \(channels) ch flags=0x\(String(asbd.mFormatFlags, radix: 16))")
        } else {
            logLine("tap format unavailable (status \(formatStatus)), assuming 48 kHz stereo")
        }

        // 3. Read the tap through a private aggregate device (the documented way).
        let subTap: [String: Any] = [
            kAudioSubTapUIDKey: description.uuid.uuidString,
            kAudioSubTapDriftCompensationKey: false
        ]
        let composition: [String: Any] = [
            kAudioAggregateDeviceNameKey: "fispeak system audio",
            kAudioAggregateDeviceUIDKey: "fispeak-tap-\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapListKey: [subTap]
        ]
        var aggregate = AudioObjectID(kAudioObjectUnknown)
        try check(
            AudioHardwareCreateAggregateDevice(composition as CFDictionary, &aggregate),
            "AudioHardwareCreateAggregateDevice"
        )
        aggregateID = aggregate

        // 4. Pull the audio with an IOProc on the aggregate device.
        var proc: AudioDeviceIOProcID?
        let createStatus = AudioDeviceCreateIOProcIDWithBlock(
            &proc,
            aggregateID,
            queue
        ) { [weak self] _, inputData, _, _, _ in
            self?.handle(inputData)
        }
        try check(createStatus, "AudioDeviceCreateIOProcIDWithBlock")
        ioProcID = proc

        if let proc = proc {
            try check(AudioDeviceStart(aggregateID, proc), "AudioDeviceStart")
        }

        // 5. Prove the device is actually running.
        var running: UInt32 = 0
        var runAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsRunning,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var runSize = UInt32(MemoryLayout<UInt32>.size)
        AudioObjectGetPropertyData(aggregateID, &runAddress, 0, nil, &runSize, &running)
        logLine("aggregate device \(aggregateID) running=\(running)")
        emitInfo(sampleRate: sampleRate, channels: channels, interleaved: true)
        if let path = wavPath {
            openWavDump(path: path, sampleRate: sampleRate, channels: channels)
        }
    }

    /// Interleave whatever layout the device delivers into stereo Float32.
    private func handle(_ inputData: UnsafePointer<AudioBufferList>) {
        let list = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: inputData)
        )
        guard list.count > 0 else { return }

        if list.count == 1 {
            // Already interleaved: forward the bytes untouched.
            guard let only = list[0].mData else { return }
            let byteCount = Int(list[0].mDataByteSize)
            guard byteCount > 0 else { return }
            emitPcm(Data(bytes: only, count: byteCount))
            return
        }

        // One buffer per channel (the usual Core Audio layout): interleave them.
        var frames = Int.max
        for buffer in list {
            guard buffer.mData != nil, buffer.mDataByteSize > 0 else { return }
            frames = min(frames, Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size)
        }
        guard frames != Int.max, frames > 0 else { return }

        let channelCount = list.count
        var interleaved = [Float32](repeating: 0, count: frames * channelCount)
        for (channel, buffer) in list.enumerated() {
            guard let raw = buffer.mData else { continue }
            let samples = raw.assumingMemoryBound(to: Float32.self)
            for frame in 0..<frames {
                interleaved[frame * channelCount + channel] = samples[frame]
            }
        }
        channels = channelCount
        emitPcm(interleaved.withUnsafeBufferPointer { Data(buffer: $0) })
    }

    func stop() {
        if let proc = ioProcID {
            AudioDeviceStop(aggregateID, proc)
            AudioDeviceDestroyIOProcID(aggregateID, proc)
        }
        ioProcID = nil
        if #available(macOS 14.2, *), tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
    }
}

// MARK: - ScreenCaptureKit fallback (macOS 13+)

final class SckSource: NSObject, SCStreamOutput, SCStreamDelegate, CaptureSource {
    private var stream: SCStream?
    private var channels = 2
    private var sampleRate = 48_000.0

    /// ScreenCaptureKit filters audio per display, so a meeting that runs on a second monitor
    /// would be silent. Pick the display that hosts the frontmost window and fall back to the
    /// largest one. `FISPEAK_CAPTURE_DISPLAY=main` forces the main display instead.
    func pickDisplay(_ content: SCShareableContent) -> SCDisplay? {
        let displays = content.displays
        guard !displays.isEmpty else { return nil }

        if ProcessInfo.processInfo.environment["FISPEAK_CAPTURE_DISPLAY"] == "main" {
            return displays.first
        }

        for window in content.windows where window.frame.width > 1 && window.frame.height > 1 {
            let center = CGPoint(x: window.frame.midX, y: window.frame.midY)
            if let match = displays.first(where: { $0.frame.contains(center) }) {
                return match
            }
        }

        return displays.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    }

    func start() throws {
        let semaphore = DispatchSemaphore(value: 0)
        var failure: Error?

        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true
                )
                guard let display = self.pickDisplay(content) else {
                    throw HelperError.message("no display found")
                }

                let filter = SCContentFilter(
                    display: display,
                    excludingApplications: [],
                    exceptingWindows: []
                )
                let configuration = SCStreamConfiguration()
                configuration.capturesAudio = true
                configuration.excludesCurrentProcessAudio = true
                configuration.sampleRate = 48_000
                configuration.channelCount = 2
                // ScreenCaptureKit always produces video; keep it as small as possible.
                configuration.width = 2
                configuration.height = 2
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                configuration.showsCursor = false

                let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
                try stream.addStreamOutput(
                    self,
                    type: .audio,
                    sampleHandlerQueue: DispatchQueue(label: "fispeak.sck.audio")
                )
                try await stream.startCapture()
                self.stream = stream
                logLine("sck stream started on display \(display.displayID)")
                if let path = wavPath {
                    openWavDump(path: path, sampleRate: 48_000, channels: 2)
                }
            } catch {
                failure = error
            }
            semaphore.signal()
        }

        semaphore.wait()
        if let failure = failure { throw failure }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid else { return }
        guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format),
              let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            return
        }

        var lengthAtOffset = 0
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer,
            atOffset: 0,
            lengthAtOffsetOut: &lengthAtOffset,
            totalLengthOut: &totalLength,
            dataPointerOut: &dataPointer
        )
        guard status == kCMBlockBufferNoErr, let pointer = dataPointer, lengthAtOffset > 0 else {
            return
        }
        channels = max(Int(asbd.pointee.mChannelsPerFrame), 1)
        sampleRate = asbd.pointee.mSampleRate
        let interleaved = asbd.pointee.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        emitInfo(sampleRate: sampleRate, channels: channels, interleaved: interleaved)
        emitPcm(Data(bytes: UnsafeRawPointer(pointer), count: lengthAtOffset))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        writeJSON([
            "type": "error",
            "code": "stream_failed",
            "message": error.localizedDescription
        ])
        exit(4)
    }

    func stop() {
        if let stream = stream {
            Task { try? await stream.stopCapture() }
        }
        stream = nil
    }
}

// MARK: - main

var activeSource: (any CaptureSource)?

func startCapture() throws -> String {
    let allowTap = requestedSource == "auto" || requestedSource == "tap"
    let allowSck = requestedSource == "auto" || requestedSource == "sck"

    if allowTap, #available(macOS 14.2, *) {
        let tap = TapSource()
        do {
            try tap.start()
            activeSource = tap
            return "tap"
        } catch {
            logLine("tap capture failed: \(error); falling back to ScreenCaptureKit")
            tap.stop()
            if requestedSource == "tap" { throw error }
        }
    }

    guard allowSck else {
        throw HelperError.message("no capture source available (requested \(requestedSource))")
    }

    if !screenRecordingGranted() {
        _ = CGRequestScreenCaptureAccess()
        throw HelperError.message("Screen Recording permission is required for ScreenCaptureKit")
    }

    let sck = SckSource()
    try sck.start()
    activeSource = sck
    return "sck"
}

// Finalise the WAV and exit cleanly when Electron stops us with SIGTERM.
let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signalSource.setEventHandler {
    activeSource?.stop()
    finalizeWav()
    logLine("stopped: buffers=\(pcmBufferCount) bytes=\(pcmByteCount)")
    exit(0)
}
signalSource.resume()
signal(SIGTERM, SIG_IGN)

let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
interruptSource.setEventHandler {
    finalizeWav()
    exit(0)
}
interruptSource.resume()
signal(SIGINT, SIG_IGN)

var source = "unknown"
do {
    source = try startCapture()
} catch {
    let message = (error as? HelperError).map { value -> String in
        switch value {
        case let .osStatus(what, status):
            return "\(what) failed with OSStatus \(status)"
        case let .message(text):
            return text
        }
    } ?? error.localizedDescription
    writeJSON(["type": "error", "code": "start_failed", "message": message])
    exit(6)
}

writeJSON([
    "type": "ready",
    "source": source,
    "sampleRate": readySampleRate,
    "channels": readyChannels,
    "pid": ProcessInfo.processInfo.processIdentifier
])
logLine("ready (source=\(source) rate=\(readySampleRate) channels=\(readyChannels))")

dispatchMain()
