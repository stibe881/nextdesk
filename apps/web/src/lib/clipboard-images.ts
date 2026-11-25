/**
 * Bilder aus der Zwischenablage (Screenshot, kopiertes Bild) für Anhänge.
 * Browser liefern sie meist als «image.png»; sie erhalten einen lesbaren
 * Namen mit Datum und Uhrzeit.
 */
/** Gibt Bildern ohne echten Namen («image.png») einen lesbaren Namen. */
export function renameClipboardImages(
  images: readonly File[],
  now: Date = new Date(),
): File[] {
  return pastedImageFilesFrom([...images], now);
}

export function pastedImageFiles(
  clipboard: Pick<DataTransfer, "items"> | null,
  now: Date = new Date(),
): File[] {
  if (!clipboard) return [];
  const files: File[] = [];
  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(file);
  }
  return pastedImageFilesFrom(files, now);
}

function pastedImageFilesFrom(files: File[], now: Date): File[] {
  const stamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(now)
    .replace(/:/gu, "-");
  return files.map((file, index) => {
    const extension =
      file.type === "image/jpeg"
        ? "jpg"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "image/gif"
            ? "gif"
            : "png";
    const generic =
      !file.name || /^image\.(png|jpe?g|gif|webp)$/iu.test(file.name);
    const name = generic
      ? `Bild ${stamp}${files.length > 1 ? ` (${index + 1})` : ""}.${extension}`
      : file.name;
    return name === file.name
      ? file
      : new File([file], name, {
          type: file.type,
          lastModified: now.getTime(),
        });
  });
}
