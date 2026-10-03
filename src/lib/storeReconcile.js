// Deterministic deep equality: object keys are compared irrespective of
// insertion order. JSON.stringify alone is key-order sensitive, so a row that
// merely round-tripped through IndexedDB with reordered keys looked like a
// conflicting edit — and could resurrect a row the other tab deleted.
function canonicalise(value){
  if(value === null || typeof value !== 'object') return value;
  if(Array.isArray(value)) return value.map(canonicalise);
  const out = {};
  for(const key of Object.keys(value).sort()) out[key] = canonicalise(value[key]);
  return out;
}

function same(a,b){
  if(a === b) return true;
  if(a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  try{ return JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b)); }catch{ return false; }
}

// Rows leave the reconciler as fresh shallow copies: merged output must never
// share row objects with an input snapshot the caller still holds.
function rowCopy(row){
  return row && typeof row === 'object' ? { ...row } : row;
}

function reconcileValue(base, local, remote){
  if(same(local, base)) return remote;
  if(same(remote, base)) return local;
  if(local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)){
    const out = {};
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)]);
    for(const key of keys){
      // A key deleted on one side while the other side edited it resolves to
      // the edited value; a key deleted on both sides (or deleted locally and
      // untouched remotely) stays absent — never an enumerable `undefined`
      // phantom that survives into structuredClone and property enumeration.
      const resolved = reconcileValue(base?.[key], local[key], remote[key]);
      if(resolved !== undefined) out[key] = resolved;
    }
    return out;
  }
  return local;
}

function evidenceStamp(row){
  return Date.parse(
    row?.outcome?.recordedAtISO
      || row?.outcomeProvenance?.capturedAt
      || row?.recordedAtISO
      || row?.provenance?.capturedAt
      || '',
  ) || 0;
}

function mergeEvidenceRows(localRows, remoteRows){
  const local = new Map((localRows || []).filter(Boolean).map(row=> [row.id, row]));
  const remote = new Map((remoteRows || []).filter(Boolean).map(row=> [row.id, row]));
  const out = [];
  for(const key of new Set([...local.keys(), ...remote.keys()])){
    if(key == null) continue;
    const l = local.get(key), r = remote.get(key);
    if(!l){ out.push(rowCopy(r)); continue; }
    if(!r){ out.push(rowCopy(l)); continue; }
    if(same(l,r)){ out.push(rowCopy(l)); continue; }
    // Evidence resolution is monotonic: once an outcome exists, an older open
    // copy from another tab must never reopen the record.
    if(Boolean(l.outcome) !== Boolean(r.outcome)){
      out.push(rowCopy(l.outcome ? l : r));
      continue;
    }
    const ls = evidenceStamp(l), rs = evidenceStamp(r);
    out.push(rowCopy(rs > ls ? r : l));
  }
  return out;
}

function mergeRows(baseRows, localRows, remoteRows, keyOf, stampOf = null){
  const base = new Map((baseRows || []).map(row=> [keyOf(row), row]));
  const local = new Map((localRows || []).map(row=> [keyOf(row), row]));
  const remote = new Map((remoteRows || []).map(row=> [keyOf(row), row]));
  const out = [];
  for(const key of new Set([...base.keys(), ...local.keys(), ...remote.keys()])){
    if(key == null) continue;
    const hasBase = base.has(key), hasLocal = local.has(key), hasRemote = remote.has(key);
    const b = base.get(key), l = local.get(key), r = remote.get(key);
    if(!hasLocal && !hasRemote) continue;
    if(hasBase && !hasLocal){ if(hasRemote && !same(r,b)) out.push(rowCopy(r)); continue; }
    if(hasBase && !hasRemote){ if(hasLocal && !same(l,b)) out.push(rowCopy(l)); continue; }
    if(!hasLocal){ out.push(rowCopy(r)); continue; }
    if(!hasRemote){ out.push(rowCopy(l)); continue; }
    if(same(l,b)){ out.push(rowCopy(r)); continue; }
    if(same(r,b)){ out.push(rowCopy(l)); continue; }
    const localStamp = rowStamp(l, stampOf);
    const remoteStamp = rowStamp(r, stampOf);
    out.push(rowCopy(stampGreater(remoteStamp, localStamp) ? r : l));
  }
  return out;
}

function rowStamp(row, stampOf){
  const primary = Date.parse(row.savedAt || row.updatedAt || row.at || row.dateISO || '') || 0;
  return [primary, stampOf ? Date.parse(stampOf(row) || '') || 0 : 0];
}

function stampGreater(a, b){
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

// Three-way merge immediately before a durable write. Unchanged local domains
// inherit canonical changes; entity collections merge by stable identity.
// The result never aliases or mutates an input snapshot: rows leave as fresh
// shallow copies and the merged top level is a new object.
export function reconcileStoreSnapshots(baseStore, localStore, remoteStore){
  if(!remoteStore) return localStore;
  const base = baseStore || {}, local = localStore || {}, remote = remoteStore || {};
  // reconcileValue may short-circuit and return one side wholesale (that side
  // is the correct merge), but callers keep using their input snapshots — so
  // the canonical result is always a fresh top level with fresh rows.
  const merged = { ...reconcileValue(base, local, remote) };
  merged.version = Math.max(Number(base.version)||0, Number(local.version)||0, Number(remote.version)||0);
  merged.history = mergeRows(base.history, local.history, remote.history, row=> row?.id);
  // Archived history reconciles exactly like live history (same session shape,
  // same identity). Live/archived disjointness is enforced at write time by
  // the storage layer, so the reconciler only unions per-id state here.
  merged.archivedHistory = mergeRows(base.archivedHistory, local.archivedHistory, remote.archivedHistory, row=> row?.id);
  merged.eventHistory = mergeRows(base.eventHistory, local.eventHistory, remote.eventHistory, row=> row?.id);
  merged.evaluationLedger = mergeEvidenceRows(local.evaluationLedger, remote.evaluationLedger);
  merged.customTemplates = mergeRows(base.customTemplates, local.customTemplates, remote.customTemplates, row=> row?.id);
  // Tombstone conflicts resolve by recency of the deletion itself (deletedAt),
  // so the newer deletion always propagates.
  merged.tombstones = mergeRows(base.tombstones, local.tombstones, remote.tombstones, row=> row?.id, row=> row?.deletedAt);
  merged.readinessLog = mergeRows(base.readinessLog, local.readinessLog, remote.readinessLog, row=> `${row?.dateISO || ''}|${row?.at || row?.score || ''}`);
  merged.programHistory = mergeRows(base.programHistory, local.programHistory, remote.programHistory, row=> `${row?.programId || ''}|${row?.version || ''}|${row?.startDateISO || ''}`);
  return merged;
}
