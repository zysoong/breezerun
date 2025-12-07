/**
 * Simplified streaming test to monitor the message persistence issue
 * This test connects to an existing session and sends a message to observe streaming behavior
 */

const WebSocket = require('ws');

// Configuration - using the session from user's test
const BACKEND_URL = 'http://localhost:8000';
const SESSION_ID = '3f250e9d-9a22-4b99-8baa-e1298f3a58d6';
const PROJECT_ID = '39caa1f6-1943-4f6a-9634-8fda2667f403';

// Test message to generate a long response
const TEST_MESSAGE = 'Explain the concept of machine learning in detail, including supervised learning, unsupervised learning, and reinforcement learning. Provide examples for each type and discuss their applications. This should be a comprehensive explanation.';

class StreamingTester {
    constructor() {
        this.events = [];
        this.chunks = [];
        this.receivedContent = '';
        this.startTime = null;
        this.endTime = null;
    }

    async checkDatabaseState(label) {
        console.log(`\n=== DATABASE STATE: ${label} ===`);

        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/chats/${SESSION_ID}/messages`);
            if (!response.ok) {
                console.error(`Failed to fetch messages: ${response.status}`);
                return null;
            }

            const { messages } = await response.json();
            const assistantMessages = messages.filter(m => m.role === 'assistant');
            const latestMessage = assistantMessages[assistantMessages.length - 1];

            if (!latestMessage) {
                console.log('No assistant message found yet');
                return null;
            }

            const contentLength = latestMessage.content ? latestMessage.content.length : 0;
            const metadata = latestMessage.message_metadata || {};

            console.log(`Message ID: ${latestMessage.id}`);
            console.log(`Content length: ${contentLength} chars`);
            console.log(`Streaming: ${metadata.streaming}`);
            console.log(`Has error: ${metadata.has_error}`);
            console.log(`Cancelled: ${metadata.cancelled}`);
            console.log(`Agent mode: ${metadata.agent_mode}`);

            if (contentLength > 0) {
                console.log(`First 100 chars: ${latestMessage.content.substring(0, 100)}...`);
                const lastChars = latestMessage.content.substring(Math.max(0, contentLength - 100));
                console.log(`Last 100 chars: ...${lastChars}`);

                // Check if content appears complete (ends with punctuation)
                const lastChar = latestMessage.content.trim().slice(-1);
                if (['.', '!', '?', '"', "'"].includes(lastChar)) {
                    console.log('Content appears complete (ends with punctuation)');
                } else {
                    console.log('⚠️ Content appears truncated (no ending punctuation)');
                }
            }

            return {
                id: latestMessage.id,
                contentLength,
                metadata,
                content: latestMessage.content
            };
        } catch (error) {
            console.error('Error checking database:', error.message);
            return null;
        }
    }

    async testStreaming() {
        console.log('\n=== STARTING STREAMING TEST ===');
        console.log(`Session ID: ${SESSION_ID}`);
        console.log(`Project ID: ${PROJECT_ID}`);

        return new Promise((resolve, reject) => {
            const wsUrl = `ws://localhost:8000/api/v1/chats/${SESSION_ID}/stream`;
            console.log(`\nConnecting to WebSocket: ${wsUrl}`);

            const ws = new WebSocket(wsUrl);
            let checkInterval;
            let chunkCount = 0;

            ws.on('open', () => {
                console.log('[WS] Connected successfully');
                this.startTime = Date.now();

                // Start periodic database checks during streaming
                checkInterval = setInterval(async () => {
                    const elapsed = Date.now() - this.startTime;
                    if (elapsed < 30000 && this.chunks.length > 0) { // Only check while actively streaming
                        await this.checkDatabaseState(`During Streaming (${this.chunks.length} chunks received)`);
                    }
                }, 3000);

                // Send test message
                const message = {
                    type: 'message',
                    content: TEST_MESSAGE,
                    session_id: SESSION_ID
                };

                console.log(`\n[WS] Sending test message...`);
                console.log(`Message preview: ${TEST_MESSAGE.substring(0, 100)}...`);
                ws.send(JSON.stringify(message));
            });

            ws.on('message', (data) => {
                const event = JSON.parse(data);
                const timestamp = Date.now() - this.startTime;

                this.events.push({ ...event, timestamp });

                switch(event.type) {
                    case 'start':
                        console.log(`\n[${timestamp}ms] STREAMING STARTED`);
                        break;

                    case 'chunk':
                        chunkCount++;
                        this.chunks.push(event.content);
                        this.receivedContent += event.content;

                        // Log every 10th chunk to avoid spam
                        if (chunkCount % 10 === 0 || chunkCount === 1) {
                            console.log(`[${timestamp}ms] Chunk #${chunkCount}: ${event.content.length} chars, Total: ${this.receivedContent.length} chars`);
                        }
                        break;

                    case 'end':
                        this.endTime = Date.now();
                        console.log(`\n[${timestamp}ms] STREAMING ENDED`);
                        console.log(`  Message ID: ${event.message_id}`);
                        console.log(`  Total chunks: ${this.chunks.length}`);
                        console.log(`  Total content: ${this.receivedContent.length} chars`);
                        console.log(`  Duration: ${this.endTime - this.startTime}ms`);
                        clearInterval(checkInterval);
                        setTimeout(() => ws.close(), 100);
                        break;

                    case 'error':
                        console.error(`\n[${timestamp}ms] ERROR: ${event.content || event.message}`);
                        clearInterval(checkInterval);
                        setTimeout(() => ws.close(), 100);
                        break;

                    case 'action':
                        console.log(`[${timestamp}ms] ACTION: ${event.tool} - ${event.status}`);
                        break;

                    case 'observation':
                        console.log(`[${timestamp}ms] OBSERVATION: ${event.content?.substring(0, 100)}...`);
                        break;

                    default:
                        console.log(`[${timestamp}ms] ${event.type.toUpperCase()}`);
                }
            });

            ws.on('error', (error) => {
                console.error('[WS] Error:', error.message);
                clearInterval(checkInterval);
                reject(error);
            });

            ws.on('close', () => {
                console.log('[WS] Connection closed');
                clearInterval(checkInterval);
                resolve();
            });
        });
    }

    async analyzeResults() {
        console.log('\n=== ANALYZING RESULTS ===');

        // Check database state at different intervals after streaming
        const checks = [
            { delay: 0, label: 'IMMEDIATELY AFTER' },
            { delay: 2000, label: 'AFTER 2 SECONDS' },
            { delay: 3000, label: 'AFTER 5 SECONDS' },
            { delay: 5000, label: 'AFTER 10 SECONDS' }
        ];

        const states = [];
        for (const check of checks) {
            if (check.delay > 0) {
                console.log(`\nWaiting ${check.delay}ms...`);
                await new Promise(r => setTimeout(r, check.delay));
            }
            const state = await this.checkDatabaseState(check.label);
            states.push({ ...check, state });
        }

        // Final analysis
        console.log('\n=== DETAILED ANALYSIS ===');

        console.log('\n1. STREAMING STATISTICS:');
        console.log(`   Total events: ${this.events.length}`);
        console.log(`   Total chunks: ${this.chunks.length}`);
        console.log(`   Received content: ${this.receivedContent.length} chars`);

        if (this.startTime && this.endTime) {
            console.log(`   Streaming duration: ${this.endTime - this.startTime}ms`);
            const avgChunkSize = this.receivedContent.length / this.chunks.length;
            console.log(`   Average chunk size: ${avgChunkSize.toFixed(1)} chars`);
        }

        // Check if received content appears complete
        const lastChar = this.receivedContent.trim().slice(-1);
        if (['.', '!', '?', '"', "'"].includes(lastChar)) {
            console.log(`   Received content appears complete (ends with "${lastChar}")`);
        } else {
            console.log(`   ⚠️ Received content may be truncated (ends with "${lastChar}")`);
        }

        console.log('\n2. PERSISTENCE TIMELINE:');
        states.forEach(({ label, state }) => {
            if (state) {
                console.log(`\n   ${label}:`);
                console.log(`     Content: ${state.contentLength} chars`);
                console.log(`     Streaming flag: ${state.metadata.streaming}`);
                console.log(`     Has error: ${state.metadata.has_error}`);
            } else {
                console.log(`\n   ${label}: No data`);
            }
        });

        console.log('\n3. CONTENT COMPARISON:');
        const finalState = states[states.length - 1].state;

        if (finalState) {
            const dbLength = finalState.contentLength;
            const receivedLength = this.receivedContent.length;

            console.log(`   Received via WebSocket: ${receivedLength} chars`);
            console.log(`   Stored in database: ${dbLength} chars`);

            if (dbLength === receivedLength) {
                console.log('   ✅ Content length matches');
            } else if (dbLength < receivedLength) {
                console.log(`   ❌ TRUNCATED: Lost ${receivedLength - dbLength} chars (${((1 - dbLength/receivedLength) * 100).toFixed(1)}%)`);
            } else {
                console.log(`   ⚠️ Database has MORE content: +${dbLength - receivedLength} chars`);
            }

            // Check content match
            if (finalState.content && this.receivedContent) {
                if (finalState.content === this.receivedContent) {
                    console.log('   ✅ Content exactly matches');
                } else if (this.receivedContent.startsWith(finalState.content)) {
                    console.log('   ❌ DB content is truncated prefix of received');
                } else if (finalState.content.startsWith(this.receivedContent)) {
                    console.log('   ⚠️ DB content extends beyond received');
                } else {
                    console.log('   ❌ Content mismatch/corruption');
                }
            }

            // Check finalization
            if (finalState.metadata.streaming === false) {
                console.log('   ✅ Properly marked as streaming=false');
            } else {
                console.log('   ❌ Still marked as streaming=true');
            }
        }

        // Final verdict
        console.log('\n=== FINAL VERDICT ===');

        if (finalState) {
            const issues = [];

            if (finalState.metadata.streaming === true) {
                issues.push('Message not finalized (streaming=true)');
            }

            if (finalState.contentLength < this.receivedContent.length) {
                const lossPercent = ((1 - finalState.contentLength/this.receivedContent.length) * 100).toFixed(1);
                issues.push(`Content truncated (lost ${lossPercent}%)`);
            }

            if (!finalState.content || !finalState.content.trim().match(/[.!?'"]\s*$/)) {
                issues.push('Content appears incomplete (no ending punctuation)');
            }

            if (issues.length === 0) {
                console.log('✅ MESSAGE PERSISTENCE WORKING CORRECTLY');
            } else {
                console.log('❌ MESSAGE PERSISTENCE ISSUES DETECTED:');
                issues.forEach(issue => console.log(`   - ${issue}`));

                console.log('\nLIKELY CAUSES:');
                if (finalState.metadata.streaming === true) {
                    console.log('1. Final update not executed in chat_handler.py (lines 839-845)');
                    console.log('2. WebSocket disconnected before final update');
                    console.log('3. Exception occurred before final commit');
                }
                if (finalState.contentLength < this.receivedContent.length) {
                    console.log('1. Batched commits not including all chunks');
                    console.log('2. Content buffer overflow or truncation');
                    console.log('3. Database column size limit reached');
                }
            }
        } else {
            console.log('❌ NO MESSAGE DATA AVAILABLE');
        }
    }

    async run() {
        try {
            await this.testStreaming();
            await this.analyzeResults();
        } catch (error) {
            console.error('Test failed:', error.message);
        }
    }
}

// Run the test
console.log('=== STREAMING PERSISTENCE TEST ===');
console.log('Backend URL:', BACKEND_URL);
console.log('Testing with existing session');

const tester = new StreamingTester();
tester.run().then(() => {
    console.log('\nTest complete');
    process.exit(0);
}).catch(error => {
    console.error('Test error:', error);
    process.exit(1);
});