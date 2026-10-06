// Full-backup lifecycle. The successful-backup timestamp is written only after
// the browser download has been initiated successfully. Partial exports, CSV,
// coach summaries and cancelled/failed encrypted backups never pass here as a
// completed full backup.

import { buildExportPayload, compressPayload, downloadBackup } from '../lib/export.js';
import { cryptoAvailable, decryptBackup, encryptBackup, looksEncrypted } from '../lib/cryptoBackup.js';
import { markSuccessfulFullBackup } from '../lib/backupState.js';
import { canShareFiles, shareFile } from '../lib/nativeShare.js';

function todayFrom(atISO){ return String(atISO).slice(0, 10); }

export function encryptedBackupSupported(){ return cryptoAvailable(); }

/** Can the platform share a backup file directly? Gates the one-tap button. */
export function backupShareSupported(){
  return canShareFiles({ mimeType:'application/json', filename:'arise-backup.arise' });
}

export async function downloadFullBackup(store, {
  atISO = new Date().toISOString(),
  download = downloadBackup,
  buildPayload = buildExportPayload,
  storage = null,
} = {}){
  const payload = buildPayload(store);
  const filename = `arise-backup-${todayFrom(atISO)}.arise`;
  await download(payload, filename);
  markSuccessfulFullBackup({ storage, atISO });
  return { filename, atISO };
}

/**
 * One-tap export: hand the real backup File to the share sheet when the
 * platform can take it (Android/iOS — "Save to Files", AirDrop, mail), else
 * fall back to the ordinary download. Either path counts as a full backup, so
 * the recency clock and the reminder clear exactly as they do for a download.
 *
 * `share` can return 'cancelled' — the user swiped the sheet away. That is a
 * deliberate no-op: nothing was saved, so nothing is marked as backed up.
 */
export async function exportFullBackup(store, {
  atISO = new Date().toISOString(),
  download = downloadBackup,
  buildPayload = buildExportPayload,
  buildFile = null,
  share = shareFile,
  canShare = canShareFiles,
  storage = null,
} = {}){
  const filename = `arise-backup-${todayFrom(atISO)}.arise`;
  const payload = buildPayload(store);

  if(canShare({ mimeType:'application/json', filename })){
    const file = buildFile
      ? buildFile(payload, filename)
      : await toBackupFile(payload, filename);
    const outcome = await share(file, 'Arise backup');
    if(outcome === 'shared'){
      markSuccessfulFullBackup({ storage, atISO });
      return { filename, atISO, method:'shared' };
    }
    // 'cancelled' is an explicit user decision — do not silently download.
    if(outcome === 'cancelled') return { filename, atISO, method:'cancelled' };
  }

  await download(payload, filename);
  markSuccessfulFullBackup({ storage, atISO });
  return { filename, atISO, method:'downloaded' };
}

/** Serialise a backup payload to a File using the same envelope as the download. */
async function toBackupFile(payload, filename){
  const { envelope } = await compressPayload(payload);
  const blob = new Blob([JSON.stringify(envelope)], { type:'application/json' });
  if(typeof File === 'function') return new File([blob], filename, { type:'application/json' });
  return blob;
}

export function triggerBinaryDownload(bytes, filename, {
  createObjectURL = (blob)=> URL.createObjectURL(blob),
  revokeObjectURL = (url)=> URL.revokeObjectURL(url),
  createAnchor = ()=> document.createElement('a'),
  schedule = (fn, ms)=> setTimeout(fn, ms),
} = {}){
  const blob = new Blob([bytes], { type:'application/octet-stream' });
  const url = createObjectURL(blob);
  const anchor = createAnchor();
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  schedule(()=> revokeObjectURL(url), 2000);
}

export async function downloadEncryptedFullBackup(store, passphrase, {
  atISO = new Date().toISOString(),
  buildPayload = buildExportPayload,
  encrypt = encryptBackup,
  triggerDownload = triggerBinaryDownload,
  storage = null,
} = {}){
  if(typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Use at least 8 characters for an encrypted backup passphrase.');
  const payload = buildPayload(store);
  const bytes = await encrypt(payload, passphrase);
  const filename = `arise-backup-${todayFrom(atISO)}.arisebak`;
  await triggerDownload(bytes, filename);
  markSuccessfulFullBackup({ storage, atISO });
  return { filename, atISO };
}

export async function decryptEncryptedFullBackup(bytes, passphrase){
  if(!looksEncrypted(bytes)) throw new Error('Not an Arise encrypted backup file.');
  return decryptBackup(bytes, passphrase);
}
