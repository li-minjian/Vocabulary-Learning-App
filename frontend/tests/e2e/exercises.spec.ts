import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
async function signIn(page: any) {
  await page.goto('/login');
  await page.evaluate(async () => {
    const path = '/src/lib/supabase.ts';
    const {
      supabase
    } = await import(/* @vite-ignore */path);
    const result = await supabase.auth.signInWithPassword({
      email: 'fixture@example.test',
      password: 'public-fixture-value'
    });
    if (result.error) throw result.error;
  });
}
const root = '/private/tmp/voca-exercises';
test.beforeAll(() => execFileSync(path.resolve('../backend/.venv/bin/python'), [path.resolve('../backend/tests/e2e/create_exercise_fixtures.py'), `${root}/fixtures`]));
async function importExercises(page: any, name: string) {
  await signIn(page);
  await page.goto('/import/files');
  await page.getByLabel('Vocabulary file (up to 50 MiB)', {
    exact: true
  }).setInputFiles(`${root}/fixtures/${name}`);
  await page.getByRole('button', {
    name: 'Analyze file',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    name: /entries analyzed/
  })).toBeVisible();
  await page.getByLabel('Collection',{exact:true}).selectOption('33333333-3333-3333-3333-333333333333');
  await page.getByLabel('New Exercise Set title', {
    exact: true
  }).fill(`E2E_TEST_EXERCISES_${Date.now()}`);
  await page.getByRole('button', {
    name: 'Preview exercise import',
    exact: true
  }).click();
  await expect(page.getByTestId('exercise-confirmation')).toBeVisible();
  const mediaConsent=page.getByLabel(/I checked that text is sufficient for cards with unsupported media/);
  if(await mediaConsent.count()){await expect(page.getByRole('button',{name:'Confirm & save exercises',exact:true})).toBeDisabled();await mediaConsent.check();}
  await page.getByRole('button', {
    name: 'Confirm & save exercises',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    level: 1,
    name: /E2E_TEST_EXERCISES/
  })).toBeVisible();
}
test('real PostgreSQL import, practice, reload, rating, resume, results and review entry', async ({
  page
}) => {
  let words = 0,
    ai = 0;
  page.on('request', r => {
    if (r.method() === 'POST' && r.url().endsWith('/api/file-import/commit')) words++;
    if (/\/api\/(ai|import\/analyze)/.test(r.url())) ai++;
  });
  await importExercises(page, 'grammar.apkg');
  await expect(page.getByRole('heading', {
    name: 'Browse exercises · 3'
  })).toBeVisible();
  await page.getByRole('link',{name:'Practice this set',exact:true}).click();
  await page.getByLabel('Session size', {
    exact: true
  }).fill('2');
  await page.getByRole('button', {
    name: 'Start Practicing',
    exact: true
  }).click();
  await expect(page.getByLabel('Blank 1', {
    exact: true
  })).toBeVisible();
  await expect(page.getByLabel('Answer feedback')).toHaveCount(0);
  await page.getByLabel('Blank 1', {
    exact: true
  }).fill('in');
  await page.getByRole('button', {
    name: 'Check answer & save',
    exact: true
  }).click();
  await expect(page.getByLabel('Answer feedback')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Answer feedback')).toContainText('Correct');
  await page.getByRole('button', {
    name: 'Good · Next',
    exact: true
  }).click();
  await expect(page.getByText('1 / 2 completed', {
    exact: true
  })).toBeVisible();
  await page.getByRole('link', {
    name: 'Pause — resume later',
    exact: true
  }).click();
  await page.getByLabel('Continue Learning').selectOption({index:1});
  await page.getByRole('button',{name:'Resume exercise session',exact:true}).click();
  await expect(page.getByText('1 / 2 completed', {
    exact: true
  })).toBeVisible();
  await page.getByRole('button', {
    name: 'Show answer / self-assess',
    exact: true
  }).click();
  await expect(page.getByLabel('Answer feedback')).toContainText('Answer revealed');
  await page.getByRole('button', {
    name: 'Again · Next',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    name: 'Session results',
    exact: true
  })).toBeVisible();
  await expect(page.getByText('Accuracy uses checked answers only.', {
    exact: false
  })).toBeVisible();
  await page.screenshot({
    path: `${root}/practice-results-synthetic.png`,
    fullPage: true
  });
  await page.goto('/review');
  await expect(page).toHaveURL(/learn\?method=review/);
  await page.getByLabel('Review scope').selectOption('exercises');
  await expect(page.getByLabel('Vocabulary format')).toHaveCount(0);
  expect(words).toBe(0);
  expect(ai).toBe(0);
});
test('exercise mapping edits, multiple cloze cards, idempotent reimport and mobile practice', async ({
  page
}) => {
  await importExercises(page, 'variants.apkg');
  await expect(page.getByRole('heading', {
    name: 'Browse exercises · 2'
  })).toBeVisible();
  await page.getByRole('link',{name:'Practice this set',exact:true}).click();
  await page.getByLabel('Session size', {
    exact: true
  }).fill('2');
  await page.getByRole('button', {
    name: 'Start Practicing',
    exact: true
  }).click();
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel('Blank 1', {
    exact: true
  })).toBeVisible();
  await expect(page.getByLabel('Blank 2', {
    exact: true
  })).toBeVisible();
  await page.getByLabel('Blank 1', {
    exact: true
  }).fill('One');
  await page.getByLabel('Blank 2', {
    exact: true
  }).fill('three');
  await page.getByLabel('Blank 2', {
    exact: true
  }).press('Enter');
  await expect(page.getByLabel('Answer feedback')).toContainText('Correct');
  await page.screenshot({
    path: `${root}/practice-mobile-synthetic.png`,
    fullPage: true
  });
  await page.getByRole('button', {
    name: 'Easy · Next',
    exact: true
  }).click();
  await expect(page.getByLabel('Blank 2', {
    exact: true
  })).toHaveCount(0);
  await page.getByLabel('Blank 1', {
    exact: true
  }).fill('two');
  await page.getByRole('button', {
    name: 'Check answer & save',
    exact: true
  }).click();
  await expect(page.getByLabel('Answer feedback')).toContainText('Correct');
  await page.getByRole('button', {
    name: 'Good · Next',
    exact: true
  }).click();
  await page.goto('/import/files');
  await page.getByLabel('Vocabulary file (up to 50 MiB)', {
    exact: true
  }).setInputFiles(`${root}/fixtures/variants.apkg`);
  await page.getByRole('button', {
    name: 'Analyze file',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Preview exercise import',
    exact: true
  }).click();
  await expect(page.getByTestId('exercise-confirmation')).toContainText('2 unchanged');
  await expect(page.getByRole('button', {
    name: 'Confirm & save exercises',
    exact: true
  })).toBeDisabled();
});
test('source choices, self assessment and confirmed exercise deletion stay separate from words', async ({
  page
}) => {
  await importExercises(page, 'qa.apkg');
  const setUrl=page.url();
  await page.getByRole('link',{name:'Practice this set',exact:true}).click();
  await page.getByLabel('Session size', {
    exact: true
  }).fill('1');
  await page.getByRole('button', {
    name: 'Start Practicing',
    exact: true
  }).click();
  await expect(page.getByLabel('Your answer (optional)', {
    exact: true
  })).toBeVisible();
  await page.getByRole('button', {
    name: 'Show answer / self-assess',
    exact: true
  }).click();
  await expect(page.getByLabel('Answer feedback')).toContainText('A source explanation');
  await page.getByRole('button', {
    name: 'Hard · Next',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    name: 'Session results',
    exact: true
  })).toBeVisible();
  await page.goto(setUrl);

  await page.getByRole('button',{name:/Describe a greeting/}).click();
  await expect(page.getByLabel('Exercise details')).toContainText('1 attempts');
  await page.getByRole('button',{name:'Delete this exercise',exact:true}).click();
  await page.getByRole('button',{name:'Confirm delete exercise and history',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Browse exercises · 0',exact:true})).toBeVisible();
  await page.getByText('Manage Exercise Set',{exact:true}).click();
  const title=await page.getByRole('heading',{level:1}).innerText();
  await page.getByRole('button',{name:'Delete set',exact:true}).click();
  await expect(page.getByRole('button',{name:'Confirm delete set and history',exact:true})).toBeDisabled();
  await page.getByLabel('Confirm set title',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Confirm delete set and history',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Library',exact:true})).toBeVisible();
});
