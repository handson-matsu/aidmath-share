// Read-only browser check against the real GAS. No POST requests are sent.
// Usage: NODE_PATH=... node tests/live-read.cjs
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const postId = process.env.LIVE_POST_ID || 'post_e5adcbf6-2ed8-424b-8e7b-4f6799067309';
(async () => {
  const server = http.createServer((req, res) => {
    const file = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'app.js', 'style.css'].includes(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(path.join(__dirname, '..', file)));
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('link', { name: /THEME 01/ }).waitFor();
    console.log('PASS topics (real browser CORS)');
    await page.getByRole('link', { name: /THEME 01/ }).click();
    const card = page.locator(`a[href="#topic/tiling/post/${postId}"]`);
    await card.waitFor();
    console.log('PASS posts (saved test post)');
    await card.click();
    await page.locator('.comment').first().waitFor();
    console.log('PASS comments (saved test comment)');
    await page.waitForFunction(() => {
      const frame = document.querySelector('.art-frame.large');
      return frame?.querySelector('img')?.naturalWidth > 0 || frame?.textContent.includes('画像を読み込めませんでした');
    });
    const imageOK = await page.locator('.art-frame.large img').count() > 0;
    assert.ok(imageOK, 'GAS image endpoint did not return a displayable image; check image upload field contract.');
    console.log('PASS image (decoded in browser)');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
