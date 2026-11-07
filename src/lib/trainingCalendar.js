// trainingCalendar.js — month grid of the days you trained (Hevy/Strong-style
// history calendar). Monday-first weeks; date-only, no time zones involved.
const pad = (n) => String(n).padStart(2, "0");

/** Sessions per calendar day (YYYY-MM-DD → count), deleted ones left out. */
export function trainedDays(history) {
  const out = new Map();
  for (const h of Array.isArray(history) ? history : []) {
    const d = String(h?.dateISO || "").slice(0, 10);
    if (!h || h.deletedAt || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out.set(d, (out.get(d) || 0) + 1);
  }
  return out;
}

/** Weeks of a month (month 1–12): arrays of 7 cells, null outside the month. */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Shift a { year, month } by n months. */
export const shiftMonth = ({ year, month }, n) => {
  const t = year * 12 + (month - 1) + n;
  return { year: Math.floor(t / 12), month: (t % 12) + 1 };
};
