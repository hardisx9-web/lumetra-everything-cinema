// Local-first, private cinema notebook. No accounts, tracking or network writes.
// Only catalogue IDs are stored, never scraped HTML or untrusted URLs.
export const KEY = 'lumetra-cinema-notebook-v1';
export const MAX_ITEMS = 250;
export const validFilmId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export const validEssayId = validFilmId;
export function emptyNotebook() { return {saved: [], watched: [], reading: []}; }
export function normalizeNotebook(data) {
  const result = emptyNotebook();
  if (!data || typeof data !== 'object') return result;
  for (const [key, validate] of [['saved',validFilmId],['watched',validFilmId],['reading',validEssayId]]) {
    const values = Array.isArray(data[key]) ? data[key] : [];
    result[key] = [...new Set(values.filter(validate))].slice(0,MAX_ITEMS);
  }
  return result;
}
export function loadNotebook(storage = globalThis.localStorage) {
  try { return normalizeNotebook(JSON.parse(storage?.getItem(KEY)||'null')); }
  catch { return emptyNotebook(); }
}
export function writeNotebook(data, storage = globalThis.localStorage) {
  const normal = normalizeNotebook(data);
  try { storage?.setItem(KEY,JSON.stringify(normal)); return true; }
  catch { return false; }
}
export function toggleNotebook(data, kind, id) {
  if (!['saved','watched','reading'].includes(kind) || !validFilmId(id)) return normalizeNotebook(data);
  const next = normalizeNotebook(data);
  next[kind] = next[kind].includes(id) ? next[kind].filter(value => value!==id) : [id,...next[kind]].slice(0,MAX_ITEMS);
  return next;
}
export function notebookJSON(data) { return JSON.stringify({format:'lumetra-cinema-notebook',version:1,exportedAt:new Date().toISOString(),...normalizeNotebook(data)},null,2); }
export function importNotebook(raw) {
  const data = JSON.parse(raw);
  if (data?.format !== 'lumetra-cinema-notebook' || data.version !== 1) throw Error('Not a Lumetra notebook export');
  return normalizeNotebook(data);
}
