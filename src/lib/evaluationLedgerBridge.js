// Cycle-safe synchronous adapters for canonical evaluation + event ledgers.
// storage.js binds them after module initialisation; consumers avoid importing
// storage.js directly and therefore avoid persistence-module cycles.

const adapters = Object.create(null);
const bind = (key, next)=> { adapters[key] = next && typeof next === 'object' ? next : null; };
const read = (key)=> {
  try{
    const rows = adapters[key]?.read?.();
    return Array.isArray(rows) ? rows : null;
  }catch{ return null; }
};
const replace = (key, rows)=> {
  try{ return adapters[key]?.replace?.(Array.isArray(rows) ? rows : []) === true; }
  catch{ return false; }
};
const clear = (key)=> {
  try{ return adapters[key]?.clear?.() === true; }
  catch{ return false; }
};

export const bindEvaluationLedgerAdapter = next => bind('evaluation', next);
export const readCanonicalEvaluationLedger = ()=> read('evaluation');
export const replaceCanonicalEvaluationLedger = rows => replace('evaluation', rows);
export const clearCanonicalEvaluationLedger = ()=> clear('evaluation');

export const bindEventLedgerAdapter = next => bind('events', next);
export const readCanonicalEventHistory = ()=> read('events');
export const replaceCanonicalEventHistory = rows => replace('events', rows);
export const clearCanonicalEventHistory = ()=> clear('events');
