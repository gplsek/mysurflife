# E2E Smoke Tests

Playwright tests that log in via browser and verify the full stack works.

## Prerequisites

- Frontend running: `cd frontend && npm start` (localhost:3000)
- Backend running: `cd backend && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000`
- Playwright browsers installed: `npx playwright install chromium`

## Run

```bash
# From project root
npx playwright test tests/e2e/smoke.spec.js

# Watch mode (see the browser)
npx playwright test tests/e2e/smoke.spec.js --headed

# Against production
BASE_URL=https://mysurflife.com npx playwright test tests/e2e/smoke.spec.js
```

## What these tests catch

- Login flow broken (Supabase config, CORS, cookie handling)
- Copilot panel returning "Something went wrong" instead of real data
- Backend exceptions surfacing as generic error messages in the UI
- Forecast timeline empty (WW3 GRIB failure silently producing `wave: null`)

## Credentials

Set via environment variables — don't hardcode:
```bash
TEST_EMAIL=george@plsek.us TEST_PASSWORD=... npx playwright test
```

The test file falls back to `george@plsek.us` for dev convenience, but override in CI.
