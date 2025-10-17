/**
 * Web Chat Widget - Standalone Bundle
 * 
 * This is a standalone JavaScript widget that can be embedded in any website
 * Version: 1.0.0
 */

(function () {
    'use strict';

    // Prevent multiple initializations
    if (window.BotChat && window.BotChat.initialized) {
        console.warn('BotChat widget already initialized');
        return;
    }

    // Global BotChat object
    window.BotChat = {
        initialized: false,
        config: null,
        widget: null,
        ws: null,
        sessionData: null,

        /**
         * Initialize the chat widget
         * @param {Object} config - Configuration object
         * @param {string} config.botId - Bot ID
         * @param {string} config.token - Widget token
         * @param {string} config.apiBase - API base URL (default: http://localhost:3000)
         * @param {Object} config.theme - Theme configuration
         */
        init: function (config) {
            if (this.initialized) {
                console.warn('BotChat widget already initialized');
                return;
            }

            // Validate config
            if (!config.botId || !config.token) {
                console.error('BotChat: botId and token are required');
                return;
            }

            this.config = {
                botId: config.botId,
                token: config.token,
                apiBase: config.apiBase || 'http://localhost:3000',
                theme: config.theme || {
                    primaryColor: '#5A3EF0',
                    botName: 'AI Assistant'
                }
            };

            this.initialized = true;

            // Initialize session
            this.initializeSession();
        },

        /**
         * Initialize chat session
         */
        initializeSession: async function () {
            try {
                const response = await fetch(`${this.config.apiBase}/api/webview/${this.config.botId}/session`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        token: this.config.token,
                        pageUrl: window.location.href,
                        metadata: {
                            userAgent: navigator.userAgent,
                            timestamp: new Date().toISOString()
                        }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Failed to initialize session: ${response.statusText}`);
                }

                this.sessionData = await response.json();
                console.log('BotChat session initialized:', this.sessionData.sessionId);

                // Create widget UI
                this.createWidget();

                // Connect to WebSocket
                this.connectWebSocket();

            } catch (error) {
                console.error('BotChat initialization error:', error);
                this.showError('Failed to connect to chat server');
            }
        },

        /**
         * Create widget UI elements
         */
        createWidget: function () {
            // Inject CSS
            this.injectStyles();

            // Create widget container
            const widgetContainer = document.createElement('div');
            widgetContainer.id = 'botchat-widget-container';
            widgetContainer.innerHTML = `
        <!-- Chat Button -->
        <button id="botchat-toggle-btn" class="botchat-toggle-btn" aria-label="Open chat">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>

        <!-- Chat Window -->
        <div id="botchat-window" class="botchat-window" style="display: none;">
          <!-- Header -->
          <div class="botchat-header">
            <div class="botchat-header-title">
              <div class="botchat-avatar">🤖</div>
              <div>
                <div class="botchat-bot-name">${this.config.theme.botName || 'AI Assistant'}</div>
                <div class="botchat-status">Online</div>
              </div>
            </div>
            <button id="botchat-close-btn" class="botchat-close-btn" aria-label="Close chat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <!-- Messages -->
          <div id="botchat-messages" class="botchat-messages">
            <div class="botchat-message botchat-bot-message">
              <div class="botchat-message-content">
                ${this.sessionData.greeting || 'Hello! How can I help you today? 👋'}
              </div>
            </div>
          </div>

          <!-- Input -->
          <div class="botchat-input-container">
            <input 
              type="text" 
              id="botchat-input" 
              class="botchat-input" 
              placeholder="Type your message..."
              autocomplete="off"
            />
            <button id="botchat-send-btn" class="botchat-send-btn" aria-label="Send message">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      `;

            document.body.appendChild(widgetContainer);

            // Attach event listeners
            this.attachEventListeners();
        },

        /**
         * Inject widget styles
         */
        injectStyles: function () {
            const primaryColor = this.config.theme.primaryColor || '#5A3EF0';

            const style = document.createElement('style');
            style.textContent = `
        #botchat-widget-container * {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }

        .botchat-toggle-btn {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: ${primaryColor};
          color: white;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s, box-shadow 0.2s;
          z-index: 999998;
        }

        .botchat-toggle-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
        }

        .botchat-window {
          position: fixed;
          bottom: 100px;
          right: 24px;
          width: 380px;
          height: 600px;
          max-height: calc(100vh - 120px);
          background: white;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
          display: flex;
          flex-direction: column;
          z-index: 999999;
          overflow: hidden;
        }

        .botchat-header {
          background: ${primaryColor};
          color: white;
          padding: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .botchat-header-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .botchat-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }

        .botchat-bot-name {
          font-weight: 600;
          font-size: 16px;
        }

        .botchat-status {
          font-size: 12px;
          opacity: 0.9;
        }

        .botchat-close-btn {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: background 0.2s;
        }

        .botchat-close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .botchat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          background: #f8f9fa;
        }

        .botchat-message {
          margin-bottom: 12px;
          display: flex;
          animation: slideIn 0.2s ease-out;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .botchat-bot-message {
          justify-content: flex-start;
        }

        .botchat-user-message {
          justify-content: flex-end;
        }

        .botchat-message-content {
          max-width: 80%;
          padding: 10px 14px;
          border-radius: 12px;
          word-wrap: break-word;
        }

        .botchat-bot-message .botchat-message-content {
          background: white;
          color: #333;
          border-bottom-left-radius: 4px;
        }

        .botchat-user-message .botchat-message-content {
          background: ${primaryColor};
          color: white;
          border-bottom-right-radius: 4px;
        }

        .botchat-input-container {
          padding: 16px;
          background: white;
          border-top: 1px solid #e9ecef;
          display: flex;
          gap: 8px;
        }

        .botchat-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #dee2e6;
          border-radius: 20px;
          font-size: 14px;
          outline: none;
        }

        .botchat-input:focus {
          border-color: ${primaryColor};
        }

        .botchat-send-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: ${primaryColor};
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 0.2s;
        }

        .botchat-send-btn:hover {
          opacity: 0.9;
        }

        .botchat-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 480px) {
          .botchat-window {
            bottom: 0;
            right: 0;
            left: 0;
            width: 100%;
            height: 100%;
            max-height: 100%;
            border-radius: 0;
          }

          .botchat-toggle-btn {
            bottom: 16px;
            right: 16px;
          }
        }
      `;

            document.head.appendChild(style);
        },

        /**
         * Attach event listeners
         */
        attachEventListeners: function () {
            const toggleBtn = document.getElementById('botchat-toggle-btn');
            const closeBtn = document.getElementById('botchat-close-btn');
            const sendBtn = document.getElementById('botchat-send-btn');
            const input = document.getElementById('botchat-input');
            const chatWindow = document.getElementById('botchat-window');

            toggleBtn.addEventListener('click', () => {
                chatWindow.style.display = 'flex';
                toggleBtn.style.display = 'none';
                input.focus();
            });

            closeBtn.addEventListener('click', () => {
                chatWindow.style.display = 'none';
                toggleBtn.style.display = 'flex';
            });

            sendBtn.addEventListener('click', () => this.sendMessage());

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
        },

        /**
         * Connect to WebSocket
         */
        connectWebSocket: function () {
            const wsUrl = this.sessionData.wsUrl;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                // Authenticate
                this.ws.send(JSON.stringify({
                    type: 'auth',
                    jwt: this.sessionData.jwt
                }));
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                // Attempt reconnection after 3 seconds
                setTimeout(() => {
                    if (this.sessionData) {
                        this.connectWebSocket();
                    }
                }, 3000);
            };
        },

        /**
         * Handle WebSocket messages
         */
        handleWebSocketMessage: function (data) {
            switch (data.type) {
                case 'authenticated':
                    console.log('WebSocket authenticated');
                    break;

                case 'bot_message':
                    this.addBotMessage(data.text);
                    break;

                case 'error':
                    console.error('Server error:', data.message);
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        },

        /**
         * Send user message
         */
        sendMessage: function () {
            const input = document.getElementById('botchat-input');
            const text = input.value.trim();

            if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            // Add user message to UI
            this.addUserMessage(text);

            // Send to server
            this.ws.send(JSON.stringify({
                type: 'user_message',
                text: text
            }));

            // Clear input
            input.value = '';
        },

        /**
         * Add user message to UI
         */
        addUserMessage: function (text) {
            const messagesContainer = document.getElementById('botchat-messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'botchat-message botchat-user-message';
            messageDiv.innerHTML = `
        <div class="botchat-message-content">${this.escapeHtml(text)}</div>
      `;
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        },

        /**
         * Add bot message to UI
         */
        addBotMessage: function (text) {
            const messagesContainer = document.getElementById('botchat-messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'botchat-message botchat-bot-message';
            messageDiv.innerHTML = `
        <div class="botchat-message-content">${this.escapeHtml(text)}</div>
      `;
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        },

        /**
         * Show error message
         */
        showError: function (message) {
            this.addBotMessage(`⚠️ ${message}`);
        },

        /**
         * Escape HTML to prevent XSS
         */
        escapeHtml: function (text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    console.log('BotChat widget loaded. Call BotChat.init() to start.');
})();
