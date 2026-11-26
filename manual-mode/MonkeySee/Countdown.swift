import AppKit

/// A big 3, 2, 1 over the frame. It is one of monkeysee's own windows, so
/// it is never in the clip.
final class Countdown {
    private let panel: ChromePanel
    private let view = CountdownView()
    private var timer: Timer?
    private var remaining: Int

    init(rect: NSRect, seconds: Int) {
        remaining = max(0, seconds)
        panel = makeChromePanel(level: .statusBar)
        panel.ignoresMouseEvents = true
        panel.contentView = view
        panel.setFrame(rect, display: false)
    }

    /// `onFinish` runs straight away when the countdown is 0 seconds.
    func start(onTick: @escaping (Int) -> Void, onFinish: @escaping () -> Void) {
        guard remaining > 0 else {
            onFinish()
            return
        }
        view.value = remaining
        onTick(remaining)
        panel.orderFrontRegardless()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            self.remaining -= 1
            if self.remaining <= 0 {
                timer.invalidate()
                self.timer = nil
                self.panel.orderOut(nil)
                onFinish()
            } else {
                self.view.value = self.remaining
                onTick(self.remaining)
            }
        }
    }

    func cancel() {
        timer?.invalidate()
        timer = nil
        panel.orderOut(nil)
    }
}

final class CountdownView: NSView {
    var value = 3 {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.15).setFill()
        bounds.fill()
        let d: CGFloat = 180
        let circle = NSRect(x: bounds.midX - d / 2, y: bounds.midY - d / 2, width: d, height: d)
        NSColor.black.withAlphaComponent(0.7).setFill()
        NSBezierPath(ovalIn: circle).fill()
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 96, weight: .bold),
            .foregroundColor: NSColor.white,
        ]
        let text = "\(value)" as NSString
        let size = text.size(withAttributes: attrs)
        text.draw(at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2), withAttributes: attrs)
    }
}
