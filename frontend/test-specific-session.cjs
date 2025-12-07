/**
 * Test to investigate the specific session that's still showing issues
 */

const WebSocket = require('ws');

// Configuration - testing the problematic session
const BACKEND_URL = 'http://localhost:8000';
const SESSION_ID = '915c9d61-2a24-4e19-886f-a80d58e30fb9';

async function checkCurrentState() {
    console.log('=== CHECKING CURRENT STATE OF SESSION ===');
    console.log(`Session ID: ${SESSION_ID}\n`);

    try {
        const response = await fetch(`${BACKEND_URL}/api/v1/chats/${SESSION_ID}/messages`);
        if (!response.ok) {
            console.error(`Failed to fetch messages: ${response.status}`);
            return;
        }

        const { messages } = await response.json();

        console.log(`Total messages: ${messages.length}`);

        messages.forEach((msg, idx) => {
            console.log(`\nMessage ${idx + 1}:`);
            console.log(`  ID: ${msg.id}`);
            console.log(`  Role: ${msg.role}`);
            console.log(`  Content length: ${msg.content ? msg.content.length : 0} chars`);

            if (msg.role === 'assistant') {
                const metadata = msg.message_metadata || {};
                console.log(`  Metadata:`);
                console.log(`    streaming: ${metadata.streaming}`);
                console.log(`    agent_mode: ${metadata.agent_mode}`);
                console.log(`    has_error: ${metadata.has_error}`);
                console.log(`    cancelled: ${metadata.cancelled}`);

                if (msg.content) {
                    console.log(`  Content preview: "${msg.content.substring(0, 100)}..."`);
                    const lastPart = msg.content.substring(Math.max(0, msg.content.length - 50));
                    console.log(`  Content end: "...${lastPart}"`);

                    // Check if content appears complete
                    const lastChar = msg.content.trim().slice(-1);
                    if (['.', '!', '?', '"', "'"].includes(lastChar)) {
                        console.log('  ✓ Content appears complete (ends with punctuation)');
                    } else {
                        console.log(`  ⚠️ Content appears truncated (ends with: "${lastChar}")`);
                    }
                }

                // Diagnosis
                if (metadata.streaming === true) {
                    console.log('\n  ❌ ISSUE: Message still marked as streaming=true');
                    console.log('  This means the final update code was never executed.');
                    console.log('  Possible causes:');
                    console.log('    1. WebSocket disconnected before streaming completed');
                    console.log('    2. Exception occurred before final commit');
                    console.log('    3. Streaming loop exited early');
                }
            }
        });

        // Try to send another test message to see if it works
        console.log('\n\n=== ATTEMPTING NEW TEST MESSAGE ===');

        return new Promise((resolve, reject) => {
            const wsUrl = `ws://localhost:8000/api/v1/chats/${SESSION_ID}/stream`;
            console.log(`Connecting to: ${wsUrl}`);

            const ws = new WebSocket(wsUrl);
            let receivedContent = '';
            let chunkCount = 0;
            let streamingComplete = false;

            ws.on('open', () => {
                console.log('[WS] Connected');

                // Send a simple test message
                const message = {
                    type: 'message',
                    content: 'Say "test complete" and nothing else.',
                    session_id: SESSION_ID
                };

                console.log('[WS] Sending test message...');
                ws.send(JSON.stringify(message));
            });

            ws.on('message', (data) => {
                const event = JSON.parse(data);

                switch(event.type) {
                    case 'start':
                        console.log('[WS] Streaming started');
                        break;
                    case 'chunk':
                        chunkCount++;
                        receivedContent += event.content;
                        process.stdout.write('.');
                        break;
                    case 'end':
                        console.log(`\n[WS] Streaming ended`);
                        console.log(`  Chunks received: ${chunkCount}`);
                        console.log(`  Content: "${receivedContent}"`);
                        console.log(`  Message ID: ${event.message_id}`);
                        streamingComplete = true;
                        ws.close();
                        break;
                    case 'error':
                        console.error(`[WS] Error: ${event.content}`);
                        ws.close();
                        break;
                }
            });

            ws.on('close', async () => {
                console.log('[WS] Connection closed');

                if (streamingComplete) {
                    // Wait a bit for database persistence
                    console.log('\nWaiting 2 seconds for database update...');
                    await new Promise(r => setTimeout(r, 2000));

                    // Check the state again
                    console.log('\n=== CHECKING STATE AFTER NEW MESSAGE ===');
                    const response = await fetch(`${BACKEND_URL}/api/v1/chats/${SESSION_ID}/messages`);
                    const { messages } = await response.json();

                    // Find the newest assistant message
                    const assistantMessages = messages.filter(m => m.role === 'assistant');
                    const latestMsg = assistantMessages[assistantMessages.length - 1];

                    if (latestMsg) {
                        const metadata = latestMsg.message_metadata || {};
                        console.log('Latest assistant message:');
                        console.log(`  Content: "${latestMsg.content}"`);
                        console.log(`  Streaming: ${metadata.streaming}`);
                        console.log(`  Has error: ${metadata.has_error}`);

                        if (latestMsg.content === 'test complete' && metadata.streaming === false) {
                            console.log('\n✅ NEW MESSAGE PERSISTED CORRECTLY');
                        } else {
                            console.log('\n❌ NEW MESSAGE ALSO HAS ISSUES');
                        }
                    }
                }

                resolve();
            });

            ws.on('error', (error) => {
                console.error('[WS] Error:', error.message);
                reject(error);
            });
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the test
console.log('=== SESSION INVESTIGATION TEST ===');
console.log('Backend URL:', BACKEND_URL);

checkCurrentState().then(() => {
    console.log('\nInvestigation complete');
    process.exit(0);
}).catch(error => {
    console.error('Test error:', error);
    process.exit(1);
});