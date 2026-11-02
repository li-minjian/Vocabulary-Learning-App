import { expect, test, type Page } from '@playwright/test';
import { writeFile, truncate } from 'node:fs/promises';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.evaluate(async () => {
    const path = '/src/lib/supabase.ts';
    const { supabase } = await import(/* @vite-ignore */ path);
    const { error } = await supabase.auth.signInWithPassword({ email: 'fixture@example.test', password: 'public-fixture-value' });
    if (error) throw error;
  });
}

function pdf(text: string) {
  const stream = text ? `BT /F1 12 Tf 50 750 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, i) => { offsets.push(source.length); source += `${i+1} 0 obj\n${value}\nendobj\n`; });
  const start = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(source + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

test('50 MiB selection accepted, +1 byte and empty rejected immediately on mobile', async ({ page }, testInfo) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/import/files');
  const file = page.getByLabel('Vocabulary file');
  const boundary = testInfo.outputPath('boundary.csv'), over = testInfo.outputPath('over.csv');
  await writeFile(boundary, 'word\nhello\n'); await truncate(boundary, 52428800);
  await writeFile(over, 'word\nhello\n'); await truncate(over, 52428801);
  await file.setInputFiles(boundary);
  await expect(page.getByRole('button', { name: 'Analyze file' })).toBeEnabled();
  await file.setInputFiles(over);
  await expect(page.getByText('File exceeds 50 MiB (52,428,800 bytes).', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze file' })).toBeDisabled();
  await file.setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) });
  await expect(page.getByText('Choose a non-empty file.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('text PDF extracts through actual Flask/Poppler then saves article with zero AI', async ({ page }) => {
  const ai: string[] = [];
  page.on('request', request => { if (/\/api\/(ai|import\/(analyze|extract-text))/.test(request.url())) ai.push(request.url()); });
  await signIn(page);
  await page.goto('/import/step1');
  await page.locator('input[type=file]').setInputFiles({ name: 'Local PDF browser.pdf', mimeType: 'application/pdf', buffer: pdf('Hello local PDF browser extraction.') });
  await expect(page.getByRole('textbox').last()).toHaveValue('Hello local PDF browser extraction.');
  await expect(page.getByText(/Document text extracted/)).toBeVisible();
  await page.getByRole('button', { name: 'Save for Reading & Typing', exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/[^/]+/);
  await expect(page.getByRole('heading', { name: 'Local PDF browser', exact: true })).toBeVisible();
  expect(ai).toHaveLength(0);
});

test('empty PDF offers AI only after local extraction and sends explicit consent', async ({ page }) => {
  await signIn(page);
  await page.goto('/import/step1');
  let aiCalls = 0;
  await page.route('**/api/uploads/*/process', async route => {
    const data = route.request().postDataJSON();
    if (data.method !== 'ai') return route.continue();
    aiCalls++;
    expect(data.consent_ai).toBe(true);
    await route.fulfill({ json: { text: 'Explicit synthetic OCR result.', method: 'ai', needs_ocr: false } });
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf('') });
  await expect(page.getByText('No usable text was extracted locally. AI extraction requires a separate explicit action.')).toBeVisible();
  expect(aiCalls).toBe(0);
  await page.getByRole('button', { name: 'Ask AI to extract this document', exact: true }).click();
  await expect(page.getByRole('textbox').last()).toHaveValue('Explicit synthetic OCR result.');
  expect(aiCalls).toBe(1);
});

test('GCS transport sends bytes directly without Supabase JWT and retries processing without reupload', async ({ page }) => {
  await signIn(page);
  await page.goto('/import/files');
  let uploads = 0, processes = 0;
  await page.route('**/api/uploads', route => route.fulfill({ json: {
    upload_id: 'a'.repeat(32)+'.csv', transport: 'gcs-post', url: 'https://storage.fixture.test/private',
    fields: { key: 'voca/tmp/fixture/file.csv', policy: 'synthetic-policy' }, expires_at: Date.now()/1000+600, content_type: 'text/csv',
  } }));
  await page.route('https://storage.fixture.test/private', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'POST' } });
    uploads++;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataBuffer()!.toString()).toContain('hello,hi');
    await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' } });
  });
  await page.route('**/api/uploads/*/process', async route => {
    processes++;
    expect(route.request().postDataBuffer()!.length).toBeLessThan(1024);
    await route.fulfill(processes === 1 ? { status: 503, json: { message: 'Synthetic retryable verification failure.' } } :
      { json: { columns: ['word', 'translation'], rows: [['hello', 'hi']], row_numbers: [2], count: 1, invalid_rows: [], warnings: [], import_id: 'synthetic', provenance:[{}], groups:[{id:'table',name:'Structured list',count:1,row_numbers:[2],fields:[{name:'word',column:0},{name:'translation',column:1}],native_cards:0,templates:[],analysis:{kind:'vocabulary',confidence:.95,reason:'Synthetic transport fixture',fields:[],mapping:{word:'0',translation:'1'},source_mapping:{},sample_rows:[2],unresolved:[]}}] } });
  });
  await page.getByLabel('Vocabulary file').setInputFiles({ name: 'direct.csv', mimeType: 'text/csv', buffer: Buffer.from('word,translation\nhello,hi\n') });
  await page.getByRole('button', { name: 'Analyze file' }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic retryable verification failure.');
  await page.getByRole('button', { name: 'Analyze file' }).click();
  await expect(page.getByRole('heading', { name: /entries analyzed/ })).toBeVisible();
  expect(uploads).toBe(1);
  expect(processes).toBe(2);
});

for (const extension of ['txt', 'md', 'pdf']) {
  test(`practice ${extension} upload previews editable text, preserves language and saves without AI`, async ({ page }) => {
    await signIn(page);
    await page.goto('/practice');
    let saves = 0, ai = 0;
    page.on('request', request => {
      if (request.url().endsWith('/api/articles') && request.method() === 'POST') saves++;
      if (request.url().includes('/api/ai/') || request.url().includes('/api/import/analyze') ||
          request.url().endsWith('/process') && request.postDataJSON()?.method === 'ai') ai++;
    });
    await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toBeVisible();
    await page.getByLabel('Language', { exact: true }).selectOption('German');
    const content = extension === 'pdf' ? 'Hello local practice PDF.' : '# Häuser\nGrüße 世界.';
    await page.getByLabel('Article file', { exact: true }).setInputFiles({ name: `Practice preview.${extension}`, mimeType: extension === 'pdf' ? 'application/pdf' : 'text/plain', buffer: extension === 'pdf' ? pdf(content) : Buffer.from('\ufeff'+content) });
    await expect(page.getByLabel('Article text', { exact: true })).toHaveValue(content);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Practice preview');
    expect(saves).toBe(0);
    await page.getByLabel('Title', { exact: true }).fill(`Reviewed ${extension} article`);
    await page.getByLabel('Article text', { exact: true }).fill(content+'\nEdited before saving.');
    await expect(page.getByLabel('Language', { exact: true })).toHaveValue('German');
    await page.getByRole('button', { name: 'Save & start practice', exact: true }).click();
    await expect(page).toHaveURL(/\/practice\/[^/]+/);
    await expect(page.getByRole('heading', { name: `Reviewed ${extension} article`, exact: true })).toBeVisible();
    expect(saves).toBe(1); expect(ai).toBe(0);
    await page.getByRole('link', { name: 'Article library', exact: true }).click();
    await expect(page.getByRole('link', { name: new RegExp(`Reviewed ${extension} article`) })).toBeVisible();
  });
}

test('practice scan keeps the draft and requires explicit AI consent', async ({ page }) => {
  await signIn(page); await page.goto('/practice');
  await page.getByLabel('Title', { exact: true }).fill('My edited title');
  await page.getByLabel('Article text', { exact: true }).fill('Keep my current draft.');
  let ai = 0;
  await page.route('**/api/uploads/*/process', async route => {
    const body = route.request().postDataJSON();
    if (body.method !== 'ai') return route.continue();
    ai++; expect(body.consent_ai).toBe(true);
    await route.fulfill({ json: { text: 'Explicit synthetic OCR preview.', needs_ocr: false, method: 'ai' } });
  });
  await page.getByLabel('Article file', { exact: true }).setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf('') });
  await expect(page.getByText('No usable PDF text layer was found. OCR/AI requires your explicit consent.')).toBeVisible();
  await expect(page.getByLabel('Article text', { exact: true })).toHaveValue('Keep my current draft.');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My edited title');
  expect(ai).toBe(0);
  await page.getByRole('button', { name: 'Ask AI to extract this PDF', exact: true }).click();
  await expect(page.getByLabel('Article text', { exact: true })).toHaveValue('Explicit synthetic OCR preview.');
  expect(ai).toBe(1);
});

test('practice upload errors preserve text and show file/content limits', async ({ page }, testInfo) => {
  await signIn(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/practice');
  await page.getByLabel('Article text', { exact: true }).fill('Retain this pasted article.');
  const file = page.getByLabel('Article file', { exact: true });
  const over = testInfo.outputPath('oversized.txt'); await writeFile(over, 'x'); await truncate(over, 52428801);
  await file.setInputFiles(over);
  await expect(page.getByRole('alert')).toContainText('File exceeds 50 MiB');
  await file.setInputFiles({ name: 'long.md', mimeType: 'text/markdown', buffer: Buffer.alloc(100001, 97) });
  await expect(page.getByRole('alert')).toContainText('100,000 characters');
  await expect(page.getByLabel('Article text', { exact: true })).toHaveValue('Retain this pasted article.');
  await expect(page.getByRole('button', { name: 'Retry extraction', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('practice upload progress can be cancelled without losing the editor', async ({ page }) => {
  await signIn(page); await page.goto('/practice');
  await page.getByLabel('Article text', { exact: true }).fill('Retain this draft on cancel.');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/uploads/*/process', async route => { await held; await route.continue().catch(() => {}); });
  await page.getByLabel('Article file', { exact: true }).setInputFiles({ name: 'cancel.txt', mimeType: 'text/plain', buffer: Buffer.from('Pending article preview.') });
  await expect(page.getByRole('progressbar', { name: 'Article file upload progress' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save & start practice', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Upload cancelled');
  await expect(page.getByLabel('Article text', { exact: true })).toHaveValue('Retain this draft on cancel.');
  release();
});
