import SwiftUI
import WatchKit

@main
struct NextDeskWatchApp: App {
  @StateObject private var session = SessionStore.shared

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(session)
    }
    // Hält die Komplikation aktuell, auch wenn die App nicht geöffnet ist.
    .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
      await BackgroundRefresh.run()
    }
  }
}

enum BackgroundRefresh {
  static let identifier = "nextdesk.summary"

  @MainActor
  static func schedule() {
    WKApplication.shared().scheduleBackgroundRefresh(
      withPreferredDate: Date().addingTimeInterval(30 * 60),
      userInfo: identifier as NSString
    ) { _ in }
  }

  @MainActor
  static func run() async {
    await NextDeskAPI().refreshSummary()
    schedule()
  }
}

struct RootView: View {
  @EnvironmentObject private var session: SessionStore
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    NavigationStack {
      if session.isSignedIn {
        HomeView()
      } else {
        SignedOutView()
      }
    }
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      Task { await NextDeskAPI().refreshSummary() }
      BackgroundRefresh.schedule()
    }
  }
}

struct SignedOutView: View {
  @EnvironmentObject private var session: SessionStore
  @State private var message: String?
  @State private var busy = false

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        Image(systemName: "iphone")
          .font(.title)
          .foregroundStyle(.tint)
        Text("Öffne nextDesk auf dem iPhone und melde dich an.")
          .multilineTextAlignment(.center)
        if let message {
          Text(message)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        Button(busy ? "Verbinde …" : "Mit iPhone verbinden") {
          busy = true
          Task {
            do {
              _ = try await session.refreshFromPhone()
              message = nil
            } catch {
              message = error.localizedDescription
            }
            busy = false
          }
        }
        .disabled(busy)
      }
      .padding(.vertical)
    }
    .navigationTitle("nextDesk")
  }
}

struct HomeView: View {
  @EnvironmentObject private var session: SessionStore

  var body: some View {
    List {
      NavigationLink {
        NewTicketView()
      } label: {
        Label("Ticket erfassen", systemImage: "plus.bubble")
      }
      NavigationLink {
        TicketListView(kind: .mine)
      } label: {
        Label("Meine Tickets", systemImage: "person.crop.circle")
      }
      NavigationLink {
        TicketListView(kind: .unassigned)
      } label: {
        Label("Nicht zugewiesen", systemImage: "tray")
      }
      NavigationLink {
        FollowUpsView()
      } label: {
        Label("Wiedervorlagen", systemImage: "calendar.badge.clock")
      }
      NavigationLink {
        ServiceTasksView()
      } label: {
        Label("Serviceaufgaben", systemImage: "checklist")
      }
      if let tenant = session.credentials?.tenantName, !tenant.isEmpty {
        Text(tenant)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .listRowBackground(Color.clear)
      }
    }
    .navigationTitle("nextDesk")
  }
}

// MARK: - Gemeinsame Bausteine

enum Loadable<Value> {
  case loading
  case loaded(Value)
  case failed(String)
}

struct ErrorView: View {
  let message: String
  let retry: () async -> Void

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: "exclamationmark.triangle")
          .foregroundStyle(.orange)
        Text(message)
          .font(.footnote)
          .multilineTextAlignment(.center)
        Button("Erneut versuchen") {
          Task { await retry() }
        }
      }
    }
  }
}

/// Zeigt kurz eine Rückmeldung nach einer Aktion.
struct Feedback: Equatable {
  let text: String
  let isError: Bool
}

extension View {
  func feedbackBanner(_ feedback: Binding<Feedback?>) -> some View {
    overlay(alignment: .bottom) {
      if let value = feedback.wrappedValue {
        Text(value.text)
          .font(.footnote)
          .padding(8)
          .frame(maxWidth: .infinity)
          .background(
            value.isError ? Color.red.opacity(0.85) : Color.green.opacity(0.85),
            in: RoundedRectangle(cornerRadius: 10))
          .onTapGesture { feedback.wrappedValue = nil }
          .task {
            try? await Task.sleep(for: .seconds(3))
            feedback.wrappedValue = nil
          }
      }
    }
  }
}

extension Date {
  var shortLabel: String {
    formatted(.dateTime.day().month().hour().minute())
  }
}
