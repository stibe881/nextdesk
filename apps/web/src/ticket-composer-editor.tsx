import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { composerParts, pendingImageMarker } from "./lib/composer-content";

export type ComposerEditorHandle = {
  focus: () => void;
};

type Props = {
  id?: string;
  value: string;
  /** Vorschau-Adressen der eingefügten Bilder (Schlüssel → Object-URL). */
  imageUrls: Readonly<Record<string, string>>;
  placeholder?: string;
  disabled?: boolean;
  ariaDescribedBy?: string;
  onChange: (value: string) => void;
  /**
   * Bilder aus Zwischenablage oder Ablegen: liefert die Schlüssel der
   * vorgemerkten Bilder (oder keine, wenn sie abgelehnt wurden).
   */
  onInsertImages: (files: File[]) => { key: string; url: string }[];
  /** Andere Dateien (PDF, Word …) werden normale Anhänge. */
  onAddFiles: (files: File[]) => void;
  onFocus?: () => void;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Liest Text und Bilder aus dem Editor (Zeilen über <br>/Blöcke). */
function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node, isFirstChild: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/ /gu, " ");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      if (node.dataset.sentinel === "true") return;
      out += "\n";
      return;
    }
    if (node.tagName === "IMG") {
      const key = node.dataset.imageKey;
      if (key) out += pendingImageMarker(key);
      return;
    }
    // Browser packen neue Zeilen teils in <div>: als Zeilenumbruch lesen.
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && !isFirstChild && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach((child, index) => walk(child, index === 0));
  };
  root.childNodes.forEach((child, index) => walk(child, index === 0));
  return out;
}

/** Baut den Editor aus dem Text neu auf. */
function render(
  root: HTMLElement,
  value: string,
  imageUrls: Readonly<Record<string, string>>,
) {
  root.replaceChildren();
  for (const part of composerParts(value)) {
    if (part.kind === "image") {
      const url = imageUrls[part.key];
      if (!url) continue;
      root.append(imageElement(part.key, url));
      continue;
    }
    part.value.split("\n").forEach((line, index) => {
      if (index > 0) root.append(document.createElement("br"));
      if (line) root.append(document.createTextNode(line));
    });
  }
  // Ein abschliessender Zeilenumbruch braucht ein zweites <br>, sonst ist
  // die leere Zeile nicht sichtbar.
  if (value.endsWith("\n")) {
    const sentinel = document.createElement("br");
    sentinel.dataset.sentinel = "true";
    root.append(sentinel);
  }
}

function imageElement(key: string, url: string): HTMLImageElement {
  const image = document.createElement("img");
  image.src = url;
  image.alt = "Eingefügtes Bild";
  image.dataset.imageKey = key;
  image.className = "ticket-composer-editor__image";
  image.draggable = false;
  return image;
}

function placeCaretAtEnd(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Fügt Knoten an der Cursor-Position ein (sonst am Ende). */
function insertNodesAtCaret(root: HTMLElement, nodes: Node[]) {
  const selection = window.getSelection();
  let range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range || !root.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(node);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(after);
  }
}

/**
 * Nachrichtenfeld wie in Outlook: Text schreiben, Screenshots oder kopierte
 * Bilder mit Ctrl+V an der Cursor-Position einfügen (auf die Feldbreite
 * verkleinert) und weiterschreiben. Formatierungen aus der Zwischenablage
 * werden nicht übernommen, nur Text und Bilder.
 */
export const TicketComposerEditor = forwardRef<ComposerEditorHandle, Props>(
  function TicketComposerEditor(
    {
      id,
      value,
      imageUrls,
      placeholder,
      disabled,
      ariaDescribedBy,
      onChange,
      onInsertImages,
      onAddFiles,
      onFocus,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    // Zuletzt vom Editor gemeldeter Wert: nur fremde Änderungen (Begrüssung,
    // KI, Entwurf, Senden) bauen den Editor neu auf.
    const lastEmitted = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        const root = rootRef.current;
        if (!root) return;
        root.focus();
        placeCaretAtEnd(root);
      },
    }));

    useEffect(() => {
      const root = rootRef.current;
      if (!root || value === lastEmitted.current) return;
      const hadFocus = document.activeElement === root;
      render(root, value, imageUrls);
      lastEmitted.current = value;
      if (hadFocus) placeCaretAtEnd(root);
    }, [imageUrls, value]);

    const emit = useCallback(() => {
      const root = rootRef.current;
      if (!root) return;
      const next = serialize(root);
      lastEmitted.current = next;
      onChange(next);
    }, [onChange]);

    function insertImages(files: File[]) {
      const root = rootRef.current;
      if (!root || files.length === 0) return;
      const inserted = onInsertImages(files);
      if (inserted.length === 0) return;
      const nodes: Node[] = [];
      // Bilder sind Blöcke: Danach geht der Text in der nächsten Zeile weiter.
      for (const image of inserted) {
        nodes.push(imageElement(image.key, image.url));
      }
      root.focus();
      insertNodesAtCaret(root, nodes);
      emit();
    }

    function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
      const files = Array.from(event.clipboardData.files ?? []);
      const images = files.filter((file) => IMAGE_TYPES.has(file.type));
      const others = files.filter((file) => !IMAGE_TYPES.has(file.type));
      event.preventDefault();
      if (images.length) insertImages(images);
      if (others.length) onAddFiles(others);
      if (images.length || others.length) return;
      // Nur Text übernehmen, ohne Formatierung aus Word, Outlook oder Web.
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      const root = rootRef.current;
      if (!root) return;
      const lines = text.replace(/\r\n?/gu, "\n").split("\n");
      const nodes: Node[] = [];
      lines.forEach((line, index) => {
        if (index > 0) nodes.push(document.createElement("br"));
        if (line) nodes.push(document.createTextNode(line));
      });
      insertNodesAtCaret(root, nodes);
      emit();
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      // Cursor an die Stelle setzen, an der das Bild losgelassen wurde.
      const docWithCaret = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const range = docWithCaret.caretRangeFromPoint?.(
        event.clientX,
        event.clientY,
      );
      if (range && rootRef.current?.contains(range.startContainer)) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      const images = files.filter((file) => IMAGE_TYPES.has(file.type));
      const others = files.filter((file) => !IMAGE_TYPES.has(file.type));
      if (images.length) insertImages(images);
      if (others.length) onAddFiles(others);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      // Zeilenumbruch als <br>, nicht als neuer Block.
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const root = rootRef.current;
        if (!root) return;
        const atEnd = (() => {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) return true;
          const probe = document.createRange();
          probe.selectNodeContents(root);
          probe.setStart(
            selection.getRangeAt(0).endContainer,
            selection.getRangeAt(0).endOffset,
          );
          return (
            probe.toString() === "" &&
            !probe.cloneContents().querySelector("img")
          );
        })();
        const nodes: Node[] = [document.createElement("br")];
        if (atEnd) {
          const sentinel = document.createElement("br");
          sentinel.dataset.sentinel = "true";
          root
            .querySelectorAll("br[data-sentinel]")
            .forEach((node) => node.remove());
          insertNodesAtCaret(root, nodes);
          root.append(sentinel);
        } else {
          insertNodesAtCaret(root, nodes);
        }
        emit();
      }
    }

    return (
      <div
        aria-describedby={ariaDescribedBy}
        aria-disabled={disabled || undefined}
        aria-multiline="true"
        className="ticket-composer-editor"
        contentEditable={!disabled}
        data-placeholder={placeholder}
        id={id}
        onBlur={emit}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={handleDrop}
        onFocus={onFocus}
        onInput={emit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        ref={rootRef}
        role="textbox"
        suppressContentEditableWarning
        tabIndex={0}
      />
    );
  },
);
