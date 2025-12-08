# Parallel Editing Demo (AI + Human)

A serverless, client-side demonstration of **real-time collaborative editing** between a Human and an AI Agent.

This demo uses **Y.js** (CRDTs) to ensure that both the human and the AI can edit the same document simultaneously without conflicts or cursor jumping.

## Features

- **Real-Time Collaboration**: Changes sync instantly (via WebRTC) between tabs/windows.
- **AI Agent Cursor**: The AI has its own presence (Purple Cursor) and types character-by-character.
- **Mock Mode**: Pre-scripted behaviors for testing without an API key.
- **Live Mode**: Connects to OpenAI (or compatible LLM) to apply real changes via text diffing.
- **Conflict Resolution**: Powered by Y.js CRDT logic.

## How to Run

1. Open `index.html` in your browser.
2. **For Collaboration Testing**: Open the same file in a **second browser window** (or incognito tab).
   - You will see two cursors.
   - Using the Right Sidebar in one window will trigger the AI (Purple Cursor) which updates *both* windows in real-time.

## Usage Guide

### 1. Mock Mode (Default)
In this mode, the AI only understands specific instructions to demonstrate the editing capabilities safely.

1. Click "Load Contract Template".
2. Type one of these commands into the sidebar:
   - "Update salary" -> Replaces `[INSERT_SALARY]`
   - "Add employee name" -> Replaces `[INSERT_EMPLOYEE_NAME]`
   - "Add remote work clause" -> Appends a new section
3. Click "Apply Instruction".
4. Watch the Purple Cursor type out the changes. You can keep typing elsewhere in the document while it works!

### 2. Live AI Mode
1. Click **Settings** in the top bar.
2. Enter your OpenAI API Key.
3. (Optional) Change the Base URL if using a local LLM or proxy.
4. Now you can give *any* instruction (e.g., "Rewrite the confidentiality clause to be stricter").
5. The AI will generate the new text, diff it against the current text, and stream the changes live.

## Technical Details

- **Y.js**: Core CRDT implementation for state management.

- **y-webrtc**: Serverless p2p transport for syncing state between browser tabs.
- **y-broadcastchannel**: Added for robust **offline local sync** between tabs if public servers are unreachable.
- **y-quill**: Binds the Y.Text model to the Quill rich text editor.
- **fast-diff**: Computes the difference between the current text and the AI's generation to create atomic insert/delete operations.
- The "AI" is technically running inside the browser client (Client-side AI Logic), but it uses a *secondary* cursor to simulate a distinct "Remote User".

## Troubleshooting

- **"WebSocket connection failed" Errors**: These are expected if the public demo signaling servers (signaling.yjs.dev, etc.) are down or blocked by your network.
- **However, the demo will still work!** We included a `BroadcastChannel` fallback.
  - **CRITICAL:** For local sync to work, you must open the demo on the **SAME URL** (e.g., both on `http://localhost:8000`).
  - If you open one tab on `:8000` and another on `:8001`, they are treated as different websites and **will not sync**.
- **Check the UI Badge**: If it says **"Connected"** (Green), it means the system is ready. Try typing to verify sync.

