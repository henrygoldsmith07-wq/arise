# Import & export

The complete contract for getting data in and out of Arise. File formats are
versioned; imports are previewed before anything is applied.

## Export formats

**JSON backup (the full backup).** Versioned envelope:

```json
{
  "app": "arise",
  "contract": "arise.contract.v4",
  "contractMin": "arise.contract.v1",
  "payloadVersion": 5,
  "schemaVersion": 5,
  "exportedAt": "2026-09-05T08:00:00.000Z",
  "device": "dev_ab12cd-34ef56",
  "appVersion": "0.1.0",
  "data": { "...the store snapshot..." }
}
```

- `contract` / `contractMin` let future versions know which readers can
  open the file; `payloadVersion`/`schemaVersion` describe the data itself.
- `device` is an anonymous per-device id (generated locally) — it marks
  provenance in merges, it is not an identity.
- **Credentials never travel:** WebDAV config and the sync passphrase are
  stripped from every export and denied on import.

**Optional encryption.** Passphrase-derived (PBKDF2) AES-GCM sealed file —
the passphrase never leaves the device and is never stored in the backup.
Losing it loses the backup's readability; that is stated at encryption time.

**Partial exports.** History-only, settings-only, events-only — same
envelope, subset payload, importable through the same preview flow.

**CSV.** A standardised spreadsheet schema for history; exported values are
formula-injection-safe (leading `=`/`+`/`-`/`@` cell values are neutralised).

**Coach export.** A consent-gated, plain-language summary (Markdown + JSON)
for a human coach: best sets and weekly volume by default; readiness and
per-set detail only if you include them. No identity, no credentials. Can
go straight to the native share sheet.

## Import: always preview → confirm

`buildImportPreview()` is read-only. It:

1. adapts the file to the current contract (backward-compatible adapters
   for every older format — versioned envelopes, pre-contract JSON, gzip,
   encrypted);
2. validates the envelope and payload against the schemas;
3. counts what would change per entity and lists conflicts
   (same-id-different-content pairs);
4. applies the dangerous-field policy — fields like `preferences.sync`
   (credentials), telemetry consents and device identity are **denied**
   regardless of file content.

You then choose:

| Mode | Semantics |
|---|---|
| **Merge** | de-duplicate by id; newest `savedAt` wins; deletions travel as tombstones |
| **Replace** | total overwrite — the UI asks for explicit confirmation with the counts |

A file that fails validation is rejected whole, with the reason — never
half-applied. Hostile inputs (deep nesting, prototype-polluting keys,
absurd sizes) are handled by the fuzz-tested parser: descriptive error or
safe result, nothing in between.

## Recovery order of operations

Lost or weird data? Before anything else: **More → Storage & diagnostics**.
Restore a snapshot (fastest, local), then import a backup (authoritative),
then — last resort — quarantine-then-empty. Details:
`docs/BACKUP_RECOVERY.md`.
