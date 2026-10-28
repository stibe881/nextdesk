import {
  corsHeaders,
  inspectInventoryItemImage,
  INVENTORY_RPC_NAMES,
  movementRpcParameters,
  movementRpcPayload,
  parseAction,
  recordCountLineRpcParameters,
  shouldIncludeAssetCandidates,
  toActiveCountsContract,
  toLookupCodeResult,
  toOpenReservationsContract,
  toSourceReservationRulesContract,
  toWorkspaceContract,
  upsertItemRpcParameters,
  upsertLocationRpcParameters,
} from "./index.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const LOCATION_ID = "00000000-0000-4000-8000-000000000003";
const EVENT_ID = "00000000-0000-4000-8000-000000000004";
const EVENT_LINE_ID = "00000000-0000-4000-8000-000000000005";
const REQUEST_ID = "00000000-0000-4000-8000-000000000006";
const COUNT_ID = "00000000-0000-4000-8000-000000000007";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    message ?? `Expected ${expectedJson}, received ${actualJson}`,
  );
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function parsedMovement(value: unknown) {
  const action = parseAction(value);
  if (
    !action ||
    action.type !== "postMovement" ||
    !action.itemId ||
    action.quantity === undefined ||
    action.reservationId
  ) {
    throw new Error("The movement fixture must parse.");
  }
  return { ...action, itemId: action.itemId, quantity: action.quantity };
}

const permissions = {
  canRead: true as const,
  canManage: false,
  canMove: true,
  canAdjust: false,
  canCloseInventoryCount: false,
};

Deno.test(
  "inventory uses only the real migration 0068 mutation RPC names",
  () => {
    assertEquals(INVENTORY_RPC_NAMES, {
      upsertLocation: "upsert_inventory_location",
      upsertItem: "upsert_inventory_item",
      postMovement: "post_inventory_movement",
      createReservation: "create_inventory_reservation",
      releaseReservation: "release_inventory_reservation",
      startCount: "start_inventory_count",
      recordCountLine: "record_inventory_count_line",
      closeCount: "close_inventory_count",
    });
  },
);

Deno.test(
  "receipt-backed inventory commands require a valid client request id",
  () => {
    const location = {
      type: "manageLocation",
      tenantId: TENANT_ID,
      operation: "create",
      values: { code: "h-01", name: "Hauptlager" },
    };
    const item = {
      type: "manageItem",
      tenantId: TENANT_ID,
      operation: "create",
      values: {
        articleNumber: "adp-1",
        name: "Adapter",
        category: "Zubehör",
        unit: "each",
        trackingMode: "quantity",
        minimumStock: 0,
        targetStock: 1,
      },
    };
    const countLine = {
      type: "recordCountLine",
      tenantId: TENANT_ID,
      countId: COUNT_ID,
      itemId: ITEM_ID,
      countedQuantity: 1,
    };
    for (const action of [location, item, countLine]) {
      assert(
        parseAction(action) === null,
        "receipt-backed commands must reject a missing clientRequestId",
      );
      assert(
        parseAction({ ...action, clientRequestId: "not-a-uuid" }) === null,
        "receipt-backed commands must reject a malformed clientRequestId",
      );
    }
  },
);

Deno.test(
  "receipt-backed inventory RPCs receive the validated client request id",
  () => {
    const locationAction = parseAction({
      type: "manageLocation",
      tenantId: TENANT_ID,
      operation: "create",
      values: { code: "h-01", name: "Hauptlager" },
      clientRequestId: REQUEST_ID,
    });
    const itemAction = parseAction({
      type: "manageItem",
      tenantId: TENANT_ID,
      operation: "create",
      values: {
        articleNumber: "adp-1",
        name: "Adapter",
        category: "Zubehör",
        unit: "each",
        trackingMode: "quantity",
        minimumStock: 0,
        targetStock: 1,
      },
      clientRequestId: REQUEST_ID,
    });
    const countLineAction = parseAction({
      type: "recordCountLine",
      tenantId: TENANT_ID,
      countId: COUNT_ID,
      itemId: ITEM_ID,
      countedQuantity: 3,
      clientRequestId: REQUEST_ID,
    });
    if (
      !locationAction ||
      locationAction.type !== "manageLocation" ||
      !itemAction ||
      itemAction.type !== "manageItem" ||
      !countLineAction ||
      countLineAction.type !== "recordCountLine"
    ) {
      throw new Error("The receipt command fixtures must parse.");
    }

    assertEquals(
      upsertLocationRpcParameters(
        TENANT_ID,
        locationAction.tenantId,
        locationAction.clientRequestId,
        null,
        { code: "h-01", name: "Hauptlager", active: true },
      ),
      {
        p_actor_id: TENANT_ID,
        p_tenant_id: TENANT_ID,
        p_client_request_id: REQUEST_ID,
        p_location_id: null,
        p_code: "h-01",
        p_name: "Hauptlager",
        p_active: true,
      },
    );
    assertEquals(
      upsertItemRpcParameters(
        TENANT_ID,
        itemAction.tenantId,
        itemAction.clientRequestId,
        null,
        {
          articleNumber: "adp-1",
          name: "Adapter",
          category: "Zubehör",
          unit: "each",
          trackingMode: "quantity",
          minimumStock: 0,
          targetStock: 1,
          manufacturer: null,
          model: null,
          supplier: null,
          privateNote: null,
          active: true,
        },
      ),
      {
        p_actor_id: TENANT_ID,
        p_tenant_id: TENANT_ID,
        p_client_request_id: REQUEST_ID,
        p_item_id: null,
        p_article_number: "adp-1",
        p_name: "Adapter",
        p_category: "Zubehör",
        p_unit: "each",
        p_tracking_mode: "quantity",
        p_minimum_quantity: 0,
        p_target_quantity: 1,
        p_manufacturer: null,
        p_model: null,
        p_supplier: null,
        p_note: null,
        p_active: true,
      },
    );
    assertEquals(recordCountLineRpcParameters(TENANT_ID, countLineAction), {
      p_actor_id: TENANT_ID,
      p_tenant_id: TENANT_ID,
      p_client_request_id: REQUEST_ID,
      p_count_id: COUNT_ID,
      p_item_id: ITEM_ID,
      p_counted_quantity: 3,
    });
  },
);

Deno.test(
  "inventory parser enforces real command allowlists and required master data",
  () => {
    assertEquals(
      parseAction({ type: "workspace", tenantId: TENANT_ID.toUpperCase() }),
      { type: "workspace", tenantId: TENANT_ID },
    );
    assert(
      parseAction({ type: "workspace", tenantId: TENANT_ID, role: "owner" }) ===
        null,
      "workspace must reject injected fields",
    );
    assert(
      parseAction({
        type: "manageLocation",
        tenantId: TENANT_ID,
        operation: "create",
        values: { name: "Hauptlager" },
        clientRequestId: REQUEST_ID,
      }) === null,
      "a location create needs both code and name",
    );
    assert(
      parseAction({
        type: "manageItem",
        tenantId: TENANT_ID,
        operation: "create",
        values: {
          articleNumber: "ADP-1",
          name: "Adapter",
          category: "Zubehör",
          unit: "Stück",
          trackingMode: "quantity",
          minimumStock: 2,
        },
        clientRequestId: REQUEST_ID,
      }) === null,
      "an item create needs every migration-required value",
    );
    assertEquals(
      parseAction({
        type: "manageItem",
        tenantId: TENANT_ID,
        operation: "create",
        values: {
          articleNumber: " ADP-1 ",
          name: " Adapter ",
          category: " Zubehör ",
          unit: " Each ",
          trackingMode: "quantity",
          minimumStock: 2,
          targetStock: 4,
          privateNote: "Nur intern",
        },
        clientRequestId: REQUEST_ID,
      }),
      {
        type: "manageItem",
        tenantId: TENANT_ID,
        operation: "create",
        values: {
          articleNumber: "adp-1",
          name: "Adapter",
          category: "Zubehör",
          unit: "each",
          trackingMode: "quantity",
          minimumStock: 2,
          targetStock: 4,
          privateNote: "Nur intern",
        },
        clientRequestId: REQUEST_ID,
      },
    );
    assert(
      parseAction({
        type: "manageItem",
        tenantId: TENANT_ID,
        operation: "create",
        values: {
          articleNumber: "SER-1",
          name: "Serienartikel",
          category: "Hardware",
          unit: "Stück",
          trackingMode: "serial",
          minimumStock: 0,
          targetStock: 1,
        },
        clientRequestId: REQUEST_ID,
      }) === null,
      "new serial-tracked items must be rejected until a secure serial workflow exists",
    );
    for (const unsupported of [
      { barcode: "DO-NOT-WRITE" },
      { qrCode: "DO-NOT-WRITE" },
      { locationId: LOCATION_ID },
    ]) {
      assert(
        parseAction({
          type: "manageItem",
          tenantId: TENANT_ID,
          operation: "update",
          itemId: ITEM_ID,
          values: unsupported,
          clientRequestId: REQUEST_ID,
        }) === null,
        "item identifiers and location assignment must not be silently accepted",
      );
    }
    assert(
      parseAction({
        type: "postMovement",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        movementType: "receipt",
        quantity: 1,
        toLocationId: LOCATION_ID,
        ticketId: COUNT_ID,
        clientRequestId: REQUEST_ID,
      }) === null,
      "ticketId belongs to reservations, not movements",
    );
    assert(
      parseAction({
        type: "postMovement",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        movementType: "receipt",
        quantity: 1.2345,
        toLocationId: LOCATION_ID,
        clientRequestId: REQUEST_ID,
      }) === null,
      "migration quantities have at most three decimal places",
    );
    assertEquals(
      parseAction({
        type: "recordCountLine",
        tenantId: TENANT_ID,
        countId: COUNT_ID,
        itemId: ITEM_ID,
        countedQuantity: 3.25,
        clientRequestId: REQUEST_ID,
      }),
      {
        type: "recordCountLine",
        tenantId: TENANT_ID,
        countId: COUNT_ID,
        itemId: ITEM_ID,
        countedQuantity: 3.25,
        clientRequestId: REQUEST_ID,
      },
    );
  },
);

Deno.test(
  "source reservation rule actions accept only exact source shapes and bounded quantities",
  () => {
    assertEquals(
      parseAction({ type: "listSourceReservationRules", tenantId: TENANT_ID }),
      { type: "listSourceReservationRules", tenantId: TENANT_ID },
    );
    assert(
      parseAction({
        type: "listSourceReservationRules",
        tenantId: TENANT_ID,
        includeReservations: true,
      }) === null,
      "the rule list must reject injected response controls",
    );

    const eventRule = {
      type: "manageSourceReservationRule",
      tenantId: TENANT_ID,
      operation: "create",
      values: {
        sourceKind: "event_space_equipment",
        equipmentKey: "projector",
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        quantity: 1.25,
        enabled: false,
      },
    };
    assertEquals(parseAction(eventRule), eventRule);
    assertEquals(
      parseAction({
        type: "manageSourceReservationRule",
        tenantId: TENANT_ID,
        operation: "update",
        ruleId: EVENT_ID,
        values: {
          sourceKind: "onboarding_template_task",
          templateId: COUNT_ID,
          templateTaskId: REQUEST_ID,
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 2,
          enabled: true,
        },
      }),
      {
        type: "manageSourceReservationRule",
        tenantId: TENANT_ID,
        operation: "update",
        ruleId: EVENT_ID,
        values: {
          sourceKind: "onboarding_template_task",
          templateId: COUNT_ID,
          templateTaskId: REQUEST_ID,
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 2,
          enabled: true,
        },
      },
    );
    for (const invalid of [
      {
        ...eventRule,
        values: { ...eventRule.values, equipmentKey: "free-text" },
      },
      {
        ...eventRule,
        values: { ...eventRule.values, quantity: 1.2345 },
      },
      {
        ...eventRule,
        values: { ...eventRule.values, templateId: COUNT_ID },
      },
      {
        ...eventRule,
        operation: "update",
        values: eventRule.values,
      },
      {
        type: "manageSourceReservationRule",
        tenantId: TENANT_ID,
        operation: "create",
        values: {
          sourceKind: "onboarding_template_task",
          templateId: COUNT_ID,
          templateTaskId: REQUEST_ID,
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 1,
          enabled: false,
          equipmentKey: "projector",
        },
      },
    ]) {
      assert(
        parseAction(invalid) === null,
        "source reservation rules must reject unknown keys, free source labels and incomplete updates",
      );
    }
  },
);

Deno.test(
  "source reservation rule mapper emits only authorized minimal configuration data",
  () => {
    const contract = toSourceReservationRulesContract(
      {
        rules: [
          {
            id: EVENT_ID,
            source_kind: "event_space_equipment",
            event_equipment_key: "projector",
            onboarding_template_id: null,
            onboarding_template_task_id: null,
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            quantity: "1.500",
            enabled: false,
            private_note: "PRIVATE-RULE-NOTE",
          },
          {
            id: EVENT_LINE_ID,
            source_kind: "onboarding_template_task",
            event_equipment_key: null,
            onboarding_template_id: COUNT_ID,
            onboarding_template_task_id: REQUEST_ID,
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            quantity: "2.000",
            enabled: true,
            audit_actor_id: TENANT_ID,
          },
        ],
        onboardingTemplateTasks: [
          {
            templateId: COUNT_ID,
            templateTitle: "ICT",
            templateTaskId: REQUEST_ID,
            templateTaskTitle: "Gerät bereitstellen",
            responsibility: "ict",
          },
        ],
      },
      { canManageEventRules: true, canManageOnboardingRules: true },
    );
    assertEquals(contract, {
      canManageEventRules: true,
      canManageOnboardingRules: true,
      rules: [
        {
          id: EVENT_ID,
          sourceKind: "event_space_equipment",
          equipmentKey: "projector",
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 1.5,
          enabled: false,
        },
        {
          id: EVENT_LINE_ID,
          sourceKind: "onboarding_template_task",
          templateId: COUNT_ID,
          templateTaskId: REQUEST_ID,
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 2,
          enabled: true,
        },
      ],
      onboardingTemplateTasks: [
        {
          templateId: COUNT_ID,
          templateTitle: "ICT",
          templateTaskId: REQUEST_ID,
          templateTaskTitle: "Gerät bereitstellen",
        },
      ],
    });
    assertEquals(sortedKeys(contract!), [
      "canManageEventRules",
      "canManageOnboardingRules",
      "onboardingTemplateTasks",
      "rules",
    ]);
    const serialized = JSON.stringify({ data: contract });
    assert(!serialized.includes("PRIVATE-RULE-NOTE"));
    assert(!serialized.includes(TENANT_ID));
    assert(!serialized.includes('"responsibility"'));

    assert(
      toSourceReservationRulesContract(
        {
          rules: [
            {
              id: EVENT_ID,
              source_kind: "event_space_equipment",
              event_equipment_key: "projector",
              onboarding_template_id: null,
              onboarding_template_task_id: null,
              item_id: ITEM_ID,
              location_id: LOCATION_ID,
              quantity: 1,
              enabled: true,
            },
          ],
          onboardingTemplateTasks: [],
        },
        { canManageEventRules: false, canManageOnboardingRules: false },
      ) === null,
      "rules must fail closed when their source right was not granted",
    );
    assert(
      toSourceReservationRulesContract(
        {
          rules: [],
          onboardingTemplateTasks: [
            {
              templateId: COUNT_ID,
              templateTitle: "ICT",
              templateTaskId: REQUEST_ID,
              templateTaskTitle: "Gerät bereitstellen",
            },
          ],
        },
        { canManageEventRules: true, canManageOnboardingRules: false },
      ) === null,
      "template task labels must fail closed without the onboarding right",
    );
  },
);

Deno.test(
  "inventory primary-image actions allow only bounded image requests and generated item paths",
  () => {
    const storageObjectPath = `${TENANT_ID}/${ITEM_ID}/${REQUEST_ID}`;
    assertEquals(
      parseAction({
        type: "createUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        contentType: "image/png",
        byteSize: 1,
      }),
      {
        type: "createUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        contentType: "image/png",
        byteSize: 1,
      },
    );
    assertEquals(
      parseAction({
        type: "completeUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        storageObjectPath,
        contentType: "image/webp",
        byteSize: 5,
      }),
      {
        type: "completeUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        storageObjectPath,
        contentType: "image/webp",
        byteSize: 5,
      },
    );
    assertEquals(
      parseAction({
        type: "createDownloadUrl",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
      }),
      { type: "createDownloadUrl", tenantId: TENANT_ID, itemId: ITEM_ID },
    );
    assertEquals(
      parseAction({ type: "delete", tenantId: TENANT_ID, itemId: ITEM_ID }),
      { type: "delete", tenantId: TENANT_ID, itemId: ITEM_ID },
    );
    for (const invalid of [
      {
        type: "createUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        contentType: "image/gif",
        byteSize: 1,
      },
      {
        type: "createUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        contentType: "image/jpeg",
        byteSize: 0,
      },
      {
        type: "createUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        contentType: "image/jpeg",
        byteSize: 5 * 1024 * 1024 + 1,
      },
      {
        type: "completeUpload",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        storageObjectPath: `${TENANT_ID}/${ITEM_ID}/not-a-uuid`,
        contentType: "image/jpeg",
        byteSize: 1,
      },
      {
        type: "createDownloadUrl",
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        storageObjectPath,
      },
    ]) {
      assert(
        parseAction(invalid) === null,
        "image commands must reject invalid data and injected fields",
      );
    }
  },
);

Deno.test(
  "inventory item image inspection verifies magic bytes and bounded dimensions",
  () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    png.set([0, 0, 4, 0, 0, 0, 3, 0], 16); // 1024 × 768
    assertEquals(inspectInventoryItemImage("image/png", png), {
      width: 1024,
      height: 768,
    });

    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 5, 0, 6, 3,
    ]);
    assertEquals(inspectInventoryItemImage("image/jpeg", jpeg), {
      width: 6,
      height: 5,
    });

    // RIFF chunks with an ungeraden Datenlänge have ein Auffüllbyte.
    const webp = new Uint8Array(26);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    webp.set([0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f], 12); // VP8L
    const packed = (639 | (479 << 14)) >>> 0;
    webp[21] = packed & 0xff;
    webp[22] = (packed >>> 8) & 0xff;
    webp[23] = (packed >>> 16) & 0xff;
    webp[24] = (packed >>> 24) & 0xff;
    assertEquals(inspectInventoryItemImage("image/webp", webp), {
      width: 640,
      height: 480,
    });

    const oversizedPng = png.slice();
    oversizedPng.set([0, 0, 16, 1], 16); // 4097 × 768
    assert(
      inspectInventoryItemImage("image/png", oversizedPng) === null,
      "images over 4096 pixels on either axis must be rejected",
    );
    assert(
      inspectInventoryItemImage("image/jpeg", png) === null,
      "declared MIME type must match the image magic bytes",
    );
  },
);

Deno.test(
  "postMovement maps client types to the migration RPC movement lines",
  () => {
    const base = {
      type: "postMovement" as const,
      tenantId: TENANT_ID,
      itemId: ITEM_ID,
      quantity: 2,
      clientRequestId: REQUEST_ID,
    };
    const receipt = parsedMovement({
      ...base,
      movementType: "receipt",
      toLocationId: LOCATION_ID,
    });
    const issue = parsedMovement({
      ...base,
      movementType: "issue",
      fromLocationId: LOCATION_ID,
    });
    const transfer = parsedMovement({
      ...base,
      movementType: "transfer",
      fromLocationId: LOCATION_ID,
      toLocationId: COUNT_ID,
    });
    const defect = parsedMovement({
      ...base,
      movementType: "defect",
      fromLocationId: LOCATION_ID,
    });
    const loss = parsedMovement({
      ...base,
      movementType: "loss",
      fromLocationId: LOCATION_ID,
    });
    const adjustmentIn = parsedMovement({
      ...base,
      movementType: "adjustment_in",
      toLocationId: LOCATION_ID,
    });
    const adjustmentOut = parsedMovement({
      ...base,
      movementType: "adjustment_out",
      fromLocationId: LOCATION_ID,
    });
    assertEquals(movementRpcPayload(receipt), {
      movementType: "receipt",
      lines: [{ item_id: ITEM_ID, location_id: LOCATION_ID, quantity: 2 }],
    });
    assertEquals(movementRpcPayload(issue), {
      movementType: "issue",
      lines: [{ item_id: ITEM_ID, location_id: LOCATION_ID, quantity: 2 }],
    });
    assertEquals(movementRpcPayload(transfer), {
      movementType: "transfer",
      lines: [
        {
          item_id: ITEM_ID,
          from_location_id: LOCATION_ID,
          to_location_id: COUNT_ID,
          quantity: 2,
        },
      ],
    });
    for (const action of [defect, loss, adjustmentOut]) {
      assertEquals(movementRpcPayload(action), {
        movementType: "adjustment",
        lines: [
          {
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            physical_delta: -2,
          },
        ],
      });
    }
    assertEquals(movementRpcPayload(adjustmentIn), {
      movementType: "adjustment",
      lines: [
        { item_id: ITEM_ID, location_id: LOCATION_ID, physical_delta: 2 },
      ],
    });
  },
);

Deno.test(
  "reservation-backed issue accepts only the reservation shape and maps its id",
  () => {
    const parsed = parseAction({
      type: "postMovement",
      tenantId: TENANT_ID,
      movementType: "issue",
      reservationId: COUNT_ID,
      clientRequestId: REQUEST_ID,
    });
    assertEquals(parsed, {
      type: "postMovement",
      tenantId: TENANT_ID,
      movementType: "issue",
      reservationId: COUNT_ID,
      clientRequestId: REQUEST_ID,
    });
    assert(
      parseAction({
        type: "postMovement",
        tenantId: TENANT_ID,
        movementType: "issue",
        reservationId: COUNT_ID,
        itemId: ITEM_ID,
        quantity: 2,
        fromLocationId: LOCATION_ID,
        clientRequestId: REQUEST_ID,
      }) === null,
      "reservation consumption must reject client-supplied item, location and quantity",
    );
    assert(
      parseAction({
        type: "postMovement",
        tenantId: TENANT_ID,
        movementType: "receipt",
        reservationId: COUNT_ID,
        clientRequestId: REQUEST_ID,
      }) === null,
      "a reservation may only be consumed as an issue",
    );

    assertEquals(
      movementRpcParameters(TENANT_ID, {
        type: "postMovement",
        tenantId: TENANT_ID,
        movementType: "issue",
        reservationId: COUNT_ID,
        clientRequestId: REQUEST_ID,
        itemId: ITEM_ID,
        quantity: 2,
        fromLocationId: LOCATION_ID,
      }),
      {
        p_actor_id: TENANT_ID,
        p_tenant_id: TENANT_ID,
        p_client_request_id: REQUEST_ID,
        p_movement_type: "issue",
        p_lines: [{ item_id: ITEM_ID, location_id: LOCATION_ID, quantity: 2 }],
        p_reservation_id: COUNT_ID,
      },
    );
  },
);

Deno.test(
  "reservation and active-count mappers expose only their minimal list payloads",
  () => {
    const reservations = toOpenReservationsContract({
      reservations: [
        {
          id: COUNT_ID,
          item_id: ITEM_ID,
          location_id: LOCATION_ID,
          quantity: "2.000",
          created_at: "2026-10-28T12:00:00.000Z",
          ticket_id: EVENT_ID,
          note: "PRIVATE-RESERVATION-NOTE",
          created_by: EVENT_LINE_ID,
        },
      ],
      items: [{ id: ITEM_ID, name: "Adapter", barcode: "PRIVATE-BARCODE" }],
      locations: [{ id: LOCATION_ID, name: "Hauptlager", code: "h-01" }],
    });
    assertEquals(reservations, [
      {
        id: COUNT_ID,
        itemName: "Adapter",
        locationName: "Hauptlager",
        quantity: 2,
        createdAt: "2026-10-28T12:00:00.000Z",
      },
    ]);
    assertEquals(sortedKeys(reservations![0]), [
      "createdAt",
      "id",
      "itemName",
      "locationName",
      "quantity",
    ]);
    assert(
      !JSON.stringify({ data: reservations }).includes(
        "PRIVATE-RESERVATION-NOTE",
      ),
      "reservation list must not expose ticket or note data",
    );

    const activeCounts = toActiveCountsContract({
      counts: [
        {
          id: COUNT_ID,
          location_id: LOCATION_ID,
          status: "counting",
          started_at: "2026-10-28T12:00:00.000Z",
          started_by: EVENT_ID,
          close_client_request_id: REQUEST_ID,
        },
      ],
      locations: [{ id: LOCATION_ID, name: "Hauptlager", code: "h-01" }],
    });
    assertEquals(activeCounts, [
      {
        id: COUNT_ID,
        locationName: "Hauptlager",
        status: "counting",
        startedAt: "2026-10-28T12:00:00.000Z",
      },
    ]);
    assertEquals(sortedKeys(activeCounts![0]), [
      "id",
      "locationName",
      "startedAt",
      "status",
    ]);
    assert(
      !JSON.stringify({ data: activeCounts }).includes(EVENT_ID),
      "active count list must not expose audit identities",
    );
  },
);

Deno.test(
  "workspace mapper emits exactly the web and iOS envelope fields and no private data",
  () => {
    const workspace = toWorkspaceContract(
      {
        items: [
          {
            id: ITEM_ID,
            name: "USB-C-Adapter",
            article_number: "adp-usbc",
            unit: "each",
            tracking_mode: "quantity",
            minimum_quantity: "5.000",
            target_quantity: "12.000",
            active: true,
            note: "PRIVATE-NOTE-SECRET",
            barcode: "ITEM-BARCODE-SECRET",
            created_at: "2026-10-28T12:00:00.000Z",
          },
        ],
        locations: [
          {
            id: LOCATION_ID,
            name: "Hauptlager",
            code: "h-01",
            active: true,
            private_note: "LOCATION-NOTE-SECRET",
          },
        ],
        balances: [
          {
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            physical_quantity: "4.000",
            reserved_quantity: "1.000",
            updated_at: "2026-10-28T12:00:00.000Z",
          },
        ],
        events: [
          {
            id: EVENT_ID,
            event_type: "movement_receipt",
            created_at: "2026-10-28T12:00:00.000Z",
            actor_id: COUNT_ID,
          },
        ],
        eventLines: [
          {
            id: EVENT_LINE_ID,
            event_id: EVENT_ID,
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            physical_delta: "4.000",
            reserved_delta: "0.000",
            serial_unit_id: COUNT_ID,
          },
        ],
        primaryImages: [
          {
            item_id: ITEM_ID,
            storage_object_path: "STORAGE-OBJECT-PATH-SECRET",
          },
        ],
        openReservationCount: 2,
        activeCountSessionCount: 1,
        recentEventsHasMore: false,
        auditRows: [{ ip: "192.0.2.1" }],
      },
      permissions,
    );
    assert(workspace !== null, "well-formed service rows must map");

    // Both clients require this exact data object once it is wrapped as {data}.
    assertEquals(sortedKeys(workspace), [
      "items",
      "locations",
      "lowStockItems",
      "permissions",
      "recentEvents",
      "recentEventsHasMore",
      "summary",
    ]);
    assertEquals(sortedKeys(workspace.permissions), [
      "canAdjust",
      "canCloseInventoryCount",
      "canManage",
      "canMove",
      "canRead",
    ]);
    assertEquals(sortedKeys(workspace.summary), [
      "activeCountSessionCount",
      "criticalItemCount",
      "openReservationCount",
    ]);
    assertEquals(sortedKeys(workspace.items[0]), [
      "active",
      "articleNumber",
      "availableQuantity",
      "hasPrimaryImage",
      "id",
      "locationName",
      "minQuantity",
      "name",
      "physicalQuantity",
      "reservedQuantity",
      "targetQuantity",
      "trackingMode",
      "unit",
    ]);
    assertEquals(sortedKeys(workspace.locations[0]), [
      "active",
      "code",
      "id",
      "name",
    ]);
    assertEquals(sortedKeys(workspace.recentEvents[0]), [
      "id",
      "itemName",
      "locationName",
      "occurredAt",
      "physicalDelta",
      "reservedDelta",
      "type",
    ]);
    assertEquals(workspace, {
      permissions,
      summary: {
        criticalItemCount: 1,
        openReservationCount: 2,
        activeCountSessionCount: 1,
      },
      items: [
        {
          id: ITEM_ID,
          name: "USB-C-Adapter",
          hasPrimaryImage: true,
          articleNumber: "adp-usbc",
          unit: "each",
          trackingMode: "quantity",
          physicalQuantity: 4,
          reservedQuantity: 1,
          availableQuantity: 3,
          minQuantity: 5,
          targetQuantity: 12,
          locationName: "Hauptlager",
          active: true,
        },
      ],
      locations: [
        {
          id: LOCATION_ID,
          name: "Hauptlager",
          code: "h-01",
          active: true,
        },
      ],
      recentEvents: [
        {
          id: EVENT_LINE_ID,
          type: "receipt",
          occurredAt: "2026-10-28T12:00:00.000Z",
          itemName: "USB-C-Adapter",
          physicalDelta: 4,
          reservedDelta: 0,
          locationName: "Hauptlager",
        },
      ],
      recentEventsHasMore: false,
      lowStockItems: [
        {
          id: ITEM_ID,
          name: "USB-C-Adapter",
          hasPrimaryImage: true,
          articleNumber: "adp-usbc",
          unit: "each",
          trackingMode: "quantity",
          physicalQuantity: 4,
          reservedQuantity: 1,
          availableQuantity: 3,
          minQuantity: 5,
          targetQuantity: 12,
          locationName: "Hauptlager",
          active: true,
        },
      ],
    });
    const serialized = JSON.stringify({ data: workspace });
    for (const forbidden of [
      "PRIVATE-NOTE-SECRET",
      "ITEM-BARCODE-SECRET",
      "LOCATION-NOTE-SECRET",
      "STORAGE-OBJECT-PATH-SECRET",
      "192.0.2.1",
      COUNT_ID,
    ]) {
      assert(
        !serialized.includes(forbidden),
        `${forbidden} leaked into the client envelope`,
      );
    }
  },
);

Deno.test("workspace mapper fails closed for untrusted relation rows", () => {
  assert(
    toWorkspaceContract(
      {
        items: [
          {
            id: ITEM_ID,
            name: "Adapter",
            article_number: "adapter",
            unit: "each",
            tracking_mode: "quantity",
            minimum_quantity: 0,
            target_quantity: 1,
            active: true,
          },
        ],
        locations: [],
        balances: [
          {
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            physical_quantity: 1,
            reserved_quantity: 0,
          },
        ],
        events: [],
        eventLines: [],
        primaryImages: [],
        openReservationCount: 0,
        activeCountSessionCount: 0,
        recentEventsHasMore: false,
      },
      permissions,
    ) === null,
    "a balance with a location outside the tenant-filtered location set must fail closed",
  );
});

Deno.test(
  "workspace mapper carries an explicit bounded-event-history flag",
  () => {
    const boundedHistory = {
      items: [],
      locations: [],
      balances: [],
      events: [],
      eventLines: [],
      primaryImages: [],
      openReservationCount: 0,
      activeCountSessionCount: 0,
      recentEventsHasMore: true,
    };
    assertEquals(
      toWorkspaceContract(boundedHistory, permissions)?.recentEventsHasMore,
      true,
    );
    assert(
      toWorkspaceContract(
        {
          ...boundedHistory,
          recentEventsHasMore: "true",
        },
        permissions,
      ) === null,
      "the bounded-history signal must have an explicit boolean value",
    );
  },
);

Deno.test(
  "lookup mapper retains kind but strips scan codes, notes and audit data",
  () => {
    const item = toLookupCodeResult({
      kind: "inventory_item",
      item: {
        id: ITEM_ID,
        name: "Adapter",
        articleNumber: "SHOULD-NOT-LEAK",
        canonical_value: "SCANNED-CODE-SECRET",
        serial_number: "SERIAL-NUMBER-SECRET",
        note: "PRIVATE-NOTE-SECRET",
      },
    });
    assertEquals(item, {
      kind: "inventory_item",
      item: { id: ITEM_ID, name: "Adapter" },
    });
    const ambiguous = toLookupCodeResult({
      kind: "ambiguous",
      candidates: [
        {
          kind: "asset",
          id: COUNT_ID,
          name: "Notebook",
          canonical_value: "ASSET-CODE-SECRET",
        },
      ],
    });
    assertEquals(ambiguous, {
      kind: "ambiguous",
      candidates: [{ kind: "asset", id: COUNT_ID, name: "Notebook" }],
    });
    const serialized = JSON.stringify({ data: item });
    assert(!serialized.includes("SCANNED-CODE-SECRET"));
    assert(!serialized.includes("SERIAL-NUMBER-SECRET"));
  },
);

Deno.test(
  "inventory lookup includes asset candidates only with the server-authorized asset feature and right",
  () => {
    assertEquals(
      shouldIncludeAssetCandidates({
        inventoryRead: false,
        assetsManagementEnabled: true,
        assetManageGranted: true,
      }),
      false,
    );
    assertEquals(
      shouldIncludeAssetCandidates({
        inventoryRead: true,
        assetsManagementEnabled: false,
        assetManageGranted: true,
      }),
      false,
    );
    assertEquals(
      shouldIncludeAssetCandidates({
        inventoryRead: true,
        assetsManagementEnabled: true,
        assetManageGranted: false,
      }),
      false,
    );
    assertEquals(
      shouldIncludeAssetCandidates({
        inventoryRead: true,
        assetsManagementEnabled: true,
        assetManageGranted: true,
      }),
      true,
    );
  },
);

Deno.test(
  "inventory CORS emits headers only for the production application origin",
  () => {
    const allowed = corsHeaders(
      new Request("https://example.test", {
        headers: { origin: "https://app.nextdesk.ch" },
      }),
    );
    assertEquals(
      allowed.get("Access-Control-Allow-Origin"),
      "https://app.nextdesk.ch",
    );
    assertEquals(allowed.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
    assertEquals(allowed.get("Vary"), "Origin");

    const denied = corsHeaders(
      new Request("https://example.test", {
        headers: { origin: "https://evil.example" },
      }),
    );
    assertEquals(denied.get("Access-Control-Allow-Origin"), null);
    assertEquals(denied.get("Access-Control-Allow-Methods"), null);
    assertEquals(denied.get("Vary"), "Origin");
  },
);
