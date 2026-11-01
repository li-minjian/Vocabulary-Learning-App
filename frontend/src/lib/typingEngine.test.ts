import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTypingInput, articleSpans, emptyTypingState, normalizeArticle, restoreTypingState, serializeTypingState, typingMetrics } from './typingEngine.ts';

describe('browser typing engine', () => {
  it('preserves punctuation, German umlauts, Chinese, Unicode offsets, and paragraph boundaries', () => {
    const source = normalizeArticle('Grüße!\r\n你好 😀 cafe\u0301.');
    const spans = articleSpans(source);
    assert.equal(spans.map(span => span.text).join(''), source);
    for (const span of spans) assert.equal(Array.from(source).slice(span.start, span.end).join(''), span.text);
    assert.equal(source, 'Grüße!\n你好 😀 café.');
  });

  it('tracks errors and backspace without erasing mistake history', () => {
    let state = applyTypingInput('hello world', emptyTypingState(), 'helxo');
    assert.equal(state.totalAttempts, 5);
    assert.equal(state.correctAttempts, 4);
    state = applyTypingInput('hello world', state, 'hel');
    state = applyTypingInput('hello world', state, 'hello ');
    assert.equal(state.typed, 'hello ');
    assert.equal(state.totalAttempts, 8);
    assert.equal(state.correctAttempts, 7);
    assert.equal(typingMetrics('hello world', state).completedWords, 1);
    assert.equal(typingMetrics('hello world', state).correctWords, 1);
    assert.equal(typingMetrics('hello world', state).accuracy, 87.5);
  });

  it('accepts fast multi-character input and counts inaccurate completed words', () => {
    const state = applyTypingInput('one two.', emptyTypingState(), 'oxe two.');
    const result = typingMetrics('one two.', { ...state, elapsedMs: 60000 });
    assert.equal(result.complete, true);
    assert.equal(result.completedWords, 2);
    assert.equal(result.correctWords, 1);
    assert.equal(result.correctCharacters, 7);
    assert.equal(result.wpm, 1);
  });

  it('supports Enter and space at paragraph transitions', () => {
    const enter = applyTypingInput('a\n\nb', emptyTypingState(), 'a\n\nb');
    const space = applyTypingInput('a\n\nb', emptyTypingState(), 'a  b');
    assert.equal(enter.typed, 'a\n\nb');
    assert.equal(space.typed, enter.typed);
    assert.equal(space.correctAttempts, 4);
  });

  it('does not permit inserting in the middle or typing past the article', () => {
    const state = applyTypingInput('abc', emptyTypingState(), 'ab');
    assert.equal(applyTypingInput('abc', state, 'axb'), state);
    assert.equal(applyTypingInput('abc', state, 'abcdef').typed, 'abc');
  });

  it('resumes exactly and rejects corrupt or stale progress', () => {
    const state = { ...applyTypingInput('hello', emptyTypingState(), 'hex'), elapsedMs: 2500 };
    const saved = serializeTypingState('hello', state);
    assert.deepEqual(restoreTypingState('hello', saved), state);
    assert.equal(restoreTypingState('other', saved), null);
    assert.equal(restoreTypingState('hello', '{'), null);
    assert.equal(restoreTypingState('hello', JSON.stringify({ ...JSON.parse(saved), correctAttempts: 100 })), null);
  });

  it('handles empty source and a final word without trailing punctuation', () => {
    assert.equal(typingMetrics('', emptyTypingState()).progress, 0);
    const result = typingMetrics('hi', applyTypingInput('hi', emptyTypingState(), 'hi'));
    assert.equal(result.completedWords, 1);
    assert.equal(result.correctWords, 1);
    assert.equal(result.progress, 100);
  });
});
