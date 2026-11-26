import AppKit

/// AppKit puts the origin at the bottom-left of the main screen, y up.
/// ScreenCaptureKit and the Accessibility API use top-left origins, y down.
enum Geometry {
    /// Height of the screen that holds the menu bar (its frame starts at 0, 0).
    static var primaryHeight: CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    /// AppKit global rect to the global top-left coordinates the Accessibility API uses.
    static func cgRect(fromAppKit r: CGRect) -> CGRect {
        CGRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height)
    }

    static func cgPoint(fromAppKit p: CGPoint) -> CGPoint {
        CGPoint(x: p.x, y: primaryHeight - p.y)
    }

    /// The screen that fully contains the rect, if one does.
    static func screen(containing r: CGRect) -> NSScreen? {
        NSScreen.screens.first { $0.frame.contains(r) }
    }

    /// The rect relative to one screen, top-left origin (ScreenCaptureKit's sourceRect).
    static func local(_ r: CGRect, in screen: NSScreen) -> CGRect {
        CGRect(x: r.minX - screen.frame.minX,
               y: screen.frame.maxY - r.maxY,
               width: r.width,
               height: r.height)
    }
}

extension NSScreen {
    var displayID: CGDirectDisplayID? {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }
}

/// "Focus Modes" -> "focus-modes". Used for file and folder names.
func slugify(_ name: String) -> String {
    let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
    var out = ""
    var lastWasDash = false
    for scalar in folded.unicodeScalars {
        if scalar.isASCII && CharacterSet.alphanumerics.contains(scalar) {
            out.unicodeScalars.append(scalar)
            lastWasDash = false
        } else if !out.isEmpty && !lastWasDash {
            out.append("-")
            lastWasDash = true
        }
    }
    while out.hasSuffix("-") { out.removeLast() }
    return out.isEmpty ? "clip" : out
}
