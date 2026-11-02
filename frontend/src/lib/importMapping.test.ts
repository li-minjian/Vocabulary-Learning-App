import test from 'node:test';
import assert from 'node:assert/strict';
import { numericColumn, representative, suggestMapping } from './importMapping.ts';
test('leading ID is not Word, unknown/repeated headers never guessed', () => {
  assert.equal(suggestMapping(['id', 'Word', 'Translation'], ['word', 'term']), '1');
  assert.equal(suggestMapping(['ID','Custom'], ['word']), '');
  assert.equal(suggestMapping(['Word','word'], ['word']), '');
  assert.equal(suggestMapping(['Word','Unknown'], ['translation']), '');
});
test('numeric values require confirmation and preview covers full file', () => {
  assert.equal(numericColumn([['1','hello'], ['2','world']], '0'), true);
  assert.equal(numericColumn([['1','hello']], '1'), false);
  const sample = representative(Array.from({length: 1000}, (_,i) => i));
  assert.equal(sample.length,100); assert.equal(sample[0],0); assert.equal(sample.at(-1),999);
});
