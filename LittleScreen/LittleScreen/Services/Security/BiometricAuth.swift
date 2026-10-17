import Foundation
import LocalAuthentication

/// Optional Face ID / Touch ID shortcut into the parent area. The PIN always
/// remains available; biometrics only add convenience, never replace it.
enum BiometricAuth {
    static var displayName: String? {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return nil
        }
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return nil
        @unknown default: return nil
        }
    }

    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        // Hide the "Enter Password" fallback: the app's own PIN is the fallback,
        // not the device passcode a child may have watched being typed.
        context.localizedFallbackTitle = ""
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch {
            return false
        }
    }
}
