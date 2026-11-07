import Foundation
import Security
import WatchConnectivity
import WidgetKit

/// Zugang zu nextDesk für die Watch. Die Watch hat keine eigene Anmeldung:
/// Das iPhone schickt über WatchConnectivity ein kurzlebiges Zugriffstoken und
/// liefert auf Anfrage ein frisches. So entstehen keine zweiten Refresh-Tokens,
/// die mit der Sitzung auf dem iPhone in Konflikt geraten könnten.
struct Credentials: Codable, Equatable, Sendable {
  var accessToken: String
  var expiresAt: Date
  var supabaseUrl: String
  var anonKey: String
  var tenantId: String
  var tenantName: String
  var userId: String
}

enum WatchError: LocalizedError {
  case phoneUnreachable
  case signedOut
  case server(String)

  var errorDescription: String? {
    switch self {
    case .phoneUnreachable:
      return "Öffne nextDesk auf dem iPhone und halte es in der Nähe."
    case .signedOut:
      return "Melde dich auf dem iPhone in der nextDesk-App an."
    case .server(let message):
      return message
    }
  }
}

/// Inhalt einer Nachricht vom iPhone, schon ausgewertet (sendbar zwischen Threads).
enum ContextUpdate: Sendable {
  case credentials(Credentials)
  case signedOut
  case none
}

@MainActor
final class SessionStore: NSObject, ObservableObject {
  static let shared = SessionStore()

  @Published private(set) var credentials: Credentials?
  @Published private(set) var phoneReachable = false

  private static let keychainAccount = "nextdesk.watch.credentials"

  override init() {
    super.init()
    credentials = Keychain.load(account: Self.keychainAccount)
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  var isSignedIn: Bool { credentials != nil }

  /// Gültiges Token; holt bei Bedarf ein frisches vom iPhone.
  func validCredentials() async throws -> Credentials {
    if let current = credentials, current.expiresAt.timeIntervalSinceNow > 90 {
      return current
    }
    return try await refreshFromPhone()
  }

  func refreshFromPhone() async throws -> Credentials {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      throw WatchError.phoneUnreachable
    }
    let update: ContextUpdate = try await withCheckedThrowingContinuation {
      continuation in
      session.sendMessage(
        ["type": "nextdesk.token"],
        replyHandler: { reply in
          continuation.resume(returning: SessionStore.parse(reply))
        },
        errorHandler: { _ in
          continuation.resume(throwing: WatchError.phoneUnreachable)
        })
    }
    apply(update)
    guard let fresh = credentials else { throw WatchError.signedOut }
    return fresh
  }

  func apply(_ update: ContextUpdate) {
    switch update {
    case .credentials(let value):
      credentials = value
      Keychain.save(value, account: Self.keychainAccount)
    case .signedOut:
      credentials = nil
      Keychain.delete(account: Self.keychainAccount)
      WatchSummary.clear()
    case .none:
      break
    }
  }

  /// Wertet den Inhalt einer Nachricht vom iPhone aus.
  nonisolated static func parse(_ context: [String: Any]) -> ContextUpdate {
    if context["signedOut"] as? Bool == true { return .signedOut }
    guard
      let token = context["accessToken"] as? String,
      let expiresAt = context["expiresAt"] as? Double,
      let url = context["supabaseUrl"] as? String,
      let anonKey = context["anonKey"] as? String,
      let tenantId = context["tenantId"] as? String,
      let userId = context["userId"] as? String
    else { return .none }
    return .credentials(
      Credentials(
        accessToken: token,
        expiresAt: Date(timeIntervalSince1970: expiresAt),
        supabaseUrl: url,
        anonKey: anonKey,
        tenantId: tenantId,
        tenantName: context["tenantName"] as? String ?? "",
        userId: userId))
  }
}

extension SessionStore: WCSessionDelegate {
  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    let update = SessionStore.parse(session.receivedApplicationContext)
    let reachable = session.isReachable
    Task { @MainActor in
      self.phoneReachable = reachable
      self.apply(update)
    }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    let update = SessionStore.parse(applicationContext)
    Task { @MainActor in self.apply(update) }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    Task { @MainActor in self.phoneReachable = reachable }
  }
}

/// Zugangsdaten im Schlüsselbund der Watch (nur auf diesem Gerät).
enum Keychain {
  private static let service = "ch.grossict.nextdesk.watch"

  static func save<T: Encodable>(_ value: T, account: String) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    delete(account: account)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: data,
    ]
    SecItemAdd(query as CFDictionary, nil)
  }

  static func load<T: Decodable>(account: String) -> T? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  static func delete(account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}

/// Anzeigewerte für die Komplikation (App Group, ohne Token).
enum WatchSummary {
  static let appGroup = "group.ch.grossict.nextdesk.watch"

  static func save(myOpen: Int, unassigned: Int, overdueTasks: Int) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    defaults.set(myOpen, forKey: "myOpen")
    defaults.set(unassigned, forKey: "unassigned")
    defaults.set(overdueTasks, forKey: "overdueTasks")
    defaults.set(Date().timeIntervalSince1970, forKey: "updatedAt")
    WidgetCenter.shared.reloadAllTimelines()
  }

  static func clear() {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    for key in ["myOpen", "unassigned", "overdueTasks", "updatedAt"] {
      defaults.removeObject(forKey: key)
    }
    WidgetCenter.shared.reloadAllTimelines()
  }
}
