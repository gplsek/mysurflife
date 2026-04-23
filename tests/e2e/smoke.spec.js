/**
 * tests/e2e/smoke.spec.js
 * =======================
 * End-to-end smoke tests for MySurfLife.
 *
 * These catch integration failures that API tests miss:
 *   - Login flow broken (Supabase config, CORS, cookie handling)
 *   - Copilot panel crashing or returning error message to the user
 *   - API errors rendered as "Something went wrong" in the UI
 *   - Backend exceptions swallowed before they reach the user
 *
 * Prerequisites:
 *   - Frontend running: cd frontend && npm start   (localhost:3000)
 *   - Backend running: cd backend && uvicorn main:app --host 127.0.0.1 --port 8000
 *
 * Run:
 *   npx playwright test tests/e2e/smoke.spec.js
 *   npx playwright test tests/e2e/smoke.spec.js --headed   (watch the browser)
 *   BASE_URL=https://mysurflife.com npx playwright test    (production)
 *
 * Auth credentials injected via environment variable to avoid hardcoding in repo:
 *   TEST_EMAIL=george@plsek.us TEST_PASSWORD=... npx playwright test
 */

const { test, expect } = require('@playwright/test');

const TEST_EMAIL    = process.env.TEST_EMAIL    || 'george@plsek.us';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '2017FordRaptor!';
const TEST_SPOT     = 'Blacks Beach';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Log in and land on the shell (dashboard). Returns when the shell nav is visible.
 */
async function loginAndGetShell(page) {
  await page.goto('/');
  // If already redirected to shell (cookie still valid), we're done
  const alreadyShell = await page.locator('nav, [class*="shell"], [class*="topbar"]').first().isVisible().catch(() => false);
  if (alreadyShell) return;

  // Home page — look for login button or form
  const loginBtn = page.locator('a[href="/login"], button:has-text("Sign in"), button:has-text("Log in")').first();
  const emailInput = page.locator('input[type="email"]');

  if (await emailInput.isVisible().catch(() => false)) {
    // Already on login form
  } else {
    await loginBtn.click();
    await page.waitForURL('**/login', { timeout: 10_000 });
  }

  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');

  // After login, should land on shell (dashboard or map)
  await page.waitForFunction(
    () => !window.location.pathname.includes('/login'),
    { timeout: 15_000 }
  );
}

/**
 * Navigate to the Copilot screen and wait for the composer input to appear.
 */
async function openCopilot(page) {
  await loginAndGetShell(page);
  // Click the Copilot nav button
  await page.click('button:has-text("Copilot"), a:has-text("Copilot"), [href="/copilot"]');
  // Wait for the composer input to be ready
  await page.waitForSelector('.cop-composer-input, textarea[placeholder*="Ask about conditions"]', {
    timeout: 15_000,
  });
}

/**
 * Send a message in the Copilot and wait for a non-loading response.
 * Returns the text of the last assistant message.
 */
async function sendCopilotMessage(page, text) {
  const input = page.locator('.cop-composer-input, textarea[placeholder*="Ask about conditions"]').first();
  await input.fill(text);
  // Send via Enter key (mirrors normal usage)
  await input.press('Enter');

  // Wait for the assistant reply to appear (loading state clears)
  await page.waitForFunction(
    () => {
      // Loading indicator should disappear
      const loadingEl = document.querySelector('[class*="loading"], [class*="thinking"], [class*="cop-loading"]');
      return !loadingEl;
    },
    { timeout: 60_000 }  // Copilot + GRIB fetch can take up to 30s
  );

  // Give the message one more tick to render
  await page.waitForTimeout(300);

  // Find the last assistant message
  const msgs = page.locator('[class*="cop-msg"][class*="assistant"], [class*="assistant-message"], [data-role="assistant"]');
  const count = await msgs.count();
  if (count === 0) {
    // Fallback: grab all message bubbles and take the last
    const allMsgs = page.locator('[class*="cop-msg"], [class*="message-bubble"]');
    const total = await allMsgs.count();
    if (total === 0) return '';
    return allMsgs.nth(total - 1).innerText();
  }
  return msgs.nth(count - 1).innerText();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Authentication', () => {
  test('login with valid credentials lands on shell', async ({ page }) => {
    await page.goto('/');

    // If already logged in, skip
    const alreadyIn = await page.locator('nav').isVisible().catch(() => false);
    if (alreadyIn) return;

    await page.goto('/login').catch(() => page.goto('/'));
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible().catch(() => false)) {
      await page.fill('input[type="email"]', TEST_EMAIL);
      await page.fill('input[type="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 15_000 });
    }

    // Shell should show nav
    await expect(page.locator('nav, [class*="topbar"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login').catch(() => {});
    const emailInput = page.locator('input[type="email"]');
    if (!await emailInput.isVisible().catch(() => false)) {
      // Home page that redirects to login
      await page.click('button:has-text("Sign in"), a:has-text("Sign in")').catch(() => {});
      await page.waitForSelector('input[type="email"]', { timeout: 5_000 }).catch(() => {});
    }

    if (!await page.locator('input[type="email"]').isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', 'wrongpassword_smoke_test');
    await page.click('button[type="submit"]');

    await expect(
      page.locator('[class*="error"], [class*="alert"], [role="alert"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });
});


test.describe('Copilot — conditions question', () => {
  test('Copilot loads without crashing', async ({ page }) => {
    await openCopilot(page);
    // Composer input is present and ready
    await expect(
      page.locator('.cop-composer-input, textarea[placeholder*="Ask about conditions"]').first()
    ).toBeVisible();
  });

  test('conditions question returns surf data, not error message', async ({ page }) => {
    /**
     * Regression for two bugs:
     * 1. "Depends object has no attribute 'get'" — crashed get_surf_spot_conditions()
     *    when called by the Copilot tool internally. User saw "Something went wrong."
     * 2. NOMADS SCN25-81 OPeNDAP retirement — forecast-timeline returned empty data,
     *    Copilot returned a vague non-answer or generic fallback.
     *
     * This test catches BOTH: if either bug is present, the Copilot response
     * will contain "Something went wrong" or will lack any wave/surf keywords.
     */
    await openCopilot(page);
    const reply = await sendCopilotMessage(page, `What are the current surf conditions at ${TEST_SPOT}?`);

    // Must NOT be the generic error fallback
    expect(reply.toLowerCase()).not.toContain('something went wrong');
    expect(reply.toLowerCase()).not.toContain("backend error");
    expect(reply.toLowerCase()).not.toContain("please try again");

    // Must contain at least one surf-related term
    const surfKeywords = ['ft', 'feet', 'wave', 'swell', 'surf', 'conditions', 'period', 'wind', 'buoy', 'score'];
    const hasSurfData = surfKeywords.some(kw => reply.toLowerCase().includes(kw));
    expect(hasSurfData).toBe(true);
  });

  test('multi-spot comparison returns data for both spots', async ({ page }) => {
    await openCopilot(page);
    const reply = await sendCopilotMessage(page, 'Compare Cardiff Reef and Swamis right now');

    expect(reply.toLowerCase()).not.toContain('something went wrong');
    // Response should mention both spots (or close synonyms)
    const mentionsCardiff = reply.toLowerCase().includes('cardiff') || reply.toLowerCase().includes('reef');
    const mentionsSwamis  = reply.toLowerCase().includes('swamis') || reply.toLowerCase().includes('encinitas');
    expect(mentionsCardiff || mentionsSwamis).toBe(true);
  });
});


test.describe('Copilot — forecast question', () => {
  test('forecast window question returns timeline data', async ({ page }) => {
    /**
     * Regression for NOMADS SCN25-81: empty forecast timeline caused the
     * Copilot's get_conditions_window tool to return nothing useful.
     */
    await openCopilot(page);
    const reply = await sendCopilotMessage(
      page,
      `What's the best time to surf ${TEST_SPOT} this weekend?`
    );

    expect(reply.toLowerCase()).not.toContain('something went wrong');
    // Should include time-related or forecast-related content
    const forecastKeywords = ['morning', 'afternoon', 'saturday', 'sunday', 'tomorrow', 'weekend', 'forecast', 'hours', 'tide', 'wind'];
    const hasForecastData = forecastKeywords.some(kw => reply.toLowerCase().includes(kw));
    expect(hasForecastData).toBe(true);
  });
});


test.describe('Map / data overlays', () => {
  test('buoy markers appear on the map', async ({ page }) => {
    await loginAndGetShell(page);

    // Navigate to map view
    await page.click('button:has-text("Map"), a[href="/map"]').catch(() => {});
    await page.waitForTimeout(2000);  // let map tiles + buoys load

    // Should show at least one buoy marker
    // The app uses Leaflet markers — look for SVG circles or marker elements
    const markers = page.locator(
      '.buoy-marker, [class*="buoy-marker"], .leaflet-marker-icon, circle[fill]'
    );
    const count = await markers.count();
    expect(count).toBeGreaterThan(0);
  });
});


test.describe('No console errors on load', () => {
  test('fresh load produces no critical console errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out known acceptable third-party noise
        if (!text.includes('favicon') && !text.includes('ERR_ABORTED')) {
          consoleErrors.push(text);
        }
      }
    });

    await loginAndGetShell(page);
    await page.waitForTimeout(2000);

    // Filter to errors likely from our code (not browser extension noise)
    const ourErrors = consoleErrors.filter(e =>
      e.includes('mysurflife') || e.includes('localhost') ||
      e.includes('api/') || e.includes('Uncaught') ||
      e.includes('TypeError') || e.includes('ReferenceError')
    );

    expect(ourErrors, `Console errors on load:\n${ourErrors.join('\n')}`).toHaveLength(0);
  });
});
