import AppKit

/// The frame's edges, grip and countdown. Never takes keyboard focus, so
/// clicking or dragging them leaves the app being filmed active.
final class ChromePanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// The sidebar. Becomes key only when a text field is clicked.
final class SidebarPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Borderless, transparent, floating, and kept on screen when monkeysee
/// isn't the active app (NSPanel hides on deactivate by default).
func configurePanel(_ panel: NSPanel, level: NSWindow.Level) {
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.level = level
    panel.hidesOnDeactivate = false
    panel.isMovable = false
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
}

func makeChromePanel(level: NSWindow.Level) -> ChromePanel {
    let panel = ChromePanel(contentRect: .zero,
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered,
                            defer: false)
    configurePanel(panel, level: level)
    return panel
}
