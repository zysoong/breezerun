/**
 * Test script to specifically test page refresh during streaming.
 * Opens browser for manual testing with console logging.
 */

import { chromium } from 'playwright';

const FRONTEND_URL = 'http://localhost:5173';

async function main() {
  console.log('=== Testing Page Refresh During Streaming ===\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect ALL console logs
  page.on('console', msg => {
    const text = msg.text();
    // Show all relevant logs
    if (text.includes('[WS]') ||
        text.includes('[useOptimizedStreaming]') ||
        text.includes('stream_sync') ||
        text.includes('isStreaming') ||
        text.includes('initialBlocks') ||
        text.includes('STREAM SYNC') ||
        text.includes('cancel')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  // Navigate to app
  console.log('1. Navigating to frontend...');
  await page.goto(FRONTEND_URL);
  await page.waitForTimeout(2000);

  // Navigate to a project
  const projectCard = page.locator('.project-card').first();
  if (await projectCard.count() > 0) {
    await projectCard.click();
    await page.waitForTimeout(1500);
  }

  // Navigate to a chat session
  let sessionElement = page.locator('.session-item, a[href*="/chat/"]').first();
  if (await sessionElement.count() > 0) {
    await sessionElement.click();
    await page.waitForTimeout(2000);
  }

  // Check current URL
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  console.log('\n=== Browser is ready ===');
  console.log('Instructions:');
  console.log('1. Send a message like "list files in current directory"');
  console.log('2. While tool is streaming, press F5 to refresh the page');
  console.log('3. Watch the console output for stream_sync events');
  console.log('4. Check if tool calls appear after refresh');
  console.log('\nKeeping browser open for 5 minutes...\n');

  // Keep browser open for testing
  await page.waitForTimeout(300000); // 5 minutes

  await browser.close();
  console.log('\nTest complete.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
