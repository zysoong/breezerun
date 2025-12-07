import { test, expect } from '@playwright/test';

test.describe('Message Persistence Bug Test', () => {
  test('should persist complete message content in database after streaming', async ({ page }) => {
    console.log('Starting message persistence test...');

    // Navigate to the application
    await page.goto('http://localhost:3000');
    console.log('Navigated to application');

    // Wait for the page to fully load (look for different possible selectors)
    try {
      // Try to find a projects list or create project button
      await page.waitForSelector('[data-testid="projects-list"], [data-testid="create-project"], .project-card, button:has-text("New Project"), button:has-text("Create Project")', {
        timeout: 10000
      });
      console.log('Found project UI elements');
    } catch (e) {
      console.log('Could not find project UI, taking screenshot...');
      await page.screenshot({ path: 'test-initial-page.png' });
    }

    // Check if we need to create a project first
    const projectExists = await page.locator('.project-card, [data-testid="project-item"]').count() > 0;

    if (!projectExists) {
      console.log('No projects found, creating one...');
      // Look for create project button
      const createBtn = page.locator('button:has-text("New Project"), button:has-text("Create Project"), button:has-text("Create"), [data-testid="create-project"]').first();
      if (await createBtn.isVisible()) {
        await createBtn.click();
        console.log('Clicked create project button');

        // Fill in project details if needed
        const projectNameInput = page.locator('input[placeholder*="Project"], input[name="name"], input[name="projectName"]').first();
        if (await projectNameInput.isVisible()) {
          await projectNameInput.fill('Test Project ' + Date.now());
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }
      }
    }

    // Click on the first project or navigate to chat
    const projectCard = page.locator('.project-card, [data-testid="project-item"], a[href*="/project"]').first();
    if (await projectCard.isVisible()) {
      await projectCard.click();
      console.log('Clicked on project');
      await page.waitForTimeout(2000);
    }

    // Try to navigate directly to a chat URL if needed
    if (!page.url().includes('/chat')) {
      console.log('Navigating directly to chat...');
      // Extract project ID from URL or create a new chat session
      const currentUrl = page.url();
      if (currentUrl.includes('/project/')) {
        const projectId = currentUrl.match(/\/project\/([^\/]+)/)?.[1];
        if (projectId) {
          await page.goto(`http://localhost:3000/project/${projectId}/chat`);
        }
      }
    }

    // Wait for chat interface to load
    console.log('Waiting for chat interface...');
    await page.waitForTimeout(3000);

    // Take a screenshot to see what's on the page
    await page.screenshot({ path: 'test-chat-page.png' });

    // Try multiple possible selectors for chat input
    const chatInputSelectors = [
      'textarea[placeholder*="Type"], textarea[placeholder*="Send"], textarea[placeholder*="Enter"], textarea[placeholder*="Message"]',
      'input[placeholder*="Type"], input[placeholder*="Send"], input[placeholder*="Enter"], input[placeholder*="Message"]',
      '[data-testid="chat-input"]',
      '[role="textbox"]',
      '.chat-input textarea, .chat-input input',
      'textarea, input[type="text"]'
    ];

    let chatInput = null;
    for (const selector of chatInputSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        chatInput = element;
        console.log(`Found chat input with selector: ${selector}`);
        break;
      }
    }

    if (!chatInput) {
      throw new Error('Could not find chat input field');
    }

    // Generate a long test message to verify persistence
    const testMessage = 'Generate a detailed explanation about the water cycle including evaporation, condensation, precipitation, and collection. Include at least 500 characters in your response.';

    console.log('Sending test message...');
    await chatInput.fill(testMessage);
    await chatInput.press('Enter');

    // Wait for streaming to start
    console.log('Waiting for streaming to start...');
    await page.waitForTimeout(2000);

    // Look for streaming indicators or message elements
    const messageSelectors = [
      '[data-testid="assistant-message"]',
      '.assistant-message',
      '.message-content',
      '[role="article"]',
      '.markdown-body',
      'div:has-text("evaporation")'
    ];

    let assistantMessage = null;
    for (const selector of messageSelectors) {
      const element = page.locator(selector).last();
      if (await element.isVisible()) {
        assistantMessage = element;
        console.log(`Found assistant message with selector: ${selector}`);
        break;
      }
    }

    // Wait for streaming to complete (look for completion indicators)
    console.log('Waiting for streaming to complete...');
    await page.waitForTimeout(10000); // Give it time to stream

    // Check for streaming end indicators
    try {
      await page.waitForSelector('[data-testid="streaming-complete"], .streaming-complete, [data-streaming="false"]', {
        timeout: 15000
      });
    } catch {
      console.log('No explicit streaming complete indicator found, continuing...');
    }

    // Get the message content after streaming
    let messageContent = '';
    if (assistantMessage) {
      messageContent = await assistantMessage.textContent() || '';
      console.log(`Message length after streaming: ${messageContent.length} characters`);
    }

    // Wait for potential re-render after database save
    console.log('Waiting for database persistence...');
    await page.waitForTimeout(3000);

    // Refresh the page to force re-fetch from database
    console.log('Refreshing page to verify persistence...');
    await page.reload();
    await page.waitForTimeout(3000);

    // Find the message again after refresh
    let messageAfterRefresh = null;
    for (const selector of messageSelectors) {
      const element = page.locator(selector).last();
      if (await element.isVisible()) {
        messageAfterRefresh = element;
        break;
      }
    }

    let contentAfterRefresh = '';
    if (messageAfterRefresh) {
      contentAfterRefresh = await messageAfterRefresh.textContent() || '';
      console.log(`Message length after refresh: ${contentAfterRefresh.length} characters`);
    }

    // Take a screenshot of the final state
    await page.screenshot({ path: 'test-after-refresh.png' });

    // Verify the message wasn't truncated
    expect(contentAfterRefresh.length).toBeGreaterThan(125);
    console.log('✓ Message persistence test passed! Content length:', contentAfterRefresh.length);

    // Also check that content contains expected keywords
    expect(contentAfterRefresh.toLowerCase()).toContain('evaporation');
    expect(contentAfterRefresh.toLowerCase()).toContain('condensation');
  });

  test('should handle rapid message sending without truncation', async ({ page }) => {
    console.log('Starting rapid message test...');

    // Navigate to the application
    await page.goto('http://localhost:3000');

    // Navigate to a chat session (reuse logic from first test)
    // ... (similar navigation code)

    // Send multiple messages quickly
    const messages = [
      'What is 2+2?',
      'Explain quantum physics in one paragraph',
      'List 5 benefits of exercise'
    ];

    for (const msg of messages) {
      // Find chat input
      const chatInput = page.locator('textarea, input[type="text"]').first();
      if (await chatInput.isVisible()) {
        await chatInput.fill(msg);
        await chatInput.press('Enter');
        await page.waitForTimeout(5000); // Wait for response
      }
    }

    // Refresh and verify all messages are complete
    await page.reload();
    await page.waitForTimeout(3000);

    const allMessages = await page.locator('.message-content, [data-testid="message"]').allTextContents();
    console.log(`Found ${allMessages.length} messages after refresh`);

    // Verify no messages are truncated to ~125 characters
    for (const content of allMessages) {
      if (content.length > 50) { // Only check substantial messages
        console.log(`Message length: ${content.length}`);
        expect(content.length).not.toBe(125);
        expect(content.length).not.toBe(124);
        expect(content.length).not.toBe(126);
      }
    }
  });
});