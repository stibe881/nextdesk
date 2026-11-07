import SwiftUI
import WidgetKit

/// Komplikation: zeigt die Zahlen, die die Watch-App zuletzt geladen hat
/// (App Group, ohne Token). Tippen öffnet die Watch-App.
struct SummaryEntry: TimelineEntry {
  let date: Date
  let myOpen: Int?
  let unassigned: Int?
  let overdueTasks: Int?
}

struct SummaryProvider: TimelineProvider {
  private static let appGroup = "group.ch.grossict.nextdesk.watch"

  func placeholder(in context: Context) -> SummaryEntry {
    SummaryEntry(date: Date(), myOpen: 3, unassigned: 1, overdueTasks: 0)
  }

  func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : load())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
    completion(
      Timeline(entries: [load()], policy: .after(Date().addingTimeInterval(30 * 60))))
  }

  private func load() -> SummaryEntry {
    guard let defaults = UserDefaults(suiteName: Self.appGroup),
      defaults.object(forKey: "updatedAt") != nil
    else {
      return SummaryEntry(date: Date(), myOpen: nil, unassigned: nil, overdueTasks: nil)
    }
    return SummaryEntry(
      date: Date(),
      myOpen: defaults.integer(forKey: "myOpen"),
      unassigned: defaults.integer(forKey: "unassigned"),
      overdueTasks: defaults.integer(forKey: "overdueTasks"))
  }
}

struct ComplicationView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SummaryEntry

  private var count: String { entry.myOpen.map(String.init) ?? "–" }

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Image(systemName: "ticket")
            .font(.caption2)
          Text(count)
            .font(.headline)
        }
      }
    case .accessoryCorner:
      Image(systemName: "ticket")
        .widgetLabel {
          Text("\(count) offen")
        }
    case .accessoryInline:
      Text(entry.myOpen == nil ? "nextDesk" : "\(count) offene Tickets")
    default:
      VStack(alignment: .leading, spacing: 1) {
        Text("nextDesk")
          .font(.headline)
          .widgetAccentable()
        if entry.myOpen == nil {
          Text("App öffnen zum Laden")
            .font(.caption2)
        } else {
          Text("Meine offen: \(count)")
            .font(.caption2)
          Text("Nicht zugewiesen: \(entry.unassigned ?? 0)")
            .font(.caption2)
          if let overdue = entry.overdueTasks, overdue > 0 {
            Text("Aufgaben überfällig: \(overdue)")
              .font(.caption2)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

@main
struct NextDeskComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "nextDeskSummary", provider: SummaryProvider()) { entry in
      ComplicationView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("nextDesk")
    .description("Meine offenen Tickets auf dem Zifferblatt.")
    .supportedFamilies([
      .accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner,
    ])
  }
}
