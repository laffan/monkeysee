import AppKit
import AVFoundation
import AVKit

/// Shows a finished recording with AVKit's trim bar. Trim saves the
/// trimmed clip; Cancel leaves the whole clip, which Save keeps as is.
/// An existing clip of the same name is moved to the Trash first.
final class TrimWindowController: NSWindowController, NSWindowDelegate {
    /// The saved file, or nil when the clip was discarded.
    var onFinish: ((URL?) -> Void)?

    private let sourceURL: URL
    private let destination: URL
    private let player: AVPlayer
    private let playerView = AVPlayerView()
    private let infoLabel = NSTextField(labelWithString: "")
    private var trimButton: NSButton?
    private var saveButton: NSButton?
    private var discardButton: NSButton?
    private var statusObservation: NSKeyValueObservation?
    private var autoTrimTries = 0
    private var finished = false

    init(sourceURL: URL, destination: URL, featureName: String) {
        self.sourceURL = sourceURL
        self.destination = destination
        self.player = AVPlayer(url: sourceURL)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 680),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered,
                              defer: false)
        window.title = "Trim “\(featureName)”"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 560, height: 420)
        // The frame and sidebar float; keep the trim window above them.
        window.level = .floating
        super.init(window: window)
        window.delegate = self
        buildContent()
        window.center()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    func present() {
        showWindow(nil)
        NSApp.activate()
        window?.makeKeyAndOrderFront(nil)
        statusObservation = player.currentItem?.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard item.status == .readyToPlay else { return }
            DispatchQueue.main.async { self?.autoTrim() }
        }
    }

    private func buildContent() {
        guard let content = window?.contentView else { return }
        playerView.player = player
        playerView.controlsStyle = .inline
        playerView.showsFullScreenToggleButton = false
        playerView.translatesAutoresizingMaskIntoConstraints = false

        let trim = NSButton(title: "Trim…", target: self, action: #selector(trimClicked))
        let save = NSButton(title: "Save", target: self, action: #selector(saveClicked))
        save.keyEquivalent = "\r"
        let discard = NSButton(title: "Discard", target: self, action: #selector(discardClicked))
        trimButton = trim
        saveButton = save
        discardButton = discard

        infoLabel.textColor = .secondaryLabelColor
        infoLabel.lineBreakMode = .byTruncatingMiddle
        infoLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        infoLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        showDestination()

        let bar = NSStackView(views: [infoLabel, discard, trim, save])
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 10, left: 14, bottom: 12, right: 14)
        bar.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(playerView)
        content.addSubview(bar)
        NSLayoutConstraint.activate([
            playerView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            playerView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            playerView.topAnchor.constraint(equalTo: content.topAnchor),
            playerView.bottomAnchor.constraint(equalTo: bar.topAnchor),
            bar.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
    }

    private func showDestination() {
        let path = (destination.path as NSString).abbreviatingWithTildeInPath
        infoLabel.stringValue = "Saves to \(path)"
    }

    private func setButtons(enabled: Bool) {
        trimButton?.isEnabled = enabled
        saveButton?.isEnabled = enabled
        discardButton?.isEnabled = enabled
    }

    // MARK: Trimming

    /// Opens the trim bar as soon as the player view can show it.
    private func autoTrim() {
        guard !finished, autoTrimTries >= 0 else { return }
        if playerView.canBeginTrimming {
            autoTrimTries = -1
            beginTrim()
        } else if autoTrimTries < 15 {
            autoTrimTries += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.autoTrim() }
        }
    }

    @objc private func trimClicked() {
        beginTrim()
    }

    private func beginTrim() {
        guard playerView.canBeginTrimming else {
            NSSound.beep()
            return
        }
        setButtons(enabled: false)
        playerView.beginTrimming { [weak self] result in
            guard let self else { return }
            self.setButtons(enabled: true)
            if result == .okButton { self.save() }
        }
    }

    // MARK: Saving

    @objc private func saveClicked() {
        save()
    }

    private func save() {
        guard !finished, let item = player.currentItem else { return }
        player.pause()
        let duration = item.duration
        var start = item.reversePlaybackEndTime
        if !start.isValid || !start.isNumeric || start < .zero { start = .zero }
        var end = item.forwardPlaybackEndTime
        if !end.isValid || !end.isNumeric || (duration.isNumeric && end > duration) { end = duration }
        let trimmed = start > .zero || (duration.isNumeric && end.isNumeric && end < duration)

        setButtons(enabled: false)
        guard trimmed else {
            infoLabel.stringValue = "Saving…"
            place(sourceURL)
            return
        }
        guard let export = AVAssetExportSession(asset: item.asset, presetName: AVAssetExportPresetHighestQuality) else {
            fail("The trimmed clip couldn't be exported.")
            return
        }
        infoLabel.stringValue = "Saving the trimmed clip…"
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("monkeysee-trim-\(UUID().uuidString).mp4")
        export.outputURL = temp
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.timeRange = CMTimeRange(start: start, end: end)
        export.exportAsynchronously { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                if export.status == .completed {
                    try? FileManager.default.removeItem(at: self.sourceURL)
                    self.place(temp)
                } else {
                    self.fail(export.error?.localizedDescription ?? "The trimmed clip couldn't be exported.")
                }
            }
        }
    }

    private func place(_ file: URL) {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fm.fileExists(atPath: destination.path) {
                try fm.trashItem(at: destination, resultingItemURL: nil)
            }
            try fm.moveItem(at: file, to: destination)
        } catch {
            fail(error.localizedDescription)
            return
        }
        finish(saved: destination)
    }

    private func fail(_ message: String) {
        infoLabel.stringValue = message
        setButtons(enabled: true)
        NSSound.beep()
    }

    @objc private func discardClicked() {
        try? FileManager.default.removeItem(at: sourceURL)
        finish(saved: nil)
    }

    private func finish(saved: URL?) {
        guard !finished else { return }
        finished = true
        statusObservation = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        window?.close()
        onFinish?(saved)
    }

    // MARK: NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if finished { return true }
        let alert = NSAlert()
        alert.messageText = "Save this clip?"
        alert.informativeText = "Closing without saving deletes the recording."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Discard")
        alert.addButton(withTitle: "Cancel")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            save()
            return false
        case .alertSecondButtonReturn:
            try? FileManager.default.removeItem(at: sourceURL)
            finished = true
            statusObservation = nil
            player.replaceCurrentItem(with: nil)
            onFinish?(nil)
            return true
        default:
            return false
        }
    }
}
