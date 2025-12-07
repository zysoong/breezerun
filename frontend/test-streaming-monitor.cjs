/**
 * Direct monitoring test for streaming behavior
 * This test monitors the actual streaming process without mocking
 */

const WebSocket = require('ws');

// Configuration
const BACKEND_URL = 'http://localhost:8000';
const PROJECT_ID = '39caa1f6-1943-4f6a-9634-8fda2667f403';

// Test message that should generate a long response
const TEST_MESSAGE = 'Generate a comprehensive explanation about web development, including frontend technologies like HTML, CSS, JavaScript, React, Vue, Angular, backend technologies like Node.js, Python, databases, and deployment strategies. Include at least 1000 characters in your response.';

class StreamingMonitor {
    constructor() {
        this.events = [];
        this.chunks = [];
        this.receivedContent = '';
        this.messageId = null;
        this.sessionId = null;
        this.startTime = null;
        this.endTime = null;
    }

    async createSession() {
        console.log('\n=== CREATING TEST SESSION ===');

        const response = await fetch(`${BACKEND_URL}/api/v1/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: PROJECT_ID,
                name: 'Streaming Monitor Test ' + Date.now()
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.status}`);
        }

        const session = await response.json();
        this.sessionId = session.id;
        console.log(`Created session: ${this.sessionId}`);
        return this.sessionId;
    }

    async checkDatabaseState(label) {
        console.log(`\n=== DATABASE STATE: ${label} ===`);

        const response = await fetch(`${BACKEND_URL}/api/v1/chats/${this.sessionId}/messages`);
        if (!response.ok) {
            console.error(`Failed to fetch messages: ${response.status}`);
            return null;
        }

        const { messages } = await response.json();
        const assistantMsg = messages.find(m => m.role === 'assistant');

        if (!assistantMsg) {
            console.log('No assistant message in database yet');
            return null;
        }

        const contentLength = assistantMsg.content ? assistantMsg.content.length : 0;
        const metadata = assistantMsg.message_metadata || {};

        console.log(`Message ID: ${assistantMsg.id}`);
        console.log(`Content length: ${contentLength} chars`);
        console.log(`Metadata: ${JSON.stringify(metadata, null, 2)}`);

        if (contentLength > 0) {
            console.log(`First 100 chars: ${assistantMsg.content.substring(0, 100)}...`);
            console.log(`Last 100 chars: ...${assistantMsg.content.substring(contentLength - 100)}`);
        }

        return {
            id: assistantMsg.id,
            contentLength,
            metadata,
            content: assistantMsg.content
        };
    }

    async monitorStreaming() {
        console.log('\n=== STARTING STREAMING MONITOR ===');

        return new Promise((resolve, reject) => {
            const wsUrl = `ws://localhost:8000/api/v1/chats/${this.sessionId}/stream`;
            console.log(`Connecting to: ${wsUrl}`);

            const ws = new WebSocket(wsUrl);
            let checkInterval;
            let lastEventTime = Date.now();

            ws.on('open', () => {
                console.log('\n[WS] Connected');
                this.startTime = Date.now();

                // Start periodic database checks
                checkInterval = setInterval(async () => {
                    const timeSinceLastEvent = Date.now() - lastEventTime;
                    if (timeSinceLastEvent < 5000) {
                        // Only check while actively streaming
                        await this.checkDatabaseState('DURING STREAMING');
                    }
                }, 2000);

                // Send test message
                const message = {
                    type: 'message',
                    content: TEST_MESSAGE,
                    session_id: this.sessionId
                };

                console.log(`\n[WS] Sending message...`);
                console.log(`Message content: ${TEST_MESSAGE.substring(0, 100)}...`);
                ws.send(JSON.stringify(message));
            });

            ws.on('message', (data) => {
                lastEventTime = Date.now();
                const event = JSON.parse(data);

                // Log event details
                const timestamp = Date.now() - this.startTime;
                this.events.push({ ...event, timestamp });

                switch(event.type) {
                    case 'start':
                        console.log(`\n[${timestamp}ms] STREAMING STARTED`);
                        break;

                    case 'chunk':
                        this.chunks.push(event.content);
                        this.receivedContent += event.content;
                        console.log(`[${timestamp}ms] CHUNK #${this.chunks.length}: ${event.content.length} chars, Total: ${this.receivedContent.length}`);
                        break;

                    case 'end':
                        this.endTime = Date.now();
                        this.messageId = event.message_id;
                        console.log(`\n[${timestamp}ms] STREAMING ENDED`);
                        console.log(`  Message ID: ${this.messageId}`);
                        console.log(`  Total chunks: ${this.chunks.length}`);
                        console.log(`  Total content: ${this.receivedContent.length} chars`);
                        console.log(`  Has error: ${event.has_error}`);
                        console.log(`  Cancelled: ${event.cancelled}`);
                        break;

                    case 'error':
                        console.error(`\n[${timestamp}ms] ERROR: ${event.content || event.message}`);
                        break;

                    case 'action':
                        console.log(`[${timestamp}ms] ACTION: ${event.tool} - ${event.status}`);
                        break;

                    case 'observation':
                        console.log(`[${timestamp}ms] OBSERVATION: ${event.content?.substring(0, 100)}...`);
                        break;

                    default:
                        console.log(`[${timestamp}ms] ${event.type.toUpperCase()}: ${JSON.stringify(event).substring(0, 200)}`);
                }

                // Close on end or error
                if (event.type === 'end' || event.type === 'error') {
                    clearInterval(checkInterval);
                    setTimeout(() => ws.close(), 100);
                }
            });

            ws.on('error', (error) => {
                console.error('[WS] Error:', error);
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

        // Check database immediately after streaming
        const immediateState = await this.checkDatabaseState('IMMEDIATELY AFTER');

        // Wait and check again
        console.log('\nWaiting 3 seconds...');
        await new Promise(r => setTimeout(r, 3000));
        const delayedState = await this.checkDatabaseState('AFTER 3 SECONDS');

        // Wait even longer
        console.log('\nWaiting 5 more seconds...');
        await new Promise(r => setTimeout(r, 5000));
        const finalState = await this.checkDatabaseState('AFTER 8 SECONDS');

        // Analysis
        console.log('\n=== DETAILED ANALYSIS ===');

        console.log('\n1. STREAMING STATISTICS:');
        console.log(`   Total events: ${this.events.length}`);
        console.log(`   Total chunks: ${this.chunks.length}`);
        console.log(`   Received content: ${this.receivedContent.length} chars`);
        console.log(`   Duration: ${this.endTime - this.startTime}ms`);

        const eventTypes = {};
        this.events.forEach(e => {
            eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
        });
        console.log(`   Event types: ${JSON.stringify(eventTypes)}`);

        console.log('\n2. PERSISTENCE ANALYSIS:');

        if (immediateState) {
            console.log(`   Immediate DB content: ${immediateState.contentLength} chars`);
            console.log(`   Immediate streaming flag: ${immediateState.metadata.streaming}`);
        }

        if (delayedState) {
            console.log(`   Delayed DB content: ${delayedState.contentLength} chars`);
            console.log(`   Delayed streaming flag: ${delayedState.metadata.streaming}`);
        }

        if (finalState) {
            console.log(`   Final DB content: ${finalState.contentLength} chars`);
            console.log(`   Final streaming flag: ${finalState.metadata.streaming}`);

            // Compare with received content
            if (finalState.contentLength === this.receivedContent.length) {
                console.log('   ✅ Content length matches received');
            } else if (finalState.contentLength < this.receivedContent.length) {
                console.log(`   ❌ TRUNCATED: Lost ${this.receivedContent.length - finalState.contentLength} chars`);
            } else {
                console.log(`   ⚠️  DB has MORE content than received (${finalState.contentLength} > ${this.receivedContent.length})`);
            }

            if (finalState.metadata.streaming === false) {
                console.log('   ✅ Properly marked as streaming=false');
            } else {
                console.log('   ❌ Still marked as streaming=true');
            }

            // Content comparison
            if (finalState.content && this.receivedContent) {
                if (finalState.content === this.receivedContent) {
                    console.log('   ✅ Content exactly matches');
                } else if (this.receivedContent.startsWith(finalState.content)) {
                    console.log('   ❌ DB content is truncated prefix');
                } else if (finalState.content.startsWith(this.receivedContent)) {
                    console.log('   ⚠️  DB content extends beyond received');
                } else {
                    console.log('   ❌ Content mismatch/corruption');
                }
            }
        }

        console.log('\n3. TIMING ANALYSIS:');

        // Check for timing patterns
        const chunkTimings = [];
        let lastTime = this.startTime;

        this.events.forEach(e => {
            if (e.type === 'chunk') {
                const timing = e.timestamp - (lastTime - this.startTime);
                chunkTimings.push(timing);
                lastTime = this.startTime + e.timestamp;
            }
        });

        if (chunkTimings.length > 0) {
            const avgTiming = chunkTimings.reduce((a, b) => a + b, 0) / chunkTimings.length;
            const maxTiming = Math.max(...chunkTimings);
            const minTiming = Math.min(...chunkTimings);

            console.log(`   Avg chunk interval: ${avgTiming.toFixed(0)}ms`);
            console.log(`   Max chunk interval: ${maxTiming}ms`);
            console.log(`   Min chunk interval: ${minTiming}ms`);
        }

        console.log('\n4. BACKEND LOGS CHECK:');
        console.log('   Check backend logs for:');
        console.log('   - [AGENT] Final message saved');
        console.log('   - [TASK REGISTRY] Marked task as completed');
        console.log('   - Any error messages or exceptions');

        // Final verdict
        console.log('\n=== FINAL VERDICT ===');

        if (finalState &&
            finalState.contentLength === this.receivedContent.length &&
            finalState.metadata.streaming === false) {
            console.log('✅ MESSAGE PERSISTENCE WORKING CORRECTLY');
        } else {
            console.log('❌ MESSAGE PERSISTENCE BUG CONFIRMED');
            console.log('\nLikely causes:');

            if (finalState && finalState.metadata.streaming === true) {
                console.log('1. Final update code not executing (lines 839-845 in chat_handler.py)');
                console.log('2. Possible WebSocket disconnect before final update');
                console.log('3. Exception occurring before final commit');
            }

            if (finalState && finalState.contentLength < this.receivedContent.length) {
                console.log('1. Batched commit not including all chunks');
                console.log('2. Streaming ending prematurely');
                console.log('3. Content buffer not fully flushed');
            }
        }
    }

    async run() {
        try {
            await this.createSession();
            await this.monitorStreaming();
            await this.analyzeResults();
        } catch (error) {
            console.error('Monitor failed:', error);
        }
    }
}

// Run the monitor
console.log('=== STREAMING PERSISTENCE MONITOR ===');
console.log('Backend URL:', BACKEND_URL);
console.log('Project ID:', PROJECT_ID);

const monitor = new StreamingMonitor();
monitor.run().then(() => {
    console.log('\nMonitor complete');
    process.exit(0);
}).catch(error => {
    console.error('Monitor error:', error);
    process.exit(1);
});