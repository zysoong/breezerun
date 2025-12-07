/**
 * Test to verify message finalization after streaming errors
 * This test reproduces the bug where messages remain with "streaming": true
 * after an error occurs during streaming.
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');

const BACKEND_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/api/chat/stream';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testStreamingFinalization() {
  console.log('\n=== TESTING STREAMING FINALIZATION BUG ===\n');

  try {
    // Use a test session ID
    const sessionId = '2a67ddeb-0b33-4c03-9bab-8d20b588ce2b'; // The problematic session
    const projectId = '39caa1f6-1943-4f6a-9634-8fda2667f403';

    // Step 1: Check current message state
    console.log('Fetching current messages from database...');
    const messagesResponse = await fetch(
      `${BACKEND_URL}/api/projects/${projectId}/chat-sessions/${sessionId}/messages`
    );

    if (!messagesResponse.ok) {
      console.error('Failed to fetch messages:', messagesResponse.status);
      return;
    }

    const messages = await messagesResponse.json();
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    console.log(`\nFound ${assistantMessages.length} assistant messages`);

    // Check each assistant message's streaming status
    assistantMessages.forEach((msg, idx) => {
      const metadata = msg.message_metadata || {};
      const streaming = metadata.streaming;
      const contentLength = msg.content ? msg.content.length : 0;

      console.log(`\nMessage ${idx + 1} (ID: ${msg.id}):`);
      console.log(`  Content length: ${contentLength} characters`);
      console.log(`  Streaming status: ${streaming}`);
      console.log(`  Has error: ${metadata.has_error}`);
      console.log(`  Agent mode: ${metadata.agent_mode}`);
      console.log(`  First 100 chars: ${msg.content ? msg.content.substring(0, 100) : 'EMPTY'}...`);

      if (streaming === true && contentLength > 0) {
        console.error(`\n❌ BUG CONFIRMED: Message ${msg.id} has content but streaming=true!`);
        console.error(`   This message was not properly finalized.`);
      }
    });

    // Step 2: Test with a new message to verify the fix
    console.log('\n\n=== TESTING WITH NEW MESSAGE ===\n');

    console.log('Connecting to WebSocket...');
    const ws = new WebSocket(`${WS_URL}/${sessionId}`);

    let messageId = null;
    let errorOccurred = false;
    let streamingComplete = false;
    let receivedContent = '';

    ws.on('open', () => {
      console.log('WebSocket connected');

      // Send a message that will trigger an error (since API key is missing)
      const testMessage = {
        type: 'chat',
        content: 'Test message to verify streaming finalization',
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
        receivedContent += message.content;
        process.stdout.write('.');
      } else if (message.type === 'error') {
        console.log('\nError received:', message.content);
        errorOccurred = true;
      } else if (message.type === 'end') {
        console.log('\nStreaming ended');
        messageId = message.message_id;
        streamingComplete = true;
        ws.close();
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('WebSocket closed');
    });

    // Wait for completion or error
    let timeout = 15;
    while (!streamingComplete && timeout > 0) {
      await sleep(1000);
      timeout--;
    }

    console.log(`\n\nStreaming complete. Error occurred: ${errorOccurred}`);
    console.log(`Received content length: ${receivedContent.length}`);

    // Step 3: Check if the new message was properly finalized
    if (messageId || errorOccurred) {
      console.log('\nWaiting for database persistence...');
      await sleep(3000);

      console.log('Fetching updated messages...');
      const updatedResponse = await fetch(
        `${BACKEND_URL}/api/projects/${projectId}/chat-sessions/${sessionId}/messages`
      );

      if (updatedResponse.ok) {
        const updatedMessages = await updatedResponse.json();
        const newAssistantMessages = updatedMessages.filter(m => m.role === 'assistant');
        const lastMessage = newAssistantMessages[newAssistantMessages.length - 1];

        if (lastMessage) {
          const metadata = lastMessage.message_metadata || {};
          console.log('\n=== LATEST MESSAGE STATUS ===');
          console.log(`Message ID: ${lastMessage.id}`);
          console.log(`Content length: ${lastMessage.content ? lastMessage.content.length : 0}`);
          console.log(`Streaming: ${metadata.streaming}`);
          console.log(`Has error: ${metadata.has_error}`);

          if (metadata.streaming === true) {
            console.error('\n❌ BUG STILL EXISTS: Message not properly finalized!');
            console.error('The streaming flag is still true after completion/error.');
          } else if (metadata.streaming === false) {
            console.log('\n✅ SUCCESS: Message was properly finalized!');
            console.log('The streaming flag was correctly set to false.');
          }
        }
      }
    }

  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
console.log('Starting streaming finalization test...');
console.log('Backend URL:', BACKEND_URL);
console.log('WebSocket URL:', WS_URL);

testStreamingFinalization().then(() => {
  console.log('\nTest complete');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});