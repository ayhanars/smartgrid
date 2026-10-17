import SwiftUI

/// Large numeric keypad shared by PIN entry and PIN setup.
struct PINPadView: View {
    let title: String
    var subtitle: String?
    @Binding var entry: String
    var submitLabel = "Unlock"
    var isDisabled = false
    var onSubmit: (String) -> Void

    private let rows: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["", "0", "delete"],
    ]

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text(title)
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            HStack(spacing: 14) {
                ForEach(0..<PINManager.maxLength, id: \.self) { index in
                    Circle()
                        .strokeBorder(Color.primary.opacity(0.6), lineWidth: 1.5)
                        .background(Circle().fill(index < entry.count ? Color.primary : Color.clear))
                        .frame(width: 16, height: 16)
                }
            }
            .accessibilityLabel("\(entry.count) of up to \(PINManager.maxLength) digits entered")

            VStack(spacing: 12) {
                ForEach(rows, id: \.self) { row in
                    HStack(spacing: 12) {
                        ForEach(row, id: \.self) { key in
                            keyButton(key)
                        }
                    }
                }
            }

            Button(submitLabel) { onSubmit(entry) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(entry.count < PINManager.minLength || isDisabled)
        }
    }

    @ViewBuilder
    private func keyButton(_ key: String) -> some View {
        if key.isEmpty {
            Color.clear.frame(width: 76, height: 76)
        } else {
            Button {
                tap(key)
            } label: {
                Group {
                    if key == "delete" {
                        Image(systemName: "delete.left")
                    } else {
                        Text(key)
                    }
                }
                .font(.title.weight(.medium))
                .frame(width: 76, height: 76)
                .background(Circle().fill(Color(.secondarySystemFill)))
            }
            .buttonStyle(.plain)
            .disabled(isDisabled)
            .accessibilityLabel(key == "delete" ? "Delete" : key)
        }
    }

    private func tap(_ key: String) {
        if key == "delete" {
            if !entry.isEmpty { entry.removeLast() }
        } else if entry.count < PINManager.maxLength {
            entry.append(key)
        }
    }
}
