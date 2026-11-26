import SwiftUI

struct Feature: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var name: String
}

/// One app being filmed, with its own list of feature buttons.
struct Project: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var name: String
    var features: [Feature] = []
}

enum Phase: Equatable {
    case idle
    case targeting
    case countingDown(Int)
    case recording(Date)
    case finishing
    case reviewing
}

/// What the sidebar shows. Projects and settings persist in UserDefaults.
final class AppModel: ObservableObject {
    @Published var projects: [Project] { didSet { save() } }
    @Published var selectedProjectID: UUID? { didSet { save() } }
    @Published var countdownSeconds: Int { didSet { save() } }
    @Published var outputFolder: URL { didSet { save() } }

    @Published var phase: Phase = .idle
    @Published var activeFeatureID: UUID?
    @Published var boundarySize = CGSize(width: 1280, height: 800)
    @Published var status: String?
    @Published var lastSaved: URL?
    @Published var targetAppName: String?
    @Published var screenRecordingAllowed = false
    @Published var accessibilityAllowed = false

    private struct Stored: Codable {
        var projects: [Project]
        var selectedProjectID: UUID?
        var countdownSeconds: Int
        var outputFolder: String
    }

    private static let defaultsKey = "monkeysee.state.v1"

    static var defaultOutputFolder: URL {
        let movies = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Movies")
        return movies.appendingPathComponent("monkeysee", isDirectory: true)
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.defaultsKey),
           let stored = try? JSONDecoder().decode(Stored.self, from: data),
           !stored.projects.isEmpty {
            projects = stored.projects
            selectedProjectID = stored.selectedProjectID ?? stored.projects.first?.id
            countdownSeconds = stored.countdownSeconds
            outputFolder = URL(fileURLWithPath: stored.outputFolder, isDirectory: true)
        } else {
            let first = Project(name: "My app")
            projects = [first]
            selectedProjectID = first.id
            countdownSeconds = 3
            outputFolder = Self.defaultOutputFolder
        }
    }

    private func save() {
        let stored = Stored(projects: projects,
                            selectedProjectID: selectedProjectID,
                            countdownSeconds: countdownSeconds,
                            outputFolder: outputFolder.path)
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: Self.defaultsKey)
        }
    }

    // MARK: Projects

    private var selectedIndex: Int? {
        projects.firstIndex { $0.id == selectedProjectID }
    }

    var currentProject: Project? {
        selectedIndex.map { projects[$0] }
    }

    func addProject(named name: String) {
        let project = Project(name: name)
        projects.append(project)
        selectedProjectID = project.id
    }

    func renameCurrentProject(to name: String) {
        guard let i = selectedIndex else { return }
        projects[i].name = name
    }

    func deleteCurrentProject() {
        guard let i = selectedIndex else { return }
        projects.remove(at: i)
        if projects.isEmpty { projects = [Project(name: "My app")] }
        selectedProjectID = projects[min(i, projects.count - 1)].id
    }

    // MARK: Features

    var features: [Feature] { currentProject?.features ?? [] }

    func feature(_ id: UUID) -> Feature? {
        for project in projects {
            if let f = project.features.first(where: { $0.id == id }) { return f }
        }
        return nil
    }

    func addFeature(named name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let i = selectedIndex else { return }
        projects[i].features.append(Feature(name: trimmed))
    }

    func renameFeature(_ id: UUID, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let i = selectedIndex,
              let j = projects[i].features.firstIndex(where: { $0.id == id }) else { return }
        projects[i].features[j].name = trimmed
    }

    func deleteFeature(_ id: UUID) {
        guard let i = selectedIndex else { return }
        projects[i].features.removeAll { $0.id == id }
    }

    func moveFeatures(from source: IndexSet, to destination: Int) {
        guard let i = selectedIndex else { return }
        projects[i].features.move(fromOffsets: source, toOffset: destination)
    }

    func nudgeFeature(_ id: UUID, by delta: Int) {
        guard let i = selectedIndex,
              let j = projects[i].features.firstIndex(where: { $0.id == id }) else { return }
        let k = j + delta
        guard projects[i].features.indices.contains(k) else { return }
        projects[i].features.swapAt(j, k)
    }

    /// <output folder>/<project>/<feature>.mp4
    func outputURL(for feature: Feature, projectName: String) -> URL {
        outputFolder
            .appendingPathComponent(slugify(projectName), isDirectory: true)
            .appendingPathComponent(slugify(feature.name) + ".mp4")
    }
}
