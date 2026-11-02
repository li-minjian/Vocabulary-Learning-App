/** Deterministic mapping: never infer a field from its position. */
export function suggestMapping(columns: string[], aliases: readonly string[]): string {
  const matches = columns.flatMap((name, i) => aliases.includes(name.trim().toLowerCase()) ? [i] : []);
  return matches.length === 1 ? String(matches[0]) : '';
}
export function numericColumn(rows: string[][], column: string): boolean {
  if (column === '') return false;
  return rows.some(row => /^[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)$/.test((row[Number(column)] || '').trim()));
}
export function representative<T>(rows: T[], limit = 100): T[] {
  if (rows.length <= limit) return rows;
  return Array.from({ length: limit }, (_, i) => rows[Math.round(i * (rows.length - 1) / (limit - 1))]);
}
