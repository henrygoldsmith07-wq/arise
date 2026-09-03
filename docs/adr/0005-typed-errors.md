# ADR 0005 — Typed domain errors and the error-handling strategy

Date: 2026-09-03 · Status: accepted

## Context
Errors were ad-hoc `throw new Error('…')` with user-facing strings written by
engine modules and stack traces surfacing in the UI. Callers could not
programmatically distinguish "row missing" from "storage broken" from "import
rejected by policy".

## Decision
1. **Typed errors** (`core/errors.js`) extend `DomainError`, each carrying a
   stable `code` (`ERROR_CODES`), a developer-facing `message`, a user-safe
   `userMessage`, and optional `details`.
2. **Boundaries catch, log, recover or re-throw the same typed error** —
   hydration, import, sync and repository calls never leak raw exceptions to
   React; they convert or propagate.
3. **The UI renders `toUserMessage(err)`** — never stack traces. Unknown
   (non-domain) errors degrade to a generic, honest message.
4. **Programming errors stay loud**: `InvariantError` is never
   caught-and-swallowed; it should crash in development.

## Consequences
Callers can `switch (err.code)`; users see safe, actionable text; diagnostics
screens can label failures by stable code; tests assert on codes instead of
message strings.
