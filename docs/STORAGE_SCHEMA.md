# Storage schema

How Arise persists data: the layout, the invariants, and the guarantees.
Field meanings are in `docs/DATA_DICTIONARY.md`.

## The layout

**IndexedDB is the canonical store.** `localStorage` keeps only lightweight
flags and the device id. One database, fourteen object stores:

```
profile          onboarding profile + preferences (keyPath: id)
sessions         history sessions, indexed by dateISO
sets             per-set records, indexed by session/date
programme        active schedule + program state
adaptations      programme-level adaptation records
recommendations  frozen pre-workout recommendation snapshots
outcomes         realised results paired to recommendations
events           consent-gated measurement events
readiness        readiness entries, indexed by dateISO
templates        user templates
quarantine       payloads that failed boot validation (never auto-deleted)
snapshots        rolling local backup snapshots
archive          archived old history (pagination/lazy loading)
tombstones       deletion markers for merge/sync
```

## Transactional writes

Every multi-store mutation runs in a single IndexedDB transaction — a save
either lands completely or not at all. There is no code path that writes
half a session. Persistence is debounced and awaited through a
`whenPersisted()` handle; the UI's "saved" indicator reflects the real
flush, not the intent.

## Boot: validation before trust

On every boot the recomposed store passes an integrity gate:

- schema validation per store (types, bounds, referential sanity);
- duplicate session/set detection, orphaned-block detection;
- impossible-value detection (negative loads/reps, invalid dates);
- schema-drift detection against the current version.

**Failure never boots a half-trusted store.** The broken payload is moved
to `quarantine` and recovery mode offers: repair from the last snapshot →
import a backup → start empty (quarantine preserved). Every repair is
logged to the events store.

## Migrations

Migrations are versioned, logged (each appends an immutable `migration`
event), dry-runnable, and failure-safe: a migration that throws leaves the
previous state intact and surfaces a recovery path instead of a blank
screen. The migration log is visible in the diagnostics screen.

## Snapshots

Rolling local snapshots (bounded count) are taken before risky operations
and periodically. The diagnostics screen lists them and can restore one —
the rollback path for bad imports, bad migrations, or a corrupted store.

## Queries and pagination

Sessions are indexed by date; history queries paginate and lazy-load older
pages rather than materialising the whole store. Very old history can be
archived (kept queryable, out of the hot path). Non-essential telemetry
events have a pruning policy; migration logs are exempt (they are the
diagnostic record).

## Quota

The diagnostics screen reports usage against the browser's quota and warns
before pressure matters. Browsers may evict under extreme storage pressure —
another reason the export habit (and `docs/BACKUP_RECOVERY.md`) exists.
