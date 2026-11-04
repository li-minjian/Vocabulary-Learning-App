import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationSection } from './navigation.ts';
test('explicit session responsibility takes precedence over content prefixes',()=>{
 for(const path of ['/learn','/learn/mixed/test','/review','/review/session','/review/result','/practice','/practice/article','/exercises/session/id'])assert.equal(navigationSection(path),'learn',path);
 for(const path of ['/library','/vocabulary','/vocabulary/id','/exercises','/exercises/id','/collections','/collections/id'])assert.equal(navigationSection(path),'library',path);
 for(const path of ['/import','/import/files'])assert.equal(navigationSection(path),'import',path);
 assert.equal(navigationSection('/statistics'),'statistics');assert.equal(navigationSection('/settings'),'settings');assert.equal(navigationSection('/'),'dashboard');
});
