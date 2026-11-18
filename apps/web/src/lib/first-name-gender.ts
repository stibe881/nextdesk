/**
 * Anrede für die Begrüssung einer Antwort: «Liebe» oder «Lieber» je nach
 * Vorname. Es gibt keine Geschlechtsangabe im Verzeichnis, deshalb wird nach
 * gängigen Vornamen (D-A-CH und häufige internationale Namen) entschieden.
 * Ist ein Name nicht eindeutig oder unbekannt (z. B. Andrea, Kim, Alex),
 * bleibt die Begrüssung neutral («Guten Tag»), statt zu raten.
 */

export type Salutation = "Liebe" | "Lieber" | "Guten Tag";

function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
}

const FEMALE = new Set(
  `anna anne annika annette anja andrina angela angelika antonia aline alessia alina alice amelie amy ana andrea_ astrid barbara beatrice beatrix bettina birgit brigitte carla carmen carolin caroline catherine cecile celine charlotte christa christina christine claudia clara corinne cornelia cristina daniela dania denise diana doris dorothea edith elena eleonora elisa elisabeth elke ella ellen elsa emilia emily emma erika esther eva evelyn fabienne felicitas fiona flavia franziska gabriela gabriele gaby gerda gisela giulia gudrun hanna hannah heidi helen helena helene henriette hilda ida ines inga ingrid irene iris isabel isabella jacqueline jana janine jasmin jeannette jennifer jessica joana johanna jolanda judith julia juliane julie jutta karin karolina katharina katja kathrin katrin klara kristin kristina laura lara larissa lea leonie lena lilian lina linda lisa livia lorena lou louisa lucia luisa luna lydia madeleine magdalena maja manuela mara margrit margaretha margarita maria marianne marie marina marion marlene marlies martina mathilde maya melanie melina melissa mia michaela michelle mirjam miriam monika monique nadia nadine natalie natascha nathalie nicole nina noemi nora olivia pamela patricia paula pauline petra priska rahel rebecca regina regula renata rita romina rosa rosmarie ruth sabina sabine sabrina salome samantha sandra sara sarah selina sibylle silvana silvia simone sofia sonja sophie stefanie stephanie susanne svenja tabea tamara tanja tatjana teresa theresa tina ursula uta valentina valeria vanessa verena veronika victoria viktoria vreni yvonne zoe`
    .split(/\s+/)
    .filter((name) => name && !name.endsWith("_"))
    .map(normalise),
);

const MALE = new Set(
  `adrian alain albert alberto alex_ alexander alfred andreas andré andre angelo anton antonio armin arnold arthur beat beni benjamin bernhard bernd bruno carlo carlos christian christoph claudio clemens colin cyrill daniel dario david dennis dieter dimitri dominik eduard elias emil enrico eric erich erik ernst fabian fabio felix ferdinand filip florian francesco frank franz fredy friedrich fritz gabriel georg gerhard gianluca giorgio giuseppe gregor guido gustav hans hansjörg hansruedi harald heinrich heinz helmut henri henry herbert hermann hugo ivan jakob jan jannik jens jerome joel johann johannes jonas jonathan josef joseph jürg jürgen julian kaspar kevin klaus konrad kurt lars laurent leandro leo leon leonardo leopold lorenz lothar louis luca lucas luis lukas manfred manuel marc marcel marco marcus mario marius markus martin matteo matthias mattia maurice max maximilian michael michel mike moritz nando nathan nicolas niklaus nico nils noah noel norbert oliver oskar otto pascal patrick paul peter philipp philippe pierre pietro rafael ralf ralph raphael reto rene renato richard robert roger roland roman ronny rudolf ruedi rolf samuel sandro sebastian sepp silvan simon stefan stephan steven sven theo theodor thomas till tim timo tobias tom urs uwe valentin victor viktor vincent walter werner wilhelm willi wolfgang yannick yves`
    .split(/\s+/)
    .filter((name) => name && !name.endsWith("_"))
    .map(normalise),
);

const FEMALE_ENDINGS = [
  "ina",
  "ana",
  "ika",
  "ine",
  "ette",
  "elle",
  "ilde",
  "hild",
  "trud",
  "burg",
  "lind",
  "gard",
  "lotte",
  "isa",
  "essa",
  "ella",
  "etta",
  "ita",
  "ela",
  "ija",
];
const MALE_ENDINGS = ["hard", "wald", "mund", "bert", "fried", "olf", "ulf"];

/** «Liebe», «Lieber» oder neutral «Guten Tag» für einen Vornamen. */
export function salutationForFirstName(
  firstName: string | null | undefined,
): Salutation {
  if (typeof firstName !== "string") return "Guten Tag";
  const full = normalise(firstName);
  if (!full) return "Guten Tag";
  const parts = full.split("-").filter(Boolean);
  const candidates = [full, ...parts];
  // Doppelnamen wie «Anna-Lena» / «Hans-Peter»: der erste Teil entscheidet.
  for (const candidate of candidates) {
    if (FEMALE.has(candidate)) return "Liebe";
    if (MALE.has(candidate)) return "Lieber";
  }
  const main = parts[0] ?? full;
  if (main.length >= 5) {
    if (MALE_ENDINGS.some((ending) => main.endsWith(ending))) return "Lieber";
    if (FEMALE_ENDINGS.some((ending) => main.endsWith(ending))) return "Liebe";
  }
  return "Guten Tag";
}
