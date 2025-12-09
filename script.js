import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { QuillBinding } from "y-quill";
import Quill from "quill";
import QuillCursors from "quill-cursors";
import diff from "fast-diff";

Quill.register("modules/cursors", QuillCursors);

const SETTINGS_KEY = "parallel_edit_settings";
const DEFAULT_SIGNALING = [
    "wss://signaling.yjs.dev",
    "wss://y-webrtc-signaling-eu.herokuapp.com",
    "wss://y-webrtc-signaling-us.herokuapp.com",
    "wss://signaling-server-2s0k.onrender.com",
    "wss://y-webrtc.fly.dev"
];

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

const DATASET = [
    { title: "Staff SWE Offer", role: "Staff SWE", location: "Austin, USA", comp: "$185k + 15%", updated: "2025-11-02" },
    { title: "Principal PM Offer", role: "Principal PM", location: "Remote (USA)", comp: "$205k + 20%", updated: "2025-10-15" },
    { title: "MSA · Acme Robotics", role: "MSA", location: "Global", comp: "Retainer $45k/qtr", updated: "2025-09-08" },
    { title: "Contractor NDA", role: "NDA", location: "EU / USA", comp: "N/A", updated: "2025-08-21" }
];

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

const historyEntries = [];
const MAX_HISTORY_ITEMS = 50;

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
const historyListEl = document.getElementById("history-list");
const historyCountEl = document.getElementById("history-count");
const datasetTableEl = document.getElementById("dataset-table");
const datasetMetaEl = document.getElementById("dataset-meta");
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

    isAiTyping: false,
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
    aiColor: "#8b5cf6"
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
setupAiCursorAwareness();

renderDataset();
renderHistory();
attachEventListeners();
trackHistory();
updateAiModeBadge();

function loadSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
        return {
            apiKey: stored?.apiKey || "",
            baseUrl: stored?.baseUrl || "https://api.openai.com/v1",
            model: stored?.model || "gpt-4o-mini",
            signaling: normalizeSignalingList(stored?.signaling),
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
        refreshLocalAiCursorLabel();
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

function renderDataset() {
    datasetTableEl.innerHTML = DATASET.map(
        (row) => `
        <tr>
            <td>${row.title}</td>
            <td>${row.role}</td>
            <td>${row.location}</td>
            <td>${row.comp}</td>
            <td>${row.updated}</td>
        </tr>`
    ).join("");
    datasetMetaEl.textContent = `${DATASET.length} rows`;
}

function trackHistory() {
    state.ytext.observe((event, transaction) => {
        if (transaction.origin === null) return;
        const stamp = new Date().toLocaleTimeString();
        event.changes.delta.forEach((change) => {
            if (!change.insert && !change.delete) return;
            const entry = {
                type: change.insert ? "insert" : "delete",
                snippet: (change.insert || `${change.delete} characters removed`).toString().slice(0, 120),
                time: stamp
            };
            historyEntries.unshift(entry);
            if (historyEntries.length > MAX_HISTORY_ITEMS) historyEntries.pop();
        });
        renderHistory();
    });
}

function renderHistory() {
    if (!historyEntries.length) {
        historyListEl.innerHTML = `<div class="text-center text-muted py-4">No edits yet</div>`;
        historyCountEl.textContent = "0";
        return;
    }
    historyListEl.innerHTML = historyEntries.map(
        (entry) => `
        <div class="list-group-item">
            <div class="d-flex justify-content-between align-items-center">
                <span class="badge text-bg-${entry.type === "insert" ? "success" : "danger"} text-uppercase">${entry.type}</span>
                <small class="text-muted">${entry.time}</small>
            </div>
            <div class="mt-2 small text-truncate">${entry.snippet}</div>
        </div>`
    ).join("");
    historyCountEl.textContent = String(historyEntries.length);
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
        aiStatusEl.innerHTML = '<span class="ai-mock-indicator"></span> Mock AI Mode';
    }
}

async function applyInstruction(instruction) {
    if (state.isAiTyping) return;
    updateAiCursor(null);
    state.isAiTyping = true;
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Streaming...';

    try {
        if (state.apiKey) {
            await runLiveAi(instruction);
        } else {
            await runMockAi(instruction);
        }
    } catch (error) {
        console.error(error);
        showToast(`AI error: ${error.message}`, true);
    } finally {
        state.isAiTyping = false;
        applyBtn.disabled = false;
        applyBtn.innerHTML = '<i class="bi bi-stars"></i> Apply Instruction';
    }
}

async function runMockAi(instruction) {
    const text = instruction.toLowerCase();
    await wait(800);
    let target = "END_OF_DOC";
    let replacement = `\n\n5. REMOTE WORK\nThe Employee may work remotely up to 3 days per week.`;
    if (text.includes("salary") || text.includes("compensation")) {
        target = "[INSERT_SALARY]";
        replacement = "$145,000";
    } else if (text.includes("name")) {
        target = "[INSERT_EMPLOYEE_NAME]";
        replacement = "Jamie Rivera";
    } else if (text.includes("start")) {
        target = "[INSERT_START_DATE]";
        replacement = "October 1st, 2025";
    }
    await simulateStreamingEdit(target, replacement);
}

async function runLiveAi(instruction) {
    const currentText = state.ytext.toString();
    const body = {
        model: state.model,
        temperature: 0.4,
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
                                    match: { type: "string", description: "Exact text from the contract to replace" },
                                    replacement: { type: "string", description: "New text to insert" }
                                },
                                required: ["match", "replacement"],
                                additionalProperties: false
                            }
                        },
                        summary: { type: "string" }
                    },
                    required: ["operations"],
                    additionalProperties: false
                }
            }
        },
        messages: [
            {
                role: "system",
                content: "You are a helpful legal co-author. Return JSON: {operations:[{match, replacement}], summary?}. The match string must be copied from the existing document."
            },
            {
                role: "user",
                content: `Document:\n${currentText}\n\nInstruction: ${instruction}`
            }
        ]
    };

    const response = await fetch(`${state.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.apiKey}`
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error("Request failed");
    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    let operations = [];
    if (rawContent) {
        let jsonText = "";
        if (Array.isArray(rawContent)) {
            jsonText = rawContent.map((part) => part.text || "").join("");
        } else if (typeof rawContent === "string") {
            jsonText = rawContent;
        }
        try {
            const parsed = JSON.parse(jsonText);
            operations = parsed.operations || [];
        } catch (error) {
            console.warn("Failed to parse structured response; falling back to diff.", error);
        }
    }

    if (operations.length) {
        const selection = state.quill.getSelection();
        if (selection && selection.length > 0) {
            const approved = await askForConfirmation();
            if (!approved) return;
        }
        await applyOperations(operations);
    } else {
        const fallbackText = Array.isArray(rawContent)
            ? rawContent.map((part) => part.text || "").join("")
            : rawContent;
        if (fallbackText) {
            await applySmartDiffV2(currentText, fallbackText);
        } else {
            throw new Error("Model returned no usable edits.");
        }
    }
}

function isUserEditingRange(startIndex, endIndex) {
    const range = state.quill.getSelection();
    if (!range) return false;
    const userStart = range.index;
    const userEnd = range.index + range.length;
    const buffer = 8;
    return userStart < endIndex + buffer && userEnd > startIndex - buffer;
}

async function simulateStreamingEdit(target, textToType) {
    const docLength = state.ytext.length;
    let index = 0;
    let lastIndex = null;
    if (target === "END_OF_DOC") {
        index = docLength;
    } else {
        const current = state.ytext.toString();
        index = current.indexOf(target);
        if (index === -1) {
            index = docLength;
            textToType = `\n${textToType}`;
        } else {
            updateAiCursor(index, target.length);
            state.ytext.delete(index, target.length);
        }
    }
    let relPos = Y.createRelativePositionFromTypeIndex(state.ytext, index);
    for (const char of textToType) {
        const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
        if (absPos) {
            updateAiCursor(absPos.index, 1);
            state.ytext.insert(absPos.index, char);
            relPos = Y.createRelativePositionFromTypeIndex(state.ytext, absPos.index + 1);
            lastIndex = absPos.index + 1;
        }
        await wait(25);
    }
    if (lastIndex !== null) {
        updateAiCursor(lastIndex, 0);
    }
}

async function applyOperations(operations) {
    let lastAnchor = null;
    for (const op of operations) {
        const match = typeof op.match === "string" ? op.match : op.target || "";
        const replacement = op.replacement ?? op.content ?? "";
        if (!match) continue;
        const current = state.ytext.toString();
        const idx = current.indexOf(match);
        if (idx === -1) continue;

        const conflictRangeEnd = idx + match.length;
        if (isUserEditingRange(idx, conflictRangeEnd)) {
            const approved = await askForConfirmation();
            if (!approved) continue;
        }

        if (match.length) {
            updateAiCursor(idx, match.length);
            state.ydoc.transact(() => {
                state.ytext.delete(idx, match.length);
            }, "ai-edit");
        }

        let relPos = Y.createRelativePositionFromTypeIndex(state.ytext, idx);
        for (const char of replacement) {
            await wait(25);
            state.ydoc.transact(() => {
                const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
                const insertIndex = absPos ? absPos.index : idx;
                state.ytext.insert(insertIndex, char);
                relPos = Y.createRelativePositionFromTypeIndex(state.ytext, insertIndex + 1);
                updateAiCursor(insertIndex + 1, 0);
                lastAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, insertIndex + 1);
            }, "ai-edit");
        }

        if (!replacement.length) {
            lastAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, idx);
        }
    }

    if (lastAnchor) {
        updateAiCursor(lastAnchor, 0);
    } else {
        updateAiCursor(null);
    }
}

async function applySmartDiffV2(oldText, newText) {
    const changes = diff(oldText, newText);
    let scanIndex = 0;
    const ops = [];
    for (const [action, chunk] of changes) {
        if (action === 0) {
            scanIndex += chunk.length;
            ops.push({ type: "EQ", anchor: Y.createRelativePositionFromTypeIndex(state.ytext, scanIndex) });
        } else if (action === -1) {
            scanIndex += chunk.length;
            ops.push({
                type: "DEL",
                endAnchor: Y.createRelativePositionFromTypeIndex(state.ytext, scanIndex)
            });
        } else if (action === 1) {
            ops.push({ type: "INS", content: chunk });
        }
    }

    let headAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, 0);
    let lastEditAnchor = null;

    for (const op of ops) {
        if (op.type === "EQ") {
            headAnchor = op.anchor;
        } else if (op.type === "DEL") {
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, state.ydoc);
            const endPos = Y.createAbsolutePositionFromRelativePosition(op.endAnchor, state.ydoc);
            if (startPos && endPos) {
                const deleteSize = endPos.index - startPos.index;
                if (deleteSize > 0) {
                    updateAiCursor(headAnchor, deleteSize);
                    await wait(25);
                    state.ytext.delete(startPos.index, deleteSize);
                    lastEditAnchor = headAnchor;
                }
            }
            headAnchor = op.endAnchor;
        } else if (op.type === "INS") {
            const startPos = Y.createAbsolutePositionFromRelativePosition(headAnchor, state.ydoc);
            if (!startPos) continue;
            let insertionAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, startPos.index);
            for (const char of op.content) {
                const abs = Y.createAbsolutePositionFromRelativePosition(insertionAnchor, state.ydoc);
                if (abs) {
                    updateAiCursor(abs.index, 1);
                    state.ytext.insert(abs.index, char);
                    insertionAnchor = Y.createRelativePositionFromTypeIndex(state.ytext, abs.index + 1);
                }
            }
            lastEditAnchor = insertionAnchor;
        }
    }
    if (lastEditAnchor || headAnchor) {
        updateAiCursor(lastEditAnchor || headAnchor, 0);
    } else {
        updateAiCursor(null);
    }
}

function setupAiCursorAwareness() {
    const awareness = state.awareness;
    const cursorModule = state.cursorModule;
    const activeIds = new Set();

    const render = () => {
        const seen = new Set();
        awareness.getStates().forEach((entry, clientId) => {
            if (!entry.aiCursor) return;
            const cursorId = `ai-agent-${clientId}`;
            seen.add(cursorId);
            try {
                let encoded = entry.aiCursor.relPos;
                if (!(encoded instanceof Uint8Array)) {
                    encoded = new Uint8Array(Object.values(encoded));
                }
                const relPos = Y.decodeRelativePosition(encoded);
                const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
                if (absPos) {
                    const label =
                        entry.aiCursor.aiLabel ||
                        (entry.aiCursor.alias ? `AI ${entry.aiCursor.alias}` : null) ||
                        (entry.user?.number ? `AI User ${entry.user.number}` : null) ||
                        (entry.user?.name ? `AI (${entry.user.name})` : "AI");
                    const color = entry.aiCursor.color || entry.user?.color || "#8b5cf6";
                    cursorModule.createCursor(cursorId, label, color);
                    cursorModule.moveCursor(cursorId, { index: absPos.index, length: entry.aiCursor.length || 0 });
                    cursorModule.toggleFlag(cursorId, true);
                }
            } catch (error) {
                console.warn("Unable to render AI cursor", error);
            }
        });
        activeIds.forEach((id) => {
            if (!seen.has(id)) {
                cursorModule.removeCursor(id);
                activeIds.delete(id);
            }
        });
        seen.forEach((id) => activeIds.add(id));
    };

    awareness.on("change", ({ removed }) => {
        render();
        removed.forEach((clientId) => {
            const cursorId = `ai-agent-${clientId}`;
            cursorModule.removeCursor(cursorId);
            activeIds.delete(cursorId);
        });
    });
    render();
}

function updateAiCursor(position, length = 0) {
    if (!state.awareness || !state.ytext) return;
    if (position === null) {
        state.awareness.setLocalStateField("aiCursor", null);
        state.cursorModule?.removeCursor("ai-agent-local");
        return;
    }
    let encoded;
    if (typeof position === "number") {
        const relPos = Y.createRelativePositionFromTypeIndex(state.ytext, position);
        encoded = Y.encodeRelativePosition(relPos);
    } else {
        encoded = Y.encodeRelativePosition(position);
    }
    const label = getLocalAiLabel();
    const color = state.aiColor || "#8b5cf6";
    state.awareness.setLocalStateField("aiCursor", {
        relPos: encoded,
        length,
        aiLabel: label,
        alias: state.userAlias,
        number: state.userNumber,
        color
    });
    const abs = typeof position === "number"
        ? { index: position }
        : Y.createAbsolutePositionFromRelativePosition(position, state.ydoc);
    if (abs) {
        state.cursorModule?.createCursor("ai-agent-local", label, color);
        state.cursorModule?.moveCursor("ai-agent-local", { index: abs.index, length });
        state.cursorModule?.toggleFlag("ai-agent-local", true);
    }
}

function getLocalAiLabel() {
    if (state.userNumber) {
        const base = `AI User ${state.userNumber}`;
        return state.userName ? `${base} (${state.userName})` : base;
    }
    return `AI (${state.userName || "Editor"})`;
}

function refreshLocalAiCursorLabel() {
    if (!state.awareness || !state.ydoc) return;
    const local = state.awareness.getLocalState();
    if (!local?.aiCursor?.relPos) return;
    let encoded = local.aiCursor.relPos;
    if (!(encoded instanceof Uint8Array)) {
        encoded = new Uint8Array(Object.values(encoded));
    }
    const relPos = Y.decodeRelativePosition(encoded);
    const abs = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
    if (abs) {
        updateAiCursor(abs.index, local.aiCursor.length || 0);
    }
}

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
