export function patchPreferences(store, patch){
  return { ...store, preferences:{ ...(store?.preferences || {}), ...(patch || {}) } };
}

export function patchAccessibility(store, patch){
  const preferences = store?.preferences || {};
  return {
    ...store,
    preferences:{
      ...preferences,
      accessibility:{ ...(preferences.accessibility || {}), ...(patch || {}) },
    },
  };
}

export function patchGymPreferences(store, patch){
  return { ...store, gymPrefs:{ ...(store?.gymPrefs || {}), ...(patch || {}) } };
}
