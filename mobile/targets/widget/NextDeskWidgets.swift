import SwiftUI
import WidgetKit

@main
struct NextDeskWidgetBundle: WidgetBundle {
  var body: some Widget {
    PrioritiesWidget()
    CountersWidget()
  }
}

// MARK: - Colours (generated from expo-target.config.js)

extension Color {
  static let ndAccent = Color("$accent")
  static let ndBackground = Color("$widgetBackground")
  static let ndSurface = Color("WidgetSurface")
  static let ndForeground = Color("WidgetForeground")
  static let ndMuted = Color("WidgetMuted")
  static let ndWarning = Color("WidgetWarning")
  static let ndDanger = Color("WidgetDanger")
}

extension View {
  /// iOS 17 needs containerBackground; older systems get padding + background.
  @ViewBuilder
  func nextDeskBackground() -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(Color.ndBackground, for: .widget)
    } else {
      padding().background(Color.ndBackground)
    }
  }
}

// MARK: - «Meine Prioritäten»

struct PrioritiesWidget: Widget {
  let kind = "NextDeskPriorities"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
      PrioritiesView(entry: entry)
    }
    .configurationDisplayName("Meine Prioritäten")
    .description("Deine drei wichtigsten Tickets mit SLA-Warnungen und offenen Freigaben.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

struct PrioritiesView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  var body: some View {
    VStack(alignment: .leading, spacing: family == .systemLarge ? 8 : 5) {
      HStack(alignment: .firstTextBaseline) {
        Label("Meine Prioritäten", systemImage: "sparkles")
          .font(.caption.weight(.bold))
          .foregroundColor(.ndAccent)
        Spacer(minLength: 4)
        Text(standLabel(entry.snapshot, now: entry.date))
          .font(.caption2)
          .foregroundColor(.ndMuted)
      }
      content
      Spacer(minLength: 0)
      CountersLine(snapshot: entry.snapshot, date: entry.date, large: family == .systemLarge)
    }
    .widgetURL(prioritiesURL)
    .nextDeskBackground()
  }

  @ViewBuilder
  private var content: some View {
    if let snapshot = entry.snapshot {
      if let items = snapshot.priorities {
        if items.isEmpty {
          hint("Dir sind gerade keine offenen Tickets zugewiesen.")
        } else {
          ForEach(items.prefix(3)) { item in
            Link(destination: ticketURL(item.id)) {
              PriorityRow(item: item, large: family == .systemLarge)
            }
          }
        }
      } else {
        hint("Öffne «Meine Prioritäten» in der App, um das Widget zu füllen.")
      }
    } else {
      hint("Öffne nextDesk und melde dich an, damit hier deine Prioritäten erscheinen.")
    }
  }

  private func hint(_ text: String) -> some View {
    Text(text)
      .font(.caption)
      .foregroundColor(.ndMuted)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct PriorityRow: View {
  let item: WidgetPriority
  let large: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(spacing: 4) {
        Text(item.ticketNumber)
          .font(.caption2.weight(.bold))
          .foregroundColor(.ndAccent)
        Text(item.subject)
          .font(.caption.weight(.semibold))
          .foregroundColor(.ndForeground)
          .lineLimit(1)
          .privacySensitive()
      }
      Text(item.reason ?? "Ohne Begründung")
        .font(.caption2)
        .foregroundColor(.ndMuted)
        .lineLimit(large ? 2 : 1)
        .privacySensitive()
    }
    .padding(.horizontal, 8)
    .padding(.vertical, large ? 6 : 3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.ndSurface)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}

struct CountersLine: View {
  let snapshot: WidgetSnapshot?
  let date: Date
  let large: Bool

  var body: some View {
    let warnings = snapshot?.slaWarnings(at: date)
    let approvals = snapshot?.approvals
    HStack(spacing: 10) {
      Label(
        "SLA-Warnungen: \(warnings.map(String.init) ?? "–")",
        systemImage: "exclamationmark.triangle.fill"
      )
      .foregroundColor((warnings ?? 0) > 0 ? .ndDanger : .ndMuted)
      Label("Freigaben: \(approvals.map(String.init) ?? "–")", systemImage: "checkmark.seal")
        .foregroundColor((approvals ?? 0) > 0 ? .ndWarning : .ndMuted)
    }
    .font(large ? .caption : .caption2)
    .lineLimit(1)
  }
}

// MARK: - SLA-Warnungen und Freigaben

struct CountersWidget: Widget {
  let kind = "NextDeskCounters"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
      CountersView(entry: entry)
    }
    .configurationDisplayName("SLA & Freigaben")
    .description("Deine SLA-Warnungen (fällig in unter 4 Stunden) und offenen Freigaben.")
    .supportedFamilies([.systemSmall, .accessoryRectangular])
  }
}

struct CountersView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  private var warnings: Int? { entry.snapshot?.slaWarnings(at: entry.date) }
  private var breaches: Int { entry.snapshot?.slaBreaches(at: entry.date) ?? 0 }
  private var approvals: Int? { entry.snapshot?.approvals }

  var body: some View {
    if family == .accessoryRectangular {
      VStack(alignment: .leading, spacing: 1) {
        Text("nextDesk").font(.headline)
        Text("SLA-Warnungen: \(warnings.map(String.init) ?? "–")")
        Text("Freigaben: \(approvals.map(String.init) ?? "–")")
      }
      .font(.caption)
      .widgetURL(prioritiesURL)
      .nextDeskAccessoryBackground()
    } else {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text("nextDesk")
            .font(.caption.weight(.bold))
            .foregroundColor(.ndAccent)
          Spacer(minLength: 2)
        }
        CounterTile(
          title: "SLA-Warnungen",
          value: warnings,
          hint: breaches > 0 ? "\(breaches) überfällig" : "fällig < 4 h",
          tint: (warnings ?? 0) > 0 ? .ndDanger : .ndForeground
        )
        CounterTile(
          title: "Freigaben",
          value: approvals,
          hint: "warten auf dich",
          tint: (approvals ?? 0) > 0 ? .ndWarning : .ndForeground
        )
        Text(standLabel(entry.snapshot, now: entry.date))
          .font(.caption2)
          .foregroundColor(.ndMuted)
      }
      .widgetURL(prioritiesURL)
      .nextDeskBackground()
    }
  }
}

struct CounterTile: View {
  let title: String
  let value: Int?
  let hint: String
  let tint: Color

  var body: some View {
    HStack(alignment: .center, spacing: 6) {
      Text(value.map(String.init) ?? "–")
        .font(.title2.weight(.bold))
        .foregroundColor(tint)
        .minimumScaleFactor(0.6)
      VStack(alignment: .leading, spacing: 0) {
        Text(title).font(.caption2.weight(.semibold)).foregroundColor(.ndForeground)
        Text(hint).font(.caption2).foregroundColor(.ndMuted)
      }
      .lineLimit(1)
      Spacer(minLength: 0)
    }
  }
}

extension View {
  @ViewBuilder
  func nextDeskAccessoryBackground() -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(.clear, for: .widget)
    } else {
      self
    }
  }
}
