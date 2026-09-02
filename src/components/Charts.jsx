// Charts.jsx — the inline SVGs for Progress.
//
// No chart library and no canvas: these are <svg> elements painted with
// `currentColor`, so they inherit the ink colour and follow the OS theme
// without a second palette. Nothing animates, so `prefers-reduced-motion`
// needs no special case here (le-studio.css also clamps transitions globally).
//
// Every chart is `role="img"` with the model's `summary` as its accessible
// name, and repeats that summary as visible text below the drawing — the
// numbers stay readable when the picture is not.

function Empty({ children }){
  return <p className="text-xs text-ink3 mt-2">{children}</p>;
}

// Per-lift estimated 1RM: the logged points, the fitted trend, and the spread
// of those sessions around it drawn as a band rather than described in words.
export function E1rmSparkline({ model }){
  if(!model || model.n < 2) return <Empty>{model?.summary || 'Not enough loaded sets to plot.'}</Empty>;
  return (
    <figure className="mt-2 m-0">
      <svg
        viewBox={`0 0 ${model.width} ${model.height}`}
        width="100%"
        height={model.height}
        role="img"
        aria-label={model.summary}
        className="block text-ink overflow-visible"
        preserveAspectRatio="none"
      >
        {model.band && <path d={model.band} fill="currentColor" opacity="0.12" />}
        {model.trend && <path d={model.trend} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.45" strokeDasharray="3 3" />}
        <path d={model.line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        {model.points.map((p, i)=> (
          <circle key={`${p.dateISO}-${i}`} cx={p.x} cy={p.y} r={i === model.points.length - 1 ? 2.5 : 1.5} fill="currentColor">
            <title>{`${p.dateISO}: ${p.e1rm}kg`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="text-[11px] text-ink3 mt-1.5">
        {model.min}–{model.max}kg range • {model.confidence} confidence
        {model.bandHalfKg != null && <> • band ±{model.bandHalfKg}kg</>}
      </figcaption>
    </figure>
  );
}

// Weekly sets per muscle. Muscles are separated by opacity rather than hue so
// the chart survives both themes and monochrome printing; a muscle sitting in
// the `high` landmark band gets a hairline outline instead of a warning colour,
// because a breach is context, not a fault.
export function WeeklyMuscleVolumeChart({ model }){
  if(!model || !model.weeks.length) return <Empty>{model?.summary || 'No sets logged yet.'}</Empty>;
  const shade = muscle=>{
    const i = model.muscles.findIndex(m=> m.muscle === muscle);
    return 0.85 - Math.min(i, 5) * 0.13;
  };
  return (
    <figure className="mt-2 m-0">
      <svg
        viewBox={`0 0 ${model.width} ${model.height}`}
        width="100%"
        height={model.height}
        role="img"
        aria-label={model.summary}
        className="block text-ink"
        preserveAspectRatio="none"
      >
        {model.weeks.map(week=> (
          <g key={week.week}>
            {week.segments.map(seg=> (
              <rect
                key={`${week.week}-${seg.muscle}`}
                x={seg.x}
                y={seg.y}
                width={seg.w}
                height={Math.max(seg.h, 0.5)}
                fill="currentColor"
                opacity={shade(seg.muscle)}
                stroke={seg.breach ? 'currentColor' : 'none'}
                strokeWidth={seg.breach ? 0.75 : 0}
              >
                <title>{`${week.week} — ${seg.muscle}: ${seg.sets} sets${seg.breach ? ' (high landmark band)' : ''}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink3">
        {model.muscles.slice(0, 6).map(m=> (
          <span key={m.muscle} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-ink" style={{ opacity: shade(m.muscle) }} aria-hidden="true" />
            {m.muscle} {m.sets}
            {m.breach && <span className="text-ink2 font-semibold">· high</span>}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// Planned vs completed, one cell per scheduled session in date order. Filled =
// done, hollow = missed, dashed = still upcoming.
export function AdherenceStrip({ model }){
  if(!model || !model.cells.length) return <Empty>{model?.summary || 'No programme scheduled yet.'}</Empty>;
  return (
    <figure className="mt-2 m-0">
      <svg
        viewBox={`0 0 ${model.width} ${model.height}`}
        width="100%"
        height={model.height}
        role="img"
        aria-label={model.summary}
        className="block text-ink"
        preserveAspectRatio="none"
      >
        {model.cells.map(cell=> (
          <rect
            key={cell.id || cell.dateISO}
            x={cell.x}
            y="0"
            width={cell.w}
            height={cell.h}
            rx="1.5"
            fill={cell.state === 'done' ? 'currentColor' : 'none'}
            opacity={cell.state === 'upcoming' ? 0.35 : 1}
            stroke={cell.state === 'done' ? 'none' : 'currentColor'}
            strokeWidth="0.75"
            strokeDasharray={cell.state === 'upcoming' ? '2 2' : undefined}
          >
            <title>{`${cell.dateISO}${cell.title ? ` — ${cell.title}` : ''}: ${cell.state}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="text-[11px] text-ink3 mt-1.5">
        {model.done} done • {model.missed} missed • {model.upcoming} upcoming
        {model.rate != null && <> • {Math.round(model.rate * 100)}% of those due</>}
      </figcaption>
    </figure>
  );
}
