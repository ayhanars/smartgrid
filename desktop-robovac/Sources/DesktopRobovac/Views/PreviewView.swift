import SwiftUI
import RobovacCore

/// What the robot is about to do: eligible files, exclusions, destinations.
struct PreviewView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            summaryHeader
                .padding()
            Divider()
            if let plan = app.plan {
                List {
                    eligibleSection(plan)
                    destinationSection(plan)
                    excludedSection(plan)
                }
                .listStyle(.inset)
            } else {
                ContentUnavailableView(
                    app.scanProblem?.message ?? "Scanning the Desktop…",
                    systemImage: app.scanProblem == nil ? "magnifyingglass" : "exclamationmark.triangle"
                )
            }
            Divider()
            footer
                .padding()
        }
        .frame(minWidth: 520, minHeight: 560)
        .background(BringToFront())
        .onAppear {
            app.markPreviewSeen()
            Task { await app.refreshPlan() }
        }
    }

    private var summaryHeader: some View {
        HStack(alignment: .top, spacing: 14) {
            RobotBadgeView(state: .idle, size: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text("Cleaning Preview").font(.title2.bold())
                if let plan = app.plan {
                    Text("\(plan.targets.count) item\(plan.targets.count == 1 ? "" : "s") will be moved · \(plan.excluded.count) left alone · \(plan.configuration.mode.displayName)")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Looking at \(app.desktopURL.path)").foregroundStyle(.secondary)
                }
                Text("Files are moved, never deleted. Every run can be undone from the menu bar.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private func eligibleSection(_ plan: CleaningPlan) -> some View {
        Section {
            if plan.targets.isEmpty {
                Text("Nothing eligible right now. Spotless!").foregroundStyle(.secondary)
            }
            ForEach(FileCategory.allCases) { category in
                let targets = plan.targets.filter { $0.category == category }
                if !targets.isEmpty {
                    DisclosureGroup {
                        ForEach(targets) { target in
                            HStack {
                                Text(target.item.name).lineLimit(1).truncationMode(.middle)
                                Spacer()
                                Text(target.destinationDirectory.lastPathComponent)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } label: {
                        Label("\(category.displayName) (\(targets.count))", systemImage: category.symbolName)
                    }
                }
            }
        } header: {
            Text("Will be moved (\(plan.targets.count))")
        }
    }

    private func destinationSection(_ plan: CleaningPlan) -> some View {
        Section("Destinations") {
            if plan.destinationDirectories.isEmpty {
                Text(plan.configuration.destinations.defaultDestination.path).foregroundStyle(.secondary)
            }
            ForEach(plan.destinationDirectories, id: \.path) { url in
                HStack {
                    Image(systemName: "folder")
                    Text(url.path).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("Show") { SystemLinks.reveal(url) }
                        .controlSize(.small)
                }
            }
        }
    }

    private func excludedSection(_ plan: CleaningPlan) -> some View {
        Section("Left alone (\(plan.excluded.count))") {
            if plan.excluded.isEmpty {
                Text("No exclusions apply.").foregroundStyle(.secondary)
            }
            ForEach(plan.excluded) { decision in
                HStack {
                    Image(systemName: decision.item.isDirectory ? "folder" : decision.category.symbolName)
                        .foregroundStyle(.secondary)
                    Text(decision.item.name).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text(decision.exclusionReason?.description ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Toggle("Show this preview before every run", isOn: $app.settings.general.previewBeforeEveryRun)
                .toggleStyle(.checkbox)
            Spacer()
            Button("Cancel") { dismissWindow(id: WindowID.preview) }
                .keyboardShortcut(.cancelAction)
            Button("Start Cleaning") {
                app.startCleaning()
                dismissWindow(id: WindowID.preview)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(app.isBusy || app.eligibleCount == 0)
        }
    }
}
