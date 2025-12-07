/**
 * Direct test for message persistence bug
 * This test directly calls the backend API to verify that messages are being
 * persisted correctly after streaming completes
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');

const BACKEND_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/api/chat/stream';

// Test configuration
const TEST_PROJECT_ID = 'test-' + Date.now();
const TEST_SESSION_ID = 'session-' + Date.now();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTestSession() {
  console.log('Creating test session...');

  // First, let's create a project
  const projectResponse = await fetch(`${BACKEND_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Project ' + TEST_PROJECT_ID,
      description: 'Testing message persistence'
    })
  });

  if (!projectResponse.ok) {
    console.log('Failed to create project, using existing session');
  } else {
    const project = await projectResponse.json();
    console.log('Created project:', project.id);
  }

  // Create or get a chat session
  const sessionResponse = await fetch(`${BACKEND_URL}/api/projects/${TEST_PROJECT_ID}/chat-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Session ' + TEST_SESSION_ID
    })
  });

  if (!sessionResponse.ok) {
    console.log('Using default session');
    return { projectId: TEST_PROJECT_ID, sessionId: TEST_SESSION_ID };
  }

  const session = await sessionResponse.json();
  console.log('Created session:', session.id);
  return { projectId: project.id, sessionId: session.id };
}

async function testMessagePersistence() {
  console.log('\n=== TESTING MESSAGE PERSISTENCE BUG ===\n');

  try {
    // Create a test session
    const { projectId, sessionId } = await createTestSession();

    // Connect to WebSocket for streaming
    console.log('Connecting to WebSocket...');
    const ws = new WebSocket(`${WS_URL}/${sessionId}`);

    let messageContent = '';
    let messageId = null;
    let streamingComplete = false;

    ws.on('open', () => {
      console.log('WebSocket connected');

      // Send a test message that should generate a long response
      const testMessage = {
        type: 'chat',
        content: 'Generate a detailed explanation about photosynthesis. Include at least 500 characters in your response about the light and dark reactions, chloroplasts, and the overall importance of the process.',
        sessionId: sessionId
      };

      console.log('Sending test message...');
      ws.send(JSON.stringify(testMessage));
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data);

      if (message.type === 'start') {
        console.log('Streaming started');
      } else if (message.type === 'chunk') {
        // Accumulate chunks
        messageContent += message.content;
        process.stdout.write('.');
      } else if (message.type === 'end') {
        console.log('\nStreaming completed');
        messageId = message.message_id;
        streamingComplete = true;
        ws.close();
      } else if (message.type === 'error') {
        console.error('Error during streaming:', message);
        ws.close();
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('WebSocket closed');
    });

    // Wait for streaming to complete
    let timeout = 30;
    while (!streamingComplete && timeout > 0) {
      await sleep(1000);
      timeout--;
    }

    if (!streamingComplete) {
      console.error('Streaming did not complete within timeout');
      return;
    }

    console.log(`\nStreaming complete. Message length: ${messageContent.length} characters`);
    console.log(`Message ID: ${messageId}`);

    // Wait a bit for database persistence
    console.log('\nWaiting for database persistence...');
    await sleep(3000);

    // Fetch the message from the database to verify persistence
    console.log('\nFetching message from database...');
    const messagesResponse = await fetch(`${BACKEND_URL}/api/projects/${projectId}/chat-sessions/${sessionId}/messages`);

    if (!messagesResponse.ok) {
      console.error('Failed to fetch messages:', messagesResponse.status);
      return;
    }

    const messages = await messagesResponse.json();
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const lastMessage = assistantMessages[assistantMessages.length - 1];

    if (!lastMessage) {
      console.error('No assistant message found in database!');
      return;
    }

    const dbContentLength = lastMessage.content ? lastMessage.content.length : 0;

    console.log('\n=== RESULTS ===');
    console.log(`Streamed content length: ${messageContent.length} characters`);
    console.log(`Database content length: ${dbContentLength} characters`);
    console.log(`First 200 chars from stream: ${messageContent.substring(0, 200)}`);
    console.log(`First 200 chars from DB: ${lastMessage.content ? lastMessage.content.substring(0, 200) : 'EMPTY'}`);

    // Check if the message was truncated
    if (dbContentLength < messageContent.length) {
      console.error('\n❌ BUG CONFIRMED: Message was truncated in database!');
      console.error(`Lost ${messageContent.length - dbContentLength} characters`);

      // Check if it's the specific ~125 character truncation
      if (dbContentLength >= 120 && dbContentLength <= 130) {
        console.error('This appears to be the 125-character truncation bug!');
      }
    } else if (dbContentLength === messageContent.length) {
      console.log('\n✅ SUCCESS: Message was persisted correctly!');
    } else {
      console.warn('\n⚠️  WARNING: Database has MORE content than streamed?');
      console.warn(`Extra: ${dbContentLength - messageContent.length} characters`);
    }

    // Additional verification: check for exact match
    if (lastMessage.content === messageContent) {
      console.log('✅ Content matches exactly');
    } else {
      console.warn('⚠️  Content differs between stream and database');
    }

  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
console.log('Starting message persistence test...');
console.log('Backend URL:', BACKEND_URL);
console.log('WebSocket URL:', WS_URL);

testMessagePersistence().then(() => {
  console.log('\nTest complete');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});