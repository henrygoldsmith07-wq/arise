# Branding, trademark, and naming audit

Date: 2026-09-06 · Scope: name, logo, icons, public copy, store metadata,
screenshots. This page records what was checked, what was found, and what
was changed or consciously accepted.

## Name: "Arise"

**Risk level: moderate — documented, not yet actionable.**

- "Arise" is a common English verb; dictionary-word marks are inherently
  weak but registrable with acquired distinctiveness in a specific class.
- A same-class collision exists: **"Arise: Level Up In Real Life"**, an
  iOS/Android Health & Fitness app with workout logging and exercise
  rankings. Independent prior use helps, but the shared first word, shared
  category, and — before this audit — our "Training, levelled up" tagline
  made the pair *more* confusingly similar than necessary.
- A public gym chain ("ARISE Gym & Fitness") claims trademark rights in a
  related but brick-and-mortar class; low conflict for software, worth
  monitoring.
- **Recommendation:** if the project ever formalizes (app-store listing,
  company entity), run a professional clearance in class 9/44 and budget
  for a distinctive secondary mark ("Arise by …"). Until then the risk is
  documented and the differentiators below are in place.

### Differentiators adopted in this audit

- Public/store metadata uses the **"training log and coach"** positioning
  (see `manifest.webmanifest`), not level-up/game framing that echoes the
  colliding app's name.
- The in-app tagline "Training, levelled up." is retained as brand voice
  (it is descriptive of the attribute dashboard, not a franchise reference),
  but it is **not** used as the store-listing name.

## Logo and icons

`public/logo.svg` is a custom geometric mark: a rounded dark square with an
amber diagonal stroke forming an upward peak over a horizon bar. It is:

- not derived from any franchise or existing app mark (checked against the
  major fitness apps and superhero-branded merch lines);
- a plain geometric composition — the least protectable *and* least
  infringing kind of mark;
- consistent across `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`,
  and the splash screens, so store screenshots and install prompts all show
  the same distinct mark.

**No changes required.** If a formal trademark is pursued, this mark is the
candidate to register, not the word alone.

## Copy sweep (hero / avenger / power-level adjacent language)

Swept all user-facing strings (`src/`, `index.html`, `public/`,
`docs/PRODUCT.md`) for: hero, avenger, marvel/DC character names, "power
level", XP, infinity/stones, "beast mode", "epic/legendary" reward language.

Findings:

| Finding | Verdict |
|---|---|
| `heroSession`, `.home-hero` (CSS/layout vocabulary) | **Accepted** — layout terminology, never user-facing copy |
| `Infinity` / `-Infinity` in `src/lib/*.js` | **Accepted** — JS numeric sentinels, not copy |
| "Game-like training", "watch attributes grow" in `index.html` meta + `manifest.webmanifest` | **Changed** — public metadata neutralized (see below) |
| "Training, levelled up." tagline in-app | **Accepted** — brand voice, describes the derived-attribute dashboard; kept out of store-listing *name* |
| "Avg attribute X/100" UI label | **Accepted** — descriptive of the feature, no franchise term |
| AI-coach system prompt tone rules | **Accepted** — already forbids invented prescriptions and hype |

### Public metadata changes (this audit)

- `index.html` meta description: rewritten to
  *"A training log with scheduled programs and honest progression math — your
  data stays on your device. Offline-first, no account."* (was "game-like …
  watch attributes grow").
- `manifest.webmanifest`: `name` → "Arise — Training log and coach";
  `description` → "Training log with scheduled programs, load tracking, and
  progress derived from your real history. Offline-first." (was "Game-like
  training…").
- `public/landing.html` keeps the brand-voice headline but leads with the
  evidence-engine differentiator ("A coach that shows its work"), which no
  competitor in the collision space claims.

## Store listing copy (neutral, professional)

Ready-to-use listing text, kept free of hype and of any competitor's name:

> **Arise — Training log and coach**
> Log your lifts, follow a scheduled program, and see where your training is
> actually heading. Arise derives every suggestion from the history *you*
> log, explains its reasoning in plain language, and keeps all of your data
> on your own device. No account. Works offline. Export everything, any time.
>
> *For healthy adults; not medical advice — see the in-app disclaimers.*

Short description (Android-style, 80 chars):
`Training log with honest progression math. Your data stays on your device.`

## Screenshots

`docs/screenshots/` and `public/screenshots/` are captured from the real app
via `npm run screenshots` against a synthetic dataset. They contain:

- only Arise's own UI, own logo, own illustrations (CC BY-SA 4.0, attributed
  in-app and in docs);
- no third-party trademarks, device chrome, or celebrity imagery;
- clearly labeled sample data in demo screens ("Demo mode — sample data").

**No changes required.** The capture script should be re-run after any
visual change so store/landing assets never drift from the real UI.

## Terminology sweep (franchise-adjacent phrasing)

Checked for borrowed fantasy/RPG vocabulary beyond the tagline: "quests",
"boss fights", "skill trees", "loot", "prestige". None present. The domain
glossary (`docs/DATA_DICTIONARY.md`, ADRs) uses strength-training and
statistics vocabulary throughout.

## Residual risks, accepted

1. The word "Arise" alone remains weak and shared with the colliding app;
   differentiators above reduce confusion but do not eliminate it.
2. The tagline's "levelled up" phrasing stays in-app; if the collision app
   ever objects formally, this is the first string to revisit.
3. Community translations (if contributed later) must be swept with the same
   rules before release — this document is the checklist.
