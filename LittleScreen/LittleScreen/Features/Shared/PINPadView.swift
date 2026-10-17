import SwiftUI
import UIKit

/// Large numeric keypad shared by PIN entry and PIN setup.
struct PINPadView: View {
    let title: String
    var subtitle: String?
    @Binding var entry: String
    var submitLabel = "Unlock"
    var isDisabled = false
    /// Increment to wobble the dots (wrong PIN).
    var shakeTrigger = 0
    var onSubmit: (String) -> Void

    private let rows: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["", "0", "delete"],
    ]

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text(title)
                    .font(AppFont.parent(26, .extrabold, relativeTo: .title2))
                    .multilineTextAlignment(.center)
                if let subtitle {
                    Text(subtitle)
                        .font(AppFont.parent(15, .regular, relativeTo: .subheadline))
                        .foregroundStyle(ParentTheme.secondaryText)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
            }

            HStack(spacing: 16) {
                ForEach(0..<PINManager.maxLength, id: \.self) { index in
                    let filled = index < entry.count
                    Circle()
                        .strokeBorder(ParentTheme.accent.opacity(filled ? 0 : 0.5), lineWidth: 2)
                        .background(Circle().fill(filled ? ParentTheme.accent : Color.clear))
                        .frame(width: 18, height: 18)
                        .scaleEffect(filled ? 1.15 : 1)
                        .animation(.spring(response: 0.25, dampingFraction: 0.6), value: filled)
                }
            }
            .padding(.vertical, 4)
            .modifier(ShakeEffect(animatableData: CGFloat(shakeTrigger)))
            .animation(.linear(duration: 0.4), value: shakeTrigger)
            .accessibilityLabel("\(entry.count) of up to \(PINManager.maxLength) digits entered")

            VStack(spacing: 14) {
                ForEach(rows, id: \.self) { row in
                    HStack(spacing: 18) {
                        ForEach(row, id: \.self) { key in
                            keyButton(key)
                        }
                    }
                }
            }

            Button {
                onSubmit(entry)
            } label: {
                Text(submitLabel)
                    .font(AppFont.parent(17, .extrabold, relativeTo: .headline))
                    .foregroundStyle(.white)
                    .frame(width: 260, height: 50)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(ParentTheme.accent))
            }
            .buttonStyle(TileButtonStyle())
            .disabled(entry.count < PINManager.minLength || isDisabled)
            .opacity(entry.count < PINManager.minLength || isDisabled ? 0.45 : 1)
            .padding(.top, 4)
        }
    }

    @ViewBuilder
    private func keyButton(_ key: String) -> some View {
        if key.isEmpty {
            Color.clear.frame(width: 78, height: 78)
        } else {
            Button {
                tap(key)
            } label: {
                Group {
                    if key == "delete" {
                        Image(systemName: "delete.left.fill")
                            .font(.system(size: 26, weight: .semibold))
                    } else {
                        Text(key)
                            .font(AppFont.parent(32, .semibold))
                    }
                }
                .frame(width: 78, height: 78)
                .background(
                    Circle()
                        .fill(key == "delete" ? Color.clear : ParentTheme.card)
                        .shadow(color: .black.opacity(key == "delete" ? 0 : 0.08), radius: 7, y: 4)
                )
                .foregroundStyle(key == "delete" ? ParentTheme.secondaryText : Color.primary)
            }
            .buttonStyle(TileButtonStyle())
            .disabled(isDisabled)
            .opacity(isDisabled ? 0.4 : 1)
            .accessibilityLabel(key == "delete" ? "Delete" : key)
        }
    }

    private func tap(_ key: String) {
        if key == "delete" {
            if !entry.isEmpty { entry.removeLast() }
        } else if entry.count < PINManager.maxLength {
            entry.append(key)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
