const vscode = require('vscode');
const { Ollama } = require("@langchain/community/llms/ollama");
const { ConversationChain } = require("langchain/chains");
const { BufferMemory } = require("langchain/memory");
const { PromptTemplate } = require("@langchain/core/prompts");

const CUSTOM_PROMPT = PromptTemplate.fromTemplate(`
    You are a coding assistant.
    {history}
    Human: {input}
    AI:`);

let conversationChain;
let isGenerating = false;

function activate(context) {
    console.log('"deepseek-r1-extension" is now active');

    const ollama = new Ollama({
        baseUrl: "http://localhost:11434",
        model: "deepseek-r1:1.5b",
        temperature: 1,
    });

    let memory = new BufferMemory(
        {
            returnMessages: true,
            memoryKey: 'history'
        }
    );
    conversationChain = new ConversationChain({
        llm: ollama,
        memory: memory,
        prompt: CUSTOM_PROMPT
    });

    const disposable = vscode.commands.registerCommand('deepseek-r1-extension.helloWorld', () => {
        const panel = vscode.window.createWebviewPanel(
            'deepseek',
            'DeepSeek',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === "chat" && !isGenerating) {
                isGenerating = true;
                const userPrompt = message.text;
                let responseText = '';

                try {
                    // Show loader in webview
                    panel.webview.postMessage({
                        command: 'showLoader',
                        show: true
                    });

                    // Stream the response
                    const stream = await conversationChain.llm.stream(
                        await conversationChain.prompt.format({
                            input: userPrompt,
                            history: await memory.loadMemoryVariables({})
                        })
                    );

                    for await (const chunk of stream) {
                        responseText += chunk;
                        panel.webview.postMessage({
                            command: 'chatResponse',
                            text: responseText,
                            isUser: false
                        });
                    }

                    await memory.saveContext(
                        { input: userPrompt },
                        { output: responseText }
                    );
                } catch (err) {
                    panel.webview.postMessage({
                        command: 'chatResponse',
                        text: 'Error: ' + err.message,
                        isUser: false
                    });
                } finally {
                    isGenerating = false;
                    // Hide loader when done
                    panel.webview.postMessage({
                        command: 'showLoader',
                        show: false
                    });
                }
            }
            else if (message.command === "clearMemory") {
                // Reset memory and chain
                memory = new BufferMemory();
                conversationChain = new ConversationChain({ llm: ollama, memory });
                panel.webview.postMessage({ command: 'clearChat' });
            }
        });

        panel.webview.html = getEnhancedWebviewContent();
    });

    context.subscriptions.push(disposable);
}

function getEnhancedWebviewContent() {
    return /* html */`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                /* Add loader styles */
                .loader {
                    border: 2px solid #f3f3f3;
                    border-top: 2px solid #705697;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto;
                    display: none;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                /* Modify existing styles */
                #askBtn:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }

                .ai-message .loader {
                    display: inline-block;
                    margin-right: 8px;
                }

                /* Keep previous styles */
                body { font-family: var(--vscode-font-family); margin: 1rem; height: 95vh; display: flex; flex-direction: column; }
                #chat-container { flex-grow: 1; overflow-y: auto; border: 1px solid var(--vscode-panel-border); margin-bottom: 1rem; padding: 1rem; }
                .message { margin-bottom: 1rem; padding: 0.8rem; border-radius: 6px; line-height: 1.4; }
                .user-message { background: var(--vscode-textBlockQuote-background); margin-left: 20%; border-left: 3px solid #4dc0ff; }
                .ai-message { background: var(--vscode-editor-inactiveSelectionBackground); margin-right: 20%; border-left: 3px solid #705697; }
                #input-container { display: flex; gap: 0.5rem; }
                #prompt { flex-grow: 1; padding: 0.8rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; resize: vertical; }
                button { padding: 0.5rem 1rem; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
            </style>
        </head>
        <body>
        <div style="display: flex; justify-content: space-between; align-items: center">
        <h2>DeepSeek Chat (with Memory)</h2>
        <button id="clearBtn" title="Clear conversation history">Clear Memory</button>
    </div>
    <div id="chat-container"></div>
    <div id="input-container">
        <textarea id="prompt" rows="3" placeholder="Ask anything..."></textarea>
        <button id="askBtn">Send</button>
    </div>
    <div id="loader" class="loader" style="display: none;"></div>
            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chat-container');
                const promptInput = document.getElementById('prompt');
                const askBtn = document.getElementById('askBtn');
                const loader = document.getElementById('loader');

                const clearBtn = document.getElementById('clearBtn');
                clearBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to clear the conversation memory?')) {
                        chatContainer.innerHTML = '';
                        vscode.postMessage({ command: 'clearMemory' });
                    }
                });

                // Update UI state function
                function updateUIState(isProcessing) {
                    askBtn.disabled = isProcessing;
                    clearBtn.disabled = isProcessing;
                    loader.style.display = isProcessing ? 'block' : 'none';
                    promptInput.disabled = isProcessing;
                }

                function appendMessage(text, isUser) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = \`message \${isUser ? 'user-message' : 'ai-message'}\`;
                    
                    if (!isUser) {
                        messageDiv.innerHTML = \`
                            <div class="loader"></div>
                            <span class="response-text">\${text}</span>
                        \`;
                    } else {
                        messageDiv.textContent = text;
                    }
                    
                    chatContainer.appendChild(messageDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }

                function updateUIState(isProcessing) {
                    askBtn.disabled = isProcessing;
                    loader.style.display = isProcessing ? 'block' : 'none';
                    promptInput.disabled = isProcessing;
                }

                askBtn.addEventListener('click', async () => {
                    const text = promptInput.value.trim();
                    if (text) {
                        promptInput.value = '';
                        updateUIState(true);
                        appendMessage(text, true);
                        appendMessage('', false); // Empty AI message with loader
                        vscode.postMessage({ command: 'chat', text });
                    }
                });

                promptInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        askBtn.click();
                    }
                });

                window.addEventListener('message', (event) => {
                    const { command, text, isUser, show } = event.data;
                    
                    if (command === 'chatResponse') {
                        const lastMessage = chatContainer.lastElementChild;
                        if (lastMessage && lastMessage.classList.contains('ai-message')) {
                            const textSpan = lastMessage.querySelector('.response-text');
                            if (textSpan) {
                                textSpan.textContent = text;
                                // Remove loader when response starts coming
                                const loader = lastMessage.querySelector('.loader');
                                if (loader && text.length > 0) {
                                    loader.style.display = 'none';
                                }
                            }
                        }
                    }
                    
                    if (command === 'showLoader') {
                        updateUIState(show);
                    }
                });
            </script>
        </body>
        </html>
    `;
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
};