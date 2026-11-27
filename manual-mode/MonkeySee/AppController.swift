import AppKit
import SwiftUI

/// Wires the sidebar, frame, recorder, countdown, target mode and trim
/// window together. The sidebar calls these methods; state lives in `model`.
final class AppController {
    let model = AppModel()

    private let boundary = BoundaryController()
    private let targeter = WindowTargeter()
    private let keystrokes = KeystrokeOverlay()
    private var sidebarPanel: SidebarPanel?
    private var recorder: Recorder?
    private var countdown: Countdown?
    private var trimWindow: TrimWindowController?
    private var permissionTimer: Timer?

    /// The feature and project being recorded, kept in case either is renamed mid-take.
    private var recordingFeature: Feature?
    private var recordingProjectName = ""
    private var streamReady = false
    private var countdownDone = false
    /// The app last fitted with Target window; brought forward before recording.
    private var targetPID: pid_t?

    private static let askedScreenRecordingKey = "monkeysee.askedScreenRecording"

    func start() {
        let panel = SidebarPanel(contentRect: NSRect(x: 0, y: 0, width: boundary.sidebarWidth, height: 600),
                                 styleMask: [.borderless, .nonactivatingPanel],
                                 backing: .buffered,
                                 defer: false)
        configurePanel(panel, level: .floating)
        panel.hasShadow = true
        panel.becomesKeyOnlyIfNeeded = true

        let background = NSVisualEffectView()
        background.material = .sidebar
        background.blendingMode = .behindWindow
        background.state = .active
        background.wantsLayer = true
        background.layer?.cornerRadius = 10
        background.layer?.masksToBounds = true

        let hosting = FirstMouseHostingView(rootView: SidebarView(model: model, controller: self))
        hosting.sizingOptions = []
        hosting.translatesAutoresizingMaskIntoConstraints = false
        background.addSubview(hosting)
        NSLayoutConstraint.activate([
            hosting.leadingAnchor.constraint(equalTo: background.leadingAnchor),
            hosting.trailingAnchor.constraint(equalTo: background.trailingAnchor),
            hosting.topAnchor.constraint(equalTo: background.topAnchor),
            hosting.bottomAnchor.constraint(equalTo: background.bottomAnchor),
        ])
        panel.contentView = background
        sidebarPanel = panel

        boundary.sidebar = panel
        boundary.onChange = { [weak self] rect in
            self?.model.boundarySize = rect.size
        }
        showPanels()

        refreshPermissions()
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshPermissions()
        }
    }

    func showPanels() {
        boundary.show()
        sidebarPanel?.orderFrontRegardless()
    }

    func shutDown() {
        targeter.end()
        keystrokes.detach()
        countdown?.cancel()
        recorder?.cancel()
    }

    func quit() {
        NSApp.terminate(nil)
    }

    // MARK: Permissions

    func refreshPermissions() {
        let screen = Permissions.screenRecording
        let ax = Permissions.accessibility
        if model.screenRecordingAllowed != screen { model.screenRecordingAllowed = screen }
        if model.accessibilityAllowed != ax { model.accessibilityAllowed = ax }
    }

    func requestScreenRecording() {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: Self.askedScreenRecordingKey) {
            defaults.set(true, forKey: Self.askedScreenRecordingKey)
            Permissions.requestScreenRecording()   // the system prompt, shown once
        } else {
            Permissions.openSettings("Privacy_ScreenCapture")
        }
        refreshPermissions()
        if !model.screenRecordingAllowed {
            model.status = "Turn on monkeysee under Privacy & Security > Screen & System Audio Recording, then quit and reopen it."
        }
    }

    func requestAccessibility() {
        Permissions.requestAccessibility()
        refreshPermissions()
        if !model.accessibilityAllowed {
            model.status = "Turn on monkeysee under Privacy & Security > Accessibility, then click Target window again."
        }
    }

    // MARK: Frame size

    func setBoundarySize(width: Int?, height: Int?) {
        guard model.phase == .idle else { return }
        boundary.setSize(width: width.map { CGFloat($0) }, height: height.map { CGFloat($0) })
    }

    func resetBoundarySize() {
        setBoundarySize(width: Int(BoundaryController.defaultSize.width),
                        height: Int(BoundaryController.defaultSize.height))
    }

    // MARK: Recording

    func record(_ feature: Feature) {
        guard model.phase == .idle else { return }
        refreshPermissions()
        guard model.screenRecordingAllowed else {
            requestScreenRecording()
            return
        }
        let rect = boundary.rect
        guard Geometry.screen(containing: rect) != nil else {
            model.status = RecorderError.offScreen.errorDescription
            return
        }

        bringTargetForward()
        model.status = nil
        model.activeFeatureID = feature.id
        recordingFeature = feature
        recordingProjectName = model.currentProject?.name ?? "clips"
        streamReady = false
        countdownDone = false
        boundary.isLocked = true

        let recorder = Recorder()
        recorder.onStop = { [weak self] error in self?.captureStopped(error) }
        self.recorder = recorder
        let countdown = Countdown(rect: rect, seconds: model.countdownSeconds)
        self.countdown = countdown
        model.phase = .countingDown(model.countdownSeconds)

        // The keystroke window has to be on screen before the stream is set
        // up, so the recorder can let it in.
        var including: [CGWindowID] = []
        if model.showKeystrokes {
            keystrokes.attach(to: rect)
            including = [keystrokes.windowID]
        }

        // The stream starts during the countdown; frames are written from "go".
        recorder.prepare(rect: rect, including: including) { [weak self] error in
            guard let self, self.recorder === recorder else { return }
            if let error {
                self.abort("Couldn't start recording: \(error.localizedDescription)")
                return
            }
            if recorder.missedIncludedWindow {
                self.model.status = "Keystrokes won't be in this clip: macOS didn't list their window."
            }
            self.streamReady = true
            if self.countdownDone { self.beginRecording() }
        }
        countdown.start(onTick: { [weak self] n in
            self?.model.phase = .countingDown(n)
        }, onFinish: { [weak self] in
            guard let self, self.recorder === recorder else { return }
            self.countdown = nil
            self.countdownDone = true
            if self.streamReady { self.beginRecording() } else { self.model.phase = .countingDown(0) }
        })
    }

    func cancelCountdown() {
        guard case .countingDown = model.phase else { return }
        abort(nil)
    }

    private func beginRecording() {
        recorder?.begin()
        model.phase = .recording(Date())
        boundary.setRecording(true)
        if model.showKeystrokes, !keystrokes.startListening() {
            model.status = "Keystrokes need Accessibility: turn on monkeysee under Privacy & Security > Accessibility."
        }
    }

    func stopRecording() {
        guard case .recording = model.phase, let recorder else { return }
        model.phase = .finishing
        keystrokes.detach()
        recorder.finish { [weak self] result in
            guard let self else { return }
            self.recorder = nil
            self.boundary.setRecording(false)
            self.boundary.isLocked = false
            switch result {
            case .failure(let error):
                self.endTake(status: "Recording failed: \(error.localizedDescription)")
            case .success(let url):
                self.review(url)
            }
        }
    }

    private func captureStopped(_ error: Error) {
        switch model.phase {
        case .recording:
            stopRecording()
            model.status = "macOS stopped the capture: \(error.localizedDescription)"
        case .countingDown:
            abort("macOS stopped the capture: \(error.localizedDescription)")
        default:
            break
        }
    }

    private func abort(_ message: String?) {
        countdown?.cancel()
        countdown = nil
        recorder?.cancel()
        recorder = nil
        keystrokes.detach()
        boundary.setRecording(false)
        boundary.isLocked = false
        endTake(status: message)
    }

    private func endTake(status: String?) {
        model.phase = .idle
        model.activeFeatureID = nil
        recordingFeature = nil
        model.status = status
    }

    private func review(_ url: URL) {
        let feature = recordingFeature ?? Feature(name: "clip")
        let destination = model.outputURL(for: feature, projectName: recordingProjectName)
        model.phase = .reviewing
        let trim = TrimWindowController(sourceURL: url, destination: destination, featureName: feature.name)
        trim.onFinish = { [weak self] saved in
            guard let self else { return }
            self.trimWindow = nil
            if let saved { self.model.lastSaved = saved }
            self.endTake(status: saved == nil ? "Clip discarded." : nil)
        }
        trimWindow = trim
        trim.present()
    }

    /// Makes the app being filmed active, so its window isn't drawn as inactive.
    private func bringTargetForward() {
        _ = sidebarPanel?.makeFirstResponder(nil)
        let me = ProcessInfo.processInfo.processIdentifier
        if let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != me {
            _ = front.activate(options: [])
        } else if let pid = targetPID, let app = NSRunningApplication(processIdentifier: pid) {
            _ = app.activate(options: [])
        }
    }

    // MARK: Target window

    func toggleTargetMode() {
        if model.phase == .targeting {
            targeter.end()
            model.phase = .idle
            model.status = nil
            return
        }
        guard model.phase == .idle else { return }
        refreshPermissions()
        guard model.accessibilityAllowed else {
            requestAccessibility()
            return
        }
        model.phase = .targeting
        model.status = "Click the window to fit into the frame. Esc cancels."
        targeter.begin(onPick: { [weak self] point in
            self?.fitWindow(at: point)
        }, onCancel: { [weak self] in
            self?.model.phase = .idle
            self?.model.status = nil
        })
    }

    private func fitWindow(at point: CGPoint) {
        model.phase = .idle
        model.status = nil
        // Let the click land in the other app before moving its window.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self else { return }
            switch WindowTargeter.fit(windowAt: point, to: self.boundary.rect) {
            case .success(let fit):
                self.targetPID = fit.pid
                self.model.targetAppName = fit.appName
                if fit.matched {
                    self.model.status = "\(fit.appName) now fills the frame."
                } else {
                    let w = Int(fit.actualSize.width), h = Int(fit.actualSize.height)
                    self.model.status = "\(fit.appName) kept its window at \(w) × \(h); it may have a size limit."
                }
            case .failure(let error):
                self.model.status = error.localizedDescription
            }
        }
    }

    // MARK: Projects and output

    func newProject() {
        DispatchQueue.main.async {
            guard let name = self.promptForName(title: "New project", message: "Name it after the app you're filming.", initial: "") else { return }
            self.model.addProject(named: name)
        }
    }

    func renameProject() {
        DispatchQueue.main.async {
            guard let current = self.model.currentProject,
                  let name = self.promptForName(title: "Rename project", message: "", initial: current.name) else { return }
            self.model.renameCurrentProject(to: name)
        }
    }

    func deleteProject() {
        DispatchQueue.main.async {
            guard let current = self.model.currentProject else { return }
            NSApp.activate()
            let alert = NSAlert()
            alert.messageText = "Delete “\(current.name)” and its \(current.features.count) feature buttons?"
            alert.informativeText = "Saved clips stay where they are."
            alert.addButton(withTitle: "Delete")
            alert.addButton(withTitle: "Cancel")
            if alert.runModal() == .alertFirstButtonReturn { self.model.deleteCurrentProject() }
        }
    }

    func chooseOutputFolder() {
        DispatchQueue.main.async {
            NSApp.activate()
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Use folder"
            panel.directoryURL = self.model.outputFolder
            if panel.runModal() == .OK, let url = panel.url {
                self.model.outputFolder = url
            }
        }
    }

    func revealOutputFolder() {
        let folder = model.outputFolder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        NSWorkspace.shared.open(folder)
    }

    func reveal(_ url: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    /// Lets a text field in the sidebar take typing (for renaming).
    func focusSidebar() {
        sidebarPanel?.makeKey()
    }

    private func promptForName(title: String, message: String, initial: String) -> String? {
        NSApp.activate()
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.stringValue = initial
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? nil : name
    }
}

/// Lets the first click on a sidebar button act even when monkeysee isn't active.
final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
