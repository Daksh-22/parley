// Accessibility audit for the auth and chat screens.
//
// The chat screen only renders for an authenticated session, so this script
// registers a user through the real UI first. Lighthouse then navigates
// fresh; the httpOnly refresh cookie in the Chrome profile restores the
// session and the chat screen is what gets audited.
//
// Usage: node infra/lighthouse-audit.mjs  (server on :4000, web on :5173)

import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const PORT = 9223;

function reportFailures(result) {
  const audits = Object.values(result.lhr.audits).filter(
    (a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary',
  );
  for (const audit of audits) {
    console.log(`  FAIL ${audit.id}: ${audit.title}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [`--remote-debugging-port=${PORT}`],
});

try {
  const flags = { port: PORT, onlyCategories: ['accessibility'], output: 'json' };

  // 1. Auth screen: fresh profile, signed out.
  const authResult = await lighthouse(APP_URL, flags);
  const authScore = Math.round((authResult.lhr.categories.accessibility?.score ?? 0) * 100);
  console.log(`auth screen accessibility: ${authScore}`);
  reportFailures(authResult);

  // 2. Register through the real UI so the profile holds a session.
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role=tab]')].find((t) =>
      t.textContent.includes('Create'),
    );
    tab.click();
  });
  await page.waitForSelector('#displayName');
  const username = `audit${Date.now() % 1000000}`;
  await page.type('#username', username);
  await page.type('#displayName', 'Audit User');
  await page.type('#password', 'audit-password-1');
  await page.click('button[type=submit]');
  await page.waitForSelector('#composer', { timeout: 15000 });
  await page.close();

  // 3. Chat screen: session restored from the refresh cookie.
  const chatResult = await lighthouse(APP_URL, flags);
  const chatScore = Math.round((chatResult.lhr.categories.accessibility?.score ?? 0) * 100);
  console.log(`chat screen accessibility: ${chatScore}`);
  reportFailures(chatResult);

  process.exitCode = authScore >= 95 && chatScore >= 95 ? 0 : 1;
} finally {
  await browser.close();
}
