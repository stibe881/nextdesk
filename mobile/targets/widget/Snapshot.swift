import Foundation
import WidgetKit

/// Shared with the app through the App Group (see app.config.ts).
let nextDeskAppGroup = "group.ch.grossict.nextdesk"
/// Key written by lib/widget-publisher.ios.ts.
let nextDeskSnapshotKey = "widgetSnapshot"
/// Own tickets due within this window count as SLA warning (lib/widget-snapshot.ts).
let slaWarningWindow: TimeInterval = 4 * 60 * 60
let nextDeskScheme = "ch.grossict.nextdesk"

/// Mirrors `WidgetSnapshot` in lib/widget-snapshot.ts. Contains no tokens.
struct WidgetPriority: Codable, Hashable, Identifiable {
  let id: String
  let ticketNumber: String
  let subject: String
  let reason: String?
}

struct WidgetSnapshot: Codable {
  let version: Int
  let updatedAt: String
  let tenantId: String
  let priorities: [WidgetPriority]?
  let slaDueAt: [String]?
  let approvals: Int?

  var updatedDate: Date? { parseISODate(updatedAt) }
  var dueDates: [Date]? { slaDueAt?.compactMap(parseISODate) }

  /// Overdue or due within four hours at `date`; nil while unknown.
  func slaWarnings(at date: Date) -> Int? {
    guard let dueDates else { return nil }
    let limit = date.addingTimeInterval(slaWarningWindow)
    return dueDates.filter { $0 < limit }.count
  }

  func slaBreaches(at date: Date) -> Int? {
    guard let dueDates else { return nil }
    return dueDates.filter { $0 <= date }.count
  }

  static let preview = WidgetSnapshot(
    version: 1,
    updatedAt: ISO8601DateFormatter().string(from: Date()),
    tenantId: "preview",
    priorities: [
      WidgetPriority(id: "1", ticketNumber: "T-1042", subject: "Drucker im 2. OG druckt nicht", reason: "SLA läuft in 2 Stunden ab"),
      WidgetPriority(id: "2", ticketNumber: "T-1038", subject: "VPN-Zugang für neue Mitarbeiterin", reason: "Kunde wartet seit gestern"),
      WidgetPriority(id: "3", ticketNumber: "T-1031", subject: "Mailbox fast voll", reason: "Hohe Priorität"),
    ],
    slaDueAt: [ISO8601DateFormatter().string(from: Date().addingTimeInterval(2 * 60 * 60))],
    approvals: 2
  )
}

private let fractionalFormatter: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter
}()

private let plainFormatter = ISO8601DateFormatter()

func parseISODate(_ value: String) -> Date? {
  fractionalFormatter.date(from: value) ?? plainFormatter.date(from: value)
}

func loadSnapshot() -> WidgetSnapshot? {
  guard
    let raw = UserDefaults(suiteName: nextDeskAppGroup)?.string(forKey: nextDeskSnapshotKey),
    let data = raw.data(using: .utf8),
    let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
    snapshot.version == 1
  else { return nil }
  return snapshot
}

/// «Stand 14:05», or «Stand 06.11. 14:05» when it is not from today.
func standLabel(_ snapshot: WidgetSnapshot?, now: Date) -> String {
  guard let date = snapshot?.updatedDate else { return "Öffne nextDesk" }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "de_CH")
  formatter.dateFormat = Calendar.current.isDate(date, inSameDayAs: now) ? "HH:mm" : "dd.MM. HH:mm"
  return "Stand \(formatter.string(from: date))"
}

func ticketURL(_ id: String) -> URL {
  let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
  return URL(string: "\(nextDeskScheme)://ticket/\(encoded)") ?? prioritiesURL
}

let prioritiesURL = URL(string: "\(nextDeskScheme)://priorities")!

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), snapshot: .preview)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    let stored = loadSnapshot()
    completion(SnapshotEntry(date: Date(), snapshot: stored ?? (context.isPreview ? .preview : nil)))
  }

  /// One entry now plus one at every moment the SLA count changes in the next
  /// hours, so the number stays right while the app is closed.
  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let now = Date()
    let snapshot = loadSnapshot()
    let horizon = now.addingTimeInterval(6 * 60 * 60)
    var dates: Set<Date> = [now]
    for due in snapshot?.dueDates ?? [] {
      for change in [due.addingTimeInterval(-slaWarningWindow), due] where change > now && change < horizon {
        dates.insert(change)
      }
    }
    let entries = dates.sorted().prefix(40).map { SnapshotEntry(date: $0, snapshot: snapshot) }
    completion(Timeline(entries: Array(entries), policy: .after(horizon)))
  }
}
