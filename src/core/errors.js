// core/errors.js — typed domain errors and the error-handling strategy.
//
// Strategy (ADR 0005):
//   1. Errors that CARRY INFORMATION for the user or the caller are thrown as
//      typed DomainErrors with a stable `code` and a user-safe message.
//   2. Boundaries (import, sync, hydration, repository calls) catch, log via
//      reportError, and either recover or re-throw the SAME typed error.
//   3. The UI renders `toUserMessage(err)` — never raw stack traces.
//   4. Programming errors (invariant violations) stay loud: they extend
//      DomainError but are never caught-and-swallowed.

/** Stable error codes — safe to switch on in callers and tests. */
export const ERROR_CODES = Object.freeze({
  VALIDATION: 'validation',
  NOT_FOUND: 'not-found',
  CONFLICT: 'conflict',
  STORAGE: 'storage',
  IMPORT_REJECTED: 'import-rejected',
  MIGRATION_FAILED: 'migration-failed',
  CRYPTO: 'crypto',
  SYNC: 'sync',
  FLAG_DISABLED: 'flag-disabled',
  INVARIANT: 'invariant',
});

export class DomainError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message developer-facing detail
   * @param {{ userMessage?: string, details?: object, cause?: Error }} [meta]
   */
  constructor(code, message, { userMessage, details, cause } = {}){
    super(message, { cause });
    this.name = 'DomainError';
    this.code = code;
    this.userMessage = userMessage || message;
    this.details = details;
  }
  toJSON(){
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export class ValidationError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.VALIDATION, message, meta); this.name = 'ValidationError'; }
}
export class NotFoundError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.NOT_FOUND, message, meta); this.name = 'NotFoundError'; }
}
export class ConflictError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.CONFLICT, message, meta); this.name = 'ConflictError'; }
}
export class StorageError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.STORAGE, message, { userMessage: 'Saving or reading your data failed. Your last export is always a safe fallback.', ...meta }); this.name = 'StorageError'; }
}
export class ImportRejectedError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.IMPORT_REJECTED, message, { userMessage: 'This backup could not be imported safely.', ...meta }); this.name = 'ImportRejectedError'; }
}
export class MigrationFailedError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.MIGRATION_FAILED, message, meta); this.name = 'MigrationFailedError'; }
}
export class CryptoError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.CRYPTO, message, meta); this.name = 'CryptoError'; }
}
export class SyncError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.SYNC, message, { userMessage: 'Sync failed. Your local data is unaffected.', ...meta }); this.name = 'SyncError'; }
}
export class FlagDisabledError extends DomainError {
  constructor(flag, meta){ super(ERROR_CODES.FLAG_DISABLED, `Feature flag "${flag}" is not enabled.`, { userMessage: 'This capability is not enabled yet.', details: { flag }, ...meta }); this.name = 'FlagDisabledError'; }
}
export class InvariantError extends DomainError {
  constructor(message, meta){ super(ERROR_CODES.INVARIANT, message, meta); this.name = 'InvariantError'; }
}

/** User-safe message for ANY thrown value (typed or not). */
export function toUserMessage(err){
  if(err instanceof DomainError) return err.userMessage;
  if(err instanceof RangeError || err instanceof TypeError) return 'Something went wrong on this device. Please try again.';
  return String(err?.message || err || 'Something went wrong.');
}

/** True for typed domain errors carrying a stable code. */
export function isDomainError(err){
  return err instanceof DomainError;
}

/** Human-readable label for a stable code (diagnostics screens). */
export function errorCodeLabel(code){
  return String(code || '').replace(/-/g, ' ');
}
