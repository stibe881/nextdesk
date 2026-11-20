import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog } from "./app-dialog";
import {
  type LinkedProject,
  type LinkKind,
  type ProjectOverview,
  projectsCall,
} from "./lib/projects-api";
import { PROJECT_STATUS_LABELS } from "./lib/projects-model";
import { HealthDot } from "./project-form";
import "./projects.css";

/**
 * Projektbezug eines Tickets, einer Bestellung, eines Netzes oder Geräts:
 * zeigt die verknüpften Projekte und erlaubt, den Eintrag mit einem Projekt
 * zu verbinden oder (Ticket, Bestellung) in ein Projekt umzuwandeln.
 * Bleibt unsichtbar, solange das Modul Projekte nicht verfügbar ist.
 */
export function ProjectLinkCard({
  onOpenProject,
  targetId,
  targetKind,
  tenantId,
}: {
  onOpenProject: (projectId: string) => void;
  targetId: string;
  targetKind: LinkKind;
  tenantId: string;
}) {
  const [linked, setLinked] = useState<LinkedProject[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [choices, setChoices] = useState<ProjectOverview["projects"] | null>(
    null,
  );
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const data = await projectsCall<{
        projects: LinkedProject[];
        canCreate: boolean;
      }>({ type: "projectsForRecord", tenantId, targetKind, targetId });
      if (version.current !== current) return;
      setLinked(data.projects);
      setCanCreate(data.canCreate);
    } catch {
      // Module off or no access: the card stays hidden.
      if (version.current === current) setLinked(null);
    }
  }, [targetId, targetKind, tenantId]);

  useEffect(() => {
    setChoices(null);
    setChoice("");
    setError("");
    void load();
  }, [load]);

  if (linked === null) return null;

  const convertible = targetKind === "ticket" || targetKind === "shop_order";
  // A ticket belongs to one project at most.
  const mayLink = targetKind !== "ticket" || linked.length === 0;

  const fail = (nextError: unknown) =>
    setError(
      nextError instanceof Error ? nextError.message : String(nextError),
    );

  const convert = async () => {
    if (
      !(await confirmDialog(
        `Aus ${targetKind === "ticket" ? "diesem Ticket" : "dieser Bestellung"} ein Projekt anlegen? ${
          targetKind === "ticket"
            ? "Das Ticket bleibt bestehen und wird mit dem Projekt verknüpft; Checklistenpunkte werden zu Aufgaben."
            : "Die Bestellung bleibt bestehen und wird mit dem Projekt verknüpft; jede Position wird zu einer Aufgabe."
        }`,
        { confirmLabel: "Projekt anlegen" },
      ))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await projectsCall<{ projectId: string }>(
        targetKind === "ticket"
          ? { type: "convertTicket", tenantId, ticketId: targetId }
          : { type: "convertShopOrder", tenantId, orderId: targetId },
      );
      onOpenProject(created.projectId);
    } catch (nextError) {
      fail(nextError);
      setBusy(false);
    }
  };

  const openChoices = async () => {
    setError("");
    try {
      const data = await projectsCall<ProjectOverview>({
        type: "overview",
        tenantId,
      });
      const taken = new Set(linked.map((project) => project.projectId));
      setChoices(
        data.projects.filter(
          (project) =>
            !taken.has(project.id) &&
            (project.role === "manager" || project.role === "member"),
        ),
      );
    } catch (nextError) {
      fail(nextError);
    }
  };

  const link = async () => {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      await projectsCall({
        type: "linkRecord",
        tenantId,
        projectId: choice,
        targetKind,
        targetId,
      });
      setChoices(null);
      setChoice("");
      await load();
    } catch (nextError) {
      fail(nextError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pj-linkcard">
      {linked.length === 0 ? (
        <p className="pj-muted">Mit keinem Projekt verknüpft.</p>
      ) : (
        linked.map((project) => (
          <button
            className="pj-linkcard__project"
            key={project.linkId}
            onClick={() => onOpenProject(project.projectId)}
            type="button"
          >
            <HealthDot health={project.health} />
            <span className="pj-two-line">
              <strong>{project.title}</strong>
              <small>
                {project.number} · {PROJECT_STATUS_LABELS[project.status]}
              </small>
            </span>
          </button>
        ))
      )}
      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}
      {choices ? (
        choices.length === 0 ? (
          <p className="pj-muted">
            Es gibt kein Projekt, in dem eine Mitarbeit oder Leitung besteht.
          </p>
        ) : (
          <div className="pj-actions">
            <select
              aria-label="Projekt"
              onChange={(event) => setChoice(event.target.value)}
              value={choice}
            >
              <option value="">Projekt wählen …</option>
              {choices.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.number} {project.title}
                </option>
              ))}
            </select>
            <button
              className="pj-button pj-button--primary"
              disabled={busy || !choice}
              onClick={() => void link()}
              type="button"
            >
              Verknüpfen
            </button>
          </div>
        )
      ) : (
        <div className="pj-actions">
          {mayLink ? (
            <button
              className="pj-button"
              disabled={busy}
              onClick={() => void openChoices()}
              type="button"
            >
              Mit Projekt verknüpfen
            </button>
          ) : null}
          {convertible && canCreate && linked.length === 0 ? (
            <button
              className="pj-button"
              disabled={busy}
              onClick={() => void convert()}
              type="button"
            >
              In Projekt umwandeln
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
