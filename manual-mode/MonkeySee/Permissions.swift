import AppKit
import ApplicationServices

enum Permissions {
    static var screenRecording: Bool { CGPreflightScreenCaptureAccess() }

    /// Shows the system prompt the first time; after that it only reports.
    @discardableResult
    static func requestScreenRecording() -> Bool { CGRequestScreenCaptureAccess() }

    static var accessibility: Bool { AXIsProcessTrusted() }

    /// Shows the "would like to control this computer" prompt when not yet trusted.
    static func requestAccessibility() {
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    /// Opens a pane of System Settings > Privacy & Security.
    static func openSettings(_ anchor: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") {
            NSWorkspace.shared.open(url)
        }
    }
}
