import SwiftUI

struct TicketListView: View {
  enum Kind { case mine, unassigned }
  let kind: Kind

  @State private var state: Loadable<[TicketRow]> = .loading

  var body: some View {
    Group {
      switch state {
      case .loading:
        ProgressView()
      case .failed(let message):
        ErrorView(message: message) { await load() }
      case .loaded(let rows) where rows.isEmpty:
        Text(kind == .mine ? "Keine offenen Tickets." : "Alles zugewiesen.")
          .foregroundStyle(.secondary)
      case .loaded(let rows):
        List(rows) { row in
          NavigationLink {
            TicketDetailView(ticketId: row.id, number: row.number)
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(row.subject).font(.headline).lineLimit(2)
              Text([row.number, row.status].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
          }
        }
      }
    }
    .navigationTitle(kind == .mine ? "Meine Tickets" : "Nicht zugewiesen")
    .task { await load() }
  }

  private func load() async {
    do {
      let api = NextDeskAPI()
      let rows: [TicketRow]
      if kind == .mine {
        rows = try await api.myTickets()
      } else {
        rows = try await api.unassignedTickets()
      }
      state = .loaded(rows)
    } catch {
      state = .failed(error.localizedDescription)
    }
  }
}

struct TicketDetailView: View {
  let ticketId: String
  let number: String

  @State private var state: Loadable<TicketDetail> = .loading
  @State private var busy = false
  @State private var feedback: Feedback?

  var body: some View {
    Group {
      switch state {
      case .loading:
        ProgressView()
      case .failed(let message):
        ErrorView(message: message) { await load() }
      case .loaded(let ticket):
        content(ticket)
      }
    }
    .navigationTitle(number)
    .task { await load() }
    .feedbackBanner($feedback)
  }

  @ViewBuilder
  private func content(_ ticket: TicketDetail) -> some View {
    List {
      Section {
        Text(ticket.subject).font(.headline)
        Text([ticket.statusLabel, ticket.priorityLabel].filter { !$0.isEmpty }.joined(separator: " · "))
          .font(.footnote)
          .foregroundStyle(.secondary)
        if let requester = ticket.requester {
          Label(requester, systemImage: "person").font(.footnote)
        }
        Label(
          ticket.assignedToMe ? "Dir zugewiesen" : (ticket.assignee ?? "Nicht zugewiesen"),
          systemImage: "person.badge.shield.checkmark"
        )
        .font(.footnote)
      }

      Section {
        if !ticket.assignedToMe {
          Button {
            run("Das Ticket ist dir zugewiesen.") {
              try await NextDeskAPI().assignToMe(ticket.id)
            }
          } label: {
            Label("Mir zuweisen", systemImage: "hand.raised")
          }
          .disabled(busy)
        }
        NavigationLink {
          StatusPickerView(ticket: ticket) { await load() }
        } label: {
          Label("Status ändern", systemImage: "arrow.triangle.2.circlepath")
        }
        NavigationLink {
          NoteView(ticketId: ticket.id) { await load() }
        } label: {
          Label("Notiz diktieren", systemImage: "mic")
        }
      }

      if !ticket.description.isEmpty {
        Section("Beschreibung") {
          Text(ticket.description).font(.footnote).lineLimit(8)
        }
      }

      if !ticket.comments.isEmpty {
        Section("Verlauf") {
          ForEach(ticket.comments) { comment in
            VStack(alignment: .leading, spacing: 2) {
              Text(comment.author + (comment.isInternal ? " · intern" : ""))
                .font(.caption2)
                .foregroundStyle(.secondary)
              Text(comment.body).font(.footnote).lineLimit(6)
            }
          }
        }
      }
    }
  }

  private func run(_ success: String, _ action: @escaping () async throws -> Void) {
    busy = true
    Task {
      do {
        try await action()
        feedback = Feedback(text: success, isError: false)
        await load()
      } catch {
        feedback = Feedback(text: error.localizedDescription, isError: true)
      }
      busy = false
    }
  }

  private func load() async {
    do {
      state = .loaded(try await NextDeskAPI().ticket(ticketId))
    } catch {
      state = .failed(error.localizedDescription)
    }
  }
}

struct StatusPickerView: View {
  let ticket: TicketDetail
  let onChange: () async -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var pendingClose: StatusOption?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    List {
      if let error {
        Text(error).font(.footnote).foregroundStyle(.red)
      }
      ForEach(ticket.statuses) { status in
        Button {
          if needsConfirmation(status) {
            pendingClose = status
          } else {
            set(status, confirmClose: false)
          }
        } label: {
          HStack {
            Text(status.label)
            Spacer()
            if status.key == ticket.statusKey {
              Image(systemName: "checkmark")
            }
          }
        }
        .disabled(busy || status.key == ticket.statusKey)
      }
    }
    .navigationTitle("Status")
    .confirmationDialog(
      "Ticket wirklich \(pendingClose?.label ?? "")? Die anfragende Person wird informiert.",
      isPresented: Binding(
        get: { pendingClose != nil },
        set: { if !$0 { pendingClose = nil } }),
      titleVisibility: .visible
    ) {
      Button("Bestätigen") {
        if let status = pendingClose { set(status, confirmClose: true) }
      }
      Button("Abbrechen", role: .cancel) { pendingClose = nil }
    }
  }

  private func needsConfirmation(_ status: StatusOption) -> Bool {
    status.isClosed || status.key == "resolved" || status.key == "closed"
  }

  private func set(_ status: StatusOption, confirmClose: Bool) {
    busy = true
    Task {
      do {
        try await NextDeskAPI().setStatus(ticket.id, key: status.key, confirmClose: confirmClose)
        await onChange()
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
      busy = false
    }
  }
}

struct NoteView: View {
  let ticketId: String
  let onSaved: () async -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var text = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    Form {
      Section {
        TextField("Interne Notiz diktieren", text: $text, axis: .vertical)
      } footer: {
        Text("Für Anfragende nicht sichtbar.")
      }
      if let error {
        Text(error).font(.footnote).foregroundStyle(.red)
      }
      Button(busy ? "Speichert …" : "Speichern") {
        busy = true
        Task {
          do {
            try await NextDeskAPI().addInternalNote(
              ticketId, text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            await onSaved()
            dismiss()
          } catch {
            self.error = error.localizedDescription
          }
          busy = false
        }
      }
      .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    .navigationTitle("Notiz")
  }
}
