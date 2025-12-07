/**
 * Test script to verify tool calls display correctly.
 * Navigates directly to a session that has tool_call and tool_result blocks.
 */

import { chromium } from 'playwright';

const FRONTEND_URL = 'http://localhost:5173';
const PROJECT_ID = 'baa4731f-9052-43ca-87f9-362e39b45037';
const SESSION_ID = '1fb7c0a6-cc4d-4d95-8ead-644332b3a2c4';

async function main() {
  console.log('=== Testing Tool Display After Page Load ===\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect ALL console logs
  page.on('console', msg => {
    const text = msg.text();
    // Show all relevant logs
    if (text.includes('[WS]') ||
        text.includes('[useOptimizedStreaming]') ||
        text.includes('[AssistantUIChatList]') ||
        text.includes('[AssistantUIMessage]') ||
        text.includes('stream_sync') ||
        text.includes('isStreaming') ||
        text.includes('initialBlocks') ||
        text.includes('toolBlock') ||
        text.includes('tool_call') ||
        text.includes('tool_result')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  // Direct navigation to chat session
  const chatUrl = `${FRONTEND_URL}/projects/${PROJECT_ID}/chat/${SESSION_ID}`;
  console.log('1. Navigating directly to chat session:', chatUrl);
  await page.goto(chatUrl);
  await page.waitForTimeout(3000);

  // Check current URL
  console.log('\n2. Current URL:', page.url());

  // Wait for content to load
  console.log('\n3. Waiting for chat content to load...');
  await page.waitForTimeout(2000);

  // Check what's rendered
  console.log('\n4. Checking rendered content...');

  // Count message wrappers
  const messageCount = await page.locator('.message-wrapper').count();
  console.log(`   Message wrappers found: ${messageCount}`);

  // Count tool fallback components
  const toolFallbackCount = await page.locator('[class*="tool-fallback"]').count();
  console.log(`   Tool fallback components found: ${toolFallbackCount}`);

  // Look for any tool-related elements
  const toolElements = await page.locator('text=bash').count();
  console.log(`   Elements containing "bash": ${toolElements}`);

  // Try to find accordion headers (tool calls often use accordions)
  const accordionHeaders = await page.locator('[data-state]').count();
  console.log(`   Accordion headers: ${accordionHeaders}`);

  console.log('\n=== Now testing page refresh ===\n');
  console.log('5. Refreshing page...');
  await page.reload();
  await page.waitForTimeout(3000);

  // Check what's rendered after refresh
  console.log('\n6. Checking rendered content after refresh...');

  const messageCountAfter = await page.locator('.message-wrapper').count();
  console.log(`   Message wrappers found: ${messageCountAfter}`);

  const toolFallbackCountAfter = await page.locator('[class*="tool-fallback"]').count();
  console.log(`   Tool fallback components found: ${toolFallbackCountAfter}`);

  console.log('\n=== Browser staying open for manual inspection ===');
  console.log('Press Ctrl+C to close.\n');

  // Keep browser open for inspection
  await page.waitForTimeout(300000); // 5 minutes

  await browser.close();
  console.log('\nTest complete.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
