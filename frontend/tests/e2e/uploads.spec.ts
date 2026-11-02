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
  await expect(page.getByRole('button', { name: /Parse/ })).toBeEnabled();
  await file.setInputFiles(over);
  await expect(page.getByText('File exceeds 50 MiB (52,428,800 bytes).', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Parse/ })).toBeDisabled();
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
      { json: { columns: ['word', 'translation'], rows: [['hello', 'hi']], row_numbers: [2], count: 1, invalid_rows: [], warnings: [], import_id: 'synthetic' } });
  });
  await page.getByLabel('Vocabulary file').setInputFiles({ name: 'direct.csv', mimeType: 'text/csv', buffer: Buffer.from('word,translation\nhello,hi\n') });
  await page.getByRole('button', { name: /Parse/ }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic retryable verification failure.');
  await page.getByRole('button', { name: /Parse/ }).click();
  await expect(page.getByRole('heading', { name: /Map your/ })).toBeVisible();
  expect(uploads).toBe(1);
  expect(processes).toBe(2);
});
