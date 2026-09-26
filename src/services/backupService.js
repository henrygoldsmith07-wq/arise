// Full-backup lifecycle. The successful-backup timestamp is written only after
// the browser download has been initiated successfully. Partial exports, CSV,
// coach summaries and cancelled/failed encrypted backups never pass here as a
// completed full backup.

import { buildExportPayload, downloadBackup } from '../lib/export.js';
import { cryptoAvailable, decryptBackup, encryptBackup, looksEncrypted } from '../lib/cryptoBackup.js';
import { markSuccessfulFullBackup } from '../lib/backupState.js';

function todayFrom(atISO){ return String(atISO).slice(0, 10); }

export function encryptedBackupSupported(){ return cryptoAvailable(); }

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
