// cryptoBackup.js — encrypted backups for data that never leaves the device
// unencrypted.
//
// Arise's backups travel by hand: a file the user downloads, mails to
// themselves, or drops in a cloud folder. A plaintext JSON backup therefore
// leaks the user's full training history — bodyweight-adjacent loads, notes,
// pain tags — to whatever service touches that file. This module wraps the
// existing payload in AES-GCM 256 with a key derived from a passphrase via
// PBKDF2-SHA256 (310k iterations, OWASP 2023 guidance), so the same file can
// still be shared/stored anywhere but is useless without the passphrase.
//
// Payload format (binary envelope, little-endian magic, then JSON fields):
//   [4b magic 'ARCB'][1b format][1b reserved][2b salt len][salt][16b iv][ciphertext]
// ciphertext = AES-GCM(JSON.stringify(buildExportPayload(store)), key, iv, aad=magic)
//  AAD binds the header to the ciphertext, so a truncated/re-stitched file
//   fails authentication instead of decrypting to garbage.
//
// Fail-soft: WebCrypto is required (all modern browsers, secure contexts);
// the caller falls back to the existing plaintext flow with a notice when
// unavailable.

const MAGIC = [0x41, 0x52, 0x43, 0x42]; // 'ARCB'
const FORMAT = 1;
const PBKDF2_ITERATIONS = 310_000;
const HEADER_BYTES = 8; // magic(4) + format(1) + reserved(1) + saltLen(2)
const IV_BYTES = 12;
const TAG_BYTES = 16; // AES-GCM authentication tag (minimum ciphertext)
const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;

function subtle(){
  try{
    if(typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  }catch{}
  return null;
}

export function cryptoAvailable(){ return Boolean(subtle()); }

async function deriveKey(passphrase, salt){
  const enc = new TextEncoder();
  const baseKey = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt an already-built export payload into an .arisebak binary blob. */
export async function encryptBackup(payload, passphrase){
  if(!cryptoAvailable()) throw new Error('Encrypted backups need a browser with WebCrypto.');
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const aad = new Uint8Array(MAGIC);
  const plaintext = new TextEncoder().encode(text);
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext));
  const out = new Uint8Array(8 + salt.length + iv.length + ciphertext.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT; out[5] = 0;
  out[6] = salt.length & 0xff; out[7] = 0;
  out.set(salt, 8);
  out.set(iv, 8 + salt.length);
  out.set(ciphertext, 8 + salt.length + iv.length);
  return out;
}

/** Decrypt an .arisebak blob produced by encryptBackup. Returns the payload object. */
export async function decryptBackup(bytes, passphrase){
  if(!cryptoAvailable()) throw new Error('Encrypted backups need a browser with WebCrypto.');
  if(!(bytes instanceof Uint8Array) || bytes.length < HEADER_BYTES + MIN_SALT_BYTES + IV_BYTES + TAG_BYTES) throw new Error('This file is too short to be an Arise backup.');
  for(let i = 0; i < 4; i++) if(bytes[i] !== MAGIC[i]) throw new Error('Not an Arise encrypted backup (bad signature).');
  const format = bytes[4];
  if(format !== FORMAT) throw new Error(`Unsupported backup format ${format}.`);
  // The salt length is attacker-controlled. Validate it against the real byte
  // length before slicing: an out-of-range value would otherwise feed PBKDF2
  // and AES-GCM inconsistent salt/iv/ciphertext slices (or a huge salt).
  const saltLen = bytes[6];
  if(saltLen < MIN_SALT_BYTES || saltLen > MAX_SALT_BYTES) throw new Error('Invalid backup header — bad salt length.');
  if(bytes.length < HEADER_BYTES + saltLen + IV_BYTES + TAG_BYTES) throw new Error('This file is too short to be an Arise backup.');
  const salt = bytes.slice(HEADER_BYTES, HEADER_BYTES + saltLen);
  const iv = bytes.slice(HEADER_BYTES + saltLen, HEADER_BYTES + saltLen + IV_BYTES);
  const ciphertext = bytes.slice(HEADER_BYTES + saltLen + IV_BYTES);
  if(iv.length !== IV_BYTES || ciphertext.length < TAG_BYTES) throw new Error('This file is too short to be an Arise backup.');
  const key = await deriveKey(passphrase, salt);
  const aad = new Uint8Array(MAGIC);
  let plainBuf;
  try{
    plainBuf = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext);
  }catch{
    // Wrong passphrase or corrupted file — indistinguishable by design.
    throw new Error('Wrong passphrase, or the file is damaged.');
  }
  try{ return JSON.parse(new TextDecoder().decode(plainBuf)); }
  catch{ throw new Error('Backup decrypted but its contents are unreadable.'); }
}

/** True when the file looks like our encrypted envelope (by magic bytes). */
export function looksEncrypted(bytes){
  return bytes instanceof Uint8Array && bytes.length > 8 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}
