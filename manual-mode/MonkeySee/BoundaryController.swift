import AppKit

struct Edges: OptionSet {
    let rawValue: Int
    static let left = Edges(rawValue: 1 << 0)
    static let right = Edges(rawValue: 1 << 1)
    static let top = Edges(rawValue: 1 << 2)
    static let bottom = Edges(rawValue: 1 << 3)
}

enum DragMode {
    case move
    case resize(Edges)
}

enum EdgeRole: CaseIterable {
    case top, bottom, left, right, grip
}

/// The recording frame: a title strip on top (drag to move), thin borders
/// on the other sides (drag to resize) and a grip at the bottom right.
/// Everything is drawn outside `rect`, so nothing of the frame is in the
/// clip, and the inside has no window at all, so clicks reach the app
/// underneath. The sidebar is kept attached to the left side.
final class BoundaryController {
    static let borderWidth: CGFloat = 6
    static let stripHeight: CGFloat = 24
    static let gripSize: CGFloat = 18
    static let sidebarGap: CGFloat = 8
    static let minSize = CGSize(width: 320, height: 200)
    /// The clips on the site are 2560 x 1600: 1280 x 800 points at 2x.
    static let defaultSize = CGSize(width: 1280, height: 800)
    private static let defaultsKey = "monkeysee.boundary.v1"

    let sidebarWidth: CGFloat = 248

    private(set) var rect: NSRect
    private(set) var isRecording = false
    /// While counting down or recording the frame can't be moved.
    var isLocked = false

    var onChange: ((NSRect) -> Void)?
    weak var sidebar: NSPanel?

    private var panels: [EdgeRole: ChromePanel] = [:]
    private var views: [EdgeRole: EdgeView] = [:]

    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.defaultsKey) {
            let r = NSRectFromString(saved)
            let onScreen = NSScreen.screens.contains { $0.frame.intersects(r) }
            rect = (onScreen && r.width >= Self.minSize.width && r.height >= Self.minSize.height) ? r : Self.defaultRect()
        } else {
            rect = Self.defaultRect()
        }
        for role in EdgeRole.allCases {
            let panel = makeChromePanel(level: .floating)
            let view = EdgeView(role: role)
            view.controller = self
            panel.contentView = view
            panels[role] = panel
            views[role] = view
        }
    }

    static func defaultRect() -> NSRect {
        let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = defaultSize
        // Centre the frame plus sidebar, leaving the sidebar's room on the left.
        let x = visible.midX - size.width / 2 + 124
        let y = visible.minY + (visible.height - size.height - stripHeight + borderWidth) / 2
        return NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height)
    }

    func show() {
        layout()
        for panel in panels.values { panel.orderFrontRegardless() }
    }

    func hide() {
        for panel in panels.values { panel.orderOut(nil) }
    }

    func setRecording(_ on: Bool) {
        isRecording = on
        for view in views.values { view.needsDisplay = true }
    }

    // MARK: Geometry

    func setRect(_ r: NSRect, persist: Bool) {
        rect = NSRect(x: r.origin.x.rounded(), y: r.origin.y.rounded(),
                      width: max(Self.minSize.width, r.width.rounded()),
                      height: max(Self.minSize.height, r.height.rounded()))
        layout()
        if persist { save() }
    }

    /// Changes the size, keeping the top-left corner where it is.
    func setSize(width: CGFloat?, height: CGFloat?) {
        let w = max(Self.minSize.width, (width ?? rect.width).rounded())
        let h = max(Self.minSize.height, (height ?? rect.height).rounded())
        setRect(NSRect(x: rect.minX, y: rect.maxY - h, width: w, height: h), persist: true)
    }

    func endDrag() {
        save()
    }

    private func save() {
        UserDefaults.standard.set(NSStringFromRect(rect), forKey: Self.defaultsKey)
    }

    func layout() {
        let b = Self.borderWidth
        let t = Self.stripHeight
        let g = Self.gripSize
        let r = rect
        panels[.top]?.setFrame(NSRect(x: r.minX - b, y: r.maxY, width: r.width + 2 * b, height: t), display: true)
        panels[.bottom]?.setFrame(NSRect(x: r.minX - b, y: r.minY - b, width: r.width + 2 * b, height: b), display: true)
        panels[.left]?.setFrame(NSRect(x: r.minX - b, y: r.minY, width: b, height: r.height), display: true)
        panels[.right]?.setFrame(NSRect(x: r.maxX, y: r.minY, width: b, height: r.height), display: true)
        panels[.grip]?.setFrame(NSRect(x: r.maxX + b - g, y: r.minY - b - g, width: g, height: g), display: true)
        for view in views.values { view.needsDisplay = true }
        layoutSidebar()
        onChange?(r)
    }

    private func layoutSidebar() {
        guard let sidebar else { return }
        let b = Self.borderWidth
        let top = rect.maxY + Self.stripHeight
        let height = max(rect.height + Self.stripHeight + b, 520)
        var x = rect.minX - b - Self.sidebarGap - sidebarWidth
        let screen = NSScreen.screens.first { $0.frame.intersects(rect) } ?? NSScreen.main
        if let visible = screen?.visibleFrame, x < visible.minX {
            // No room on the left: try the right, else pin to the screen edge
            // (it may then cover part of the frame; it isn't in the clip).
            let right = rect.maxX + b + Self.sidebarGap
            x = right + sidebarWidth <= visible.maxX ? right : visible.minX
        }
        sidebar.setFrame(NSRect(x: x, y: top - height, width: sidebarWidth, height: height), display: true)
    }

    // MARK: Dragging

    func dragMode(for role: EdgeRole, at p: NSPoint, in size: NSSize) -> DragMode {
        let corner: CGFloat = 16
        switch role {
        case .top:
            if p.x < corner { return .resize([.top, .left]) }
            if p.x > size.width - corner { return .resize([.top, .right]) }
            if p.y > size.height - 4 { return .resize([.top]) }
            return .move
        case .bottom:
            if p.x < corner { return .resize([.bottom, .left]) }
            if p.x > size.width - corner { return .resize([.bottom, .right]) }
            return .resize([.bottom])
        case .left:
            return .resize([.left])
        case .right:
            return .resize([.right])
        case .grip:
            return .resize([.bottom, .right])
        }
    }

    func apply(_ mode: DragMode, from start: NSRect, dx: CGFloat, dy: CGFloat) {
        var r = start
        switch mode {
        case .move:
            r.origin.x += dx
            r.origin.y += dy
        case .resize(let edges):
            if edges.contains(.right) {
                r.size.width = max(Self.minSize.width, start.width + dx)
            }
            if edges.contains(.left) {
                let w = max(Self.minSize.width, start.width - dx)
                r.origin.x = start.maxX - w
                r.size.width = w
            }
            if edges.contains(.top) {
                r.size.height = max(Self.minSize.height, start.height + dy)
            }
            if edges.contains(.bottom) {
                let h = max(Self.minSize.height, start.height - dy)
                r.origin.y = start.maxY - h
                r.size.height = h
            }
        }
        setRect(r, persist: false)
    }
}

/// One piece of the frame. Draws itself and handles move/resize drags.
final class EdgeView: NSView {
    let role: EdgeRole
    weak var controller: BoundaryController?

    private var mode: DragMode?
    private var startMouse = NSPoint.zero
    private var startRect = NSRect.zero

    init(role: EdgeRole) {
        self.role = role
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let controller else { return }
        let color: NSColor = controller.isRecording ? .systemRed : .controlAccentColor
        switch role {
        case .grip:
            color.withAlphaComponent(0.9).setStroke()
            for i in 0..<3 {
                let inset = CGFloat(4 + i * 4)
                let line = NSBezierPath()
                line.move(to: NSPoint(x: inset, y: 2))
                line.line(to: NSPoint(x: bounds.maxX - 2, y: bounds.maxY - inset))
                line.lineWidth = 1.5
                line.stroke()
            }
        case .top:
            color.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 5, yRadius: 5).fill()
            // Square off the bottom corners where the side borders meet the strip.
            NSRect(x: 0, y: 0, width: bounds.width, height: bounds.height / 2).fill()
            let size = controller.rect.size
            let dims = "\(Int(size.width)) × \(Int(size.height))"
            let text = controller.isRecording ? "● REC   \(dims)" : "\(dims)   ·   drag to move"
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold),
                .foregroundColor: NSColor.white,
            ]
            let label = text as NSString
            let labelSize = label.size(withAttributes: attrs)
            label.draw(at: NSPoint(x: (bounds.width - labelSize.width) / 2,
                                   y: (bounds.height - labelSize.height) / 2),
                       withAttributes: attrs)
        default:
            color.setFill()
            bounds.fill()
        }
    }

    // MARK: Mouse

    override func mouseDown(with event: NSEvent) {
        guard let controller, !controller.isLocked else { return }
        let p = convert(event.locationInWindow, from: nil)
        mode = controller.dragMode(for: role, at: p, in: bounds.size)
        startMouse = NSEvent.mouseLocation
        startRect = controller.rect
        if case .move? = mode { NSCursor.closedHand.set() }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let controller, let mode else { return }
        let now = NSEvent.mouseLocation
        controller.apply(mode, from: startRect, dx: now.x - startMouse.x, dy: now.y - startMouse.y)
    }

    override func mouseUp(with event: NSEvent) {
        guard mode != nil else { return }
        mode = nil
        controller?.endDrag()
        cursor(at: convert(event.locationInWindow, from: nil)).set()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: bounds,
                                       options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self,
                                       userInfo: nil))
    }

    override func mouseEntered(with event: NSEvent) {
        cursor(at: convert(event.locationInWindow, from: nil)).set()
    }

    override func mouseMoved(with event: NSEvent) {
        cursor(at: convert(event.locationInWindow, from: nil)).set()
    }

    override func mouseExited(with event: NSEvent) {
        if mode == nil { NSCursor.arrow.set() }
    }

    private func cursor(at p: NSPoint) -> NSCursor {
        guard let controller, !controller.isLocked else { return .arrow }
        switch controller.dragMode(for: role, at: p, in: bounds.size) {
        case .move:
            return .openHand
        case .resize(let edges):
            if edges == [.left] || edges == [.right] { return .resizeLeftRight }
            if edges == [.top] || edges == [.bottom] { return .resizeUpDown }
            return .crosshair
        }
    }
}
