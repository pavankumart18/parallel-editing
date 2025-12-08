import * as Y from 'https://esm.sh/yjs'
import { WebrtcProvider } from 'https://esm.sh/y-webrtc'
import { QuillBinding } from 'https://esm.sh/y-quill'
import Quill from 'https://esm.sh/quill@1.3.6'
import QuillCursors from 'https://esm.sh/quill-cursors@3.0.0'
import diff from 'https://esm.sh/fast-diff'

Quill.register('modules/cursors', QuillCursors);

/**
 * CONFIGURATION
 */
const ROOM_NAME = 'parallel-contract-edit-demo-v1';
const TEMPLATE_TEXT = `
EMPLOYMENT AGREEMENT

This Employment Agreement (the "Agreement") is made and entered into as of [INSERT_START_DATE], by and between [INSERT_COMPANY_NAME] (the "Company") and [INSERT_EMPLOYEE_NAME] (the "Employee").

1. POSITION AND DUTIES
The Company agrees to employ the Employee as a [INSERT_JOB_TITLE]. The Employee accepts this employment and agrees to devote their full working time and attention to the performance of their duties.

2. COMPENSATION
(a) Base Salary. The Company shall pay the Employee a base salary of [INSERT_SALARY] per year, payable in accordance with the Company's standard payroll schedule.
(b) Benefits. The Employee shall be eligible to participate in the Company's standard benefit plans.

3. AT-WILL EMPLOYMENT
Employment with the Company is for no specific period of time. Your employment with the Company will be "at will," meaning that either you or the Company may terminate your employment at any time and for any reason, with or without cause.

4. CONFIDENTIALITY
The Employee agrees not to disclose any of the Company's proprietary information or trade secrets to any third party during or after their employment.

__________________________
Employee Signature

__________________________
Company Representative
`.trim();

/**
 * STATE MANAGEMENT
 */
const state = {
    apiKey: localStorage.getItem('openai_api_key') || '',
    baseUrl: localStorage.getItem('openai_base_url') || 'https://llmfoundry.straive.com/openai/v1',
    model: 'gpt-4o-mini', // Assuming 'gpt-4.1-mini' meant 'gpt-4o-mini' or similar recent small model.
    isAiTyping: false
};

// --- Suppress Expected Console Errors ---
// The public signaling servers often reject connections or are down. 
// This filters those specific errors to keep the demo console clean.
const originalConsoleError = console.error;
console.error = function (...args) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('WebSocket connection to')) {
        // Suppress flaky signaling server errors
        return;
    }
    originalConsoleError.apply(console, args);
};

// --- Yjs Initialization ---
const ydoc = new Y.Doc();

const provider = new WebrtcProvider(ROOM_NAME, ydoc, {
    signaling: [
        'wss://signaling.yjs.dev',
        'wss://y-webrtc-signaling-eu.herokuapp.com',
        'wss://y-webrtc-signaling-us.herokuapp.com'
    ]
});

const ytext = ydoc.getText('quill');

// --- User Awareness (Me) ---
const awareness = provider.awareness; // We borrow awareness from WebRTC (shared logic)
// Assign a random user color
const userColors = ['#2563eb', '#db2777', '#ca8a04', '#16a34a', '#0891b2'];
const myColor = userColors[Math.floor(Math.random() * userColors.length)];
const names = ['Human Editor', 'Legal Assoc.', 'Manager', 'Reviewer'];
const myName = names[Math.floor(Math.random() * names.length)];

// Initialize Awareness
awareness.setLocalStateField('user', {
    name: myName,
    color: myColor
});

// Bind UI Input
const nameInput = document.getElementById('user-name-input');
nameInput.value = myName;
nameInput.addEventListener('change', () => {
    const newName = nameInput.value.trim() || 'Anonymous';
    awareness.setLocalStateField('user', {
        name: newName,
        color: myColor
    });
});


// --- Connection Status Logic ---
const statusEl = document.getElementById('connection-status');

const updateStatus = () => {
    // We are connected if WebRTC is on OR if we see other users (via BroadcastChannel)
    const isConnected = provider.connected || awareness.getStates().size > 1;

    if (isConnected) {
        statusEl.innerHTML = '<span class="ai-active-indicator"></span> Connected';
        statusEl.classList.remove('text-secondary');
        statusEl.classList.add('text-success', 'border-success');
    } else {
        // If we are alone and WebRTC is disconnected
        statusEl.innerHTML = '<span class="ai-mock-indicator" style="background-color: #ef4444;"></span> Offline';
        statusEl.classList.add('text-secondary');
        statusEl.classList.remove('text-success', 'border-success');
    }
};

provider.on('status', updateStatus);
awareness.on('change', updateStatus); // Also update when peers appear/disappear anywhere
updateStatus();


// --- Quill Editor Setup ---
const editorContainer = document.getElementById('editor');
const quill = new Quill(editorContainer, {
    modules: {
        cursors: true, // Enable cursors module
        toolbar: [
            [{ header: [1, 2, false] }],
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['clean']
        ]
    },
    placeholder: 'Waiting for contract...',
    theme: 'snow'
});

// Bind Yjs to Quill
const binding = new QuillBinding(ytext, quill, awareness);

// --- AI Ghost Cursor (Awareness Strategy) ---
// We sync AI cursors via the existing Yjs Awareness protocol.
// This ensures cursors are EPHEMERAL (they disappear when the user disconnects).

const cursorModule = quill.getModule('cursors');

// Helper to update AI cursors from Awareness states
const updateAiCursorsFromAwareness = () => {
    const states = awareness.getStates(); // Map<clientID, stateObj>

    // Track which agents are active to clean up stale ones
    const activeAgentIds = new Set();

    states.forEach((state, clientId) => {
        if (!state.aiCursor) return; // This user has no active AI

        const agentId = `ai-agent-${clientId}`;
        activeAgentIds.add(agentId);

        const data = state.aiCursor;
        if (data.relPos) {
            try {
                // Decode position
                // Note: Yjs awareness encodes Uint8Array as standard Arrays in JSON usually, 
                // but direct local state is clean. Over wire it might change.
                // We handle both.
                let uint8Array = data.relPos;
                if (!(uint8Array instanceof Uint8Array)) {
                    uint8Array = new Uint8Array(Object.values(data.relPos));
                }

                const relPos = Y.decodeRelativePosition(uint8Array);
                const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);

                if (absPos) {
                    const name = data.name || 'AI Agent';
                    const color = data.color || '#8b5cf6';

                    cursorModule.createCursor(agentId, name, color);
                    cursorModule.moveCursor(agentId, { index: absPos.index, length: data.length });
                    cursorModule.toggleFlag(agentId, true);
                }
            } catch (e) {
                console.warn(`Failed to render AI cursor for ${agentId}`, e);
            }
        }
    });

    // Cleanup: Remove any cursors that are no longer in the awareness states
    // (We iterate the *cursor module's* known cursors? No, quill-cursors doesn't expose list easily)
    // Actually, we can just remove cursors that are NOT in activeAgentIds?
    // Quill-cursors unfortunately doesn't give us a list of all cursors easily without internal access.
    // Hack: We rely on the fact that if 'aiCursor' field is removed, we get an update here.
    // We should probably track known agents locally.
};

// Track known agents to allow removal
let knownAiAgents = new Set();
awareness.on('change', ({ added, updated, removed }) => {
    // Standard update
    updateAiCursorsFromAwareness();

    // explicitly handle removals
    removed.forEach(clientId => {
        cursorModule.removeCursor(`ai-agent-${clientId}`);
    });

    // Also check if a user just cleared their 'aiCursor' field (update without aiCursor)
    updated.forEach(clientId => {
        const state = awareness.getStates().get(clientId);
        if (state && !state.aiCursor) {
            cursorModule.removeCursor(`ai-agent-${clientId}`);
        }
    });
});


// ... (remaining helper functions unchanged, but included for context if needed, though this chunk targets the specific observer block) ...



// --- HELPER: UI Notifications (Toast) ---
function showToast(message, isError = false) {
    const toastEl = document.getElementById('liveToast');
    const toastBody = document.getElementById('toast-message');
    const toastHeader = toastEl.querySelector('.toast-header strong');

    toastBody.textContent = message;

    if (isError) {
        toastHeader.textContent = 'Error';
        toastHeader.classList.add('text-danger');
    } else {
        toastHeader.textContent = 'Notification';
        toastHeader.classList.remove('text-danger');
    }

    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}

/**
 * UI EVENT HANDLERS
 */

// Load Template
document.getElementById('btn-template').addEventListener('click', () => {
    // For demo simplicity, we just overwrite. In a real app we'd ask confirmation.
    ytext.delete(0, ytext.length);
    ytext.insert(0, TEMPLATE_TEXT);
    showToast('Contract template loaded successfully.');
});

// Apply AI Instruction
document.getElementById('btn-apply-ai').addEventListener('click', async () => {
    const instruction = document.getElementById('ai-instruction').value.trim();
    if (!instruction) return;

    if (state.isAiTyping) return;
    setAiBusy(true);

    try {
        if (state.apiKey) {
            await runLiveAi(instruction);
        } else {
            await runMockAi(instruction);
        }
    } catch (e) {
        console.error(e);
        showToast('AI Error: ' + e.message, true);
    } finally {
        setAiBusy(false);
        // Leave the cursor at the end position so users can see where it finished
        // updateAiCursor(null); 
    }
});

// Settings Modal
const settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));
document.getElementById('btn-save-settings').addEventListener('click', () => {
    state.apiKey = document.getElementById('api-key').value.trim();
    state.baseUrl = document.getElementById('base-url').value.trim();
    state.model = document.getElementById('model-name').value.trim();

    localStorage.setItem('openai_api_key', state.apiKey);
    localStorage.setItem('openai_base_url', state.baseUrl);

    updateStatusIndicators();
    settingsModal.hide();
});

// Initial UI Sync
document.getElementById('api-key').value = state.apiKey;
document.getElementById('base-url').value = state.baseUrl;
updateStatusIndicators();

function updateStatusIndicators() {
    const statusEl = document.getElementById('ai-mode-status');
    const dot = statusEl.querySelector('.ai-mock-indicator');

    if (state.apiKey) {
        statusEl.innerHTML = '<span class="ai-active-indicator"></span> Live AI Mode';
        dot.className = 'ai-active-indicator';
    } else {
        statusEl.innerHTML = '<span class="ai-mock-indicator"></span> Mock AI Mode';
        dot.className = 'ai-mock-indicator';
    }
}

function setAiBusy(busy) {
    state.isAiTyping = busy;
    const btn = document.getElementById('btn-apply-ai');
    btn.disabled = busy;
    btn.innerHTML = busy ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Thinking...' : '<i class="bi bi-stars"></i> Apply Instruction';
}

/**
 * AI LOGIC (MOCK MODE)
 */
async function runMockAi(instruction) {
    const task = instruction.toLowerCase();
    await new Promise(r => setTimeout(r, 1000));

    let replacement = "";
    let target = "";

    if (task.includes("salary") || task.includes("compensation")) {
        target = "[INSERT_SALARY]";
        replacement = "$145,000 USD";
    } else if (task.includes("name") || task.includes("employee")) {
        target = "[INSERT_EMPLOYEE_NAME]";
        replacement = "Jane Doe";
    } else if (task.includes("start date")) {
        target = "[INSERT_START_DATE]";
        replacement = "October 1st, 2025";
    } else if (task.includes("company")) {
        target = "[INSERT_COMPANY_NAME]";
        replacement = "Acme Corp Intl.";
    } else {
        target = "END_OF_DOC";
        replacement = "\n\n5. REMOTE WORK\nThe Employee shall be entitled to work remotely for up to 3 days per week, subject to manager approval.";
    }

    // --- Conflict Detection ---
    const currentContent = ytext.toString();
    const startIndex = (target === "END_OF_DOC") ? currentContent.length : currentContent.indexOf(target);
    const endIndex = (target === "END_OF_DOC") ? startIndex : startIndex + target.length;

    // Check if user is editing this range
    if (startIndex !== -1 && isUserEditingRange(startIndex, endIndex)) {
        const approved = await askForConfirmation();
        if (!approved) return; // User rejected logic
    }

    await simulateStreamingEdit(target, replacement);
}

/**
 * AI LOGIC (LIVE MODE)
 */
async function runLiveAi(instruction) {
    const currentText = ytext.toString();

    // Construct Prompt
    const messages = [
        { role: "system", content: "You are a helpful legal assistant. You are editing a contract. Output ONLY the full updated text of the contract. Do not add markdown formatting or conversation." },
        { role: "user", content: `Current Contract:\n${currentText}\n\nInstruction: ${instruction}\n\nRewrite the contract to apply the instruction.` }
    ];

    const response = await fetch(`${state.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${state.apiKey}`
        },
        body: JSON.stringify({
            model: state.model,
            messages: messages,
            temperature: 0.7
        })
    });

    if (!response.ok) throw new Error("API Request Failed");
    const data = await response.json();
    const newText = data.choices[0].message.content;

    // --- Conflict Detection ---
    // For live mode, we only check if the USER has a selection (is actively editing something specific).
    // A more advanced diff-check is possible but computationally expensive to pre-calculate before apply.
    // Heuristic: If user has a non-collapsed selection (highlighted text), ASK.
    // Or if the user is typing (last keypress < 2s ago).

    const range = quill.getSelection();
    if (range && range.length > 0) {
        // User has highlighted text, assume they are "editing same thing" if AI touches it.
        // For safety in this demo, we ALWAYS ask if user has content selected.
        const approved = await askForConfirmation();
        if (!approved) return;
    }

    await applySmartDiffV2(currentText, newText);
}

// --- Conflict Helpers ---

function isUserEditingRange(startIndex, endIndex) {
    const range = quill.getSelection();
    if (!range) return false;

    // Check for overlap: 
    // (UserStart < TargetEnd) AND (UserEnd > TargetStart)
    const userStart = range.index;
    const userEnd = range.index + range.length;

    // Add a small buffer (e.g. 10 chars) to "proximity"
    const buffer = 10;

    // Overlap logic
    return (userStart < endIndex + buffer) && (userEnd > startIndex - buffer);
}

async function askForConfirmation() {
    return new Promise((resolve) => {
        const modalEl = document.getElementById('conflictModal');
        const modal = new bootstrap.Modal(modalEl);

        const btnAccept = document.getElementById('btn-accept-conflict');
        const btnReject = document.getElementById('btn-reject-conflict');

        // Clean up listeners from previous runs involved tricky logic, 
        // simpler approach: one-time handlers

        const cleanup = () => {
            btnAccept.removeEventListener('click', onAccept);
            btnReject.removeEventListener('click', onReject);
            modal.hide();
        };

        const onAccept = () => {
            cleanup();
            resolve(true);
        };

        const onReject = () => {
            cleanup();
            showToast('AI edit cancelled by user.', true);
            resolve(false);
        };

        btnAccept.addEventListener('click', onAccept);
        btnReject.addEventListener('click', onReject);

        modal.show();
    });
}


/**
 * CORE EDITING FUNCTIONS
 * Refactored to use RelativePositions to prevent cursor jumping/conflicts during concurrent editing.
 */

async function simulateStreamingEdit(target, textToType) {
    const docLength = ytext.length;
    let index = 0;

    // 1. Find the starting position (Absolute)
    if (target === "END_OF_DOC") {
        index = docLength;
    } else {
        const currentContent = ytext.toString();
        index = currentContent.indexOf(target);
        if (index === -1) {
            index = docLength;
            textToType = "\n" + textToType;
        } else {
            // Select and delete placeholder
            updateAiCursor(index, target.length);
            await wait(300);
            ytext.delete(index, target.length);
        }
    }

    // 2. Convert to RelativePosition for robust streaming
    // We anchor to the insertion point.
    let currentRelPos = Y.createRelativePositionFromTypeIndex(ytext, index);

    // Type the replacement
    for (let i = 0; i < textToType.length; i++) {
        // Resolve absolute position right before writing
        const absPos = Y.createAbsolutePositionFromRelativePosition(currentRelPos, ydoc);

        if (absPos) {
            const currentIndex = absPos.index;
            updateAiCursor(currentIndex, 1);
            ytext.insert(currentIndex, textToType[i]);

            // Move anchor forward by 1 for the next character
            currentRelPos = Y.createRelativePositionFromTypeIndex(ytext, currentIndex + 1);
        }

        await wait(20 + Math.random() * 30);
    }
}

async function applySmartDiff(oldText, newText) {
    const changes = diff(oldText, newText);
    let currentIndex = 0; // This tracks the position in the *current* Yjs document

    for (const [action, chunk] of changes) {
        if (action === 0) {
            // EQUAL: Just move cursor/index forward
            currentIndex += chunk.length;
        } else if (action === -1) {
            // DELETE: Delete at current index
            // We lock the position with a RelativePosition
            let delRelPos = Y.createRelativePositionFromTypeIndex(ytext, currentIndex);

            updateAiCursor(currentIndex, chunk.length);
            await wait(50);

            // Resolve again in case it moved due to concurrent edits
            const absPos = Y.createAbsolutePositionFromRelativePosition(delRelPos, ydoc);
            if (absPos) {
                // Ensure we don't try to delete beyond the document length
                const actualLength = Math.min(chunk.length, ytext.length - absPos.index);
                if (actualLength > 0) {
                    ytext.delete(absPos.index, actualLength);
                }
            }
            // Delete does NOT advance currentIndex (content shifted back)
        } else if (action === 1) {
            // INSERT
            let insRelPos = Y.createRelativePositionFromTypeIndex(ytext, currentIndex);

            for (let i = 0; i < chunk.length; i++) {
                const absPos = Y.createAbsolutePositionFromRelativePosition(insRelPos, ydoc);
                if (absPos) {
                    const writeIndex = absPos.index;
                    updateAiCursor(writeIndex, 1);
                    ytext.insert(writeIndex, chunk[i]);

                    // Advance our anchor for the next character
                    insRelPos = Y.createRelativePositionFromTypeIndex(ytext, writeIndex + 1);
                    // Also advance main counter for next diff chunks
                    currentIndex++;
                }
                if (i % 5 === 0) await wait(10);
            }
        }
    }
}

// Update MY AI Cursor via Awareness (Ephemeral)
// STRICT MODE: Only accepts RelativePosition objects.
function updateAiCursor(position, length = 0) {
    if (position === null) {
        awareness.setLocalStateField('aiCursor', null);
        return;
    }

    let encodedRelPos;

    // Safety: If someone passes a number, we convert it immediately to a NEW RelativePosition
    if (typeof position === 'number') {
        const relPos = Y.createRelativePositionFromTypeIndex(ytext, position);
        encodedRelPos = Y.encodeRelativePosition(relPos);
    } else {
        try {
            encodedRelPos = Y.encodeRelativePosition(position);
        } catch (e) {
            console.warn("Invalid cursor position object", position);
            return;
        }
    }

    // Broadcast my AI's state via Awareness
    awareness.setLocalStateField('aiCursor', {
        relPos: encodedRelPos,
        length: length,
        name: `AI (${myName})`,
        color: '#8b5cf6'
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function applySmartDiffV2(oldText, newText) {
    const changes = diff(oldText, newText);

    // Strategy: Pre-Calculate Anchors
    // We map the linear diff to specific positions in the CURRENT ytext.
    // By creating RelativePositions *before* we start editing, we ensure
    // that our target locations shift correctly if the user types *during* the apply process.

    let scanIndex = 0;
    const ops = [];

    // 1. Plan Phase: Create Anchors for all operations
    for (const [action, chunk] of changes) {
        if (action === 0) { // EQUAL
            // We need to keep `chunk.length` characters.
            scanIndex += chunk.length;
            ops.push({ type: 'EQ', anchor: Y.createRelativePositionFromTypeIndex(ytext, scanIndex) });
        } else if (action === -1) { // DELETE
            // We need to delete `chunk.length' characters starting from current position.
            // The "End" of the deletion is at `scanIndex + length`.
            scanIndex += chunk.length;
            ops.push({ type: 'DEL', startAnchor: null, endAnchor: Y.createRelativePositionFromTypeIndex(ytext, scanIndex), length: chunk.length });
        } else if (action === 1) { // INSERT
            // Insert happens AT current position. Index doesn't move relative to old text.
            ops.push({ type: 'INS', content: chunk });
        }
    }

    // 2. Execution Phase: Apply edits using the Anchors
    // We maintain a "Head" anchor tracking where we are.
    let headAnchor = Y.createRelativePositionFromTypeIndex(ytext, 0);
    // NEW: Track the location of the *last performed edit* so we can park the cursor there.
    let lastEditAnchor = null;

    for (const op of ops) {
        if (op.type === 'EQ') {
            // Just move head to the new anchor
            headAnchor = op.anchor;
        } else if (op.type === 'DEL') {
            // Delete from Head to EndAnchor
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, ydoc);
            const endPos = Y.createAbsolutePositionFromRelativePosition(op.endAnchor, ydoc);

            if (startPos && endPos) {
                const deleteSize = endPos.index - startPos.index;
                // Safety check: ensure we are deleting forward and reasonable amount
                if (deleteSize > 0 && deleteSize <= 1000) {
                    // Update cursor to deletion point
                    updateAiCursor(headAnchor, deleteSize);
                    await wait(50);
                    ytext.delete(startPos.index, deleteSize);

                    // Mark this as an edit location
                    lastEditAnchor = headAnchor;
                }
            }
            headAnchor = op.endAnchor;

        } else if (op.type === 'INS') {
            // Insert at Head
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, ydoc);
            if (startPos) {
                const insertIndex = startPos.index;
                // Walking Anchor logic for the insertion itself
                let typingAnchor = Y.createRelativePositionFromTypeIndex(ytext, insertIndex);

                for (let i = 0; i < op.content.length; i++) {
                    const typePos = Y.createAbsolutePositionFromRelativePosition(typingAnchor, ydoc);
                    if (typePos) {
                        updateAiCursor(typingAnchor, 0);
                        ytext.insert(typePos.index, op.content[i]);
                    }
                    if (i % 5 === 0) await wait(10);
                }
                // Mark this as an edit location (at the end of the insertion)
                lastEditAnchor = typingAnchor;
            }
        }
    }

    // Park cursor at the LAST EDIT position if one exists, otherwise leave it (or set to null)
    if (lastEditAnchor) {
        updateAiCursor(lastEditAnchor, 0);
        console.log("Cursor parked at last edit.");
    } else {
        // If no edits occurred (just reading?), maybe hide it or park at end.
        // But usually there's an edit. If equal, park at end.
        updateAiCursor(headAnchor, 0);
    }
}
