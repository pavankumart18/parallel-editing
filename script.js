import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { QuillBinding } from "y-quill";
import Quill from "quill";
import QuillCursors from "quill-cursors";
import diff from "fast-diff";
import { DOCUMENTS } from "./documents.js";
import { AgentManager } from "./agent-manager.js";

Quill.register("modules/cursors", QuillCursors);

const SETTINGS_KEY = "parallel_edit_settings";
const DEFAULT_SIGNALING = [
    "wss://signaling.yjs.dev",
    "wss://y-webrtc-signaling-eu.herokuapp.com",
    "wss://y-webrtc-signaling-us.herokuapp.com",
    "wss://signaling-server-2s0k.onrender.com",
    "wss://y-webrtc-signaling-us.herokuapp.com",
    "wss://y-webrtc.fly.dev"
];

const TEMPLATE_TEXT = DOCUMENTS[0].content; // Default to first doc

function deriveAiColor(hex, offset = 35) {
    if (typeof hex !== "string" || !/^#([0-9a-f]{6})$/i.test(hex)) return "#8b5cf6";
    const num = parseInt(hex.slice(1), 16);
    const clamp = (value) => Math.max(0, Math.min(255, value));
    const r = clamp(((num >> 16) & 0xff) + offset);
    const g = clamp(((num >> 8) & 0xff) + offset);
    const b = clamp((num & 0xff) + offset);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function getAliasFromClientId(id) {
    const absId = Math.abs(Number(id) || 0);
    const number = (absId % 9000) + 1;
    return { number, alias: `User ${number}` };
}

function normalizeSignalingList(value) {
    let list = [];
    if (Array.isArray(value)) {
        list = value;
    } else if (typeof value === "string") {
        list = value.split(/[\n,]+/);
    }
    list = list
        .map((entry) => entry.trim())
        .filter(Boolean);
    return list.length ? list : [...DEFAULT_SIGNALING];
}

// History handling removed

const nameInput = document.getElementById("user-name-input");
const statusEl = document.getElementById("connection-status");
const aiStatusEl = document.getElementById("ai-mode-status");
const roomNameEl = document.getElementById("room-name");
const collaboratorCountEl = document.getElementById("collaborator-count");
const shareBtn = document.getElementById("btn-share");
const templateBtn = document.getElementById("btn-template");
const uploadInput = document.getElementById("file-upload");
const applyBtn = document.getElementById("btn-apply-ai");
const instructionInput = document.getElementById("ai-instruction");
// History UI elements removed

// const datasetTableEl = document.getElementById("dataset-table"); // Removed? UI changed but elements might exist
// const datasetMetaEl = document.getElementById("dataset-meta");
const settingsForm = document.getElementById("settings-form");
const settingsModalEl = document.getElementById("settingsModal");
const settingsModal = new bootstrap.Modal(settingsModalEl);

const settings = loadSettings();
hydrateSettingsForm();

const state = {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    signaling: settings.signaling.slice(),

    isAiTyping: false, // Global manual lock
    activeAgents: new Set(), // IDs of running agents

    ydoc: null,
    ytext: null,
    webrtcProvider: null,
    awareness: null,
    quill: null,
    cursorModule: null,
    userName: null,
    userAlias: null,
    userNumber: null,
    userColor: null,
    aiColor: "#8b5cf6",
    selectedDocId: null
};

// Initialize Agent Manager
const agentManager = new AgentManager("agents-container", "agent-count");

// Wire up Agent Task Execution
agentManager.onTaskStart = async (agentId, prompt, section) => {
    // We execute the AI Logic here
    await runAgentAi(agentId, prompt, section);
};

const roomName = ensureRoomParam();
roomNameEl.textContent = roomName;

const collab = initCollaboration(roomName);
state.ydoc = collab.ydoc;
state.ytext = collab.ytext;
state.webrtcProvider = collab.webrtcProvider;
state.awareness = collab.awareness;

state.quill = initQuill(state.ytext, state.awareness);
state.cursorModule = state.quill.getModule("cursors");
setupAgentCursorSync(); // Sync agent cursors across clients check

renderDemoCards();
// history calls removed
attachEventListeners();
updateAiModeBadge();

// --- Demo Card Rendering ---
function renderDemoCards() {
    const listContainer = document.getElementById("demo-docs-list");
    const actionsContainer = document.getElementById("demo-actions-container");

    if (!listContainer || !actionsContainer) return;

    listContainer.innerHTML = "";

    DOCUMENTS.forEach(doc => {
        const card = document.createElement("div");
        card.className = `card shadow-sm mb-2 demo-card ${state.selectedDocId === doc.id ? 'border-primary bg-primary bg-opacity-10' : ''}`;
        card.style.cursor = "pointer";
        card.innerHTML = `
            <div class="card-body p-2 d-flex align-items-center gap-2">
                <div class="rounded-circle bg-white p-2 text-primary border">
                    <i class="bi ${doc.icon || 'bi-file-text'}"></i>
                </div>
                <div class="overflow-hidden">
                    <h6 class="mb-0 text-truncate fw-bold" style="font-size: 0.9rem;">${doc.title}</h6>
                    <small class="text-muted text-xs text-truncate d-block">${doc.description}</small>
                </div>
            </div>
        `;

        card.onclick = () => {
            state.selectedDocId = doc.id;
            replaceDocumentText(doc.content, "demo-load");
            renderDemoCards(); // Re-render to update selection style
            renderActions(doc, actionsContainer);
            showToast(`Loaded ${doc.title}`);
        };

        listContainer.appendChild(card);
    });

    // If no selection, render empty state or first doc's actions if desired
    if (!state.selectedDocId) {
        actionsContainer.innerHTML = `<div class="text-center text-muted small py-3">Select a document above to see agent actions.</div>`;
    }
}

function renderActions(doc, container) {
    container.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold mb-0 text-secondary text-xs text-uppercase">Available Agents</h6>
        </div>
    `;

    const grid = document.createElement("div");
    grid.className = "d-flex flex-column gap-2";

    doc.prompts.forEach(prompt => {
        const btn = document.createElement("button");
        const role = getAgentRoleForSection(prompt.section);
        btn.className = "btn btn-outline-dark text-start p-2 d-flex align-items-center gap-2 w-100 border-0 shadow-sm bg-white";
        btn.style.fontSize = "13px";
        btn.innerHTML = `
            <span class="badge rounded-circle p-2" style="background-color: ${role.color}20; color: ${role.color}">
                <i class="bi bi-robot"></i>
            </span>
            <div class="lh-sm">
                <div class="fw-bold">${prompt.label}</div>
                <small class="text-muted text-xs">${prompt.section}</small>
            </div>
            <i class="bi bi-play-circle ms-auto text-secondary"></i>
        `;

        btn.onclick = () => {
            // Spawn Agent
            agentManager.spawnAgent(`${role.name} (${state.userName})`, role.role, role.color, prompt, prompt.section);
        };
        grid.appendChild(btn);
    });

    container.appendChild(grid);
}

function getAgentRoleForSection(section) {
    if (section.includes("Legal") || section.includes("Indemnification") || section.includes("Liab")) return { name: "Legal Bot", role: "Legal Counsel", color: "#ef4444" };
    if (section.includes("Budget") || section.includes("Financ")) return { name: "Finance Bot", role: "Controller", color: "#10b981" };
    if (section.includes("Security") || section.includes("Tech")) return { name: "SecOps Bot", role: "Security", color: "#f59e0b" };
    return { name: "Editor Bot", role: "Copy Editor", color: "#3b82f6" };
}

function loadSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
        return {
            apiKey: stored?.apiKey || "",
            baseUrl: stored?.baseUrl || "https://api.openai.com/v1",
            model: stored?.model || "gpt-4o-mini",
            signaling: normalizeSignalingList(stored?.signaling)
        };
    } catch {
        return {
            apiKey: "",
            baseUrl: "https://llmfoundry.straive.com/openai/v1",
            model: "gpt-4o-mini",
            signaling: [...DEFAULT_SIGNALING]
        };
    }
}

function persistSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model,
        signaling: state.signaling
    }));
}

function hydrateSettingsForm() {
    document.getElementById("api-key").value = settings.apiKey;
    document.getElementById("base-url").value = settings.baseUrl;
    document.getElementById("model-name").value = settings.model;
    const signalingField = document.getElementById("signaling-servers");
    if (signalingField) {
        signalingField.value = (settings.signaling || DEFAULT_SIGNALING).join("\n");
    }
}

function ensureRoomParam() {
    const url = new URL(window.location.href);
    let room = url.searchParams.get("room");
    if (!room) {
        room = `parallel-${Math.random().toString(36).slice(2, 8)}`;
        url.searchParams.set("room", room);
        window.history.replaceState({}, "", url);
    }
    return room;
}

function initCollaboration(room) {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("quill");
    const signaling = state.signaling?.length ? state.signaling : DEFAULT_SIGNALING;
    const webrtcProvider = new WebrtcProvider(room, ydoc, { signaling });
    const awareness = webrtcProvider.awareness;
    const meta = ydoc.getMap("meta");

    const userNames = ["Human Editor", "Reviewer", "Counsel", "Manager"];
    const userColors = ["#2563eb", "#db2777", "#ca8a04", "#16a34a", "#0891b2"];
    const myName = userNames[Math.floor(Math.random() * userNames.length)];
    const myColor = userColors[Math.floor(Math.random() * userColors.length)];
    const aliasInfo = getAliasFromClientId(ydoc.clientID);

    state.userAlias = aliasInfo.alias;
    state.userNumber = aliasInfo.number;
    state.userColor = myColor;
    state.aiColor = deriveAiColor(myColor);

    nameInput.value = myName;
    awareness.setLocalStateField("user", {
        name: myName,
        color: myColor,
        alias: aliasInfo.alias,
        number: aliasInfo.number
    });
    state.userName = myName;
    nameInput.addEventListener("input", () => {
        const nextName = nameInput.value.trim() || "Anonymous";
        awareness.setLocalStateField("user", {
            name: nextName,
            color: myColor,
            alias: aliasInfo.alias,
            number: aliasInfo.number
        });
        state.userName = nextName;
        // refreshLocalAiCursorLabel(); // Deprecated
    });

    let rtcConnected = false;
    let wsConnected = false;

    const transportLabel = () => {
        if (rtcConnected) return "WebRTC";
        if (wsConnected) return "WebSocket";
        return "Offline";
    };

    const updateStatus = () => {
        const peers = Math.max(awareness.getStates().size, 1);
        const connected = rtcConnected;
        statusEl.innerHTML = `<span class="ai-${connected ? "active" : "mock"}-indicator"></span>${connected ? `Connected via WebRTC` : "Waiting for peers"}`;
        statusEl.classList.toggle("text-success", connected);
        statusEl.classList.toggle("border-success", connected);
        statusEl.classList.toggle("text-warning", !connected);
        if (collaboratorCountEl) {
            collaboratorCountEl.textContent = String(peers);
        }
    };

    webrtcProvider.on("status", (event) => {
        rtcConnected = Boolean(event.connected);
        if (!rtcConnected && event.status === "disconnected") {
            console.warn("WebRTC disconnected from signaling servers", event);
        }
        updateStatus();
    });

    awareness.on("change", updateStatus);
    updateStatus();

    const maybeSeed = () => {
        if (!meta.get("seeded") && !ytext.length) {
            ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, TEMPLATE_TEXT);
                meta.set("seeded", true);
            }, "seed-template");
        }
    };

    webrtcProvider.once("synced", (synced) => synced && maybeSeed());

    return { ydoc, ytext, webrtcProvider, awareness, meta };
}

function initQuill(ytext, awareness) {
    const editorContainer = document.getElementById("editor");
    const quill = new Quill(editorContainer, {
        modules: {
            cursors: true,
            toolbar: [
                [{ header: [1, 2, false] }],
                ["bold", "italic", "underline"],
                [{ list: "ordered" }, { list: "bullet" }],
                ["clean"]
            ]
        },
        placeholder: "Waiting for contract...",
        theme: "snow"
    });
    new QuillBinding(ytext, quill, awareness);
    return quill;
}

function attachEventListeners() {
    shareBtn.addEventListener("click", copyRoomLink);
    templateBtn.addEventListener("click", () => {
        loadTemplate();
        showToast("Template loaded");
    });
    uploadInput.addEventListener("change", handleUpload);
    applyBtn.addEventListener("click", () => {
        const text = instructionInput.value.trim();
        if (!text) {
            showToast("Enter an instruction first", true);
            return;
        }
        applyInstruction(text);
    });
    document.getElementById("btn-save-settings").addEventListener("click", () => {
        state.apiKey = document.getElementById("api-key").value.trim();
        state.baseUrl = document.getElementById("base-url").value.trim() || "https://llmfoundry.straive.com/openai/v1";
        state.model = document.getElementById("model-name").value.trim() || "gpt-4o-mini";
        const rawSignaling = document.getElementById("signaling-servers")?.value || "";
        const nextSignaling = normalizeSignalingList(rawSignaling);
        const prevSignature = (state.signaling || []).join("|");
        const nextSignature = nextSignaling.join("|");

        state.signaling = nextSignaling;

        settings.apiKey = state.apiKey;
        settings.baseUrl = state.baseUrl;
        settings.model = state.model;
        settings.signaling = nextSignaling.slice();

        persistSettings();
        updateAiModeBadge();
        settingsModal.hide();
        const message = prevSignature !== nextSignature
            ? "Settings saved. Reload the tab to reconnect using the new signaling servers."
            : "Settings saved";
        showToast(message);
    });
}

function copyRoomLink() {
    const url = window.location.href;
    if (navigator.share) {
        navigator.share({ title: "ParallelEdit room", url }).catch(() => { });
        return;
    }
    navigator.clipboard.writeText(url)
        .then(() => showToast("Room link copied"))
        .catch(() => showToast("Unable to copy link automatically.", true));
}

function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text()
        .then((text) => {
            replaceDocumentText(text, "upload");
            showToast(`Loaded ${file.name}`);
        })
        .catch((error) => showToast(`Failed to read file: ${error.message}`, true))
        .finally(() => {
            event.target.value = "";
        });
}

// Dataset and History render functions removed

function replaceDocumentText(nextText, origin = "manual") {
    if (!state.ydoc || !state.ytext) return;
    state.ydoc.transact(() => {
        state.ytext.delete(0, state.ytext.length);
        state.ytext.insert(0, nextText);
    }, origin);
}

function loadTemplate() {
    replaceDocumentText(TEMPLATE_TEXT, "template-load");
}

function updateAiModeBadge() {
    if (state.apiKey) {
        aiStatusEl.innerHTML = '<span class="ai-active-indicator"></span> Live AI Mode';
    } else {
        aiStatusEl.innerHTML = '<span class="ai-mock-indicator"></span> Mock AI Mode';
    }
}


async function applyInstruction(instruction) {
    // Manual Global Override
    if (state.isAiTyping) return;
    state.isAiTyping = true;
    updateAgentCursor("global-ai", null); // Clear

    applyBtn.disabled = true;
    applyBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Streaming...';

    const agentId = `manual-ai-${state.userNumber || "guest"}`;
    const agentName = `${state.userName || "User"} (AI)`;
    const agentColor = state.aiColor;

    try {
        await orchestrateAndSpawn(instruction);
    } catch (error) {
        console.error(error);
        showToast(`AI error: ${error.message}`, true);
    } finally {
        state.isAiTyping = false;
        applyBtn.disabled = false;
        applyBtn.innerHTML = '<i class="bi bi-stars"></i> Apply Instruction';
        // updateAgentCursor(agentId, null); // Keep cursor visible
    }
}

async function runAgentAi(agentId, promptObj, section) {
    const agent = agentManager.agents.get(agentId);
    if (!agent) return;

    agentManager.updateAgentLog(agentId, "Reading document...");
    const instruction = promptObj.instruction;
    const currentText = state.ytext.toString();

    // Check for section context
    // If section string provided (e.g. "Section 6"), we could narrow context, 
    // but for now we pass full doc and instruction.

    agentManager.updateAgentLog(agentId, "Querying LLM...");
    if (state.apiKey) {
        await runLiveAiTask(agentId, agent.name, agent.color, instruction, (msg) => agentManager.updateAgentLog(agentId, msg));
    } else {
        await runMockAiTask(agentId, agent.name, agent.color, instruction);
    }
}

async function runMockAiTask(agentId, name, color, instruction) {
    const text = instruction.toLowerCase();
    await wait(800);

    // Simple mock logic
    let target = null;
    let replacement = "";

    // Heuristics based on common demo prompts & user input
    if (text.includes("salary") || text.includes("compensation")) {
        target = "[INSERT_SALARY]";
        replacement = "$165,000";
    } else if (text.includes("liability") || text.includes("insurance")) {
        target = "limits of not less than $2,000,000";
        replacement = "limits of not less than $5,000,000 (and naming Landlord as additional insured)";
    } else if (text.includes("password")) {
        target = "10 minutes or less";
        replacement = "5 minutes or less, and requiring MFA";
    } else if (text.includes("budget")) {
        target = "Development Resources: 3 Full-stack Engineers";
        replacement = "Development Resources: 3 Full-stack Engineers, 1 AI Specialist, +10% Contingency";
    } else if (text.includes("name") && text.includes("update")) {
        // "Update name to Pavan"
        // Extract name 
        const match = instruction.match(/name to\s+([^\s]+)/i);
        const newName = match ? match[1] : "Pavan";

        // Try to find placeholders in Commercial Lease
        if (state.ytext.toString().includes("[TENANT_NAME]")) {
            target = "[TENANT_NAME]";
            replacement = newName;
        } else if (state.ytext.toString().includes("Tenant Name")) {
            target = "Tenant Name";
            replacement = newName;
        }
    } else if (text.includes("section 3") && text.includes("rent")) {
        target = "payable in advance on the first day of each calendar month.";
        replacement = "payable in advance on the first day of each calendar month, subject to an annual increase of 3% on the anniversary of the commencement date.";
    }

    // Fallback: If no heuristic match, DO NOT append to doc.
    if (!target) {
        agentManager.updateAgentLog(agentId, "Mock check: No specific edits found for this instruction.");
        // Try to find user cursor to show we are "there" but don't edit
        if (state.awareness) {
            const localState = state.awareness.getLocalState();
            if (localState && localState.cursor) {
                // Flash cursor there
                updateAgentCursor(agentId, localState.cursor.index, 0, name, color);
                await wait(1000);
            }
        }
        return;
    }

    // Generic heuristic if target is "END_OF_DOC" was removed.
    // We only edit if we found a valid target.

    if (target) {
        agentManager.updateAgentLog(agentId, `Found match: "${target.slice(0, 20)}..."`);
        await simulateStreamingEdit(target, replacement, agentId, name, color);
        agentManager.updateAgentLog(agentId, "Edit complete.");
    }
}

async function orchestrateAndSpawn(instruction) {
    // 1. Live AI Orchestration
    if (state.apiKey) {
        agentManager.updateAgentLog(`manual-ai-${state.userNumber}`, "Orchestrating plan...");
        try {
            const body = {
                model: state.model,
                temperature: 0.1,
                messages: [
                    {
                        role: "system",
                        content: `You are a Lead Editor. Break the user's request into 1 to 3 distinct sub-tasks for different specialists. 
RETURN JSON: { "tasks": [{ "role": "string", "name": "string", "instruction": "string", "section_context": "string" }] }.
Example: Request "Fix headers and update dates" -> tasks: [{ "role": "Formatter", "instruction": "Fix headers", "section_context": "Header" }, { "role": "Clerk", "instruction": "Update dates", "section_context": "Dates" }]`
                    },
                    { role: "user", content: instruction }
                ],
                response_format: { type: "json_object" }
            };

            const res = await fetch(`${state.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.apiKey}` },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            const plan = JSON.parse(data.choices[0].message.content);

            if (plan.tasks && plan.tasks.length > 0) {
                // Spawn parallel agents
                plan.tasks.forEach(task => {
                    agentManager.spawnAgent(`${task.name} (${state.userName})`, task.role, deriveAiColor(task.role), { label: "Manual Task", instruction: task.instruction }, task.section_context);
                });
                return;
            }
        } catch (e) {
            console.warn("Orchestration failed, falling back to single agent", e);
        }
    }

    // 2. Mock / Fallback (Single Agent)
    const agentId = `manual-ai-${state.userNumber || "guest"}`;
    const agentName = `${state.userName || "User"} (AI)`;
    const agentColor = state.aiColor;

    // We manually spawn a "Manager" agent first to show activity? 
    // Actually, applyInstruction calls runs directly. 
    // But to support "multiagents work parallel", we should preferably use spawnAgent even for manual override?
    // The previous logic used 'runLiveAiTask' directly without spawning a card.
    // Let's change Manual Override to ALWAYS spawn an agent card! 
    // This unifies the UX.

    agentManager.spawnAgent(agentName, "Manual Override", agentColor, { label: "Manual Instruction", instruction: instruction }, "General");
}

async function runLiveAiTask(agentId, name, color, instruction, logFn) {
    const currentText = state.ytext.toString();
    const body = {
        model: state.model,
        temperature: 0.3,
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "contract_edit",
                schema: {
                    type: "object",
                    properties: {
                        operations: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    match: { type: "string", description: "Exact unique text from the document to replace." },
                                    replacement: { type: "string", description: "The new text to insert." }
                                },
                                required: ["match", "replacement"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["operations"],
                    additionalProperties: false
                }
            }
        },
        messages: [
            {
                role: "system",
                content: `You are ${name}, a helpful assistant.Return JSON: { operations: [{ match, replacement }] }. The 'match' text must exist exactly in the document.Do not hallucinate matches.`
            },
            {
                role: "user",
                content: `Document: \n${currentText} \n\nInstruction: ${instruction} `
            }
        ]
    };

    const response = await fetch(`${state.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.apiKey}` },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Auth Error: ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    let operations = [];

    try {
        const parsed = JSON.parse(rawContent);
        operations = parsed.operations || [];
    } catch (e) {
        if (logFn) logFn("Failed to parse JSON, trying diff...");
    }

    if (operations.length) {
        if (logFn) logFn(`Applying ${operations.length} edits...`);
        await applyOperations(operations, agentId, name, color);
    } else {
        // Fallback: if text returned, diff it
        if (typeof rawContent === 'string' && rawContent.length > 5) {
            if (logFn) logFn("Applying smart diff...");
            await applySmartDiffV2(currentText, rawContent, agentId, name, color);
        } else {
            if (logFn) logFn("No edits returned.");
        }
    }
}

async function simulateStreamingEdit(target, textToType, agentId, name, color, cleanInsertIndex = null) {
    const docLength = state.ytext.length;
    let index = 0;

    if (cleanInsertIndex !== null) {
        index = cleanInsertIndex;
    } else if (target === "END_OF_DOC") {
        index = docLength;
    } else if (target) {
        const current = state.ytext.toString();
        index = current.indexOf(target);
        if (index === -1) {
            // Target not found
            return;
        }
        // Delete target first
        updateAgentCursor(agentId, index, target.length, name, color);
        await wait(500);
        state.ydoc.transact(() => {
            state.ytext.delete(index, target.length);
        }, agentId); // Use agentId as origin
    }

    let relPos = Y.createRelativePositionFromTypeIndex(state.ytext, index);

    // Type replacement
    for (const char of textToType) {
        const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
        if (absPos) {
            updateAgentCursor(agentId, absPos.index, 1, name, color);
            state.ydoc.transact(() => {
                state.ytext.insert(absPos.index, char);
            }, agentId);
            relPos = Y.createRelativePositionFromTypeIndex(state.ytext, absPos.index + 1);
        }
        await wait(20);
    }
    // updateAgentCursor(agentId, null);
}

async function applyOperations(operations, agentId, name, color) {
    for (const op of operations) {
        const match = op.match;
        const replacement = op.replacement;
        if (!match) continue;

        const current = state.ytext.toString();
        const idx = current.indexOf(match);
        if (idx === -1) continue;

        // Visual Highlight
        updateAgentCursor(agentId, idx, match.length, name, color);
        await wait(600); // Pause to show what's being deleted

        // Delete
        state.ydoc.transact(() => {
            state.ytext.delete(idx, match.length);
        }, agentId);

        // Type Insert
        let relPos = Y.createRelativePositionFromTypeIndex(state.ytext, idx);
        for (const char of replacement) {
            await wait(15);
            state.ydoc.transact(() => {
                const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
                if (absPos) {
                    state.ytext.insert(absPos.index, char);
                    updateAgentCursor(agentId, absPos.index + 1, 0, name, color);
                    relPos = Y.createRelativePositionFromTypeIndex(state.ytext, absPos.index + 1);
                }
            }, agentId);
        }
    }
    // updateAgentCursor(agentId, null);
}

async function applySmartDiffV2(oldText, newText, agentId, name, color) {
    const changes = diff(oldText, newText);
    let scanIndex = 0;

    // Similar logic to legacy, but using agent cursor
    // ... simplified loop ...
    let headAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, 0);

    for (const [action, chunk] of changes) {
        if (action === 0) { // EQ
            // Move anchor
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, state.ydoc);
            if (startPos) {
                headAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, startPos.index + chunk.length);
            }
        } else if (action === -1) { // DEL
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, state.ydoc);
            if (startPos) {
                updateAgentCursor(agentId, startPos.index, chunk.length, name, color);
                await wait(25);
                state.ydoc.transact(() => {
                    state.ytext.delete(startPos.index, chunk.length);
                }, agentId);
                // Head anchor stays at startPos (content shifted)
            }
        } else if (action === 1) { // INS
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, state.ydoc);
            if (startPos) {
                let instAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, startPos.index);
                for (const char of chunk) {
                    const abs = Y.createAbsolutePositionFromRelativePosition(instAnchor, state.ydoc);
                    if (abs) {
                        updateAgentCursor(agentId, abs.index, 1, name, color);
                        state.ydoc.transact(() => {
                            state.ytext.insert(abs.index, char);
                        }, agentId);
                        instAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, abs.index + 1);
                    }
                    // wait(5) // fast
                }
                headAnchor = instAnchor;
            }
        }
    }
    // updateAgentCursor(agentId, null);
}

function updateAgentCursor(agentId, position, length = 0, name = "AI", color = "#8b5cf6", isRemote = false) {
    if (!state.cursorModule || !state.ydoc) return;

    // 1. Render locally immediately (visual feedback)
    if (position === null) {
        state.cursorModule.removeCursor(agentId);
    } else {
        state.cursorModule.createCursor(agentId, name, color);
        // Only update UI if we have a valid DOM/editor state
        state.cursorModule.moveCursor(agentId, { index: position, length });
        state.cursorModule.toggleFlag(agentId, true);
    }

    // 2. Broadcast/Persist (using RelativePosition)
    if (!isRemote) {
        const cursorsMap = state.ydoc.getMap("agent-cursors");
        state.ydoc.transact(() => {
            if (position === null) {
                cursorsMap.delete(agentId);
            } else {
                // Convert absolute index to RelativePosition
                try {
                    const relPos = Y.createRelativePositionFromTypeIndex(state.ytext, position);
                    const encoded = Y.encodeRelativePosition(relPos);
                    // Store as array for JSON compatibility in map
                    const relPosArr = Array.from(encoded);
                    cursorsMap.set(agentId, { relPos: relPosArr, length, name, color });
                } catch (e) {
                    console.warn("Failed to encode cursor", e);
                }
            }
        }, "agent-cursor-sync");
    }
}

function setupAgentCursorSync() {
    if (!state.ydoc) return;
    const cursorsMap = state.ydoc.getMap("agent-cursors");

    // Helper: Refresh all cursors from Map (Resolving RelPos -> AbsPos)
    const refreshCursors = () => {
        cursorsMap.forEach((data, agentId) => {
            if (!data || !data.relPos) return;
            try {
                // Decode RelativePosition
                const compiled = new Uint8Array(data.relPos);
                const relPos = Y.decodeRelativePosition(compiled);
                // Resolve to current absolute position
                const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);

                if (absPos) {
                    // Update UI directly (isRemote=true equivalent)
                    state.cursorModule.createCursor(agentId, data.name, data.color);
                    state.cursorModule.moveCursor(agentId, { index: absPos.index, length: data.length });
                    state.cursorModule.toggleFlag(agentId, true);
                } else {
                    // Position invalid/deleted
                    state.cursorModule.removeCursor(agentId);
                }
            } catch (e) {
                console.warn("Failed to refresh cursor", e);
            }
        });
    };

    // 1. Observe Map Changes (Remote Updates)
    cursorsMap.observe((event) => {
        if (event.transaction.origin === "agent-cursor-sync") return; // Ignore our own sync ops

        // We can just call refreshCursors to be safe and simple, 
        // or optimize. Since this runs on every remote keystroke (if they broadcast),
        // let's just trigger refreshCursors() which is robust.
        refreshCursors();
    });

    // 2. Observe Text Changes (Local & Remote)
    // This ensures that when WE type, the "floating" agent cursors anchor correctly.
    state.ytext.observe(() => {
        refreshCursors();
    });
}

// Cursor synchronization helpers for AI are now handled by AgentManager logic locally.
// Future: propagate agent cursors via Awareness if needed for multi-user visibility.

function askForConfirmation() {
    return new Promise((resolve) => {
        const modalEl = document.getElementById("conflictModal");
        const modal = new bootstrap.Modal(modalEl);
        const acceptBtn = document.getElementById("btn-accept-conflict");
        const rejectBtn = document.getElementById("btn-reject-conflict");

        const cleanup = () => {
            acceptBtn.removeEventListener("click", onAccept);
            rejectBtn.removeEventListener("click", onReject);
            modal.hide();
        };

        const onAccept = () => {
            cleanup();
            resolve(true);
        };

        const onReject = () => {
            cleanup();
            showToast("AI edit cancelled.", true);
            resolve(false);
        };

        acceptBtn.addEventListener("click", onAccept);
        rejectBtn.addEventListener("click", onReject);
        modal.show();
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message, isError = false) {
    const toastEl = document.getElementById("liveToast");
    const toastBody = document.getElementById("toast-message");
    const toastHeader = toastEl.querySelector(".toast-header strong");
    toastBody.textContent = message;
    toastHeader.textContent = isError ? "Error" : "Notification";
    toastHeader.classList.toggle("text-danger", isError);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}
window.showToast = showToast;
