import { tn } from "./formality";
/**
 * «Ticket-Aufteilung»: draft handling and validation of the child tickets
 * before they are sent to the ticket-coordination function.
 */

export const MAX_SPLIT_CHILDREN = 10;
export const SPLIT_SUBJECT_MIN = 3;
export const SPLIT_SUBJECT_MAX = 240;
export const SPLIT_DESCRIPTION_MAX = 50000;

export type SplitDraftChild = {
  key: string;
  subject: string;
  description: string;
  departmentId: string;
  teamId: string;
  agentId: string;
};

export type SplitDraftField = "subject" | "description" | "departmentId";
export type SplitDraftErrors = Partial<Record<SplitDraftField, string>>;

export type SplitPayloadChild = {
  subject: string;
  description: string;
  departmentId: string;
  teamId: string | null;
  agentId: string | null;
};

/** A new child prefilled from the parent ticket. */
export function newSplitChild(
  key: string,
  parent: { ticketNumber: string; subject: string; description: string },
): SplitDraftChild {
  const reference = `Teil von Ticket ${parent.ticketNumber}\n\n`;
  return {
    key,
    subject: parent.subject.slice(0, SPLIT_SUBJECT_MAX),
    description: `${reference}${parent.description}`.slice(
      0,
      SPLIT_DESCRIPTION_MAX,
    ),
    departmentId: "",
    teamId: "",
    agentId: "",
  };
}

/** German messages per field; an empty object means the child is valid. */
export function splitChildErrors(child: SplitDraftChild): SplitDraftErrors {
  const errors: SplitDraftErrors = {};
  const subject = child.subject.trim();
  if (subject.length < SPLIT_SUBJECT_MIN) {
    errors.subject = "Der Betreff braucht mindestens 3 Zeichen.";
  } else if (subject.length > SPLIT_SUBJECT_MAX) {
    errors.subject = "Der Betreff darf höchstens 240 Zeichen lang sein.";
  }
  const description = child.description.trim();
  if (!description) {
    errors.description = tn(
      "Bitte beschreibe den Teilauftrag.",
      "Bitte beschreiben Sie den Teilauftrag.",
    );
  } else if (description.length > SPLIT_DESCRIPTION_MAX) {
    errors.description = "Die Beschreibung ist zu lang.";
  }
  if (!child.departmentId) {
    errors.departmentId = tn(
      "Bitte wähle eine Abteilung.",
      "Bitte wählen Sie eine Abteilung.",
    );
  }
  return errors;
}

export type SplitValidation = {
  valid: boolean;
  /** Message for the whole form (count limits), or null. */
  formError: string | null;
  childErrors: SplitDraftErrors[];
};

export function validateSplitDraft(
  children: readonly SplitDraftChild[],
): SplitValidation {
  const childErrors = children.map(splitChildErrors);
  let formError: string | null = null;
  if (children.length < 1) {
    formError = tn(
      "Erfasse mindestens ein Teil-Ticket.",
      "Erfassen Sie mindestens ein Teil-Ticket.",
    );
  } else if (children.length > MAX_SPLIT_CHILDREN) {
    formError = `Es sind höchstens ${MAX_SPLIT_CHILDREN} Teil-Tickets auf einmal möglich.`;
  }
  return {
    valid:
      formError === null &&
      childErrors.every((errors) => Object.keys(errors).length === 0),
    formError,
    childErrors,
  };
}

/** The request body of the split action (trimmed, empty ids as null). */
export function splitPayload(
  children: readonly SplitDraftChild[],
): SplitPayloadChild[] {
  return children.map((child) => ({
    subject: child.subject.trim(),
    description: child.description.trim(),
    departmentId: child.departmentId,
    teamId: child.teamId || null,
    agentId: child.agentId || null,
  }));
}

/** Changing the department resets team and agent; changing the team resets the agent. */
export function updateSplitChild(
  child: SplitDraftChild,
  change: Partial<Omit<SplitDraftChild, "key">>,
): SplitDraftChild {
  const next = { ...child, ...change };
  if (
    change.departmentId !== undefined &&
    change.departmentId !== child.departmentId
  ) {
    next.teamId = "";
    next.agentId = "";
  } else if (change.teamId !== undefined && change.teamId !== child.teamId) {
    next.agentId = "";
  }
  return next;
}

/** Open children block resolving or closing the parent. */
export function openChildCount(
  children: readonly { isClosed: boolean }[],
): number {
  return children.filter((child) => !child.isClosed).length;
}
