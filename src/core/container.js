// core/container.js — minimal dependency injection container.
//
// Services never import each other or reach into module singletons for their
// collaborators; they receive them. The container resolves registered
// factories lazily as singletons, and carries the adapter bag (clock, logger,
// storage) so tests can substitute fakes for every side-effecting edge.
//
// Rationale (ADR 0004): React components consume services through a context
// provider built on this container; pure engine modules stay React-free; and
// every adapter boundary is swappable in tests without module mocking.

const REGISTRY = new Map();     // name -> factory(container)
const INSTANCES = new Map();    // name -> resolved singleton
const RESOLVING = new Set();    // cycle detection

/**
 * Register a service factory. Re-registration replaces the factory and
 * discards the cached instance (used by tests to swap implementations).
 */
export function register(name, factory){
  REGISTRY.set(name, factory);
  INSTANCES.delete(name);
}

/** Resolve a service by name (lazily, memoised). Throws on unknown or cycles. */
export function resolve(name){
  if(INSTANCES.has(name)) return INSTANCES.get(name);
  const factory = REGISTRY.get(name);
  if(!factory) throw new Error(`DI: no service registered as "${name}"`);
  if(RESOLVING.has(name)) throw new Error(`DI: circular dependency resolving "${name}"`);
  RESOLVING.add(name);
  try{
    const instance = factory((n)=> resolve(n), adapters());
    INSTANCES.set(name, instance);
    return instance;
  } finally {
    RESOLVING.delete(name);
  }
}

/** True when the name has a registration (optional dependencies). */
export function has(name){
  return REGISTRY.has(name);
}

/** Drop every resolved instance (tests, hot reload). Factories survive. */
export function resetContainer(){
  INSTANCES.clear();
  RESOLVING.clear();
}

// ── Adapter bag: every side-effecting edge, injectable ─────────────────────
const adapterBag = {
  clock: () => new Date(),
  nowISO: () => new Date().toISOString(),
  uuid: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  log: () => {},          // structured logger lands with the sync provider
  reportError: (err) => { if(typeof console !== 'undefined') console.error(err); },
};

const adapterOverrides = new Map();

/** Replace an adapter (clock/logger/…) for this process — tests, Storybook. */
export function overrideAdapter(name, implementation){
  adapterOverrides.set(name, implementation);
}

export function clearAdapterOverrides(){
  adapterOverrides.clear();
}

export function adapters(){
  const bag = { ...adapterBag };
  for(const [k, v] of adapterOverrides) bag[k] = v;
  bag.nowISO = bag.nowISO || (() => bag.clock().toISOString());
  return Object.freeze(bag);
}
