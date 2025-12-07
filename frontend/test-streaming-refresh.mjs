/**
 * Test script to verify tool calls display correctly during ACTIVE streaming.
 * 1. Navigates to a chat session
 * 2. Sends a message to trigger tool calls
 * 3. Waits for tool call to start
 * 4. Refreshes the page while streaming
 * 5. Checks if tool calls are displayed after refresh
 */

import { chromium } from 'playwright';

const FRONTEND_URL = 'http://localhost:5173';
const PROJECT_ID = 'baa4731f-9052-43ca-87f9-362e39b45037';

async function main() {
  console.log('=== Testing Tool Display During Active Streaming ===\n');

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
        text.includes('tool_result') ||
        text.includes('action')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  // Navigate to project
  console.log('1. Navigating to project...');
  await page.goto(`${FRONTEND_URL}/projects/${PROJECT_ID}`);
  await page.waitForTimeout(2000);

  // Create a new chat session
  console.log('\n2. Creating new chat session...');
  const newChatButton = page.locator('button:has-text("New Chat"), button:has-text("+ New"), [aria-label*="new chat"]').first();
  if (await newChatButton.count() > 0) {
    await newChatButton.click();
    await page.waitForTimeout(2000);
  } else {
    // Click on any existing session
    const sessionLink = page.locator('a[href*="/chat/"]').first();
    if (await sessionLink.count() > 0) {
      await sessionLink.click();
      await page.waitForTimeout(2000);
    }
  }

  // Get current URL
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  // Check if we're in a chat session
  if (!currentUrl.includes('/chat/')) {
    console.log('ERROR: Not in a chat session. Please manually navigate to a chat.');
    console.log('Browser staying open for manual testing...');
    await page.waitForTimeout(300000);
    await browser.close();
    return;
  }

  // Wait for input to be ready
  await page.waitForTimeout(1000);

  // Find and fill the message input
  console.log('\n3. Sending message to trigger tool calls...');
  const messageInput = page.locator('textarea, input[type="text"]').first();
  if (await messageInput.count() > 0) {
    await messageInput.fill('list the files in the current directory using bash');
    await page.waitForTimeout(500);

    // Press Enter or click send button
    const sendButton = page.locator('button[type="submit"], button:has-text("Send")').first();
    if (await sendButton.count() > 0) {
      await sendButton.click();
    } else {
      await messageInput.press('Enter');
    }

    console.log('Message sent. Waiting for tool call to start...');

    // Wait for tool call to appear in the stream
    let toolCallStarted = false;
    let waitTime = 0;
    const maxWait = 15000; // 15 seconds max

    while (!toolCallStarted && waitTime < maxWait) {
      await page.waitForTimeout(500);
      waitTime += 500;

      // Check for any indication of tool call starting
      const bashElements = await page.locator('text=bash').count();
      if (bashElements > 0) {
        toolCallStarted = true;
        console.log(`\n4. Tool call detected after ${waitTime}ms!`);
      }
    }

    if (!toolCallStarted) {
      console.log('\n4. Tool call not detected within timeout. Refreshing anyway...');
    }

    // Now refresh the page while streaming is active
    console.log('\n5. Refreshing page while streaming is active...');
    await page.reload();
    await page.waitForTimeout(5000);

    // Check what's rendered after refresh
    console.log('\n6. Checking rendered content after refresh...');

    const messageCount = await page.locator('.message-wrapper').count();
    console.log(`   Message wrappers found: ${messageCount}`);

    const bashElements = await page.locator('text=bash').count();
    console.log(`   Elements containing "bash": ${bashElements}`);

  } else {
    console.log('ERROR: Could not find message input');
  }

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
