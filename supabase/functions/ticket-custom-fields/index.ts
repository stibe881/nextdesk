import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_TYPES = ["text", "number", "date", "select", "checkbox"] as const;
type FieldType = (typeof FIELD_TYPES)[number];
type FieldValue = string | number | boolean | null;

type ListDefinitionsAction = { type: "listDefinitions"; tenantId: string };
type UpsertDefinitionAction = {
  type: "upsertDefinition";
  tenantId: string;
  definitionId: string | null;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string[];
  expectedVersion: number;
};
type CreateDefinitionAtPositionAction = {
  type: "createDefinitionAtPosition";
  tenantId: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string[];
  sectionId: string;
  position: number;
  expectedVersion: number;
};
type UpdateDefinitionAtPositionAction = {
  type: "updateDefinitionAtPosition";
  tenantId: string;
  definitionId: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string[];
  sectionId: string;
  position: number;
  expectedVersion: number;
};
type RetireDefinitionAction = {
  type: "retireDefinition";
  tenantId: string;
  definitionId: string;
  expectedVersion: number;
};
type ListValuesAction = {
  type: "listValues";
  tenantId: string;
  ticketId: string;
};
type SetValuesAction = {
  type: "setValues";
  tenantId: string;
  ticketId: string;
  values: Array<{ definitionId: string; value: FieldValue }>;
};
type GetLayoutAction = { type: "getLayout"; tenantId: string };
type SaveSectionAction = {
  type: "saveSection";
  tenantId: string;
  sectionId: string | null;
  label: string;
  expectedVersion: number;
};
type MoveDefinitionAction = {
  type: "moveDefinition";
  tenantId: string;
  definitionId: string;
  sectionId: string;
  position: number;
  expectedVersion: number;
};
type Action =
  | ListDefinitionsAction
  | UpsertDefinitionAction
  | CreateDefinitionAtPositionAction
  | UpdateDefinitionAtPositionAction
  | RetireDefinitionAction
  | ListValuesAction
  | SetValuesAction
  | GetLayoutAction
  | SaveSectionAction
  | MoveDefinitionAction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    Array.from(value.trim()).length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && FIELD_TYPES.includes(value as FieldType);
}

function isExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseStringOptions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const options = value.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  if (
    options.some((item) => !isText(item, 1, 100)) ||
    new Set(options.map((item) => item.toLocaleLowerCase("de-CH"))).size !==
      options.length
  ) {
    return null;
  }
  return options;
}

function parseValues(
  value: unknown,
): Array<{ definitionId: string; value: FieldValue }> | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const values: Array<{ definitionId: string; value: FieldValue }> = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !Object.keys(item).every(
        (key) => key === "definitionId" || key === "value",
      ) ||
      Object.keys(item).length !== 2 ||
      !isUuid(item.definitionId) ||
      !(
        item.value === null ||
        typeof item.value === "string" ||
        typeof item.value === "number" ||
        typeof item.value === "boolean"
      ) ||
      (typeof item.value === "number" && !Number.isFinite(item.value))
    ) {
      return null;
    }
    values.push({ definitionId: item.definitionId, value: item.value });
  }
  if (new Set(values.map((item) => item.definitionId)).size !== values.length) {
    return null;
  }
  return values;
}

export function parseTicketCustomFieldsAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !isUuid(value.tenantId)
  ) {
    return null;
  }

  if (
    value.type === "listDefinitions" &&
    Object.keys(value).every((key) => key === "type" || key === "tenantId")
  ) {
    return { type: value.type, tenantId: value.tenantId };
  }

  if (
    value.type === "getLayout" &&
    Object.keys(value).every((key) => key === "type" || key === "tenantId")
  ) {
    return { type: value.type, tenantId: value.tenantId };
  }

  if (
    value.type === "saveSection" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "sectionId", "label", "expectedVersion"].includes(
        key,
      ),
    ) &&
    (value.sectionId === null || isUuid(value.sectionId)) &&
    isText(value.label, 2, 120) &&
    typeof value.expectedVersion === "number" &&
    Number.isSafeInteger(value.expectedVersion) &&
    value.expectedVersion > 0
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      sectionId: value.sectionId,
      label: value.label.trim(),
      expectedVersion: value.expectedVersion,
    };
  }

  if (
    value.type === "moveDefinition" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "definitionId",
        "sectionId",
        "position",
        "expectedVersion",
      ].includes(key),
    ) &&
    isUuid(value.definitionId) &&
    isUuid(value.sectionId) &&
    isPosition(value.position) &&
    isExpectedVersion(value.expectedVersion)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      definitionId: value.definitionId,
      sectionId: value.sectionId,
      position: value.position,
      expectedVersion: value.expectedVersion,
    };
  }

  if (
    value.type === "upsertDefinition" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "definitionId",
        "fieldKey",
        "label",
        "fieldType",
        "required",
        "options",
        "expectedVersion",
      ].includes(key),
    ) &&
    (value.definitionId === null || isUuid(value.definitionId)) &&
    isText(value.fieldKey, 2, 63) &&
    /^[a-z][a-z0-9_]{1,62}$/u.test(value.fieldKey.trim()) &&
    isText(value.label, 2, 120) &&
    isFieldType(value.fieldType) &&
    typeof value.required === "boolean" &&
    isExpectedVersion(value.expectedVersion)
  ) {
    const options = parseStringOptions(value.options);
    if (
      options === null ||
      (value.fieldType === "select") !== options.length > 0
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId: value.tenantId,
      definitionId: value.definitionId,
      fieldKey: value.fieldKey.trim().toLowerCase(),
      label: value.label.trim(),
      fieldType: value.fieldType,
      required: value.required,
      options,
      expectedVersion: value.expectedVersion,
    };
  }

  if (
    value.type === "createDefinitionAtPosition" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "fieldKey",
        "label",
        "fieldType",
        "required",
        "options",
        "sectionId",
        "position",
        "expectedVersion",
      ].includes(key),
    ) &&
    isText(value.fieldKey, 2, 63) &&
    /^[a-z][a-z0-9_]{1,62}$/u.test(value.fieldKey.trim()) &&
    isText(value.label, 2, 120) &&
    isFieldType(value.fieldType) &&
    typeof value.required === "boolean" &&
    isUuid(value.sectionId) &&
    isPosition(value.position) &&
    isExpectedVersion(value.expectedVersion)
  ) {
    const options = parseStringOptions(value.options);
    if (
      options === null ||
      (value.fieldType === "select") !== options.length > 0
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId: value.tenantId,
      fieldKey: value.fieldKey.trim().toLowerCase(),
      label: value.label.trim(),
      fieldType: value.fieldType,
      required: value.required,
      options,
      sectionId: value.sectionId,
      position: value.position,
      expectedVersion: value.expectedVersion,
    };
  }

  if (
    value.type === "updateDefinitionAtPosition" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "definitionId",
        "fieldKey",
        "label",
        "fieldType",
        "required",
        "options",
        "sectionId",
        "position",
        "expectedVersion",
      ].includes(key),
    ) &&
    isUuid(value.definitionId) &&
    isText(value.fieldKey, 2, 63) &&
    /^[a-z][a-z0-9_]{1,62}$/u.test(value.fieldKey.trim()) &&
    isText(value.label, 2, 120) &&
    isFieldType(value.fieldType) &&
    typeof value.required === "boolean" &&
    isUuid(value.sectionId) &&
    isPosition(value.position) &&
    isExpectedVersion(value.expectedVersion)
  ) {
    const options = parseStringOptions(value.options);
    if (
      options === null ||
      (value.fieldType === "select") !== options.length > 0
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId: value.tenantId,
      definitionId: value.definitionId,
      fieldKey: value.fieldKey.trim().toLowerCase(),
      label: value.label.trim(),
      fieldType: value.fieldType,
      required: value.required,
      options,
      sectionId: value.sectionId,
      position: value.position,
      expectedVersion: value.expectedVersion,
    };
  }

  if (
    value.type === "retireDefinition" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "definitionId", "expectedVersion"].includes(key),
    ) &&
    isUuid(value.definitionId) &&
    isExpectedVersion(value.expectedVersion)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      definitionId: value.definitionId,
      expectedVersion: value.expectedVersion,
    };
  }

  if (
    value.type === "listValues" &&
    Object.keys(value).every(
      (key) => key === "type" || key === "tenantId" || key === "ticketId",
    ) &&
    isUuid(value.ticketId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
    };
  }

  if (
    value.type === "setValues" &&
    Object.keys(value).every(
      (key) =>
        key === "type" ||
        key === "tenantId" ||
        key === "ticketId" ||
        key === "values",
    ) &&
    isUuid(value.ticketId)
  ) {
    const values = parseValues(value.values);
    return values === null
      ? null
      : {
          type: value.type,
          tenantId: value.tenantId,
          ticketId: value.ticketId,
          values,
        };
  }

  return null;
}

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function errorResponse(
  request: Request,
  error: { code?: string; message?: string },
): Response {
  if (error.code === "P0002" || error.message === "ticket_not_found") {
    return response(request, { error: { code: "ticket_not_found" } }, 404);
  }
  if (error.message === "custom_field_definition_not_found") {
    return response(
      request,
      {
        error: { code: "custom_field_definition_not_found" },
      },
      404,
    );
  }
  if (error.message === "layout_version_conflict") {
    return response(
      request,
      { error: { code: "layout_version_conflict" } },
      409,
    );
  }
  if (error.message === "custom_field_definition_inactive") {
    return response(
      request,
      { error: { code: "custom_field_definition_inactive" } },
      409,
    );
  }
  if (error.code === "42501") {
    return response(
      request,
      {
        error: { code: "ticket_custom_field_access_denied" },
      },
      403,
    );
  }
  if (["22023", "23505", "23514"].includes(error.code ?? "")) {
    return response(
      request,
      { error: { code: "invalid_ticket_custom_field" } },
      422,
    );
  }
  return response(
    request,
    { error: { code: "ticket_custom_field_failed" } },
    500,
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== APP_ORIGIN) {
    return response(request, { error: { code: "origin_not_allowed" } }, 403);
  }

  const action = parseTicketCustomFieldsAction(
    await request.json().catch(() => null),
  );
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }

  if (action.type === "listValues" || action.type === "setValues") {
    const { data: membership, error: membershipError } =
      await context.supabaseAdmin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .eq("status", "active")
        .maybeSingle();
    if (membershipError)
      return response(
        request,
        { error: { code: "tenant_feature_lookup_failed" } },
        503,
      );
    if (!membership)
      return response(
        request,
        { error: { code: "ticket_custom_field_access_denied" } },
        403,
      );

    const featureStates = await resolveTenantFeatureStates(
      context.supabaseAdmin,
      action.tenantId,
      ["ticketing.detail"],
    );
    if (!featureStates)
      return response(
        request,
        { error: { code: "tenant_feature_lookup_failed" } },
        503,
      );
    if (featureStates["ticketing.detail"] !== true)
      return response(
        request,
        { error: { code: "ticket_feature_disabled" } },
        403,
      );
  }

  let result: unknown;
  let error: { code?: string; message?: string } | null = null;
  switch (action.type) {
    case "listDefinitions": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "list_ticket_custom_field_definitions",
        { p_actor_id: actorId, p_tenant_id: action.tenantId },
      ));
      break;
    }
    case "getLayout": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "list_ticket_custom_field_layout",
        { p_actor_id: actorId, p_tenant_id: action.tenantId },
      ));
      break;
    }
    case "saveSection": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "save_ticket_custom_field_section",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_section_id: action.sectionId,
          p_label: action.label,
          p_expected_version: action.expectedVersion,
        },
      ));
      break;
    }
    case "moveDefinition": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "move_ticket_custom_field_definition",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_definition_id: action.definitionId,
          p_section_id: action.sectionId,
          p_position: action.position,
          p_expected_version: action.expectedVersion,
        },
      ));
      break;
    }
    case "upsertDefinition": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "upsert_ticket_custom_field_definition",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_definition_id: action.definitionId,
          p_field_key: action.fieldKey,
          p_label: action.label,
          p_field_type: action.fieldType,
          p_required: action.required,
          p_options: action.options,
          p_expected_version: action.expectedVersion,
        },
      ));
      break;
    }
    case "createDefinitionAtPosition": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "create_ticket_custom_field_definition_at_position",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_field_key: action.fieldKey,
          p_label: action.label,
          p_field_type: action.fieldType,
          p_required: action.required,
          p_options: action.options,
          p_section_id: action.sectionId,
          p_position: action.position,
          p_expected_version: action.expectedVersion,
        },
      ));
      break;
    }
    case "updateDefinitionAtPosition": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "update_ticket_custom_field_definition_at_position",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_definition_id: action.definitionId,
          p_field_key: action.fieldKey,
          p_label: action.label,
          p_field_type: action.fieldType,
          p_required: action.required,
          p_options: action.options,
          p_section_id: action.sectionId,
          p_position: action.position,
          p_expected_version: action.expectedVersion,
        },
      ));
      break;
    }
    case "retireDefinition": {
      ({ error } = await context.supabaseAdmin.rpc(
        "retire_ticket_custom_field_definition",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_definition_id: action.definitionId,
          p_expected_version: action.expectedVersion,
        },
      ));
      break;
    }
    case "listValues": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "list_ticket_custom_field_values",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_ticket_id: action.ticketId,
        },
      ));
      break;
    }
    case "setValues": {
      ({ data: result, error } = await context.supabaseAdmin.rpc(
        "apply_ticket_custom_field_values",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_ticket_id: action.ticketId,
          p_values: action.values,
        },
      ));
      break;
    }
  }

  if (error) return errorResponse(request, error);
  return response(request, { data: result });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
