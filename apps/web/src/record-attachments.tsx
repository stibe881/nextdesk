import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Download, FileText, Image as ImageIcon, Trash2, UploadCloud, X } from "lucide-react";
import { supabase } from "./lib/supabase";

export type RecordEntityType = "contract" | "license";
export type RecordAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,image/png,image/jpeg,image/webp";

export function validateRecordFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return `«${file.name}»: Nur PDF, PNG, JPG und WebP sind erlaubt.`;
  }
  if (file.size < 1) return `«${file.name}» ist leer.`;
  if (file.size > MAX_BYTES) {
    return `«${file.name}» ist grösser als 25 MB.`;
  }
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function invokeAttachments(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke(
    "record-attachments",
    { body },
  );
  if (error) {
    // The function returns a readable German message for expected failures.
    let message = "Der Vorgang ist fehlgeschlagen.";
    try {
      const context = (error as { context?: Response }).context;
      const payload = context ? await context.json() : null;
      if (typeof payload?.error?.message === "string") {
        message = payload.error.message;
      }
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  const payload =
    data && typeof data === "object" && "data" in data
      ? (data as { data: unknown }).data
      : null;
  if (!payload || typeof payload !== "object") {
    throw new Error("Ungültige Antwort des Servers.");
  }
  return payload as Record<string, unknown>;
}

export async function uploadRecordAttachment(
  tenantId: string,
  entityType: RecordEntityType,
  entityId: string,
  file: File,
): Promise<RecordAttachment> {
  const contentType = file.type.toLowerCase();
  const created = await invokeAttachments({
    type: "createUpload",
    tenantId,
    entityType,
    entityId,
    filename: file.name,
    contentType,
    byteSize: file.size,
  });
  if (typeof created.signedUrl !== "string" || typeof created.storageObjectPath !== "string") {
    throw new Error("Ungültige Upload-Antwort.");
  }
  const upload = await fetch(created.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!upload.ok) throw new Error(`«${file.name}» konnte nicht hochgeladen werden.`);
  const completed = await invokeAttachments({
    type: "completeUpload",
    tenantId,
    entityType,
    entityId,
    storageObjectPath: created.storageObjectPath,
    filename: file.name,
    contentType,
    byteSize: file.size,
  });
  const attachment = completed.attachment as RecordAttachment | undefined;
  if (!attachment?.id) throw new Error("Ungültige Anhang-Antwort.");
  return attachment;
}

function Thumbnail({ file }: { file: File }) {
  const url = useMemo(
    () => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url ? (
    <img alt="" className="record-attachments__thumb" src={url} />
  ) : (
    <span className="record-attachments__icon" aria-hidden="true">
      <FileText size={20} />
    </span>
  );
}

/**
 * Drag-and-drop area plus list of attachments. With an entityId the files are
 * uploaded at once; without one (a record that is not saved yet) they are
 * queued and the parent uploads them after saving.
 */
export function RecordAttachments({
  tenantId,
  entityType,
  entityId,
  queued,
  onQueuedChange,
  readOnly = false,
}: {
  tenantId: string;
  entityType: RecordEntityType;
  entityId: string | null;
  queued: File[];
  onQueuedChange: (files: File[]) => void;
  readOnly?: boolean;
}) {
  const [attachments, setAttachments] = useState<RecordAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    if (!entityId) {
      setAttachments([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await invokeAttachments({
        type: "list",
        tenantId,
        entityType,
        entityId,
      });
      setAttachments(Array.isArray(data.attachments) ? (data.attachments as RecordAttachment[]) : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Anhänge konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addFiles(files: File[]) {
    if (readOnly || files.length === 0) return;
    const problems: string[] = [];
    const valid = files.filter((file) => {
      const problem = validateRecordFile(file);
      if (problem) problems.push(problem);
      return !problem;
    });
    setError(problems.join(" "));
    if (valid.length === 0) return;
    if (!entityId) {
      onQueuedChange([...queued, ...valid]);
      return;
    }
    for (const file of valid) {
      setUploading((current) => [...current, file.name]);
      try {
        const saved = await uploadRecordAttachment(tenantId, entityType, entityId, file);
        setAttachments((current) => [saved, ...current]);
      } catch (reason) {
        setError((current) =>
          [current, reason instanceof Error ? reason.message : `«${file.name}» konnte nicht hochgeladen werden.`]
            .filter(Boolean)
            .join(" "),
        );
      } finally {
        setUploading((current) => {
          const index = current.indexOf(file.name);
          return index < 0 ? current : current.filter((_, position) => position !== index);
        });
      }
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  }

  async function download(attachment: RecordAttachment) {
    setError("");
    try {
      const data = await invokeAttachments({
        type: "createDownloadUrl",
        tenantId,
        attachmentId: attachment.id,
      });
      if (typeof data.url !== "string") throw new Error("Ungültige Antwort des Servers.");
      const link = document.createElement("a");
      link.href = data.url;
      link.rel = "noopener";
      link.target = "_blank";
      link.click();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Download ist fehlgeschlagen.");
    }
  }

  async function remove(attachment: RecordAttachment) {
    if (!window.confirm(`«${attachment.filename}» löschen?`)) return;
    setError("");
    try {
      await invokeAttachments({
        type: "delete",
        tenantId,
        attachmentId: attachment.id,
      });
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Anhang konnte nicht gelöscht werden.");
    }
  }

  return (
    <div className="record-attachments">
      <span className="record-attachments__label">Anhänge (Bilder, PDF)</span>
      {!readOnly ? (
        <div
          aria-label="Dateien hier ablegen oder zum Auswählen klicken"
          className={`record-attachments__dropzone${dragging ? " is-dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <UploadCloud aria-hidden="true" size={28} />
          <strong>Dateien hierher ziehen</strong>
          <span>oder klicken zum Auswählen · PDF, PNG, JPG, WebP · max. 25 MB</span>
          <input
            accept={ACCEPT}
            hidden
            multiple
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
            ref={inputRef}
            type="file"
          />
        </div>
      ) : null}
      {error ? (
        <p className="record-attachments__error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="record-attachments__list">
        {queued.map((file, index) => (
          <li key={`${file.name}-${index}`}>
            <Thumbnail file={file} />
            <div>
              <strong>{file.name}</strong>
              <small>{formatSize(file.size)} · wird beim Speichern hochgeladen</small>
            </div>
            <button
              aria-label={`«${file.name}» entfernen`}
              className="icon-button"
              onClick={() => onQueuedChange(queued.filter((_, position) => position !== index))}
              type="button"
            >
              <X size={16} />
            </button>
          </li>
        ))}
        {uploading.map((name, index) => (
          <li className="is-uploading" key={`uploading-${name}-${index}`}>
            <span className="record-attachments__icon" aria-hidden="true">
              <UploadCloud size={20} />
            </span>
            <div>
              <strong>{name}</strong>
              <small>Wird hochgeladen …</small>
            </div>
          </li>
        ))}
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <span className="record-attachments__icon" aria-hidden="true">
              {attachment.contentType === "application/pdf" ? (
                <FileText size={20} />
              ) : (
                <ImageIcon size={20} />
              )}
            </span>
            <div>
              <strong>{attachment.filename}</strong>
              <small>
                {formatSize(attachment.byteSize)} ·{" "}
                {new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(
                  new Date(attachment.createdAt),
                )}
              </small>
            </div>
            <button
              aria-label={`«${attachment.filename}» herunterladen`}
              className="icon-button"
              onClick={() => void download(attachment)}
              type="button"
            >
              <Download size={16} />
            </button>
            {!readOnly ? (
              <button
                aria-label={`«${attachment.filename}» löschen`}
                className="icon-button"
                onClick={() => void remove(attachment)}
                type="button"
              >
                <Trash2 size={16} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {loading ? <p className="record-attachments__hint">Anhänge werden geladen …</p> : null}
      {!loading &&
      !error &&
      entityId &&
      attachments.length === 0 &&
      uploading.length === 0 ? (
        <p className="record-attachments__hint">Noch keine Anhänge.</p>
      ) : null}
    </div>
  );
}
