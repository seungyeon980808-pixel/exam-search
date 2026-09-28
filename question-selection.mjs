export function createQuestionSelection(initialIds = []) {
  const ids = [...new Set(initialIds.filter((id) => typeof id === 'string' && id.trim()))];
  return {
    has(id) { return ids.includes(id); },
    toggle(id) {
      if (typeof id !== 'string' || !id.trim()) return false;
      const index = ids.indexOf(id);
      if (index === -1) ids.push(id);
      else ids.splice(index, 1);
      return index === -1;
    },
    remove(id) {
      const index = ids.indexOf(id);
      if (index !== -1) ids.splice(index, 1);
    },
    clear() { ids.length = 0; },
    move(id, direction) {
      const index = ids.indexOf(id);
      const target = index + direction;
      if (index < 0 || ![-1, 1].includes(direction) || target < 0 || target >= ids.length) return false;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return true;
    },
    snapshot() { return [...ids]; },
  };
}
