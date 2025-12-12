import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { QuillBinding } from "y-quill";
import Quill from "quill";
import QuillCursors from "quill-cursors";
import diff from "fast-diff";
import { DOCUMENTS } from "./documents.js";
import { AgentManager } from "./agent-manager.js";

Quill.register("modules/cursors", QuillCursors);

// DOM Helper (Uniformity Guideline)
const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

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

const nameInput = $("#user-name-input");
const statusEl = $("#connection-status");
const aiStatusEl = $("#ai-mode-status");
const roomNameEl = $("#room-name");
const collaboratorCountEl = $("#collaborator-count");
const shareBtn = $("#btn-share");
const templateBtn = $("#btn-template");
const uploadInput = $("#file-upload");
const applyBtn = $("#btn-apply-ai");
const instructionInput = $("#ai-instruction");
const settingsForm = $("#settings-form");
const settingsModalEl = $("#settingsModal");
// const settingsModal = new bootstrap.Modal(settingsModalEl); // Removed global init to avoid conflicts

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
setupAgentCursorSync();

// --- Activity Logging Setup ---
updateActivityLog(`Connecting to room: ${roomName}...`);

state.awareness.on("change", () => {
    const states = state.awareness.getStates();
    $("#collaborator-count").innerText = states.size;
    updateActivityLog(`Collaborators count: ${states.size}`);
});

state.webrtcProvider.on("status", (event) => {
    if (event.connected) {
        $("#connection-status").innerHTML = '<span class="ai-active-indicator"></span> Connected';
        $("#connection-status").classList.replace("bg-secondary", "bg-success");
        updateActivityLog("WebRTC Connected", "success");
    } else {
        $("#connection-status").innerHTML = '<span class="ai-mock-indicator"></span> Disconnected';
        $("#connection-status").classList.replace("bg-success", "bg-secondary");
        updateActivityLog("WebRTC Disconnected", "warning");
    }
});

// Sync Template Selection (Available Agents)
state.ydoc.getMap("app-state").observe(event => {
    if (event.keysChanged.has("selectedDocId")) {
        const newId = state.ydoc.getMap("app-state").get("selectedDocId");
        if (newId && newId !== state.selectedDocId) {
            const doc = DOCUMENTS.find(d => d.id === newId);
            if (doc) {
                state.selectedDocId = newId;
                const actionsContainer = $("#agent-prompts-bar");
                if (actionsContainer) renderActions(doc, actionsContainer);
                renderTopBarDocs(); // Update highlight
                updateActivityLog(`Host selected: ${doc.title}`, "info");
            }
        }
    }
});

renderTemplatesGrid();
renderTopBarDocs();
setupTemplateButton();
attachEventListeners();
updateAiModeBadge();
setupThemeToggle();

// --- Activity Logger ---
function updateActivityLog(message, type = "info") {
    const logContainer = $("#activity-log");
    if (!logContainer) return;

    const entry = document.createElement("div");
    entry.className = "mb-1 text-truncate";
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let colorClass = "text-muted";
    if (type === "success") colorClass = "text-success";
    if (type === "warning") colorClass = "text-warning";
    if (type === "error") colorClass = "text-danger";

    entry.innerHTML = `<span class="opacity-50 me-2">[${time}]</span><span class="${colorClass}">${message}</span>`;
    logContainer.prepend(entry); // Newest top
}

// --- Top Bar Docs Rendering (Scroller) ---
function renderTopBarDocs() {
    const listContainer = $("#demo-docs-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    DOCUMENTS.forEach(doc => {
        const card = document.createElement("div");
        card.className = `card shadow-sm demo-card flex-shrink-0 ${state.selectedDocId === doc.id ? 'border-primary bg-primary bg-opacity-10' : ''}`;
        card.style.cursor = "pointer";
        card.style.minWidth = "220px";
        card.style.maxWidth = "260px";
        card.innerHTML = `
            <div class="card-body p-2 d-flex align-items-center gap-2">
                <div class="rounded-circle bg-body p-2 text-primary border me-2">
                    <i class="bi ${doc.icon || 'bi-file-text'} fs-5"></i>
                </div>
                <div class="overflow-hidden">
                    <h6 class="card-title mb-0 text-truncate fw-bold" style="font-size: 0.85rem;">${doc.title}</h6>
                    <small class="card-text text-muted text-xs text-truncate d-block">${doc.description}</small>
                </div>
            </div>
        `;

        card.onclick = () => {
            loadDocFromModal(doc);
            renderTopBarDocs(); // Update selection state in top bar too
        };

        listContainer.appendChild(card);
    });
}


// --- Templates Grid Rendering (Modal) ---
function renderTemplatesGrid() {
    const gridContainer = $("#templates-grid");
    if (!gridContainer) return;

    gridContainer.innerHTML = "";

    DOCUMENTS.forEach(doc => {
        const col = document.createElement("div");
        col.className = "col";
        col.innerHTML = `
            <div class="card h-100 border-0 shadow-sm template-card">
                <div class="card-body p-4 d-flex flex-column text-center">
                    <div class="mb-3">
                        <i class="bi ${doc.icon || 'bi-file-text'} text-primary display-5"></i>
                    </div>
                    <h5 class="card-title fw-bold mb-2">${doc.title}</h5>
                    <p class="card-text text-muted small flex-grow-1">${doc.description}</p>
                    <button class="btn btn-primary w-100 mt-3 fw-bold py-2 btn-load-template" data-id="${doc.id}">
                        Plan & Run
                    </button>
                </div>
            </div>
        `;

        // Event Listener for the button
        const btn = col.querySelector(".btn-load-template");
        btn.onclick = () => {
            loadDocFromModal(doc);
        };

        gridContainer.appendChild(col);
    });
}

function loadDocFromModal(doc) {
    state.selectedDocId = doc.id;
    replaceDocumentText(doc.content, "demo-load");

    // Update UI
    const modalEl = document.getElementById('templatesModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    // Render Actions in Horizontal Bar
    const actionsContainer = $("#agent-prompts-bar");
    if (actionsContainer) renderActions(doc, actionsContainer);

    // Sync Selection to others
    if (state.ydoc) {
        state.ydoc.getMap("app-state").set("selectedDocId", doc.id);
    }

    showToast(`Loaded template: ${doc.title}`);
    updateActivityLog(`Loaded template: ${doc.title}`, "success");
}

function renderActions(doc, container) {
    container.innerHTML = "";

    // Header for context (optional, or just icons)
    const label = document.createElement("span");
    label.className = "text-muted small fw-bold me-2 text-uppercase d-none d-md-inline";
    label.style.fontSize = "0.7rem";
    label.innerText = "Available Agents:";
    container.appendChild(label);

    doc.prompts.forEach(prompt => {
        const btn = document.createElement("button");
        const role = getAgentRoleForSection(prompt.section);
        // Pill style
        btn.className = "btn btn-outline-secondary btn-sm rounded-pill d-flex align-items-center gap-2 border shadow-sm bg-body text-body";
        btn.style.fontSize = "0.85rem";
        btn.innerHTML = `
            <i class="bi bi-robot text-primary"></i>
            <span class="fw-medium">${prompt.label}</span>
        `;

        btn.onclick = () => {
            // STRICT MODE: Check for LLM Config
            if (!state.apiKey || state.apiKey === "" || state.apiKey === "sk-...") {
                const settingsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal'));
                settingsModal.show();
                showToast("Please configure LLM API Key first!", true);
                return;
            }

            const role = getAgentRoleForSection(prompt.section);
            const userName = state.userName || "User";
            agentManager.spawnAgent(`${role.name} (${userName})`, role.role, role.color, prompt, prompt.section);
        };

        container.appendChild(btn);
    });
}

// Ensure the modal can be opened from the top bar button too
function setupTemplateButton() {
    const btn = $("#btn-template");
    if (btn) {
        btn.onclick = () => {
            const modal = new bootstrap.Modal(document.getElementById('templatesModal'));
            renderTemplatesGrid();
            modal.show();
        };
        // Also remove old attributes if any
        btn.removeAttribute("data-bs-toggle");
        btn.removeAttribute("data-bs-target");
    }
}

function setupThemeToggle() {
    const btn = document.getElementById("btn-theme-toggle");
    const icon = document.getElementById("theme-icon");
    const html = document.documentElement;

    // 1. Load preference
    const stored = localStorage.getItem("theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let currentTheme = stored || (systemDark ? "dark" : "light");

    const applyTheme = (theme) => {
        html.setAttribute("data-bs-theme", theme);
        if (theme === "dark") {
            icon.className = "bi bi-sun-fill";
        } else {
            icon.className = "bi bi-moon-stars-fill";
        }
    };

    applyTheme(currentTheme);

    // 2. Toggle
    if (btn) {
        btn.onclick = () => {
            currentTheme = currentTheme === "dark" ? "light" : "dark";
            localStorage.setItem("theme", currentTheme);
            applyTheme(currentTheme);
        };
    }
}

function renderActions_DEPRECATED(doc, container) {
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
    $("#api-key").value = settings.apiKey;
    $("#base-url").value = settings.baseUrl;
    $("#model-name").value = settings.model;
    const signalingField = $("#signaling-servers");
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
    });

    let rtcConnected = false;
    let wsConnected = false;

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
    const editorContainer = $("#editor");
    const quill = new Quill(editorContainer, {
        modules: {
            cursors: true,
            toolbar: [
                [{ header: [1, 2, 3, false] }],
                ["bold", "italic", "underline", "strike"],
                [{ color: [] }, { background: [] }],
                [{ align: [] }],
                [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
                ["link", "image", "clean"]
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
        if (!state.apiKey) {
            const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal'));
            modal.show();
            showToast("Please configure LLM API Key first!", true);
            return;
        }
        if (!text) {
            showToast("Enter an instruction first", true);
            return;
        }
        applyInstruction(text);
    });
    $("#btn-save-settings").addEventListener("click", () => {
        state.apiKey = $("#api-key").value.trim();
        state.baseUrl = $("#base-url").value.trim() || "https://llmfoundry.straive.com/openai/v1";
        state.model = $("#model-name").value.trim() || "gpt-4o-mini";
        const rawSignaling = $("#signaling-servers")?.value || "";
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

        // Robustly find and hide the modal
        const modalInstance = bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal'));
        if (modalInstance) modalInstance.hide();

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
        aiStatusEl.innerHTML = '<span class="ai-mock-indicator"></span> Setup Required';
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
    }
}

async function runAgentAi(agentId, promptObj, section) {
    const agent = agentManager.agents.get(agentId);
    if (!agent) return;

    agentManager.updateAgentLog(agentId, "Reading document...");
    const instruction = promptObj.instruction;
    const currentText = state.ytext.toString();

    agentManager.updateAgentLog(agentId, "Querying LLM...");
    agentManager.updateAgentLog(agentId, "Querying LLM...");

    if (!state.apiKey) {
        agentManager.updateAgentLog(agentId, "Error: No API Key configured.");
        throw new Error("API Key missing");
    }

    await runLiveAiTask(agentId, agent.name, agent.color, instruction, (msg) => agentManager.updateAgentLog(agentId, msg));
}



async function orchestrateAndSpawn(instruction) {
    // 1. Live AI Orchestration
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

    // 2. Fallback (Single Agent)
    const agentName = `${state.userName || "User"} (AI)`;
    const agentColor = state.aiColor;

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



async function applyOperations(operations, agentId, name, color) {
    for (const op of operations) {
        const match = op.match;
        const replacement = op.replacement;
        if (!match) continue;

        const current = state.ytext.toString();
        const idx = current.indexOf(match);
        if (idx === -1) continue;

        // Log the action
        updateActivityLog(`${name} replacing "${match.slice(0, 15)}..."`, "info");

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
}

async function applySmartDiffV2(oldText, newText, agentId, name, color) {
    const changes = diff(oldText, newText);
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
        refreshCursors();
    });

    // 2. Observe Text Changes (Local & Remote)
    // This ensures that when WE type, the "floating" agent cursors anchor correctly.
    state.ytext.observe(() => {
        refreshCursors();
    });
}

function askForConfirmation() {
    return new Promise((resolve) => {
        const modalEl = $("#conflictModal");
        const modal = new bootstrap.Modal(modalEl);
        const acceptBtn = $("#btn-accept-conflict");
        const rejectBtn = $("#btn-reject-conflict");

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
    const toastEl = $("#liveToast");
    const toastBody = $("#toast-message");
    const toastHeader = toastEl.querySelector(".toast-header strong");
    toastBody.textContent = message;
    toastHeader.textContent = isError ? "Error" : "Notification";
    toastHeader.classList.toggle("text-danger", isError);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}
window.showToast = showToast;
console.log("Parallel Edit Script Loaded");
