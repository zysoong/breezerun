/**
 * Comprehensive test to mock frontend WebSocket and LLM API
 * This test will help identify where message persistence fails
 */

const WebSocket = require('ws');
const http = require('http');
const { URL } = require('url');

// Configuration
const BACKEND_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/api/v1/chats';
const MOCK_LLM_PORT = 8765;

// Mock LLM response - simulating a complete message that gets truncated
const MOCK_RESPONSE_CHUNKS = [
    "I'm an autonomous coding agent designed to assist with a variety of programming-related tasks. ",
    "My main capabilities include helping users write, test, and debug code across different programming languages and environments.\n\n",
    "Here's a more detailed introduction:\n\n",
    "1. **Purpose**: My primary goal is to make coding more accessible and efficient. ",
    "I can handle tasks such as writing scripts, solving coding problems, performing code reviews, and experimenting with new programming concepts.\n\n",
    "2. **Supported Languages**: I am equipped to work with several programming languages including Python (versions 3.11, 3.12, and 3.13), ",
    "JavaScript/TypeScript with Node.js, Java, C++, Go, Rust, and many others. ",
    "I can also work with various frameworks and libraries specific to each language.\n\n",
    "3. **Development Tools**: I have access to essential development tools including version control (Git), ",
    "package managers (pip, npm, cargo), testing frameworks, and build tools. ",
    "I can help set up development environments, manage dependencies, and configure CI/CD pipelines.\n\n",
    "4. **Problem-Solving Approach**: When tackling coding challenges, I employ a systematic approach - ",
    "understanding requirements, planning the solution, implementing code incrementally, testing thoroughly, and refining based on results.\n\n",
    "5. **Learning and Adaptation**: I stay updated with modern programming practices, design patterns, and best practices. ",
    "I can explain complex concepts in simple terms and adapt my explanations to different skill levels."
];

// Calculate expected total length
const EXPECTED_TOTAL_LENGTH = MOCK_RESPONSE_CHUNKS.join('').length;
console.log(`Expected total message length: ${EXPECTED_TOTAL_LENGTH} characters`);

// Create mock LLM server
function createMockLLMServer() {
    const server = http.createServer((req, res) => {
        console.log(`[MOCK LLM] Received request: ${req.method} ${req.url}`);

        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
            // Mock OpenAI streaming response
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });

            // Send chunks with delays to simulate real streaming
            let chunkIndex = 0;
            const sendNextChunk = () => {
                if (chunkIndex < MOCK_RESPONSE_CHUNKS.length) {
                    const chunk = MOCK_RESPONSE_CHUNKS[chunkIndex];
                    const data = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gpt-4',
                        choices: [{
                            index: 0,
                            delta: { content: chunk },
                            finish_reason: null
                        }]
                    };

                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                    console.log(`[MOCK LLM] Sent chunk ${chunkIndex + 1}/${MOCK_RESPONSE_CHUNKS.length}: ${chunk.substring(0, 50)}...`);
                    chunkIndex++;

                    // Send next chunk after delay
                    setTimeout(sendNextChunk, 100);
                } else {
                    // Send final chunk with finish_reason
                    const finalData = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gpt-4',
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: 'stop'
                        }]
                    };

                    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                    console.log('[MOCK LLM] Streaming complete');
                }
            };

            // Start streaming after a small delay
            setTimeout(sendNextChunk, 100);
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    server.listen(MOCK_LLM_PORT, () => {
        console.log(`[MOCK LLM] Server running on port ${MOCK_LLM_PORT}`);
    });

    return server;
}

// Test WebSocket streaming behavior
async function testStreamingBehavior() {
    console.log('\n=== TESTING BACKEND STREAMING BEHAVIOR ===\n');

    // Start mock LLM server
    const mockServer = createMockLLMServer();

    try {
        // Create a test chat session first
        const createSessionResponse = await fetch(`${BACKEND_URL}/api/v1/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: '39caa1f6-1943-4f6a-9634-8fda2667f403',
                name: 'Test Streaming ' + Date.now()
            })
        });

        if (!createSessionResponse.ok) {
            throw new Error(`Failed to create session: ${createSessionResponse.status}`);
        }

        const session = await createSessionResponse.json();
        const sessionId = session.id;
        console.log(`Created test session: ${sessionId}`);

        // Connect WebSocket
        console.log('Connecting to WebSocket...');
        const ws = new WebSocket(`${WS_URL}/${sessionId}/stream`);

        let receivedContent = '';
        let messageId = null;
        let streamingEvents = [];
        let chunkCount = 0;
        let lastChunkTime = null;
        let firstChunkTime = null;

        ws.on('open', () => {
            console.log('WebSocket connected');

            // Send test message
            const message = {
                type: 'message',
                content: 'Generate a detailed introduction about yourself',
                session_id: sessionId
            };

            console.log('Sending message to backend...');
            ws.send(JSON.stringify(message));
        });

        ws.on('message', (data) => {
            const event = JSON.parse(data);
            streamingEvents.push(event);

            const now = Date.now();

            if (event.type === 'start') {
                console.log('\n[STREAMING START]');
                firstChunkTime = now;
            } else if (event.type === 'chunk') {
                if (!firstChunkTime) firstChunkTime = now;

                receivedContent += event.content;
                chunkCount++;

                const timeSinceLastChunk = lastChunkTime ? now - lastChunkTime : 0;
                lastChunkTime = now;

                console.log(`[CHUNK ${chunkCount}] Length: ${event.content.length}, Total: ${receivedContent.length}, Interval: ${timeSinceLastChunk}ms`);
            } else if (event.type === 'end') {
                const totalTime = now - firstChunkTime;
                console.log(`\n[STREAMING END]`);
                console.log(`  Message ID: ${event.message_id}`);
                console.log(`  Total chunks: ${chunkCount}`);
                console.log(`  Total time: ${totalTime}ms`);
                console.log(`  Content length: ${receivedContent.length} characters`);

                messageId = event.message_id;
                ws.close();
            } else if (event.type === 'error') {
                console.error('[ERROR]', event);
                ws.close();
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        // Wait for streaming to complete
        await new Promise((resolve) => {
            ws.on('close', () => {
                console.log('WebSocket closed');
                resolve();
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                console.log('Timeout - closing WebSocket');
                ws.close();
                resolve();
            }, 30000);
        });

        console.log('\n=== STREAMING COMPLETED ===');
        console.log(`Received content length: ${receivedContent.length} characters`);
        console.log(`Expected content length: ${EXPECTED_TOTAL_LENGTH} characters`);

        // Wait for database persistence
        console.log('\nWaiting 3 seconds for database persistence...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check database state
        console.log('\n=== CHECKING DATABASE STATE ===');

        const messagesResponse = await fetch(`${BACKEND_URL}/api/v1/chats/${sessionId}/messages`);
        if (!messagesResponse.ok) {
            throw new Error(`Failed to fetch messages: ${messagesResponse.status}`);
        }

        const { messages } = await messagesResponse.json();
        const assistantMessage = messages.find(m => m.role === 'assistant');

        if (!assistantMessage) {
            console.error('❌ No assistant message found in database!');
        } else {
            const dbContentLength = assistantMessage.content ? assistantMessage.content.length : 0;
            const metadata = assistantMessage.message_metadata || {};

            console.log('\nDatabase Message State:');
            console.log(`  Message ID: ${assistantMessage.id}`);
            console.log(`  Content length in DB: ${dbContentLength} characters`);
            console.log(`  Metadata: ${JSON.stringify(metadata, null, 2)}`);

            // Analysis
            console.log('\n=== ANALYSIS ===');

            if (dbContentLength === 0) {
                console.error('❌ CRITICAL: Message has NO content in database!');
            } else if (dbContentLength < receivedContent.length) {
                console.error(`❌ TRUNCATION: Lost ${receivedContent.length - dbContentLength} characters`);
                console.error(`   Received: ${receivedContent.length} chars`);
                console.error(`   Saved: ${dbContentLength} chars`);
            } else if (dbContentLength === receivedContent.length) {
                console.log('✅ Content length matches');
            }

            if (metadata.streaming === true) {
                console.error('❌ INCOMPLETE: Message still marked as streaming=true');
            } else if (metadata.streaming === false) {
                console.log('✅ Message properly marked as streaming=false');
            }

            // Check for specific truncation patterns
            if (dbContentLength > 0 && dbContentLength < 200) {
                console.warn('⚠️  Possible 125-character truncation bug pattern');
            }

            // Compare content
            if (dbContentLength > 0 && receivedContent.length > 0) {
                const dbContent = assistantMessage.content;
                if (dbContent === receivedContent) {
                    console.log('✅ Content exactly matches');
                } else if (receivedContent.startsWith(dbContent)) {
                    console.error('❌ Database content is prefix of received (truncated)');
                } else if (dbContent.startsWith(receivedContent)) {
                    console.warn('⚠️  Database has MORE content than received?');
                } else {
                    console.error('❌ Content mismatch - corruption detected');
                }
            }

            // Event analysis
            console.log('\n=== EVENT SEQUENCE ANALYSIS ===');
            console.log(`Total events received: ${streamingEvents.length}`);

            const eventTypes = {};
            streamingEvents.forEach(e => {
                eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
            });
            console.log('Event type counts:', eventTypes);

            // Check if we got proper start/end sequence
            const hasStart = streamingEvents.some(e => e.type === 'start');
            const hasEnd = streamingEvents.some(e => e.type === 'end');
            const hasError = streamingEvents.some(e => e.type === 'error');

            if (!hasStart) console.error('❌ Missing START event');
            if (!hasEnd && !hasError) console.error('❌ Missing END event');

            // Final verdict
            console.log('\n=== FINAL VERDICT ===');
            if (dbContentLength === EXPECTED_TOTAL_LENGTH && metadata.streaming === false) {
                console.log('✅ MESSAGE PERSISTENCE WORKING CORRECTLY');
            } else {
                console.error('❌ MESSAGE PERSISTENCE BUG CONFIRMED');
                console.error(`   Issue: Message not properly finalized after streaming`);
                console.error(`   Expected ${EXPECTED_TOTAL_LENGTH} chars with streaming=false`);
                console.error(`   Got ${dbContentLength} chars with streaming=${metadata.streaming}`);
            }
        }

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        // Cleanup
        mockServer.close(() => {
            console.log('[MOCK LLM] Server closed');
        });
    }
}

// Run the test
console.log('Starting backend streaming test with mocked LLM...');
console.log('Backend URL:', BACKEND_URL);
console.log('Mock LLM Port:', MOCK_LLM_PORT);

// Note: You may need to configure the backend to use the mock LLM endpoint
console.log('\nNOTE: Ensure backend is configured to use http://localhost:8765/v1/chat/completions as LLM endpoint\n');

testStreamingBehavior().then(() => {
    console.log('\nTest complete');
    process.exit(0);
}).catch(error => {
    console.error('Test error:', error);
    process.exit(1);
});