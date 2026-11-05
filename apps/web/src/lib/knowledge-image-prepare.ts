import {
  KNOWLEDGE_IMAGE_TYPES,
  MAX_KNOWLEDGE_IMAGE_BYTES,
  MAX_KNOWLEDGE_IMAGE_EDGE,
} from "./knowledge-images";

// Browser-only helpers for article images (same approach as the shop photos).

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    image.src = url;
  });
}

const SUPPORTED_TYPES: readonly string[] = KNOWLEDGE_IMAGE_TYPES;

/**
 * Downscales large images to at most 1600 px on the longer edge (as JPEG).
 * Small images in a supported format stay untouched; GIFs are kept as they
 * are (animation) when they fit the size limit.
 */
export async function prepareKnowledgeImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`«${file.name}» ist kein Bild.`);
  }
  if (file.type === "image/gif" && file.size <= MAX_KNOWLEDGE_IMAGE_BYTES) {
    return file;
  }
  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    throw new Error(
      `«${file.name}» kann nicht gelesen werden. Bitte JPG, PNG, WebP oder GIF verwenden.`,
    );
  }
  const scale = Math.min(
    1,
    MAX_KNOWLEDGE_IMAGE_EDGE /
      Math.max(image.naturalWidth, image.naturalHeight, 1),
  );
  if (
    scale === 1 &&
    SUPPORTED_TYPES.includes(file.type) &&
    file.size <= MAX_KNOWLEDGE_IMAGE_BYTES
  ) {
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob || blob.size > MAX_KNOWLEDGE_IMAGE_BYTES) {
    throw new Error(`«${file.name}» ist zu gross (höchstens 5 MB).`);
  }
  const name = file.name.replace(/\.[^.]+$/, "") || "bild";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(new Error("Das Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}
