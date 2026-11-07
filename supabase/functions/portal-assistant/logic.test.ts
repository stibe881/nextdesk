import { assertEquals } from "jsr:@std/assert@1";
import { fallbackDraft, MAX_QUESTIONS, parseAction, parseAiAnswer, parseMessages, searchReply } from "./logic.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-0000000000aa";
const ticketId = "00000000-0000-4000-8000-0000000000bb";
const articleA = "00000000-0000-4000-8000-0000000000c1";
const articleB = "00000000-0000-4000-8000-0000000000c2";
const category = "00000000-0000-4000-8000-0000000000d1";

Deno.test("the conversation starts and ends with the person", () => {
  assertEquals(parseMessages([{ role: "user", text: "Drucker druckt nicht" }])?.length, 1);
  assertEquals(
    parseMessages([{ role: "user", text: "a" }, { role: "assistant", text: "Welcher?" }]),
    null,
  );
  assertEquals(parseMessages([{ role: "assistant", text: "Hallo" }, { role: "user", text: "x" }]), null);
  assertEquals(parseMessages([{ role: "user", text: "   " }]), null);
  assertEquals(parseMessages([]), null);
});

Deno.test("finish needs the matching reference", () => {
  assertEquals(
    parseAction({ type: "finish", tenantId, sessionId, outcome: "ticket_created" }),
    null,
  );
  const finished = parseAction({ type: "finish", tenantId, sessionId, outcome: "ticket_created", ticketId });
  assertEquals(finished?.type === "finish" && finished.ticketId, ticketId);
  assertEquals(
    parseAction({ type: "finish", tenantId, sessionId, outcome: "abandoned", ticketId })?.type,
    "finish",
  );
  assertEquals(parseAction({ type: "finish", tenantId, sessionId, outcome: "open" }), null);
});

Deno.test("turn defaults to the formal address", () => {
  const turn = parseAction({ type: "turn", tenantId, messages: [{ role: "user", text: "VPN geht nicht" }] });
  assertEquals(turn?.type === "turn" && turn.address, "formal");
  assertEquals(
    parseAction({ type: "turn", tenantId, address: "casual", messages: [{ role: "user", text: "x" }] }),
    null,
  );
});

Deno.test("AI answer keeps only known IDs and stops asking after two questions", () => {
  const fallback = { subject: "Fallback", description: "Text" };
  const answer = parseAiAnswer(
    {
      reply: "Probieren Sie diesen Artikel.",
      articleIds: [articleA, "unknown", articleA, articleB],
      question: "Welches Gerät?",
      subject: "  VPN   verbindet nicht ",
      description: "",
      categoryId: "unknown",
    },
    { articleIds: [articleA, articleB], categoryIds: [category] },
    MAX_QUESTIONS,
    fallback,
  );
  assertEquals(answer?.articleIds, [articleA, articleB]);
  assertEquals(answer?.question, null);
  assertEquals(answer?.subject, "VPN verbindet nicht");
  assertEquals(answer?.description, "Text");
  assertEquals(answer?.categoryId, null);
  const asking = parseAiAnswer(
    { reply: "", articleIds: [], question: "Seit wann?", subject: "x", description: "y", categoryId: category },
    { articleIds: [], categoryIds: [category] },
    1,
    fallback,
  );
  assertEquals(asking?.question, "Seit wann?");
  assertEquals(asking?.categoryId, category);
  assertEquals(parseAiAnswer({ reply: "", question: null }, { articleIds: [], categoryIds: [] }, 0, fallback), null);
});

Deno.test("fallback draft uses the first sentence and keeps the answers", () => {
  const draft = fallbackDraft([
    { role: "user", text: "Mein Laptop startet nicht. Seit heute Morgen." },
    { role: "assistant", text: "Leuchtet eine Lampe?" },
    { role: "user", text: "Nein" },
  ]);
  assertEquals(draft.subject, "Mein Laptop startet nicht.");
  assertEquals(
    draft.description,
    "Mein Laptop startet nicht. Seit heute Morgen.\n\nRückfrage: Leuchtet eine Lampe?\nAntwort: Nein",
  );
  assertEquals(fallbackDraft([{ role: "user", text: "x" }]).subject, "Anfrage über den Assistenten");
});

Deno.test("search reply respects the address", () => {
  assertEquals(searchReply(0, "informal").includes("Du kannst"), true);
  assertEquals(searchReply(2).includes("erstellen Sie"), true);
});
