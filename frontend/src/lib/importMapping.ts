import type { ImportGroup, ImportRow, ParsedList } from './fileImport';

export const targetFields = [
  ['word', 'Word / phrase'], ['translation', 'Translation'], ['definition', 'Definition / notes'],
  ['examples', 'Example'], ['language', 'Language'], ['collocations', 'Collocations'],
  ['ipa', 'Pronunciation / IPA'], ['pos', 'Part of speech'], ['tags', 'Tags'], ['source', 'Source / deck'],
] as const;
export type TargetField = typeof targetFields[number][0];
export interface GroupConfig {
  mapping: Record<string, string>; sourceMapping: Record<string, string>; enabled: boolean; conversion: boolean; numeric: boolean;
}
export const kindLabels: Record<string, string> = { vocabulary: 'Vocabulary cards', translation_cards: 'Translation cards', question_answer: 'Question & answer', grammar_exercise: 'Grammar exercises', cloze_exercise: 'Cloze exercises', unresolved: 'Needs a quick check' };
export const requiresConversion = (group: ImportGroup) => !['vocabulary', 'unresolved'].includes(group.analysis.kind);
export const initialConfig = (group: ImportGroup): GroupConfig => ({ mapping: { ...group.analysis.mapping }, sourceMapping: Object.fromEntries(Object.entries(group.analysis.source_mapping).map(([key,value]) => [key,String(value)])), enabled: !requiresConversion(group), conversion: false, numeric: false });

export function cellValue(group: ImportGroup, cells: string[], column: string | number | undefined): string {
  if (column === '' || column === undefined) return '';
  const field = group.fields.find(field => field.column === Number(column));
  return cells[field?.canonical_column ?? Number(column)] || '';
}
export function projectRow(parsed: ParsedList, group: ImportGroup, config: GroupConfig, number: number, defaultLanguage: string, position?: number): ImportRow {
  const index = position ?? parsed.row_numbers.indexOf(number);
  const row: ImportRow = { row: number, word: '', language: defaultLanguage, source_kind: group.analysis.kind, conversion_confirmed: config.conversion };
  for (const [key] of targetFields) {
    const value = cellValue(group, parsed.rows[index], config.mapping[key]);
    if (key !== 'language' || value) (row as unknown as Record<string, unknown>)[key] = value;
  }
  const provenance = parsed.provenance[index];
  if (provenance?.note_id) { row.source_note_id = provenance.note_id; row.source_group_id = provenance.group_id; }
  return row;
}
export function excludedFields(group: ImportGroup, mapping: Record<string,string>): string[] {
  const used = new Set<number>();
  for (const column of Object.values(mapping)) {
    if (column === '') continue;
    const field = group.fields.find(field => field.column === Number(column));
    used.add(Number(column));
    if (field?.canonical_column !== undefined) used.add(field.canonical_column);
    if (field?.from_column !== undefined) used.add(field.from_column);
  }
  return group.fields.filter(field => !field.derived && !used.has(field.column)).map(field => field.name);
}

export function numericColumn(rows: string[][], column: string): boolean {
  if (column === '') return false;
  return rows.some(row => /^[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)$/.test((row[Number(column)] || '').trim()));
}
export function representative<T>(rows: T[], limit = 100): T[] {
  if (rows.length <= limit) return rows;
  return Array.from({ length: limit }, (_, i) => rows[Math.round(i * (rows.length - 1) / (limit - 1))]);
}
