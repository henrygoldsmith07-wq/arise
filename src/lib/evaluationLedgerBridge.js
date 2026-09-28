const adapters={};
export const bindCanonicalLedger=(key,next)=>{ adapters[key]=next||null; };
export const readCanonicalValue=key=>{
  try{ return adapters[key]?.read?.() ?? null; }catch{ return null; }
};
export const readCanonicalLedger=key=>{
  const rows=readCanonicalValue(key);
  return Array.isArray(rows)?rows:null;
};
export const replaceCanonicalLedger=(key,rows)=>{
  try{ return adapters[key]?.replace?.(Array.isArray(rows)?rows:[])===true; }catch{ return false; }
};
export const clearCanonicalLedger=key=>{
  try{ return adapters[key]?.clear?.()===true; }catch{ return false; }
};
