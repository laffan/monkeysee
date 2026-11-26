import AppKit

// Started by hand (no storyboard), so the delegate is set before run().
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
