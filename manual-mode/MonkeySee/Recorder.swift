import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

enum RecorderError: LocalizedError {
    case offScreen
    case noDisplay
    case notStarted
    case tooShort
    case writer(String)

    var errorDescription: String? {
        switch self {
        case .offScreen: return "Move the frame so it sits fully on one screen."
        case .noDisplay: return "Couldn't find the screen the frame is on."
        case .notStarted: return "The recording never started."
        case .tooShort: return "Nothing was captured; the recording was too short."
        case .writer(let message): return message
        }
    }
}

/// Records one screen area to an H.264 mp4 at the screen's pixel scale.
///
/// ScreenCaptureKit only delivers a frame when the screen changes, so the
/// newest frame is kept and written on a 30 fps clock. That gives a
/// constant 30 fps file, like the clips agent-mode makes, and the stream
/// can start during the countdown without its start-up delay showing.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let fps: Int32 = 30

    /// Called on the main queue if macOS stops the capture (for example
    /// from the screen-sharing menu in the menu bar).
    var onStop: ((Error) -> Void)?

    private let queue = DispatchQueue(label: "com.natelaffan.monkeysee.capture")
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var outputURL: URL?

    // Touched only on `queue`.
    private var latest: CVPixelBuffer?
    private var startHostTime: CMTime?
    private var frameIndex: Int64 = 0
    private var framesAppended = 0
    private var timer: DispatchSourceTimer?
    private var failure: Error?

    /// Sets up the file and starts the stream. `rect` is in AppKit screen
    /// coordinates. Frames are kept but not written until `begin()`.
    /// `completion` runs on the main queue.
    func prepare(rect: NSRect, completion: @escaping (Error?) -> Void) {
        guard let screen = Geometry.screen(containing: rect), let displayID = screen.displayID else {
            completion(RecorderError.offScreen)
            return
        }
        let scale = screen.backingScaleFactor
        let sourceRect = Geometry.local(rect, in: screen)
        let pixelWidth = Self.even(rect.width * scale)
        let pixelHeight = Self.even(rect.height * scale)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("monkeysee-\(UUID().uuidString).mp4")

        do {
            try makeWriter(url: url, width: pixelWidth, height: pixelHeight)
        } catch {
            completion(error)
            return
        }

        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [weak self] content, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    completion(error)
                    return
                }
                guard let content,
                      let display = content.displays.first(where: { $0.displayID == displayID }) else {
                    completion(RecorderError.noDisplay)
                    return
                }
                // Leave monkeysee's own windows (frame, sidebar, countdown) out of the clip.
                let me = ProcessInfo.processInfo.processIdentifier
                let mine = content.applications.filter { $0.processID == me }
                let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])

                let config = SCStreamConfiguration()
                config.sourceRect = sourceRect
                config.width = pixelWidth
                config.height = pixelHeight
                config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.colorSpaceName = CGColorSpace.sRGB
                config.showsCursor = true
                config.queueDepth = 6
                config.capturesAudio = false

                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                do {
                    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
                } catch {
                    completion(error)
                    return
                }
                self.stream = stream
                stream.startCapture { error in
                    DispatchQueue.main.async { completion(error) }
                }
            }
        }
    }

    /// Starts writing frames. Call once the countdown has finished.
    func begin() {
        queue.async {
            guard let writer = self.writer, writer.status == .unknown else { return }
            guard writer.startWriting() else {
                self.failure = writer.error
                return
            }
            writer.startSession(atSourceTime: .zero)
            self.startHostTime = CMClockGetTime(CMClockGetHostTimeClock())
            self.frameIndex = 0
            self.framesAppended = 0
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: .milliseconds(10))
            timer.setEventHandler { [weak self] in self?.writeDueFrames(until: nil) }
            self.timer = timer
            timer.resume()
        }
    }

    /// Stops the stream and finishes the file. `completion` runs on the main queue.
    func finish(completion: @escaping (Result<URL, Error>) -> Void) {
        let end = CMClockGetTime(CMClockGetHostTimeClock())
        stream?.stopCapture { _ in }
        stream = nil
        queue.async {
            self.timer?.cancel()
            self.timer = nil
            self.writeDueFrames(until: end)
            self.latest = nil

            guard let writer = self.writer, let url = self.outputURL, writer.status == .writing else {
                let error = self.failure ?? self.writer?.error ?? RecorderError.notStarted
                DispatchQueue.main.async { completion(.failure(error)) }
                return
            }
            guard self.framesAppended > 0 else {
                writer.cancelWriting()
                try? FileManager.default.removeItem(at: url)
                DispatchQueue.main.async { completion(.failure(RecorderError.tooShort)) }
                return
            }
            self.input?.markAsFinished()
            writer.endSession(atSourceTime: CMTime(value: self.frameIndex, timescale: self.fps))
            writer.finishWriting {
                let result: Result<URL, Error>
                if writer.status == .completed {
                    result = .success(url)
                } else {
                    result = .failure(writer.error ?? RecorderError.writer("The video file couldn't be finished."))
                }
                DispatchQueue.main.async { completion(result) }
            }
        }
    }

    /// Stops everything and deletes the file (used when a countdown is cancelled).
    func cancel() {
        stream?.stopCapture { _ in }
        stream = nil
        queue.async {
            self.timer?.cancel()
            self.timer = nil
            self.latest = nil
            if self.writer?.status == .writing { self.writer?.cancelWriting() }
            if let url = self.outputURL { try? FileManager.default.removeItem(at: url) }
        }
    }

    // MARK: Writing

    private func makeWriter(url: URL, width: Int, height: Int) throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 12_000_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: Int(fps),
                AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
            ] as [String: Any],
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw RecorderError.writer("The video writer refused its input.")
        }
        writer.add(input)
        self.adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
        self.writer = writer
        self.input = input
        self.outputURL = url
    }

    /// Writes the newest frame for every 1/30 s tick that has passed.
    private func writeDueFrames(until end: CMTime?) {
        guard let start = startHostTime, let adaptor, let pixels = latest else { return }
        let now = end ?? CMClockGetTime(CMClockGetHostTimeClock())
        let elapsed = CMTimeGetSeconds(CMTimeSubtract(now, start))
        guard elapsed.isFinite, elapsed >= 0 else { return }
        let due = Int64(elapsed * Double(fps)) + 1
        while frameIndex < due {
            if adaptor.assetWriterInput.isReadyForMoreMediaData {
                let time = CMTime(value: frameIndex, timescale: fps)
                if adaptor.append(pixels, withPresentationTime: time) {
                    framesAppended += 1
                } else {
                    failure = writer?.error
                }
            }
            frameIndex += 1
        }
    }

    private static func even(_ value: CGFloat) -> Int {
        let n = Int(value.rounded())
        return n - n % 2
    }

    // MARK: SCStreamOutput, SCStreamDelegate

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let info = attachments.first,
              let rawStatus = info[.status] as? Int,
              let status = SCFrameStatus(rawValue: rawStatus),
              status == .complete,
              let pixels = sampleBuffer.imageBuffer else { return }
        latest = pixels
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { self.onStop?(error) }
    }
}
