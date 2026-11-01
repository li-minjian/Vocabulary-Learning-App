/** Browser-only copy practice. Positions are Unicode code-point offsets. */
export interface TextSpan {
  text: string;
  start: number;
  end: number;
  kind: 'word' | 'space' | 'punctuation';
}

export interface TypingState {
  typed: string;
  totalAttempts: number;
  correctAttempts: number;
  elapsedMs: number;
}

export const emptyTypingState = (): TypingState => ({ typed: '', totalAttempts: 0, correctAttempts: 0, elapsedMs: 0 });

export function normalizeArticle(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/\u00a0/g, ' ');
}

export function articleSpans(text: string): TextSpan[] {
  const parts = text.match(/[\p{L}\p{M}\p{N}]+(?:[’'\-][\p{L}\p{M}\p{N}]+)*|\s+|[^\p{L}\p{M}\p{N}\s]+/gu) || [];
  let offset = 0;
  return parts.map(part => {
    const start = offset;
    offset += Array.from(part).length;
    return {
      text: part, start, end: offset,
      kind: /^\s+$/u.test(part) ? 'space' : /^[\p{L}\p{M}\p{N}]/u.test(part) ? 'word' : 'punctuation',
    };
  });
}

/** Only append/backspace editing is accepted: practice always advances through the article. */
export function applyTypingInput(source: string, state: TypingState, input: string): TypingState {
  const expected = Array.from(source);
  const previous = Array.from(state.typed);
  const next = Array.from(input.normalize('NFC'));
  let common = 0;
  while (common < previous.length && common < next.length && previous[common] === next[common]) common++;
  if (common < Math.min(previous.length, next.length)) return state;
  if (next.length < previous.length) return { ...state, typed: next.join('') };
  const accepted = next.slice(0, expected.length);
  let correct = 0;
  for (let index = previous.length; index < accepted.length; index++) {
    // A space can advance a paragraph break; the visible paragraph boundary stays intact.
    if (expected[index] === '\n' && accepted[index] === ' ') accepted[index] = '\n';
    if (accepted[index] === expected[index]) correct++;
  }
  return {
    ...state,
    typed: accepted.join(''),
    totalAttempts: state.totalAttempts + Math.max(0, accepted.length - previous.length),
    correctAttempts: state.correctAttempts + correct,
  };
}

export function typingMetrics(source: string, state: TypingState) {
  const expected = Array.from(source);
  const typed = Array.from(state.typed);
  const correctCharacters = typed.reduce((sum, value, index) => sum + Number(value === expected[index]), 0);
  const spans = articleSpans(source).filter(span => span.kind === 'word');
  const completed = spans.filter(span => span.end <= typed.length && (span.end === expected.length || typed.length > span.end));
  const correctWords = completed.filter(span => typed.slice(span.start, span.end).join('') === span.text).length;
  return {
    position: typed.length,
    progress: expected.length ? Math.min(100, typed.length / expected.length * 100) : 0,
    accuracy: state.totalAttempts ? state.correctAttempts / state.totalAttempts * 100 : 100,
    wpm: state.elapsedMs >= 1000 ? Math.round(correctCharacters / 5 / (state.elapsedMs / 60000)) : 0,
    correctCharacters,
    completedWords: completed.length,
    correctWords,
    totalWords: spans.length,
    complete: expected.length > 0 && typed.length === expected.length,
  };
}

export function sourceFingerprint(source: string): string {
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return `${source.length}:${(hash >>> 0).toString(16)}`;
}

export function restoreTypingState(source: string, raw: string | null): TypingState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.source !== sourceFingerprint(source) || typeof value.typed !== 'string') return null;
    const length = Array.from(value.typed).length;
    if (length > Array.from(source).length) return null;
    if (![value.totalAttempts, value.correctAttempts, value.elapsedMs].every(n => Number.isFinite(n) && n >= 0)) return null;
    if (value.correctAttempts > value.totalAttempts || value.totalAttempts < length) return null;
    return { typed: value.typed, totalAttempts: value.totalAttempts, correctAttempts: value.correctAttempts, elapsedMs: value.elapsedMs };
  } catch {
    return null;
  }
}

export function serializeTypingState(source: string, state: TypingState): string {
  return JSON.stringify({ version: 1, source: sourceFingerprint(source), ...state });
}
