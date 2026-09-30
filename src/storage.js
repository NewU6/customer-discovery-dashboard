// localStorage persistence for version 1. All data stays in this browser.
import { sanitizeProspect } from './logic.js';

export const STORAGE_KEY = 'cdd.prospects.v1';

export function loadProspects(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data.map(sanitizeProspect);
  } catch {
    return null;
  }
}

export function saveProspects(prospects, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prospects));
    return true;
  } catch {
    return false;
  }
}

export function clearProspects(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Scorecard targets are stored separately so prospect data is never rewritten by a settings change.
export const SETTINGS_KEY = 'cdd.settings.v1';

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
