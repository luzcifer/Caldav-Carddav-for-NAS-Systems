import { useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Upload, FileText, Loader2 } from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { AttachmentItem, EntityType } from '../types';

interface AttachmentsPanelProps {
  entityType: EntityType;
  entityId: string | null;
  attachments: AttachmentItem[];
  onChange: (next: AttachmentItem[]) => void;
  readOnly?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  entityType,
  entityId,
  attachments,
  onChange,
  readOnly = false,
}: AttachmentsPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0 || !entityId) return;
    setUploading(true);
    setError(null);
    let current = [...attachments];
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiRequest<{ attachment: AttachmentItem }>(
          `/attachments/${entityType}/${entityId}`,
          { method: 'POST', body: fd },
        );
        current = [res.attachment, ...current];
      }
      onChange(current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(attId: string) {
    try {
      await apiRequest(`/attachments/${attId}`, { method: 'DELETE' });
      onChange(attachments.filter((a) => a.id !== attId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <div className="space-y-2.5 p-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface-2)]/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold flex items-center gap-1.5 text-[var(--text-primary)]">
          <Paperclip className="w-3.5 h-3.5 text-[var(--accent)]" />
          Dateianhänge ({attachments.length})
        </span>

        {!readOnly && entityId && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleFileSelect(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Datei hinzufügen
            </button>
          </>
        )}
      </div>

      {!entityId && (
        <p className="text-xs text-[var(--text-muted)]">
          Bitte zuerst speichern, um Dateien an diesen Eintrag anzuhängen.
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {entityId && attachments.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">Noch keine Dateien angehängt.</p>
      )}

      {attachments.length > 0 && (
        <ul className="divide-y divide-[var(--border-hairline)] rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
          {attachments.map((att) => (
            <li key={att.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                <div className="min-w-0">
                  <div className="font-medium truncate text-[var(--text-primary)]">{att.original_name}</div>
                  <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
                    {formatBytes(att.size_bytes)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title="Herunterladen"
                  onClick={() => void downloadAuthenticatedFile(`/attachments/${att.id}/download`, att.original_name)}
                  className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    title="Entfernen"
                    onClick={() => void handleDelete(att.id)}
                    className="p-1.5 rounded hover:bg-red-500/15 text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
