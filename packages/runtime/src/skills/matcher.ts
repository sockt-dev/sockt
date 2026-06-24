export function scoreRelevance(query: string, skillDescription: string): number {
  const queryWords = new Set(tokenize(query));
  const descWords = new Set(tokenize(skillDescription));

  if (queryWords.size === 0 || descWords.size === 0) return 0;

  const intersection = [...queryWords].filter((w) => descWords.has(w)).length;
  const union = new Set([...queryWords, ...descWords]).size;

  return union > 0 ? intersection / union : 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
