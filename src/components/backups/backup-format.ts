/**
 * Pure helpers for the backups settings UI (docs/drafts/p11-plan.md U2).
 */
import type { BackupKind } from "@/lib/tessera/types";

export const BACKUP_KIND_LABEL: Record<BackupKind, string> = {
  auto: "Automatic",
  manual: "Manual",
  migration: "Migration",
  "pre-restore": "Pre-restore",
};

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when the newest auto backup is older than 48 hours or missing. */
export function autoBackupStale(lastAutoAt: string | null, nowIso: string): boolean {
  if (lastAutoAt === null) return true;
  return Date.parse(nowIso) - Date.parse(lastAutoAt) > 48 * 60 * 60 * 1000;
}
