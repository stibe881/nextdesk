import { eventSpaceEmailIntakeMatchingRoomId } from "./event-space-email-ticket-intake.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const rooms = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Aula" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Seminarraum Nord" },
] as const;

Deno.test("ordnet eine eindeutige Raumkennung vor dem aktiven Raumnamen zu", () => {
  assert(
    eventSpaceEmailIntakeMatchingRoomId("A1 09 Aula", rooms) === rooms[0].id,
    "Eine eindeutige Ortsangabe mit Kennung muss dem einzigen Raum «Aula» zugeordnet werden.",
  );
  assert(
    eventSpaceEmailIntakeMatchingRoomId("Seminarraum Nord", rooms) ===
      rooms[1].id,
    "Eine exakte Raumbezeichnung muss unverändert zugeordnet werden.",
  );
});

Deno.test("weist mehrdeutige Raumteiltreffer sicher zurück", () => {
  const ambiguousRooms = [
    { id: "00000000-0000-4000-8000-000000000003", name: "Aula" },
    { id: "00000000-0000-4000-8000-000000000004", name: "Aula Nord" },
  ] as const;
  assert(
    eventSpaceEmailIntakeMatchingRoomId("Aula Nord West", ambiguousRooms) ===
      null,
    "Mehrere mögliche Raumtreffer dürfen nie stillschweigend ausgewählt werden.",
  );
});

Deno.test("bevorzugt einen exakten Raumtreffer vor einer längeren Raumbezeichnung", () => {
  const overlappingRooms = [
    { id: "00000000-0000-4000-8000-000000000005", name: "Aula" },
    { id: "00000000-0000-4000-8000-000000000006", name: "Aula West" },
  ] as const;
  assert(
    eventSpaceEmailIntakeMatchingRoomId("Aula", overlappingRooms) ===
      overlappingRooms[0].id,
    "Eine exakte Ortsangabe muss nicht wegen eines längeren Raumnamens in Klärung fallen.",
  );
});
