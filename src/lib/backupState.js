// Backup reminder state is deliberately narrower than "any export".
// A successful full Arise backup qualifies; CSV/coach/event/partial exports do
// not, because they cannot restore the complete local-first store.

// New key on purpose: the old `arise.lastExportAt` was also written by CSV
// exports and cancelled/failed encrypted-backup attempts, so it cannot prove a
// recoverable backup exists.
export const LAST_FULL_BACKUP_AT_KEY = 'arise.lastFullBackupAt.v1';
export const BACKUP_REMINDER_DISMISSED_AT_KEY = 'arise.backupReminderDismissedAt';
export const BACKUP_REMINDER_INTERVAL_MS = 7 * 86400000;

// An "overdue" backup is the louder signal on top of the weekly reminder: two
// weeks without a full backup, or ten logged sessions since one. Both are
// measured locally — no notification permission, no server, nothing leaves
// the device.
export const BACKUP_OVERDUE_DAYS = 14;
export const SESSIONS_SINCE_BACKUP_WARN = 10;
const DAY_MS = 86400000;

function browserStorage(storage){
  if(storage) return storage;
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}

export function readBackupState(storage = null){
  const target = browserStorage(storage);
  if(!target) return { lastBackupAt:null, dismissedAt:null };
  try{
    return {
      lastBackupAt:target.getItem(LAST_FULL_BACKUP_AT_KEY),
      dismissedAt:target.getItem(BACKUP_REMINDER_DISMISSED_AT_KEY),
    };
  }catch{
    return { lastBackupAt:null, dismissedAt:null };
  }
}

export function markSuccessfulFullBackup({ storage = null, atISO = new Date().toISOString() } = {}){
  const target = browserStorage(storage);
  if(!target) return false;
  try{
    target.setItem(LAST_FULL_BACKUP_AT_KEY, atISO);
    return true;
  }catch{ return false; }
}

export function dismissBackupReminder({ storage = null, atISO = new Date().toISOString() } = {}){
  const target = browserStorage(storage);
  if(!target) return false;
  try{
    target.setItem(BACKUP_REMINDER_DISMISSED_AT_KEY, atISO);
    return true;
  }catch{ return false; }
}

function parseTime(value){
  if(value == null || value === '') return null;
  if(typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function backupReminderDue({
  history = [],
  lastBackupAt = null,
  dismissedAt = null,
  nowMs = Date.now(),
  intervalMs = BACKUP_REMINDER_INTERVAL_MS,
} = {}){
  const lastBackupMs = parseTime(lastBackupAt);
  const dismissedMs = parseTime(dismissedAt);
  const newestSession = history.length ? history[history.length - 1]?.dateISO : null;
  const newestSessionMs = parseTime(newestSession);
  const referenceMs = lastBackupMs ?? newestSessionMs;
  if(referenceMs == null) return false;
  if(nowMs - referenceMs <= intervalMs) return false;
  if(dismissedMs != null && nowMs - dismissedMs <= intervalMs) return false;
  return true;
}

/**
 * Backups that predate a session's timestamp. History is append-ordered by
 * date, so sessions logged after the last full backup are exactly the work
 * that exists nowhere but this device.
 */
export function sessionsSinceBackup({ history = [], lastBackupAt = null } = {}){
  const lastBackupMs = parseTime(lastBackupAt);
  if(lastBackupMs == null) return history.length;
  return history.filter(session=> {
    const at = parseTime(session?.savedAt) ?? parseTime(session?.dateISO);
    // A session with no readable timestamp is counted: under-counting work at
    // risk is the one error this signal must not make.
    return at == null || at > lastBackupMs;
  }).length;
}

/**
 * A single, renderable backup-recency summary for More/Today.
 *   daysSince   — whole days since the last full backup (null if never)
 *   sessions    — sessions logged since then
 *   overdue     — true at >14 days or >=10 sessions since the last backup
 *   never       — no full backup on record at all
 * `overdue` is never true on an empty history: a user with nothing logged has
 * nothing to lose yet, so nagging them would be noise.
 */
export function backupRecency({
  history = [],
  lastBackupAt = null,
  nowMs = Date.now(),
  overdueDays = BACKUP_OVERDUE_DAYS,
  warnSessions = SESSIONS_SINCE_BACKUP_WARN,
} = {}){
  const lastBackupMs = parseTime(lastBackupAt);
  const sessions = sessionsSinceBackup({ history, lastBackupAt });
  const daysSince = lastBackupMs == null ? null : Math.floor((nowMs - lastBackupMs) / DAY_MS);
  const never = lastBackupMs == null;
  const hasTraining = history.length > 0;
  const overdue = hasTraining && (
    (lastBackupMs != null && nowMs - lastBackupMs > overdueDays * DAY_MS)
    || sessions >= warnSessions
  );
  return { daysSince, sessions, overdue, never, lastBackupAt:lastBackupAt ?? null };
}

/** Human sentence: "Last backup: 3 days ago" / "Last backup: never". */
export function backupRecencyLabel(summary){
  if(!summary || summary.never) return 'Last backup: never';
  const days = summary.daysSince ?? 0;
  if(days <= 0) return 'Last backup: today';
  if(days === 1) return 'Last backup: 1 day ago';
  return `Last backup: ${days} days ago`;
}
