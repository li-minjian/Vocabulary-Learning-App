import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 1000 }, launchOptions: { channel: 'chrome' }, screenshot: 'only-on-failure' },
  webServer: [
    { command: '../backend/.venv/bin/python ../backend/tests/e2e/fixture_server.py', url: 'http://127.0.0.1:54399/api/health', reuseExistingServer: false },
    { command: 'npm run dev -- --host localhost --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: false,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' } },
  ],
});
