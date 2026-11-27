import SwiftUI

struct SidebarView: View {
    @ObservedObject var model: AppModel
    let controller: AppController

    @State private var newFeatureName = ""
    @State private var editingID: UUID?
    @State private var editingName = ""
    @FocusState private var renameFocused: Bool

    private var busy: Bool { model.phase != .idle }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            projectRow
            phaseSection
            targetSection
            sizeRow
            countdownRow
            keystrokesRow
            Divider()
            Text("Features")
                .font(.caption)
                .foregroundStyle(.secondary)
            featureList
            addRow
            Divider()
            footer
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Top

    private var header: some View {
        HStack {
            Text("monkeysee").font(.headline)
            Spacer()
            Button(action: { controller.quit() }) {
                Image(systemName: "power")
            }
            .buttonStyle(.borderless)
            .help("Quit monkeysee")
        }
    }

    private var projectRow: some View {
        HStack(spacing: 6) {
            Picker("Project", selection: $model.selectedProjectID) {
                ForEach(model.projects) { project in
                    Text(project.name).tag(Optional(project.id))
                }
            }
            .labelsHidden()
            Menu {
                Button("New project…") { controller.newProject() }
                Button("Rename project…") { controller.renameProject() }
                Button("Delete project…") { controller.deleteProject() }
                Divider()
                Button("Output folder…") { controller.chooseOutputFolder() }
                Button("Show output folder") { controller.revealOutputFolder() }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .disabled(busy)
    }

    @ViewBuilder
    private var phaseSection: some View {
        switch model.phase {
        case .countingDown(let n):
            HStack {
                Text(n > 0 ? "Recording in \(n)…" : "Starting…")
                Spacer()
                Button("Cancel") { controller.cancelCountdown() }
            }
        case .recording(let start):
            Button(action: { controller.stopRecording() }) {
                HStack {
                    Image(systemName: "stop.fill")
                    TimelineView(.periodic(from: start, by: 1)) { context in
                        Text("Stop   \(Self.elapsed(from: start, to: context.date))")
                            .monospacedDigit()
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .controlSize(.large)
        case .finishing:
            Text("Finishing the clip…").foregroundStyle(.secondary)
        case .reviewing:
            Text("Trim and save the clip in its window.").foregroundStyle(.secondary)
        case .idle, .targeting:
            EmptyView()
        }
        if let status = model.status {
            Text(status)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var targetSection: some View {
        Button(action: { controller.toggleTargetMode() }) {
            Label(model.phase == .targeting ? "Cancel targeting" : "Target window", systemImage: "scope")
                .frame(maxWidth: .infinity)
        }
        .controlSize(.large)
        .disabled(busy && model.phase != .targeting)
        .help("Click this, then click a window: it is moved and sized to fill the frame.")
        if let name = model.targetAppName {
            Text("Target: \(name)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var sizeRow: some View {
        HStack(spacing: 4) {
            Text("Frame").foregroundStyle(.secondary)
            TextField("W", value: widthBinding, format: IntegerFormatStyle<Int>().grouping(.never))
                .frame(width: 54)
                .multilineTextAlignment(.trailing)
            Text("×")
            TextField("H", value: heightBinding, format: IntegerFormatStyle<Int>().grouping(.never))
                .frame(width: 54)
            Spacer(minLength: 0)
            Button("Reset") { controller.resetBoundarySize() }
                .help("1280 × 800, the size of the site's clips")
        }
        .textFieldStyle(.roundedBorder)
        .disabled(busy)
    }

    private var widthBinding: Binding<Int> {
        Binding(get: { Int(model.boundarySize.width) },
                set: { controller.setBoundarySize(width: $0, height: nil) })
    }

    private var heightBinding: Binding<Int> {
        Binding(get: { Int(model.boundarySize.height) },
                set: { controller.setBoundarySize(width: nil, height: $0) })
    }

    private var countdownRow: some View {
        Stepper(value: $model.countdownSeconds, in: 0...10) {
            Text("Countdown \(model.countdownSeconds) s")
        }
        .disabled(busy)
    }

    private var keystrokesRow: some View {
        Toggle("Show keystrokes", isOn: $model.showKeystrokes)
            .disabled(busy)
            .help("Shortcuts and keys like Return or the arrows appear at the bottom of the clip, as in agent mode. Plain typing isn't shown.")
    }

    // MARK: Features

    private var featureList: some View {
        List {
            ForEach(model.features) { feature in
                row(for: feature)
            }
            .onMove { source, destination in
                model.moveFeatures(from: source, to: destination)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .frame(minHeight: 120)
        .overlay {
            if model.features.isEmpty {
                Text("Add the features you want clips of, then click one to record it.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
    }

    @ViewBuilder
    private func row(for feature: Feature) -> some View {
        if editingID == feature.id {
            TextField("Feature name", text: $editingName)
                .textFieldStyle(.roundedBorder)
                .focused($renameFocused)
                .onSubmit { commitRename() }
                .onExitCommand { editingID = nil }
        } else {
            let active = model.activeFeatureID == feature.id
            Button(action: { controller.record(feature) }) {
                HStack(spacing: 6) {
                    Image(systemName: active ? "record.circle.fill" : "record.circle")
                        .foregroundStyle(active ? Color.red : Color.secondary)
                    Text(feature.name).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(busy)
            .help("Record “\(feature.name)”")
            .contextMenu {
                Button("Rename…") { beginRename(feature) }
                Button("Move up") { model.nudgeFeature(feature.id, by: -1) }
                Button("Move down") { model.nudgeFeature(feature.id, by: 1) }
                Divider()
                Button("Delete", role: .destructive) { model.deleteFeature(feature.id) }
            }
        }
    }

    private var addRow: some View {
        HStack(spacing: 6) {
            TextField("New feature", text: $newFeatureName)
                .textFieldStyle(.roundedBorder)
                .onSubmit { addFeature() }
            Button(action: { addFeature() }) {
                Image(systemName: "plus")
            }
            .disabled(newFeatureName.trimmingCharacters(in: .whitespaces).isEmpty)
            .help("Add a feature button")
        }
        .disabled(busy)
    }

    private func addFeature() {
        model.addFeature(named: newFeatureName)
        newFeatureName = ""
    }

    private func beginRename(_ feature: Feature) {
        controller.focusSidebar()
        editingName = feature.name
        editingID = feature.id
        DispatchQueue.main.async { renameFocused = true }
    }

    private func commitRename() {
        if let id = editingID { model.renameFeature(id, to: editingName) }
        editingID = nil
    }

    // MARK: Footer

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !model.screenRecordingAllowed {
                permissionRow("Screen Recording is off.") { controller.requestScreenRecording() }
            }
            if !model.accessibilityAllowed {
                permissionRow(model.showKeystrokes
                              ? "Accessibility is off (for Target window and keystrokes)."
                              : "Accessibility is off (for Target window).") { controller.requestAccessibility() }
            }
            if let saved = model.lastSaved {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text("Saved \(saved.lastPathComponent)")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                    Button("Show") { controller.reveal(saved) }
                        .buttonStyle(.link)
                }
                .font(.callout)
            }
            Text(outputSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .truncationMode(.middle)
        }
    }

    private var outputSummary: String {
        let folder = (model.outputFolder.path as NSString).abbreviatingWithTildeInPath
        let project = slugify(model.currentProject?.name ?? "clips")
        return "Clips go to \(folder)/\(project)/"
    }

    private func permissionRow(_ text: String, action: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(text).font(.caption)
            Spacer(minLength: 0)
            Button("Allow…", action: action).controlSize(.small)
        }
    }

    private static func elapsed(from start: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
