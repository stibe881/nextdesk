import Foundation

/// Kurzübersicht eines Tickets für Listen.
struct TicketRow: Identifiable, Hashable, Sendable {
  let id: String
  let number: String
  let subject: String
  let status: String
  let priority: String
}

struct TicketComment: Identifiable, Hashable, Sendable {
  let id: String
  let author: String
  let body: String
  let isInternal: Bool
}

struct TicketDetail: Sendable {
  let id: String
  let number: String
  let subject: String
  let description: String
  let statusKey: String
  let statusLabel: String
  let priorityLabel: String
  let requester: String?
  let assignee: String?
  let assignedToMe: Bool
  let comments: [TicketComment]
  let statuses: [StatusOption]
}

struct StatusOption: Identifiable, Hashable, Sendable {
  var id: String { key }
  let key: String
  let label: String
  let isClosed: Bool
}

struct Department: Identifiable, Hashable, Sendable {
  let id: String
  let name: String
}

struct FollowUp: Identifiable, Hashable, Sendable {
  let id: String
  let title: String
  let dueAt: Date?
}

struct ServiceTask: Identifiable, Hashable, Sendable {
  let id: String
  let title: String
  let dueAt: Date?
  let overdue: Bool
  let requireNote: Bool
}

/// Zugriff auf nextDesk mit dem Token der angemeldeten Person. Die Watch nutzt
/// dieselben Edge Functions und Zeilenregeln wie die App; nextDesk prüft alle
/// Rechte selbst.
@MainActor
struct NextDeskAPI {
  var session = SessionStore.shared

  static let watchNote = "Erfasst über die Apple Watch."

  // MARK: Tickets

  func myTickets() async throws -> [TicketRow] {
    try await tickets(assigned: .mine)
  }

  func unassignedTickets() async throws -> [TicketRow] {
    try await tickets(assigned: .nobody)
  }

  enum Assignment { case mine, nobody }

  private func tickets(assigned: Assignment) async throws -> [TicketRow] {
    let creds = try await session.validCredentials()
    let statuses = try await rest(
      "ticket_statuses",
      ["select": "id,key,label,is_closed", "tenant_id": "eq.\(creds.tenantId)"])
    let priorities = try await rest(
      "ticket_priorities",
      ["select": "id,label", "tenant_id": "eq.\(creds.tenantId)"])
    let closed = statuses.filter { $0["is_closed"] as? Bool == true }
      .compactMap { $0["id"] as? String }
    var query: [String: String] = [
      "select": "id,ticket_number,subject,status_id,priority_id,updated_at",
      "tenant_id": "eq.\(creds.tenantId)",
      "order": "updated_at.desc",
      "limit": "30",
      "assigned_agent_id": assigned == .mine ? "eq.\(creds.userId)" : "is.null",
    ]
    if !closed.isEmpty { query["status_id"] = "not.in.(\(closed.joined(separator: ",")))" }
    let rows = try await rest("tickets", query)
    let statusLabel = Dictionary(
      statuses.compactMap { row -> (String, String)? in
        guard let id = row["id"] as? String, let label = row["label"] as? String else {
          return nil
        }
        return (id, label)
      }, uniquingKeysWith: { first, _ in first })
    let priorityLabel = Dictionary(
      priorities.compactMap { row -> (String, String)? in
        guard let id = row["id"] as? String, let label = row["label"] as? String else {
          return nil
        }
        return (id, label)
      }, uniquingKeysWith: { first, _ in first })
    return rows.compactMap { row -> TicketRow? in
      guard let id = row["id"] as? String else { return nil }
      return TicketRow(
        id: id,
        number: row["ticket_number"] as? String ?? "",
        subject: row["subject"] as? String ?? "",
        status: statusLabel[row["status_id"] as? String ?? ""] ?? "",
        priority: priorityLabel[row["priority_id"] as? String ?? ""] ?? "")
    }
  }

  func ticket(_ ticketId: String) async throws -> TicketDetail {
    let creds = try await session.validCredentials()
    let data = try await function(
      "ticket-operations",
      ["type": "getTicket", "tenantId": creds.tenantId, "ticketId": ticketId])
    guard let ticket = data["ticket"] as? [String: Any] else {
      throw WatchError.server("Das Ticket ist nicht verfügbar.")
    }
    let statuses = (data["statuses"] as? [[String: Any]] ?? []).compactMap { row -> StatusOption? in
      guard let key = row["key"] as? String, let label = row["label"] as? String else {
        return nil
      }
      return StatusOption(key: key, label: label, isClosed: row["is_closed"] as? Bool == true)
    }
    let statusId = ticket["status_id"] as? String
    let status = (data["statuses"] as? [[String: Any]] ?? []).first { $0["id"] as? String == statusId }
    let priorityId = ticket["priority_id"] as? String
    let priority = (data["priorities"] as? [[String: Any]] ?? []).first {
      $0["id"] as? String == priorityId
    }
    let comments: [TicketComment] = (data["comments"] as? [[String: Any]] ?? []).suffix(10).compactMap {
      row -> TicketComment? in
      guard let id = row["id"] as? String else { return nil }
      return TicketComment(
        id: id,
        author: row["authorName"] as? String ?? "",
        body: row["body"] as? String ?? "",
        isInternal: row["visibility"] as? String == "internal")
    }
    return TicketDetail(
      id: ticketId,
      number: ticket["ticket_number"] as? String ?? "",
      subject: ticket["subject"] as? String ?? "",
      description: ticket["description"] as? String ?? "",
      statusKey: status?["key"] as? String ?? "",
      statusLabel: status?["label"] as? String ?? "",
      priorityLabel: priority?["label"] as? String ?? "",
      requester: (data["requesterContact"] as? [String: Any])?["displayName"] as? String,
      assignee: (data["assignedAgent"] as? [String: Any])?["displayName"] as? String,
      assignedToMe: ticket["assigned_agent_id"] as? String == creds.userId,
      comments: Array(comments.reversed()),
      statuses: statuses)
  }

  func assignToMe(_ ticketId: String) async throws {
    let creds = try await session.validCredentials()
    _ = try await function(
      "ticket-operations",
      [
        "type": "updateTicket", "tenantId": creds.tenantId, "ticketId": ticketId,
        "assignedAgentId": creds.userId,
      ])
  }

  func setStatus(_ ticketId: String, key: String, confirmClose: Bool) async throws {
    let creds = try await session.validCredentials()
    var body: [String: Any] = [
      "type": "updateTicket", "tenantId": creds.tenantId, "ticketId": ticketId,
      "statusKey": key,
    ]
    if confirmClose { body["confirmClose"] = true }
    _ = try await function("ticket-operations", body)
  }

  func addInternalNote(_ ticketId: String, text: String) async throws {
    let creds = try await session.validCredentials()
    _ = try await function(
      "ticket-operations",
      [
        "type": "addComment", "tenantId": creds.tenantId, "ticketId": ticketId,
        "body": "\(text)\n\n\(Self.watchNote)", "visibility": "internal",
      ])
  }

  // MARK: Ticket erfassen

  func formOptions() async throws -> (departments: [Department], requesterId: String?) {
    let creds = try await session.validCredentials()
    let data = try await function(
      "ticket-actions", ["type": "getFormOptions", "tenantId": creds.tenantId])
    let departments = (data["departments"] as? [[String: Any]] ?? []).compactMap {
      row -> Department? in
      guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
      return Department(id: id, name: name)
    }
    let requester = (data["currentRequester"] as? [String: Any])?["id"] as? String
    return (departments, requester)
  }

  /// Erfasst ein Ticket und liefert die Ticketnummer.
  func createTicket(
    departmentId: String, requesterId: String, subject: String, description: String,
    priorityKey: String
  ) async throws -> String {
    let creds = try await session.validCredentials()
    let text = description.isEmpty ? subject : description
    let data = try await function(
      "ticket-actions",
      [
        "type": "createTicket", "tenantId": creds.tenantId, "departmentId": departmentId,
        "priorityKey": priorityKey, "requesterContactId": requesterId,
        "subject": subject, "description": "\(text)\n\n\(Self.watchNote)",
      ])
    return data["ticketNumber"] as? String ?? ""
  }

  // MARK: Wiedervorlagen und Serviceaufgaben

  func followUps() async throws -> [FollowUp] {
    let creds = try await session.validCredentials()
    let data = try await function(
      "experience-hub",
      ["type": "listFollowUps", "tenantId": creds.tenantId, "includeResolved": false, "limit": 30])
    return (data["followUps"] as? [[String: Any]] ?? []).compactMap { row -> FollowUp? in
      guard let id = row["id"] as? String else { return nil }
      return FollowUp(
        id: id, title: row["title"] as? String ?? "", dueAt: Self.date(row["dueAt"]))
    }
  }

  func resolveFollowUp(_ id: String) async throws {
    let creds = try await session.validCredentials()
    _ = try await function(
      "experience-hub", ["type": "resolveFollowUp", "tenantId": creds.tenantId, "followUpId": id])
  }

  func serviceTasks() async throws -> [ServiceTask] {
    let creds = try await session.validCredentials()
    let data = try await function(
      "service-tasks", ["type": "overview", "tenantId": creds.tenantId, "scope": "mine"])
    let rows =
      (data["overdue"] as? [[String: Any]] ?? []) + (data["dueToday"] as? [[String: Any]] ?? [])
    var seen = Set<String>()
    return rows.compactMap { row -> ServiceTask? in
      guard let id = row["id"] as? String, seen.insert(id).inserted else { return nil }
      let status = row["status"] as? String ?? ""
      guard status == "open" || status == "in_progress" || status.isEmpty else { return nil }
      return ServiceTask(
        id: id, title: row["title"] as? String ?? "", dueAt: Self.date(row["dueAt"]),
        overdue: row["overdue"] as? Bool == true, requireNote: row["requireNote"] as? Bool == true)
    }
  }

  func completeServiceTask(_ id: String, note: String?) async throws {
    let creds = try await session.validCredentials()
    var body: [String: Any] = [
      "type": "updateOccurrence", "tenantId": creds.tenantId, "occurrenceId": id,
      "action": "complete",
    ]
    if let note, !note.isEmpty { body["note"] = "\(note)\n\n\(Self.watchNote)" }
    _ = try await function("service-tasks", body)
  }

  /// Lädt die Zahlen für die Komplikation und speichert sie in der App Group.
  func refreshSummary() async {
    guard session.isSignedIn else { return }
    let mine = (try? await myTickets().count) ?? 0
    let unassigned = (try? await unassignedTickets().count) ?? 0
    let overdue = (try? await serviceTasks().filter(\.overdue).count) ?? 0
    WatchSummary.save(myOpen: mine, unassigned: unassigned, overdueTasks: overdue)
  }

  // MARK: HTTP

  private func rest(_ table: String, _ query: [String: String]) async throws -> [[String: Any]] {
    let creds = try await session.validCredentials()
    guard var components = URLComponents(string: "\(creds.supabaseUrl)/rest/v1/\(table)") else {
      throw WatchError.server("Die Adresse von nextDesk ist ungültig.")
    }
    components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
    guard let url = components.url else {
      throw WatchError.server("Die Adresse von nextDesk ist ungültig.")
    }
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let json = try await send(request)
    return json as? [[String: Any]] ?? []
  }

  private func function(_ name: String, _ body: [String: Any]) async throws -> [String: Any] {
    let creds = try await session.validCredentials()
    guard let url = URL(string: "\(creds.supabaseUrl)/functions/v1/\(name)") else {
      throw WatchError.server("Die Adresse von nextDesk ist ungültig.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let json = try await send(request)
    guard let envelope = json as? [String: Any], let data = envelope["data"] as? [String: Any]
    else { return [:] }
    return data
  }

  /// Sendet mit Token; bei abgelaufenem Token einmal mit frischem Token wiederholen.
  private func send(_ base: URLRequest, retried: Bool = false) async throws -> Any {
    let creds = try await session.validCredentials()
    var request = base
    request.timeoutInterval = 20
    request.setValue(creds.anonKey, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(creds.accessToken)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 && !retried {
      _ = try await session.refreshFromPhone()
      return try await send(base, retried: true)
    }
    let json = try? JSONSerialization.jsonObject(with: data)
    guard (200..<300).contains(status) else {
      throw WatchError.server(Self.errorMessage(json, status: status))
    }
    return json ?? [:]
  }

  private static func errorMessage(_ json: Any?, status: Int) -> String {
    let error = (json as? [String: Any])?["error"] as? [String: Any]
    if let message = error?["message"] as? String, !message.isEmpty { return message }
    if status == 403 { return "Dafür fehlt dir in nextDesk die Berechtigung." }
    let code = error?["code"] as? String ?? "http_\(status)"
    return "Die Aktion war nicht möglich (\(code))."
  }

  private static func date(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    let full = ISO8601DateFormatter()
    full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = full.date(from: text) { return date }
    return ISO8601DateFormatter().date(from: text)
  }
}
