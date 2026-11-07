// Word-based ticket similarity shared by problem management (open ticket
// candidates) and knowledge suggestions (solved ticket clusters).

// Filler words that say nothing about the topic of a ticket.
export const STOP_WORDS = new Set(
  (
    "der die das und oder ein eine einer einem einen nicht ist sind bei mit " +
    "von vom zum zur für auf aus nach wie was wer wo im in am an es ich wir " +
    "sie er mein meine meinem unser bitte hallo danke frage problem problemen " +
    "probleme fehler geht funktioniert mehr neue neuer neues kein keine auch " +
    "noch schon ticket hilfe re aw fw wg betreff anfrage"
  ).split(" "),
);

/** Significant, distinct words of a ticket subject (lower case). */
export function subjectWords(subject: string): string[] {
  return [
    ...new Set(
      subject
        .toLocaleLowerCase("de-CH")
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .map((word) => word.replace(/^-+|-+$/g, ""))
        .filter((word) =>
          word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)
        ),
    ),
  ];
}
