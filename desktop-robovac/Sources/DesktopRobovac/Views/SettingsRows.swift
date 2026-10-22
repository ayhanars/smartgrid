import SwiftUI
import RobovacCore

// Row building blocks for the Settings window, after the Claude Design handoff:
// uppercase section headers, white cards with hairline separators, 22 pt
// small buttons, 26 × 15 switches.

struct SettingsSection<Rows: View>: View {
    var title: String? = nil
    var aside: String? = nil
    var footnote: String? = nil
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                DSSectionHeader(title: title, value: aside, uppercase: true)
            }
            VStack(spacing: 0) { rows() }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .dsCard(ring: DS.dynamic(DS.rgba(0, 0, 0, 0.1), DS.rgba(255, 255, 255, 0.08)))
            if let footnote {
                Text(footnote).font(DS.caption).foregroundStyle(DS.secondary60).padding(.horizontal, 2)
            }
        }
    }
}

struct RowDivider: View {
    var body: some View {
        Rectangle().fill(DS.hairline).frame(height: 1).padding(.leading, 12)
    }
}

struct ToggleRow: View {
    let label: String
    var sub: String? = nil
    @Binding var isOn: Bool
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            Toggle(isOn: $isOn) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).fixedSize(horizontal: false, vertical: true)
                    if let sub { Text(sub).font(DS.caption).foregroundStyle(DS.secondary60).fixedSize(horizontal: false, vertical: true) }
                }
            }
            .toggleStyle(DSSwitchStyle())
            .padding(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            .frame(minHeight: 36)
        }
    }
}

struct RowAction: Identifiable {
    let id = UUID()
    let title: String
    let action: () -> Void
    var kind: DSSmallButtonStyle.Kind = .secondary
}

struct PathRow: View {
    let label: String
    let path: String
    var actions: [RowAction]
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        FolderIcon()
                        Text(path).font(DS.caption).foregroundStyle(DS.secondary60).lineLimit(1).truncationMode(.middle)
                    }
                }
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    ForEach(actions) { action in
                        Button(action.title, action: action.action).buttonStyle(DSSmallButtonStyle(kind: action.kind))
                    }
                }
            }
            .padding(EdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12))
            .frame(minHeight: 44)
        }
    }
}

struct FolderIcon: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous).fill(DS.folderBlue).frame(width: 12, height: 9)
    }
}

struct SliderRow: View {
    let label: String
    let valueText: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label)
                    Spacer()
                    Text(valueText).font(DS.small).monospacedDigit().foregroundStyle(DS.secondary60)
                }
                if let step {
                    Slider(value: $value, in: range, step: step).controlSize(.small)
                } else {
                    Slider(value: $value, in: range).controlSize(.small)
                }
            }
            .padding(EdgeInsets(top: 8, leading: 12, bottom: 10, trailing: 12))
        }
    }
}

struct PickerRow<T: Hashable>: View {
    let label: String
    let options: [T]
    let title: (T) -> String
    @Binding var selection: T
    var sub: String? = nil
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 12) {
                    Text(label)
                    Spacer()
                    Picker("", selection: $selection) {
                        ForEach(options, id: \.self) { option in
                            Text(title(option)).tag(option)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .controlSize(.small)
                    .fixedSize()
                }
                .frame(minHeight: 22)
                if let sub { Text(sub).font(DS.caption).foregroundStyle(DS.secondary60) }
            }
            .padding(EdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12))
        }
    }
}

struct SegmentedRow<T: Hashable>: View {
    let label: String
    let options: [T]
    let title: (T) -> String
    @Binding var selection: T
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            HStack(spacing: 12) {
                Text(label)
                Spacer()
                TextPillPicker(options: options, title: title, selection: $selection)
            }
            .padding(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            .frame(minHeight: 36)
        }
    }
}

/// Wrapping row of chips, as in the extensions and name-pattern editors.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 300
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

struct ChipsRow: View {
    let label: String
    let chips: [String]
    let placeholder: String
    let onAdd: (String) -> Void
    let onRemove: (Int) -> Void
    var first = false
    @State private var text = ""

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            VStack(alignment: .leading, spacing: 8) {
                Text(label)
                if !chips.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(Array(chips.enumerated()), id: \.offset) { index, chip in
                            HStack(spacing: 5) {
                                Text(chip).font(.system(size: 12, design: .monospaced))
                                Button { onRemove(index) } label: {
                                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                                        .frame(width: 14, height: 14)
                                        .background(Circle().fill(DS.chipClose))
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.leading, 9).padding(.trailing, 6)
                            .frame(height: 22)
                            .background(Capsule().fill(DS.chipFill))
                        }
                    }
                }
                HStack(spacing: 6) {
                    TextField(placeholder, text: $text)
                        .textFieldStyle(.plain)
                        .font(DS.small)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(DS.fieldFill))
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(DS.fieldRing, lineWidth: 0.5))
                        .onSubmit(add)
                    Button("Add", action: add).buttonStyle(DSSmallButtonStyle())
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(EdgeInsets(top: 8, leading: 12, bottom: 10, trailing: 12))
        }
    }

    private func add() {
        let value = text.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty else { return }
        onAdd(value)
        text = ""
    }
}

/// A selectable list of paths with actions underneath (Add…, Remove).
struct ListRow: View {
    let label: String
    let items: [String]
    let emptyText: String
    let onAdd: () -> Void
    let addTitle: String
    var onRemove: ((String) -> Void)? = nil
    var first = false
    @State private var selected: String?

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            VStack(alignment: .leading, spacing: 6) {
                Text(label)
                VStack(spacing: 0) {
                    if items.isEmpty {
                        HStack { Text(emptyText).font(DS.small).foregroundStyle(DS.tertiary); Spacer() }
                            .padding(.horizontal, 8).frame(height: 24)
                    }
                    ForEach(items, id: \.self) { item in
                        Button {
                            selected = selected == item ? nil : item
                        } label: {
                            HStack(spacing: 7) {
                                FolderIcon()
                                Text(item).font(DS.small).lineLimit(1).truncationMode(.middle)
                                Spacer()
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 24)
                            .background(selected == item ? DS.accent.opacity(0.18) : .clear)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(DS.fieldFill))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(DS.fieldRing, lineWidth: 0.5))
                HStack(spacing: 6) {
                    Button(addTitle, action: onAdd).buttonStyle(DSSmallButtonStyle())
                    if let onRemove {
                        Button("Remove") {
                            if let selected { onRemove(selected) }
                            selected = nil
                        }
                        .buttonStyle(DSSmallButtonStyle())
                        .disabled(selected == nil)
                    }
                }
            }
            .padding(EdgeInsets(top: 8, leading: 12, bottom: 10, trailing: 12))
        }
    }
}

struct CategoryRow: View {
    let category: FileCategory
    @Binding var isOn: Bool
    let folder: String?
    let onChoose: () -> Void
    let onUseDefault: () -> Void
    var first = false

    static func tint(for category: FileCategory) -> Color {
        switch category {
        case .screenshot: return Color(nsColor: DS.hex(0x5AC8FA))
        case .image: return Color(nsColor: DS.hex(0xFF9F0A))
        case .pdf: return Color(nsColor: DS.hex(0xFF453A))
        case .document: return Color(nsColor: DS.hex(0x5E5CE6))
        case .video: return Color(nsColor: DS.hex(0xBF5AF2))
        case .audio: return Color(nsColor: DS.hex(0xFF375F))
        case .archive: return Color(nsColor: DS.hex(0xA2845E))
        case .other: return Color(nsColor: DS.hex(0x8E8E93))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            HStack(spacing: 10) {
                Button { withAnimation(.easeInOut(duration: 0.2)) { isOn.toggle() } } label: { DSSwitchKnob(isOn: isOn) }
                    .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 7) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous).fill(CategoryRow.tint(for: category)).frame(width: 8, height: 8)
                        Text(category.displayName)
                    }
                    Text(folder ?? "Default destination").font(DS.caption).foregroundStyle(DS.secondary60).lineLimit(1).truncationMode(.middle)
                }
                .opacity(isOn ? 1 : 0.45)
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    Button("Choose Folder…", action: onChoose).buttonStyle(DSSmallButtonStyle())
                    Button("Use Default", action: onUseDefault).buttonStyle(DSSmallButtonStyle()).opacity(folder == nil ? 0.45 : 1).disabled(folder == nil)
                }
            }
            .padding(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            .frame(minHeight: 44)
        }
    }
}

struct SoundRow: View {
    let label: String
    @Binding var isOn: Bool
    let onPlay: () -> Void
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            HStack(spacing: 10) {
                Button { withAnimation(.easeInOut(duration: 0.2)) { isOn.toggle() } } label: { DSSwitchKnob(isOn: isOn) }
                    .buttonStyle(.plain)
                Text(label)
                Spacer()
                Button(action: onPlay) { Label("Play", systemImage: "play.fill") }
                    .buttonStyle(DSSmallButtonStyle())
                    .disabled(!isOn)
            }
            .padding(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            .frame(minHeight: 36)
        }
    }
}

struct NoteRow: View {
    let text: String
    let button: String
    let action: () -> Void
    var first = false

    var body: some View {
        VStack(spacing: 0) {
            if !first { RowDivider() }
            HStack(spacing: 12) {
                Text(text).font(DS.small).foregroundStyle(DS.secondary70).frame(maxWidth: 300, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button(button, action: action).buttonStyle(DSSmallButtonStyle())
            }
            .padding(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            .frame(minHeight: 44)
        }
    }
}
