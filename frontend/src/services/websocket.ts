export interface ChatMessage {
  type: 'message' | 'chunk' | 'start' | 'end' | 'error' | 'user_message_saved' | 'thought' | 'action' | 'action_streaming' | 'action_args_chunk' | 'observation' | 'cancelled' | 'cancel_acknowledged';
  content?: string;
  message_id?: string;
  tool?: string;
  args?: any;
  partial_args?: string;  // For action_args_chunk events
  success?: boolean;
  step?: number;
  partial_content?: string;
  status?: string;  // For action_streaming status
}

export class ChatWebSocket {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private onMessageCallback?: (message: ChatMessage) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private messageQueue: Array<{type: string, content?: string}> = [];
  private isReconnecting = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  connect(onMessage: (message: ChatMessage) => void): void {
    this.onMessageCallback = onMessage;

    const wsUrl = `ws://127.0.0.1:8000/api/v1/chats/${this.sessionId}/stream`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      // Send any queued messages
      while (this.messageQueue.length > 0) {
        const queuedMessage = this.messageQueue.shift();
        if (queuedMessage && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(queuedMessage));
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message: ChatMessage = JSON.parse(event.data);
        if (this.onMessageCallback) {
          this.onMessageCallback(message);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      this.attemptReconnect();
    };
  }

  sendMessage(content: string): void {
    const message = {
      type: 'message',
      content,
    };

    // If WebSocket is open, send immediately
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }

    // If WebSocket is closed or closing, queue the message and reconnect
    this.messageQueue.push(message);
    this.ensureConnection();
  }

  sendCancel(): void {
    const message = {
      type: 'cancel',
    };

    // If WebSocket is open, send immediately
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }

    // If WebSocket is closed or closing, queue the message and reconnect
    this.messageQueue.push(message);
    this.ensureConnection();
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.onMessageCallback) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect(this.onMessageCallback!);
      }, 2000 * this.reconnectAttempts);
    }
  }

  /**
   * Ensures WebSocket connection is active. If not, initiates reconnection.
   * This is called when user tries to send a message while disconnected.
   */
  private ensureConnection(): void {
    // If already reconnecting, don't start another reconnection
    if (this.isReconnecting) {
      return;
    }

    // If connection is good, nothing to do
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Connection is not good, initiate reconnection
    if (this.onMessageCallback) {
      this.isReconnecting = true;

      // Close existing connection if it's in a bad state
      if (this.ws && (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED)) {
        this.ws = null;
      }

      // Reset reconnect attempts counter to allow fresh reconnection
      // This is important for user-initiated reconnects (sending a message)
      this.reconnectAttempts = 0;

      // Reconnect immediately (no delay for user-initiated reconnect)
      this.connect(this.onMessageCallback);
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
