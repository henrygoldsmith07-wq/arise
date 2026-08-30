// charts.js — chart geometry for Progress.
//
// Pure functions: each takes logged history and returns coordinates, path
// strings and a `summary` sentence. The SVG components stay declarative and
// the maths stays testable in plain node.
//
// Deliberately no chart library — four chart types would multiply a ~268K
// bundle, and `le-studio.css` already owns the colours. Components paint with
// `currentColor` and opacity so OS theme is respected for free, and every
// model carries `summary`: the text equivalent that replaces the drawing for
// a screen reader, and the honest description of what was actually measured.

import { strengthSeriesWithConfidence, volumeLandmarks, weekKey } from './analytics.js';

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

// Build an SVG path from points. Straight segments only: a smoothed spline
// would draw e1RM values between sessions that were never logged.
export function linePath(points){
  if(!points || !points.length) return '';
  return points.map((p, i)=> `${i ? 'L' : 'M'}${round(p.x, 1)} ${round(p.y, 1)}`).join(' ');
}

// Linear fit on the point index — the same x the engine regresses on in
// `strengthSeriesWithConfidence`, so the drawn line matches the reported slope.
function fit(ys){
  const n = ys.length;
  const xs = ys.map((_, i)=> i);
  const my = ys.reduce((a, b)=> a + b, 0) / n;
  const mx = xs.reduce((a, b)=> a + b, 0) / n;
  let num = 0, den = 0;
  for(let i = 0; i < n; i++){ num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const predict = x=> intercept + slope * x;
  // Residual standard error. With n-2 degrees of freedom this is undefined at
  // n<3, which is exactly where the engine already refuses to claim a trend.
  let ssRes = 0;
  for(let i = 0; i < n; i++) ssRes += (ys[i] - predict(xs[i])) ** 2;
  const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : null;
  return { slope, intercept, predict, se };
}

// Per-lift estimated-1RM sparkline with the confidence band *drawn* rather
// than described. The band is ±1.96 residual standard errors around the fitted
// line — the spread of the sessions already logged, not a forecast, and never
// drawn below the engine's own three-point floor.
export function e1rmChartModel(history, exerciseId, opts = {}){
  const width = opts.width ?? 280;
  const height = opts.height ?? 64;
  const pad = opts.pad ?? 5;
  const series = strengthSeriesWithConfidence(history || [], exerciseId);
  const pts = series.pts || [];
  const base = {
    exerciseId,
    n: pts.length,
    confidence: series.confidence,
    slope: series.slope ?? 0,
    r2: series.r2 ?? null,
    width,
    height,
    points: [],
    line: '',
    band: null,
    trend: '',
    min: null,
    max: null,
  };
  if(pts.length < 2){
    return { ...base, summary: pts.length
      ? 'One loaded set logged for this exercise — a trend needs at least two.'
      : 'No loaded sets logged for this exercise yet.' };
  }

  const ys = pts.map(p=> p.e1rm);
  const { predict, se } = fit(ys);
  const bandHalf = se == null ? 0 : 1.96 * se;

  // The band is part of the picture, so it belongs in the domain — otherwise
  // it clips at the frame and reads narrower than it is.
  const candidates = [...ys];
  if(bandHalf > 0) for(let i = 0; i < ys.length; i++){ candidates.push(predict(i) + bandHalf, predict(i) - bandHalf); }
  let lo = Math.min(...candidates);
  let hi = Math.max(...candidates);
  if(hi === lo){ lo -= 1; hi += 1; }

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = i=> pad + (pts.length === 1 ? innerW / 2 : (i * innerW) / (pts.length - 1));
  const y = v=> pad + innerH - ((v - lo) / (hi - lo)) * innerH;

  const points = pts.map((p, i)=> ({ x: round(x(i), 1), y: round(y(p.e1rm), 1), e1rm: p.e1rm, dateISO: p.dateISO }));
  const trendPoints = pts.map((_, i)=> ({ x: x(i), y: y(predict(i)) }));

  let band = null;
  if(bandHalf > 0){
    const upper = pts.map((_, i)=> ({ x: x(i), y: y(predict(i) + bandHalf) }));
    const lower = pts.map((_, i)=> ({ x: x(i), y: y(predict(i) - bandHalf) })).reverse();
    band = `${linePath(upper)} ${linePath(lower).replace(/^M/, 'L')} Z`;
  }

  const best = Math.max(...ys);
  const direction = series.slope > 0.1 ? 'rising' : series.slope < -0.1 ? 'falling' : 'flat';
  const bandText = band
    ? ` The shaded band is ±${round(bandHalf, 1)}kg — the spread of these sessions around the trend, not a prediction.`
    : ' Too few sessions to draw a spread.';

  return {
    ...base,
    points,
    line: linePath(points),
    trend: linePath(trendPoints),
    band,
    bandHalfKg: band ? round(bandHalf, 1) : null,
    min: Math.min(...ys),
    max: best,
    summary: `${pts.length} loaded sessions, best estimated 1RM ${best}kg. Trend ${direction} at ${round(series.slope, 2)}kg per session (${series.confidence} confidence).${bandText}`,
  };
}

// Weekly sets per muscle as a stacked bar. Muscles sitting in the `high`
// landmark band are flagged — a breach is context worth seeing, not a warning
// that something is wrong, so the model carries the band name too.
export function stackedVolumeModel(history, byId, opts = {}){
  const weeks = opts.weeks ?? 8;
  const width = opts.width ?? 280;
  const height = opts.height ?? 72;
  const gap = opts.gap ?? 2;

  const byWeek = new Map();
  for(const session of history || []){
    const key = weekKey(new Date(`${session.dateISO}T00:00:00`));
    if(!byWeek.has(key)) byWeek.set(key, new Map());
    const bucket = byWeek.get(key);
    for(const block of session.blocks || []){
      const muscle = byId?.[block.exerciseId]?.muscle || 'Other';
      if(muscle === 'Cardio') continue;
      bucket.set(muscle, (bucket.get(muscle) || 0) + (block.sets || []).length);
    }
  }

  const keys = [...byWeek.keys()].sort().slice(-weeks);
  const landmarks = volumeLandmarks(history || [], byId);
  const totals = new Map();
  for(const key of keys) for(const [muscle, sets] of byWeek.get(key)) totals.set(muscle, (totals.get(muscle) || 0) + sets);
  const order = [...totals.keys()].sort((a, b)=> totals.get(b) - totals.get(a) || a.localeCompare(b));

  const empty = { weeks: [], muscles: [], max: 0, width, height, summary: 'No sets logged yet — the weekly breakdown appears once you train.' };
  if(!keys.length) return empty;

  const max = Math.max(1, ...keys.map(key=> [...byWeek.get(key).values()].reduce((a, b)=> a + b, 0)));
  const barW = keys.length ? (width - gap * (keys.length - 1)) / keys.length : width;

  const bars = keys.map((key, i)=>{
    const bucket = byWeek.get(key);
    const total = [...bucket.values()].reduce((a, b)=> a + b, 0);
    let cursor = height;
    const segments = order.filter(muscle=> bucket.get(muscle)).map(muscle=>{
      const sets = bucket.get(muscle);
      const h = (sets / max) * height;
      cursor -= h;
      return {
        muscle,
        sets,
        x: round(i * (barW + gap), 1),
        y: round(cursor, 1),
        w: round(barW, 1),
        h: round(h, 1),
        band: landmarks[muscle]?.band || null,
        breach: landmarks[muscle]?.band === 'high',
      };
    });
    return { week: key, total, x: round(i * (barW + gap), 1), w: round(barW, 1), segments };
  });

  const breached = order.filter(muscle=> landmarks[muscle]?.band === 'high');
  const muscles = order.map(muscle=> ({
    muscle,
    sets: totals.get(muscle),
    band: landmarks[muscle]?.band || null,
    breach: landmarks[muscle]?.band === 'high',
  }));

  return {
    weeks: bars,
    muscles,
    max,
    width,
    height,
    summary: `Weekly sets by muscle over ${keys.length} week${keys.length === 1 ? '' : 's'}, peaking at ${max} sets. `
      + `${muscles.slice(0, 3).map(m=> `${m.muscle} ${m.sets}`).join(', ')}. `
      + (breached.length
        ? `${breached.join(' and ')} sit in the high landmark band — rough context, not a target.`
        : 'No muscle is in the high landmark band.'),
  };
}

// Planned vs completed as a strip: one cell per scheduled session, in date
// order. A future session is `upcoming`, never `missed` — the same rule the
// programme-adherence card already applies to the percentage.
export function adherenceStripModel(schedule, history, opts = {}){
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const width = opts.width ?? 280;
  const height = opts.height ?? 14;
  const gap = opts.gap ?? 2;

  const sessions = [...(schedule?.sessions || [])].sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const doneIds = new Set((history || []).map(h=> h.id));
  const empty = { cells: [], done: 0, missed: 0, upcoming: 0, total: 0, rate: null, width, height, summary: 'No programme scheduled yet.' };
  if(!sessions.length) return empty;

  const cellW = (width - gap * (sessions.length - 1)) / sessions.length;
  const cells = sessions.map((session, i)=>{
    const done = doneIds.has(session.id) || session.status === 'done';
    const state = done ? 'done' : String(session.dateISO) >= today ? 'upcoming' : 'missed';
    return {
      id: session.id,
      dateISO: session.dateISO,
      title: session.title || '',
      state,
      x: round(i * (cellW + gap), 1),
      w: round(cellW, 1),
      h: height,
    };
  });

  const count = state=> cells.filter(c=> c.state === state).length;
  const done = count('done');
  const missed = count('missed');
  const upcoming = count('upcoming');
  const elapsed = done + missed;

  return {
    cells,
    done,
    missed,
    upcoming,
    total: cells.length,
    rate: elapsed ? round(done / elapsed, 2) : null,
    width,
    height,
    summary: `${cells.length} scheduled sessions: ${done} completed, ${missed} missed, ${upcoming} still upcoming. `
      + (elapsed ? `${Math.round((done / elapsed) * 100)}% of sessions due so far were completed.` : 'None are due yet.'),
  };
}
