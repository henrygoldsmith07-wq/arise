const adapters={};
export const bindCanonicalLedger=(key,next)=>{ adapters[key]=next||null; };
export const readCanonicalLedger=key=>{
  try{ const rows=adapters[key]?.read?.(); return Array.isArray(rows)?rows:null; }catch{ return null; }
};
export const replaceCanonicalLedger=(key,rows)=>{
  try{ return adapters[key]?.replace?.(Array.isArray(rows)?rows:[])===true; }catch{ return false; }
};
export const clearCanonicalLedger=key=>{
  try{ return adapters[key]?.clear?.()===true; }catch{ return false; }
};
