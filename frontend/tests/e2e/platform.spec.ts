import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.evaluate(async () => {
    // Dedicated local auth fixture. No production credentials or auth bypass.
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(/* @vite-ignore */ modulePath);
    const result = await supabase!.auth.signInWithPassword({ email: 'fixture@example.test', password: 'public-fixture-value' });
    if (result.error) throw result.error;
  });
}

test('unauthenticated routes remain protected', async ({ page }) => {
  await page.goto('/import/files');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Continue with Google' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/gallery-login.png', fullPage: true, animations: 'disabled' });
});

test('file import upload, mapping, collection, duplicate skip and zero AI', async ({ page }) => {
  let aiRequests = 0;
  page.on('request', request => { if (/\/api\/(ai|import\/(analyze|extract-text|check-typo))/.test(request.url())) aiRequests++; });
  await signIn(page);
  await page.goto('/import');
  await page.getByRole('button', { name: /Upload vocabulary or Anki file/ }).click();
  await expect(page).toHaveURL(/\/import\/files/);
  await page.getByLabel('Vocabulary file').setInputFiles({ name: 'words.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeffword,translation,example\ncurious,好奇的,"Hello, world"\ngrüßen,问候,Hallo\ncurious,duplicate,Again\n,invalid,No word') });
  await page.getByRole('button', { name: 'Analyze file' }).click();
  await expect(page.getByRole('heading', { name: /entries analyzed/ })).toBeVisible();
  await page.getByLabel('Collection', { exact: true }).selectOption('33333333-3333-3333-3333-333333333333');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/file-import-mapping-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Check duplicates & preview' }).click();
  await expect(page.getByText('2 ready · 1 duplicates skipped · 1 invalid rows')).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/file-import-confirm-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(page.getByText('2 imported · 0 recovered / already saved · 1 skipped · 1 invalid · 0 failed')).toBeVisible();
  expect(aiRequests).toBe(0);
  await page.screenshot({ path: 'test-results/file-import-result-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Open Vocabulary' }).click();
  await expect(page).toHaveURL(/\/vocabulary$/);
  await expect(page.getByRole('heading', { name: 'Vocabulary Library', exact: true })).toBeVisible();
  await expect(page.getByText('curious', { exact: true })).toBeVisible();
});

test('real keyboard typing, local dictionary, progress resume, explicit AI', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  await signIn(page);
  await page.goto('/practice');
  await page.getByLabel('Title', { exact: true }).fill('E2E reading article');
  await page.getByLabel('Article text').fill('Hello world.\nCurious people take off.');
  await page.getByRole('button', { name: /Save.*article|Save.*practice/i }).click();
  await expect(page).toHaveURL(/\/practice\/[^/]+/);
  const articleUrl = page.url();
  await page.getByRole('button', { name: 'Start typing', exact: true }).click();
  const input = page.getByLabel('Type the article', { exact: true });
  await expect(input).toBeFocused();
  const before = apiRequests.length;
  await page.keyboard.type('Hxl');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('ello ');
  await expect(input).toHaveValue('Hello ');
  expect(apiRequests.length).toBe(before);
  await page.getByRole('button', { name: 'Look up world', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'world', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ECDICT', exact: true })).toBeVisible();
  await expect(input).toHaveValue('Hello ');
  expect(apiRequests.filter(url => url.includes('/api/ai/'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Save to Vocabulary', exact: true }).click();
  await expect(page.getByText('Saved to Vocabulary. Ready for active recall in Review.')).toBeVisible();
  await page.getByRole('button', { name: 'Save to Vocabulary', exact: true }).click();
  await expect(page.getByText('Already in your Vocabulary. Your notes and review progress were preserved.')).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/typing-dictionary-desktop.png', fullPage: true });
  await page.waitForTimeout(450);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume practice' })).toBeVisible();
  await expect(input).toHaveValue('Hello ');
  await page.getByRole('button', { name: 'Resume practice' }).click();
  await page.keyboard.type('world.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Curious people take off.');
  await expect(page.getByRole('heading', { name: 'Article completed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Look up world', exact: true }).click();
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect.poll(() => apiRequests.filter(url => url.includes('/api/ai/enrich')).length).toBe(1);
  await page.goto(articleUrl);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(input).toHaveValue('');
});

test('responsive file mapping and article library have no horizontal overflow', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/import/files', '/practice']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/${route.endsWith('files') ? 'file-import' : 'practice'}-mobile.png`, fullPage: true });
  }
  await page.getByRole('link', { name: /E2E reading article/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E reading article', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/typing-mobile.png', fullPage: true });
});

test('vocabulary CRUD, collection reload, recall, exports and screen gallery', async ({ page, request }) => {
  const headers = { Authorization: 'Bearer fixture-access-token' };
  const created = await request.post('http://127.0.0.1:54399/api/words', { headers, data: {
    word: 'gallery', translation: '画廊', language: 'English', pos: 'Noun',
    collection: '33333333-3333-3333-3333-333333333333', definition: 'A room for art.',
  } });
  expect(created.status()).toBe(201);
  const word = await created.json();
  const updated = await request.put(`http://127.0.0.1:54399/api/words/${word.id}`, { headers, data: { definition: 'A place to exhibit art.' } });
  expect(updated.status()).toBe(200);
  const reviewed = await request.post('http://127.0.0.1:54399/api/review/answer', { headers, data: { word_id: word.id, answer: 'good' } });
  expect(reviewed.status()).toBe(200);
  expect((await reviewed.json()).mastery).toBe('Familiar');
  for (const endpoint of ['/api/stats', '/api/export/all', '/api/export/review-progress', '/api/export/vocabulary?format=csv']) {
    expect((await request.get(`http://127.0.0.1:54399${endpoint}`, { headers })).status()).toBe(200);
  }
  await signIn(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const routes = [
    ['dashboard', '/', 'Dashboard'],
    ['vocabulary', '/vocabulary', 'Vocabulary Library'],
    ['add-word', '/vocabulary/new', 'Add Word'],
    ['word-detail', `/vocabulary/${word.id}`, 'gallery'],
    ['import-hub', '/import', 'Bring your words into Voca'],
    ['import-step1', '/import/step1', 'Paste Text & Document Capture'],
    ['review-hub', '/review', 'Review Hub'],
    ['review-session', '/review/session', ''],
    ['review-result', '/review/result', 'Recall Session Complete'],
    ['collections', '/collections', 'Collections Hub'],
    ['collection-detail', '/collections/33333333-3333-3333-3333-333333333333', 'E2E test collection'],
    ['statistics', '/statistics', 'Statistics'],
    ['settings', '/settings', 'Settings'],
  ];
  for (const [name, route, heading] of routes) {
    await page.goto(route);
    if (name === 'review-session') await expect(page.getByRole('button', { name: 'Reveal Definition', exact: true })).toBeVisible();
    else await expect(page.locator('main')).toBeVisible();
    if (heading) await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `test-results/gallery-${name}.png`, fullPage: true, animations: 'disabled' });
  }
  let aiRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/ai/')) aiRequests++; });
  const state = { title: 'Fixture article', language: 'English', text: 'A curious reader explores the world.', candidates: [{ word: 'curious', translation: '好奇的', pos: 'Adjective' }], words: [{ word: 'curious', translation: '好奇的', pos: 'Adjective' }] };
  for (const step of [2, 3]) {
    await page.evaluate(({ step, state }) => {
      history.pushState({ usr: state, key: `gallery-${step}` }, '', `/import/step${step}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, { step, state });
    await expect(page.getByText(step === 2 ? 'Select Candidates' : 'Review & Save Pipeline', { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/gallery-import-step${step}.png`, fullPage: true, animations: 'disabled' });
  }
  expect(aiRequests).toBe(0);
  expect(errors).toEqual([]);
  expect((await request.delete(`http://127.0.0.1:54399/api/words/${word.id}`, { headers })).status()).toBe(200);
});

test('long article fast input scrolls caret and local miss never asks AI', async ({ page }) => {
  await signIn(page);
  await page.goto('/practice');
  const source = 'zzzxqnotaword.\n' + Array.from({ length: 70 }, (_, index) => `Paragraph ${index}: Curious readers explore words.\n`).join('');
  await page.getByLabel('Title', { exact: true }).fill('Long scrolling fixture');
  await page.getByLabel('Article text').fill(source);
  await page.getByRole('button', { name: /Save.*article|Save.*practice/i }).click();
  await expect(page).toHaveURL(/\/practice\/[^/]+/);
  let aiRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/ai/')) aiRequests++; });
  await page.getByRole('button', { name: 'Look up zzzxqnotaword', exact: true }).click();
  await expect(page.getByText('Not found in local dictionary', { exact: true })).toBeVisible();
  expect(aiRequests).toBe(0);
  await page.getByRole('button', { name: 'Start typing', exact: true }).click();
  await page.keyboard.insertText(source.slice(0, 1200));
  await expect(page.getByLabel('Type the article', { exact: true })).toHaveValue(source.slice(0, 1200));
  await expect.poll(() => page.locator('[aria-label="Article typing surface"]').evaluate(element => element.parentElement!.scrollTop)).toBeGreaterThan(0);
  expect(aiRequests).toBe(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible();
});
