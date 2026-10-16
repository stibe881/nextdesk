import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";

type Department = { id: string; key: string; name: string; kind: string };
type Priority = { key: string; label: string; sort_order: number };

type OptionsResponse = { departments: Department[]; priorities: Priority[] };

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Der Ticketvorgang konnte nicht verarbeitet werden.";
}

export function TicketComposer({
  tenantId,
  onCreated,
}: {
  tenantId: string;
  onCreated: () => void;
}) {
  const [options, setOptions] = useState<OptionsResponse>({
    departments: [],
    priorities: [],
  });
  const [departmentId, setDepartmentId] = useState("");
  const [priorityKey, setPriorityKey] = useState("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    setLoading(true);
    setError("");
    void supabase.functions
      .invoke("ticket-actions", { body: { type: "getFormOptions", tenantId } })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        const payload = data as { data?: OptionsResponse } | null;
        if (!payload?.data) throw new Error("Ticketoptionen fehlen.");
        if (!mounted) return;
        setOptions(payload.data);
        setDepartmentId(payload.data.departments[0]?.id ?? "");
        setPriorityKey(
          payload.data.priorities.some((item) => item.key === "normal")
            ? "normal"
            : (payload.data.priorities[0]?.key ?? ""),
        );
      })
      .catch((nextError) => {
        if (mounted) setError(errorMessage(nextError));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !departmentId || !priorityKey) return;
    setSaving(true);
    setError("");
    setMessage("");
    const { data, error: requestError } = await supabase.functions.invoke(
      "ticket-actions",
      {
        body: {
          type: "createTicket",
          tenantId,
          departmentId,
          priorityKey,
          subject,
          description,
        },
      },
    );
    if (requestError) {
      setError(errorMessage(requestError));
      setSaving(false);
      return;
    }
    const ticketNumber = (data as { data?: { ticketNumber?: string } } | null)
      ?.data?.ticketNumber;
    setSubject("");
    setDescription("");
    setMessage(
      ticketNumber
        ? `Ticket ${ticketNumber} wurde erfasst.`
        : "Das Ticket wurde erfasst.",
    );
    setSaving(false);
    onCreated();
  }

  return (
    <section className="ticket-compose panel" aria-label="Ticket erfassen">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NEUER VORGANG</p>
          <h2>Ticket erfassen</h2>
        </div>
        <span className="data-caption">Mandantenzugriff aktiv</span>
      </div>
      {loading ? (
        <p className="empty-state">Erfassungsoptionen werden geladen …</p>
      ) : (
        <form className="ticket-compose-form" onSubmit={createTicket}>
          <label>
            Betreff
            <input
              disabled={saving || options.departments.length === 0}
              minLength={3}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Worum geht es?"
              required
              value={subject}
            />
          </label>
          <label>
            Abteilung
            <select
              disabled={saving || options.departments.length === 0}
              onChange={(event) => setDepartmentId(event.target.value)}
              required
              value={departmentId}
            >
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priorität
            <select
              disabled={saving || options.priorities.length === 0}
              onChange={(event) => setPriorityKey(event.target.value)}
              required
              value={priorityKey}
            >
              {options.priorities.map((priority) => (
                <option key={priority.key} value={priority.key}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ticket-compose-description">
            Beschreibung
            <textarea
              disabled={saving || options.departments.length === 0}
              minLength={1}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Beschreiben Sie das Anliegen so konkret wie möglich."
              required
              rows={4}
              value={description}
            />
          </label>
          <button
            className="primary-button"
            disabled={saving || options.departments.length === 0}
            type="submit"
          >
            {saving ? "Ticket wird erstellt …" : "Ticket erstellen"}
          </button>
        </form>
      )}
      {error && <p className="ticket-compose-message error">{error}</p>}
      {message && <p className="ticket-compose-message success">{message}</p>}
    </section>
  );
}
