const SELECTION_KEY = 'exam-library-selection-v1';
const SEARCH_KEY = 'exam-library-recent-searches-v1';

// Store only references and labels. Source documents and editor contents stay separate.
export function normalizeSelection(value) {
  if (value?.version !== 1 || !Array.isArray(value.items)) return [];
  const seen = new Set();
  return value.items.filter(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w.-]{1,120}$/u.test(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 500).map(item => ({ id: item.id, label: typeof item.label === 'string' ? item.label.slice(0, 160) : item.id }));
}

export function createLibraryPreferences(storage) {
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
  return {
    selection: () => normalizeSelection(read(SELECTION_KEY, null)),
    saveSelection(items) {
      const clean = normalizeSelection({ version: 1, items });
      if (!Array.isArray(items) || clean.length !== items.length) return false;
      try { storage.setItem(SELECTION_KEY, JSON.stringify({ version: 1, items: clean })); return true; }
      catch { return false; }
    },
    searches(scope) {
      const rows = read(SEARCH_KEY, []);
      return Array.isArray(rows) ? rows.filter(row => row?.scope === scope && Array.isArray(row.words)
        && row.words.length > 0 && row.words.length <= 3 && row.words.every(word => typeof word === 'string' && word.length <= 120)).slice(0, 4) : [];
    },
    rememberSearch(scope, words) {
      if (!words.length || words.length > 3 || words.some(word => typeof word !== 'string' || word.length > 120)) return;
      const stored = read(SEARCH_KEY, []);
      const previous = Array.isArray(stored) ? stored : [];
      const rows = [{ scope, words: [...words] }, ...previous.filter(row => row?.scope !== scope || JSON.stringify(row.words) !== JSON.stringify(words))].slice(0, 24);
      try { storage.setItem(SEARCH_KEY, JSON.stringify(rows)); } catch { /* Recent searches are optional. */ }
    }
  };
}
