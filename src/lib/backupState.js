// Backup reminder state is deliberately narrower than "any export".
// A successful full Arise backup qualifies; CSV/coach/event/partial exports do
// not, because they cannot restore the complete local-first store.

// New key on purpose: the old `arise.lastExportAt` was also written by CSV
// exports and cancelled/failed encrypted-backup attempts, so it cannot prove a
// recoverable backup exists.
export const LAST_FULL_BACKUP_AT_KEY = 'arise.lastFullBackupAt.v1';
export const BACKUP_REMINDER_DISMISSED_AT_KEY = 'arise.backupReminderDismissedAt';
export const BACKUP_REMINDER_INTERVAL_MS = 7 * 86400000;

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
