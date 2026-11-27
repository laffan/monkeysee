import AppKit
import SwiftUI

/// Shows the keys pressed during a take in a pill near the bottom of the
/// frame, drawn to look like agent mode's HUD (src/overlay.js). It sits in
/// its own click-through window over the recorded area, and the recorder
/// lets that one window into the clip while leaving monkeysee's other
/// windows out.
///
/// What it shows, like agent mode's clips: shortcuts (any key with ⌘, ⌃ or
/// ⌥), keys such as ↩ ⇥ esc ⌫ and the arrows, and a modifier tapped on its
/// own, spelled out ("Shift", then "Shift × 2", "× 3" for quick repeats).
/// Plain typing (letters, digits, space, ⇧ with a letter) isn't shown.
///
/// Global key monitors need Accessibility access, which Target window
/// already asks for.
final class KeystrokeOverlay {
    private let state = KeystrokeState()
    private let panel: ChromePanel
    private var monitors: [Any] = []
    private var hideWork: DispatchWorkItem?

    /// A modifier pressed with nothing else held, waiting to see whether it
    /// is released before any other key or click.
    private var pendingModifier: (name: String, flag: NSEvent.ModifierFlags, at: Date)?
    private var lastTap: (name: String, at: Date, count: Int)?

    static let holdSeconds: TimeInterval = 1.4
    /// Longer than this between press and release is a hold, not a tap.
    static let tapMaxSeconds: TimeInterval = 0.6
    /// Taps of the same modifier closer than this count up.
    static let repeatGapSeconds: TimeInterval = 0.7

    init() {
        panel = makeChromePanel(level: .floating)
        panel.ignoresMouseEvents = true
        let hosting = NSHostingView(rootView: KeystrokeHUD(state: state))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    /// The overlay window's id, for the recorder's filter.
    var windowID: CGWindowID { CGWindowID(panel.windowNumber) }

    /// Puts the (still empty) window over `rect`. Call before the recorder
    /// prepares its stream, so the window is there to be let in.
    func attach(to rect: NSRect) {
        panel.setFrame(rect, display: true)
        panel.orderFrontRegardless()
    }

    /// Starts listening for keys. Returns false when Accessibility is off,
    /// in which case macOS delivers no key events.
    @discardableResult
    func startListening() -> Bool {
        stopListening()
        monitors = [
            NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] in self?.keyDown($0) },
            NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] in self?.flagsChanged($0) },
            NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in
                self?.pendingModifier = nil
            },
        ].compactMap { $0 }
        return Permissions.accessibility
    }

    func stopListening() {
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        pendingModifier = nil
        lastTap = nil
    }

    /// Stops listening and takes the window off the screen.
    func detach() {
        stopListening()
        hideWork?.cancel()
        hideWork = nil
        state.visible = false
        panel.orderOut(nil)
    }

    // MARK: Events

    private func keyDown(_ event: NSEvent) {
        pendingModifier = nil
        lastTap = nil
        guard let caps = KeyCaps.caps(for: event) else { return }
        if event.isARepeat && state.visible && state.caps == caps && state.count == 0 {
            scheduleHide()   // a held key: keep it up without popping again
            return
        }
        show(caps, count: 0)
    }

    private func flagsChanged(_ event: NSEvent) {
        let held = event.modifierFlags.intersection(KeyCaps.modifierMask)
        guard let modifier = KeyCaps.modifier(forKeyCode: event.keyCode) else {
            pendingModifier = nil
            return
        }
        let name = modifier.name, flag = modifier.flag
        if held.contains(flag) {
            // Pressed. Only a modifier pressed on its own can become a tap.
            if held == flag {
                pendingModifier = (name: name, flag: flag, at: Date())
            } else {
                pendingModifier = nil
            }
            return
        }
        // Released.
        guard let pending = pendingModifier, pending.flag == flag, held.isEmpty else {
            pendingModifier = nil
            return
        }
        pendingModifier = nil
        let now = Date()
        guard now.timeIntervalSince(pending.at) <= Self.tapMaxSeconds else { return }

        var count = 1
        if let last = lastTap, last.name == name, now.timeIntervalSince(last.at) <= Self.repeatGapSeconds {
            count = last.count + 1
        }
        lastTap = (name: name, at: now, count: count)
        show([name], count: count > 1 ? count : 0)
    }

    // MARK: Showing

    private func show(_ caps: [String], count: Int) {
        state.caps = caps
        state.count = count
        state.generation &+= 1
        state.visible = true
        scheduleHide()
    }

    private func scheduleHide() {
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.state.visible = false }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.holdSeconds, execute: work)
    }
}

/// Turns key events into the labels agent mode shows: macOS order
/// ⌃ ⌥ ⇧ ⌘ and then the key.
enum KeyCaps {
    static let modifierMask: NSEvent.ModifierFlags = [.control, .option, .shift, .command]

    private static let special: [UInt16: String] = [
        36: "↩", 76: "↩", 48: "⇥", 49: "space", 51: "⌫", 117: "⌦", 53: "esc",
        123: "←", 124: "→", 125: "↓", 126: "↑",
        116: "⇞", 121: "⇟", 115: "↖", 119: "↘",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
        98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
    ]

    /// Keys that are part of plain typing, shown only with ⌘, ⌃ or ⌥.
    private static let typingKeys: Set<UInt16> = [49] // space

    /// The caps for a key press, or nil when it's plain typing.
    static func caps(for event: NSEvent) -> [String]? {
        let flags = event.modifierFlags.intersection(modifierMask)
        let shortcut = flags.contains(.command) || flags.contains(.control) || flags.contains(.option)

        let key: String
        if let label = special[event.keyCode] {
            if typingKeys.contains(event.keyCode) && !shortcut { return nil }
            key = label
        } else {
            guard shortcut else { return nil }
            let base = event.characters(byApplyingModifiers: []) ?? event.charactersIgnoringModifiers ?? ""
            let trimmed = base.trimmingCharacters(in: .controlCharacters)
            guard !trimmed.isEmpty else { return nil }
            key = trimmed.uppercased()
        }

        var caps: [String] = []
        if flags.contains(.control) { caps.append("⌃") }
        if flags.contains(.option) { caps.append("⌥") }
        if flags.contains(.shift) { caps.append("⇧") }
        if flags.contains(.command) { caps.append("⌘") }
        caps.append(key)
        return caps
    }

    /// The spelled-out name and flag for a modifier key, left or right.
    static func modifier(forKeyCode code: UInt16) -> (name: String, flag: NSEvent.ModifierFlags)? {
        switch code {
        case 55, 54: return ("Command", .command)
        case 56, 60: return ("Shift", .shift)
        case 58, 61: return ("Option", .option)
        case 59, 62: return ("Control", .control)
        default: return nil
        }
    }
}

final class KeystrokeState: ObservableObject {
    @Published var caps: [String] = []
    @Published var count = 0
    @Published var visible = false
    /// Changes on every press, to replay the pop.
    @Published var generation = 0
}

/// The pill: the same sizes, colours and timing as agent mode's `.hud`
/// (CSS pixels there are points here).
struct KeystrokeHUD: View {
    @ObservedObject var state: KeystrokeState

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.clear
            pill
                .opacity(state.visible ? 1 : 0)
                .offset(y: state.visible ? 0 : 12)
                .animation(.easeInOut(duration: 0.18), value: state.visible)
                .padding(.bottom, 48)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private var pill: some View {
        HStack(spacing: 14) {
            // New caps on every press, so each one pops in.
            HStack(spacing: 6) {
                ForEach(Array(state.caps.enumerated()), id: \.offset) { _, cap in
                    KeyCapView(text: cap)
                }
            }
            .id(state.generation)
            if state.count > 0 {
                Text("× \(state.count)")
                    .font(.system(size: 20, weight: .semibold))
                    .opacity(0.85)
                    .frame(minWidth: 48, alignment: .leading)
            }
        }
        .foregroundStyle(.white)
        .padding(.vertical, 12)
        .padding(.horizontal, 18)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 22 / 255, green: 22 / 255, blue: 28 / 255).opacity(0.86))
        )
        .shadow(color: .black.opacity(0.28), radius: 20, x: 0, y: 12)
    }
}

struct KeyCapView: View {
    let text: String
    /// CSS: @keyframes pop, .82 to 1.08 to 1 over .22 s.
    @State private var scale: CGFloat = 0.82

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 9, style: .continuous)
        Text(text)
            .font(.system(size: 20, weight: .semibold))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 10)
            .frame(minWidth: 34, minHeight: 38, maxHeight: 38)
            .background(shape.fill(Color.white.opacity(0.12)))
            // The 2px darker lip along the bottom (CSS: inset 0 -2px 0).
            .overlay(
                shape.fill(Color.black.opacity(0.35))
                    .mask(VStack(spacing: 0) { Spacer(minLength: 0); Rectangle().frame(height: 2) })
            )
            .overlay(shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
            .scaleEffect(scale)
            .onAppear {
                withAnimation(.easeOut(duration: 0.13)) {
                    scale = 1.08
                } completion: {
                    withAnimation(.easeInOut(duration: 0.09)) { scale = 1.0 }
                }
            }
    }
}
