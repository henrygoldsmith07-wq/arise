# Arise user guide

Everything in Arise lives on your device. There is no account, no server and
no sync unless you deliberately configure one. This guide walks the app the
way you will actually use it: first run → training day → reading your
progress → taking care of your data.

---

## First five minutes

1. **Onboarding** asks goal, training location, available equipment, level,
   days per week and session length. Answer honestly rather than ambitiously —
   every recommendation is filtered through these answers, and the equipment
   answer is a hard honesty gate (a bodyweight-only user is never shown a
   barbell lift as "recommended"). Barbell users can optionally enter their
   plate inventory, which makes load targets achievable-by-construction.
   Saving builds your first programme from these answers — the days-per-week,
   session-length and liked/avoided-movement answers all apply. If you train
   fewer days than the programme was written for, its sessions **rotate**
   week to week (a 3-day user on a 4-day upper/lower gets every upper and
   lower session in turn) rather than one session being dropped for good.
   The last step, **Fine-tune preferences**, is where you mark movements to
   **Like** (preferred when substituting) or **Avoid** (never prescribed).
   Exercises are grouped by muscle — tap a group to open it; each header
   shows how many you've liked and avoided. Type in the search box to find a
   lift by name, muscle or kit; gym shorthand works too (`db` for dumbbell,
   `rdl` for Romanian deadlift, `lat` for pulldowns, `pec`/`chest`). Muscle
   chips narrow the list, and **Show my picks** lists only what you've marked.
   Liking a movement clears an Avoid on it and vice versa.
2. **Today** is the home screen. It shows the session scheduled for today —
   or "up next" on rest days — and nothing else competes with it.
3. **Train → pick a program** creates a dated schedule. The schedule lives
   locally; missed days simply stay missed, nothing silently reshuffles.

## Training day

- Open the session from **Today**. Sets are logged inline: reps, load, RPE
  (leave load blank for bodyweight). Every barbell, dumbbell, machine and
  cable lift has a load field and the plate/stack keypad.
- **Gym Mode** (session header toggle) is the one-thumb layout: focus on one
  exercise at a time, large touch targets, swipe right to complete / left to
  mark a set failed, long-press to edit, and a load numpad with equipment-aware
  quick-add buttons (plates, dumbbell steps, machine increments).
- First time on a loaded lift with no history? Tap **Not sure what weight? Find it** on the exercise: do one easy set, enter weight, reps and how many you had left, and you get a starting weight (an estimate, rounded down to what your kit can load).
- **Setup notes**: on any lift tap **Add setup (seat, pin, grip)** to save the seat height, pin or stack position, grip and bench/back angle (plus one free note). It shows under the target the next time you do that lift in Gym Mode, the session runner and Guided mode. Each logged session remembers the setup you used, the lift's history sheet shows it, and if today's note differs from last time's you get a "Changed since last time (was …)" line. Notes stay on your device, ride along in your backup and sync (the newest edit per lift wins), and **Clear** removes one.
- **Rest timer** auto-starts after a completed set (configurable in More).
  It announces the last seconds with sound/haptics/voice per your settings,
  keeps running in a dock while you browse, and can hold the screen awake.
- The runner shows **last time's sets** per exercise and the engine's target
  with its reason ("+2.5 kg — reps target hit twice at this load").
- Notes are free-text; quick tags capture pain, soreness and session quality
  in one tap. Pain/discomfort tags actively soften future recommendations.

## My programme: edit the plan you are running

Tap **Train → Edit programme** to make the running programme yours without
rebuilding it as a template.

- Pick a day (its tab shows **•** once edited). Each exercise shows its
  **sets × reps**, with controls to **Swap**, change **sets** (1–8) and the
  **rep range** (bottom/top steppers; timed holds step in 5-second jumps),
  **move up/down** and **remove** (a day always keeps at least one exercise).
- **Swap** lists the closest alternatives your kit supports (same muscle and
  movement first, liked exercises lifted, avoided ones never shown). After a
  swap the original is always first in the list, so swapping back is one tap.
- **Rest** has its own stepper per exercise (15-second steps, 15 s to 5 min).
  The rest timer in the session uses exactly that value (a rest you saved
  for a lift in Gym Mode still wins).
- **Pair with next** turns an exercise and the one below it into a
  **superset** (shown as Superset A / B; **Unpair** splits them). In the
  session, Gym Mode and Guided mode you alternate A1 → B1, then get **one rest** (the
  longer of the two rests), then A2 → B2, and so on. Moving or removing one
  half splits the pair; swapping either half keeps it. Session-length
  estimates count one rest per round.
- **+ Add exercise** searches the exercises your kit supports; **Rename day**
  changes the name everywhere it shows.
- Changes apply to **every upcoming session of that day**, across all weeks.
  Completed sessions are never rewritten. Values you did not touch keep each
  week's own template progression (week 2's extra reps survive a swap).
- Customised days and exercises carry an **Edited** badge; the Train card
  says **Customised**, and Today marks **your swap**.
- **Undo** reverses the last change. **Reset this day** or **Reset all to
  template** puts the programme back exactly as generated (with confirmation,
  and undoable).
- Progress and the load engine follow the **exercise**, not the slot: history
  logged on a lift is still there when you swap back to it.
- Edits belong to this programme. Starting a different programme (or
  clearing the schedule) asks first, because it clears them, and offers
  **Save as my template** so you keep a copy. They are stored on this device
  with the programme and travel in backups, exports and sync.
- **Save as my template** (bottom of the editor) turns the programme as it
  stands now (your edits included, every week of the block) into a template
  under **Train → Build my own & my templates**. After saving, **Copy share
  code** gives you a code a friend can import.
- When a block ends with customised days, Today offers **Start next block from
  my edits**: it saves the template and starts a fresh block from it in one
  tap, so the next block begins with your changes already in place.

## Block plan: see the whole block

Train → **Block plan** lays out every week of your current block: the sessions, their sets, and how many hard sets each muscle gets that week (main muscle of each exercise only; a rough 6–20 range is shown as a guide, not a rule).

- **Make deload week** cuts that week's planned sets by the same factor the weekly review uses and leaves your loads alone. **Make normal week** puts the exact original sets back. Weeks you have already finished cannot be changed.
- **Add a week** copies your latest normal week onto the same weekdays when the block runs out. **Remove the week I added** takes it back while nothing in it is done.
- A build week with more than about 20 sets for one muscle is flagged. Low volume is not: it is the right call when you are protecting a muscle on purpose, such as legs before big rides.

## Choose your training days

On Train, the weekday card lets you pick which days you lift. Upcoming sessions re-date onto those days and avoid your ride days. Tap Move on any session to shift it to another day; if that day is taken, the two sessions swap.

**Add to calendar.** Under the weekday card, pick a start time and reminder, then tap Add to calendar. You get a calendar file with your next planned sessions (exercises, sets, reps, estimated length). Moved a session? Export again: your calendar updates the same events rather than adding copies.

## Reading your progress

Mistyped a set? Progress → **Edit logged workouts** lets you fix the load, reps or RPE, delete a set, or delete a whole session. It stays on your device.

- **Progress** shows weekly volume, estimated strength trend, streak and
  consistency, PRs (with fake-PR filtering — jitter and technique-change PRs
  are flagged, not celebrated), and per-muscle volume-balance advice.
- **Weekly Review** is the defining weekly interaction: adherence, what the
  engine noticed, the graduated recovery read from your own readiness
  check-ins, and the directives for next week. Skim it once a week;
  ignore it daily. "Export as Markdown" below the review hands the whole week
  (including the engine's verdicts and the evidence behind them) to the
  platform share sheet or your clipboard — your record, your format,
  generated entirely on-device.
- **Ask the coach** (Today, after the Weekly Review; also on Progress): a
  plain-language question about your training — "explain my week", "am I
  improving?", "why did my bench press stall?" — answered on-device from the
  engines' own findings, with reasons and evidence. Nothing leaves the device;
  the optional cloud coach stays an explicit opt-in under More → Privacy &
  integrations.
- Attributes (Strength / Endurance / Consistency / Technique) derive only
  from your logged history — never from program labels.

## Body weight and strength for your size

Progress → **Body weight** is optional. Log a weigh-in (or type it in the Today check-in) and Arise shows the trend and, for each lift you trained lately, your estimated max as a multiple of your body weight, compared with the 8 weeks before. That answers "did I get stronger, or just heavier?" — handy when you also ride or run and weight matters. Pull-ups, chin-ups and dips count your body weight plus any added load minus assistance. Machine and cable stacks are not comparable between gyms, so treat the multiple as a way to compare yourself with you. Day-to-day swings of 1–2 kg are water; the trend waits for entries a week apart. Stays on your device; Export and sync carry it.

## Your data

- **More → Data:** export (JSON backup, optionally passphrase-encrypted;
  partial exports for history / settings / events only), import with preview
  and conflict handling, CSV export for spreadsheets.
- **Automatic local backups:** rolling snapshots are kept on-device; the
  diagnostics screen shows storage health and can restore a snapshot.
- **Cross-device sync (optional):** More → Sync. You provide your own WebDAV
  storage (Nextcloud, Fastmail, Synology…). See `docs/SYNC_GUIDE.md`.
- Clearing local data is total and immediate — export first.

## Settings that matter (More)

| Setting                                | Effect                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Sound cues / voice coach / speech rate | Rest-countdown audio; voice announces exercise and rep targets                  |
| Haptics                                | Vibration patterns (Android; iOS Safari has no vibration API)                   |
| Gym mode preferences                   | Focus mode, auto rest start, wake lock                                          |
| Units, theme                           | kg/lb; system / light / dark                                                    |
| Consent center                         | Telemetry (off by default), Pulse, health summary — each independent, revocable |
| Accessibility                          | Large text, high contrast, reduced motion                                       |

## Where to go deeper

- How the engine thinks: `docs/METHODOLOGY.md`
- What the app refuses to claim: `docs/CANNOT_PROVE.md`
- Every stored field: `docs/DATA_DICTIONARY.md`
- When things go wrong: `docs/TROUBLESHOOTING.md`
