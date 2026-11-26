import AppKit
import ApplicationServices

struct FitResult {
    let appName: String
    let pid: pid_t
    let actualSize: CGSize
    /// False when the app kept a different size or position (min/max size limits).
    let matched: Bool
}

enum FitError: LocalizedError {
    case noWindow
    case ownWindow
    case fullScreen(String)
    case refused(String)

    var errorDescription: String? {
        switch self {
        case .noWindow: return "No window was found where you clicked."
        case .ownWindow: return "That's one of monkeysee's own windows; click the app you want to film."
        case .fullScreen(let app): return "\(app) is in full screen. Leave full screen, then target it again."
        case .refused(let app): return "\(app) didn't let its window be moved or resized."
        }
    }
}

/// Target mode: waits for the next click in another app, then moves and
/// resizes the window under it to fill the frame exactly (title bar
/// included), using the Accessibility API.
final class WindowTargeter {
    private var mouseMonitor: Any?
    private var keyMonitor: Any?

    /// `onPick` gets the click point in global top-left coordinates.
    /// Clicks in monkeysee's own windows don't count (global monitors only
    /// see other apps' events), so the sidebar's Cancel button still works.
    func begin(onPick: @escaping (CGPoint) -> Void, onCancel: @escaping () -> Void) {
        end()
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            let point = Geometry.cgPoint(fromAppKit: NSEvent.mouseLocation)
            self?.end()
            onPick(point)
        }
        keyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return } // Escape
            self?.end()
            onCancel()
        }
    }

    func end() {
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        mouseMonitor = nil
        keyMonitor = nil
    }

    /// Moves and resizes the window at `point` to `rect` (AppKit coordinates).
    static func fit(windowAt point: CGPoint, to rect: NSRect) -> Result<FitResult, FitError> {
        let target = Geometry.cgRect(fromAppKit: rect)
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 2)

        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
              let element = hit,
              let window = enclosingWindow(of: element) else {
            return .failure(.noWindow)
        }

        var pid: pid_t = 0
        AXUIElementGetPid(window, &pid)
        if pid == ProcessInfo.processInfo.processIdentifier { return .failure(.ownWindow) }
        let appName = NSRunningApplication(processIdentifier: pid)?.localizedName ?? "That app"

        if (copyAttribute(window, "AXFullScreen") as? Bool) == true { return .failure(.fullScreen(appName)) }
        if (copyAttribute(window, "AXMinimized") as? Bool) == true {
            AXUIElementSetAttributeValue(window, "AXMinimized" as CFString, kCFBooleanFalse)
        }

        // Size, then position, then size again: some apps clamp the size to
        // the room left on screen at the old position.
        let sized = setSize(window, target.size)
        let placed = setPosition(window, target.origin)
        _ = setSize(window, target.size)
        guard sized || placed else { return .failure(.refused(appName)) }
        AXUIElementPerformAction(window, "AXRaise" as CFString)

        let actualSize = size(of: window) ?? target.size
        let actualOrigin = position(of: window) ?? target.origin
        let matched = abs(actualSize.width - target.width) < 1
            && abs(actualSize.height - target.height) < 1
            && abs(actualOrigin.x - target.minX) < 1
            && abs(actualOrigin.y - target.minY) < 1
        return .success(FitResult(appName: appName, pid: pid, actualSize: actualSize, matched: matched))
    }

    // MARK: Accessibility helpers

    private static func enclosingWindow(of element: AXUIElement) -> AXUIElement? {
        var current: AXUIElement? = element
        var steps = 0
        while let el = current, steps < 64 {
            if (copyAttribute(el, "AXRole") as? String) == "AXWindow" { return el }
            if let window = axElement(copyAttribute(el, "AXWindow")) { return window }
            current = axElement(copyAttribute(el, "AXParent"))
            steps += 1
        }
        return nil
    }

    private static func copyAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }

    private static func axElement(_ value: CFTypeRef?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(value, to: AXUIElement.self)
    }

    private static func setSize(_ window: AXUIElement, _ size: CGSize) -> Bool {
        var s = size
        guard let value = AXValueCreate(.cgSize, &s) else { return false }
        return AXUIElementSetAttributeValue(window, "AXSize" as CFString, value) == .success
    }

    private static func setPosition(_ window: AXUIElement, _ origin: CGPoint) -> Bool {
        var p = origin
        guard let value = AXValueCreate(.cgPoint, &p) else { return false }
        return AXUIElementSetAttributeValue(window, "AXPosition" as CFString, value) == .success
    }

    private static func size(of window: AXUIElement) -> CGSize? {
        guard let value = copyAttribute(window, "AXSize"), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var s = CGSize.zero
        return AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cgSize, &s) ? s : nil
    }

    private static func position(of window: AXUIElement) -> CGPoint? {
        guard let value = copyAttribute(window, "AXPosition"), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var p = CGPoint.zero
        return AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cgPoint, &p) ? p : nil
    }
}
