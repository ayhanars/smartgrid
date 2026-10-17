import Foundation
import Security

/// Small key/value secret storage. The app uses the Keychain; tests use memory.
protocol SecretStore {
    func data(for key: String) throws -> Data?
    func set(_ data: Data, for key: String) throws
    func remove(_ key: String) throws
}

enum KeychainError: LocalizedError {
    case status(OSStatus)

    var errorDescription: String? {
        switch self {
        case .status(let status):
            let message = SecCopyErrorMessageString(status, nil) as String? ?? "code \(status)"
            return "Keychain error: \(message)"
        }
    }
}

/// Generic-password Keychain items scoped to this app and device. Items are
/// readable after the first unlock so the PIN check works even if the parent
/// area is opened while the device has been locked since boot.
struct KeychainStore: SecretStore {
    var service = "com.example.littlescreen"

    func data(for key: String) throws -> Data? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
        return result as? Data
    }

    func set(_ data: Data, for key: String) throws {
        let query = baseQuery(for: key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            for (attributeKey, value) in attributes {
                insert[attributeKey] = value
            }
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    func remove(_ key: String) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}

/// Non-persistent store for unit tests and previews.
final class InMemorySecretStore: SecretStore {
    private var storage: [String: Data] = [:]

    init() {}

    func data(for key: String) throws -> Data? { storage[key] }
    func set(_ data: Data, for key: String) throws { storage[key] = data }
    func remove(_ key: String) throws { storage[key] = nil }
}
