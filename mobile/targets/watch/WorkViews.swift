import SwiftUI

/// Ticket per Sprache erfassen: diktieren, Entwurf prüfen, bestätigen.
struct NewTicketView: View {
  private struct PriorityOption: Identifiable, Hashable {
    let key: String
    let label: String
    var id: String { key }
  }

  private let priorities = [
    PriorityOption(key: "low", label: "Niedrig"),
    PriorityOption(key: "normal", label: "Normal"),
    PriorityOption(key: "high", label: "Hoch"),
    PriorityOption(key: "urgent", label: "Dringend"),
  ]

  @State private var subject = ""
  @State private var details = ""
  @State private var priority = "normal"
  @State private var departments: [Department] = []
  @State private var departmentId = ""
  @State private var requesterId: String?
  @State private var loadError: String?
  @State private var confirming = false
  @State private var busy = false
  @State private var error: String?
  @State private var created: String?

  private var trimmedSubject: String {
    subject.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    Group {
      if let created {
        VStack(spacing: 8) {
          Image(systemName: "checkmark.circle.fill")
            .font(.title)
            .foregroundStyle(.green)
          Text(created.isEmpty ? "Ticket erfasst." : "Ticket \(created) erfasst.")
            .multilineTextAlignment(.center)
          Button("Neues Ticket") { reset() }
        }
      } else if let loadError {
        ErrorView(message: loadError) { await loadOptions() }
      } else {
        form
      }
    }
    .navigationTitle("Ticket erfassen")
    .task { await loadOptions() }
  }

  private var form: some View {
    Form {
      Section("Was ist passiert?") {
        TextField("Betreff diktieren", text: $subject)
        TextField("Details (optional)", text: $details, axis: .vertical)
      }
      Section {
        Picker("Priorität", selection: $priority) {
          ForEach(priorities) { option in
            Text(option.label).tag(option.key)
          }
        }
        if departments.count > 1 {
          Picker("Abteilung", selection: $departmentId) {
            ForEach(departments) { department in
              Text(department.name).tag(department.id)
            }
          }
        }
      }
      if let error {
        Text(error).font(.footnote).foregroundStyle(.red)
      }
      Button(busy ? "Erfasst …" : "Prüfen und erfassen") {
        confirming = true
      }
      .disabled(busy || trimmedSubject.count < 3 || departmentId.isEmpty || requesterId == nil)
    }
    .confirmationDialog(
      "Ticket erfassen?", isPresented: $confirming, titleVisibility: .visible
    ) {
      Button("Erfassen") { submit() }
      Button("Abbrechen", role: .cancel) {}
    } message: {
      Text(summary)
    }
  }

  private var summary: String {
    let department = departments.first { $0.id == departmentId }?.name ?? ""
    let priorityLabel = priorities.first { $0.key == priority }?.label ?? ""
    return [trimmedSubject, [department, priorityLabel].filter { !$0.isEmpty }.joined(separator: " · ")]
      .joined(separator: "\n")
  }

  private func loadOptions() async {
    guard departments.isEmpty else { return }
    do {
      let options = try await NextDeskAPI().formOptions()
      departments = options.departments
      departmentId = options.departments.first?.id ?? ""
      requesterId = options.requesterId
      loadError =
        options.departments.isEmpty
        ? "Du kannst in keiner Abteilung Tickets erfassen."
        : (options.requesterId == nil ? "Für dein Konto ist keine anfragende Person hinterlegt." : nil)
    } catch {
      loadError = error.localizedDescription
    }
  }

  private func submit() {
    guard let requesterId else { return }
    busy = true
    error = nil
    Task {
      do {
        created = try await NextDeskAPI().createTicket(
          departmentId: departmentId,
          requesterId: requesterId,
          subject: String(trimmedSubject.prefix(240)),
          description: details.trimmingCharacters(in: .whitespacesAndNewlines),
          priorityKey: priority)
      } catch {
        self.error = error.localizedDescription
      }
      busy = false
    }
  }

  private func reset() {
    subject = ""
    details = ""
    priority = "normal"
    created = nil
    error = nil
  }
}

struct FollowUpsView: View {
  @State private var state: Loadable<[FollowUp]> = .loading
  @State private var pending: FollowUp?
  @State private var feedback: Feedback?

  var body: some View {
    Group {
      switch state {
      case .loading:
        ProgressView()
      case .failed(let message):
        ErrorView(message: message) { await load() }
      case .loaded(let items) where items.isEmpty:
        Text("Keine offenen Wiedervorlagen.").foregroundStyle(.secondary)
      case .loaded(let items):
        List(items) { item in
          Button {
            pending = item
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(item.title).lineLimit(2)
              if let due = item.dueAt {
                Text(due.shortLabel)
                  .font(.caption2)
                  .foregroundStyle(due < Date() ? .red : .secondary)
              }
            }
          }
        }
      }
    }
    .navigationTitle("Wiedervorlagen")
    .task { await load() }
    .feedbackBanner($feedback)
    .confirmationDialog(
      "Als erledigt markieren?",
      isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
      titleVisibility: .visible
    ) {
      Button("Erledigt") {
        if let item = pending { resolve(item) }
      }
      Button("Abbrechen", role: .cancel) { pending = nil }
    } message: {
      Text(pending?.title ?? "")
    }
  }

  private func load() async {
    do {
      state = .loaded(try await NextDeskAPI().followUps())
    } catch {
      state = .failed(error.localizedDescription)
    }
  }

  private func resolve(_ item: FollowUp) {
    Task {
      do {
        try await NextDeskAPI().resolveFollowUp(item.id)
        feedback = Feedback(text: "Erledigt.", isError: false)
        await load()
      } catch {
        feedback = Feedback(text: error.localizedDescription, isError: true)
      }
    }
  }
}

struct ServiceTasksView: View {
  @State private var state: Loadable<[ServiceTask]> = .loading

  var body: some View {
    Group {
      switch state {
      case .loading:
        ProgressView()
      case .failed(let message):
        ErrorView(message: message) { await load() }
      case .loaded(let tasks) where tasks.isEmpty:
        Text("Heute ist nichts fällig.").foregroundStyle(.secondary)
      case .loaded(let tasks):
        List(tasks) { task in
          NavigationLink {
            CompleteServiceTaskView(task: task) { await load() }
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(task.title).lineLimit(2)
              Text(task.overdue ? "Überfällig" : (task.dueAt?.shortLabel ?? "Heute"))
                .font(.caption2)
                .foregroundStyle(task.overdue ? .red : .secondary)
            }
          }
        }
      }
    }
    .navigationTitle("Serviceaufgaben")
    .task { await load() }
  }

  private func load() async {
    do {
      state = .loaded(try await NextDeskAPI().serviceTasks())
    } catch {
      state = .failed(error.localizedDescription)
    }
  }
}

struct CompleteServiceTaskView: View {
  let task: ServiceTask
  let onDone: () async -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var note = ""
  @State private var busy = false
  @State private var error: String?

  private var trimmedNote: String {
    note.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    Form {
      Section {
        Text(task.title).font(.headline)
      }
      Section {
        TextField(
          task.requireNote ? "Notiz zum Ergebnis (nötig)" : "Notiz (optional)",
          text: $note, axis: .vertical)
      }
      if let error {
        Text(error).font(.footnote).foregroundStyle(.red)
      }
      Button(busy ? "Speichert …" : "Erledigt") {
        busy = true
        Task {
          do {
            try await NextDeskAPI().completeServiceTask(
              task.id, note: trimmedNote.isEmpty ? nil : trimmedNote)
            await onDone()
            dismiss()
          } catch {
            self.error = error.localizedDescription
          }
          busy = false
        }
      }
      .disabled(busy || (task.requireNote && trimmedNote.isEmpty))
    }
    .navigationTitle("Erledigen")
  }
}
