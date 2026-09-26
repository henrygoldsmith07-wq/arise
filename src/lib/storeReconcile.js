function same(a,b){
  if(a === b) return true;
  try{ return JSON.stringify(a) === JSON.stringify(b); }catch{ return false; }
}

function reconcileValue(base, local, remote){
  if(same(local, base)) return remote;
  if(same(remote, base)) return local;
  if(local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)){
    const out = {};
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)]);
    for(const key of keys) out[key] = reconcileValue(base?.[key], local[key], remote[key]);
    return out;
  }
  return local;
}

function mergeRows(baseRows, localRows, remoteRows, keyOf){
  const base = new Map((baseRows || []).map(row=> [keyOf(row), row]));
  const local = new Map((localRows || []).map(row=> [keyOf(row), row]));
  const remote = new Map((remoteRows || []).map(row=> [keyOf(row), row]));
  const out = [];
  for(const key of new Set([...base.keys(), ...local.keys(), ...remote.keys()])){
    if(key == null) continue;
    const hasBase = base.has(key), hasLocal = local.has(key), hasRemote = remote.has(key);
    const b = base.get(key), l = local.get(key), r = remote.get(key);
    if(!hasLocal && !hasRemote) continue;
    if(hasBase && !hasLocal){ if(hasRemote && !same(r,b)) out.push(r); continue; }
    if(hasBase && !hasRemote){ if(hasLocal && !same(l,b)) out.push(l); continue; }
    if(!hasLocal){ out.push(r); continue; }
    if(!hasRemote){ out.push(l); continue; }
    if(same(l,b)){ out.push(r); continue; }
    if(same(r,b)){ out.push(l); continue; }
    const localStamp = Date.parse(l.savedAt || l.updatedAt || l.at || l.dateISO || '') || 0;
    const remoteStamp = Date.parse(r.savedAt || r.updatedAt || r.at || r.dateISO || '') || 0;
    out.push(remoteStamp > localStamp ? r : l);
  }
  return out;
}

// Three-way merge immediately before a durable write. Unchanged local domains
// inherit canonical changes; entity collections merge by stable identity.
export function reconcileStoreSnapshots(baseStore, localStore, remoteStore){
  if(!remoteStore) return localStore;
  if(!baseStore) return reconcileValue({}, localStore || {}, remoteStore || {});
  const base = baseStore || {}, local = localStore || {}, remote = remoteStore || {};
  const merged = reconcileValue(base, local, remote);
  merged.version = Math.max(Number(base.version)||0, Number(local.version)||0, Number(remote.version)||0);
  merged.history = mergeRows(base.history, local.history, remote.history, row=> row?.id);
  merged.eventHistory = mergeRows(base.eventHistory, local.eventHistory, remote.eventHistory, row=> row?.id);
  merged.evaluationLedger = mergeRows(base.evaluationLedger, local.evaluationLedger, remote.evaluationLedger, row=> row?.id);
  merged.customTemplates = mergeRows(base.customTemplates, local.customTemplates, remote.customTemplates, row=> row?.id);
  merged.tombstones = mergeRows(base.tombstones, local.tombstones, remote.tombstones, row=> row?.id);
  merged.readinessLog = mergeRows(base.readinessLog, local.readinessLog, remote.readinessLog, row=> `${row?.dateISO || ''}|${row?.at || row?.score || ''}`);
  merged.programHistory = mergeRows(base.programHistory, local.programHistory, remote.programHistory, row=> `${row?.programId || ''}|${row?.version || ''}|${row?.startDateISO || ''}`);
  return merged;
}
