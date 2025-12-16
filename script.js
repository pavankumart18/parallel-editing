import diff from "fast-diff";
import { html, render } from "lit-html";
import Quill from "quill";
import QuillCursors from "quill-cursors";
import saveform from "saveform";
import { QuillBinding } from "y-quill";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import { AgentManager } from "./agent-manager.js";
import { APP_CONFIG, CARDS, DEFAULTS, DOCUMENTS } from "./config.js";

Quill.register("modules/cursors", QuillCursors);

const Inline = Quill.import("blots/inline");

class AgentHighlightBlot extends Inline {
  static create(value) {
    const node = super.create();
    let payload = {};
    if (typeof value === "string") {
      try {
        payload = JSON.parse(value);
      } catch {
        payload = {};
      }
    } else if (value && typeof value === "object") {
      payload = value;
    }
    node.dataset.agentHighlightId = payload.id || "";
    node.dataset.agentHighlightColor = payload.color || "";
    node.classList.add("agent-highlight");
    if (payload.color) {
      node.style.setProperty("--agent-highlight-color", payload.color);
    }
    node.style.backgroundColor = payload.color || "#fde68a";
    return node;
  }

  static formats(node) {
    const id = node.dataset.agentHighlightId;
    const color = node.dataset.agentHighlightColor;
    if (!id) return null;
    return JSON.stringify({ id, color });
  }
}
AgentHighlightBlot.blotName = "agent-highlight";
AgentHighlightBlot.tagName = "mark";
AgentHighlightBlot.className = "agent-highlight";
Quill.register(AgentHighlightBlot);

// DOM Helper (Uniformity Guideline)
const $ = document.querySelector.bind(document);

const SETTINGS_KEY = "parallel_edit_settings";
const TEMPLATE_TEXT = DOCUMENTS[0].content;
const MODEL_GUARDRAILS = [
  {
    matcher: /gpt-5-mini/i,
    blockedParams: ["temperature"],
    message: "Temperature is not supported for GPT-5-mini",
  },
];
const MODEL_WARNINGS_SEEN = new Set();

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
  return list.length ? list : [...DEFAULTS.signaling];
}

const nameInput = $("#user-name-input");
const statusEl = $("#connection-status");
const aiStatusEl = $("#ai-mode-status");
const roomNameEl = $("#room-name");
const collaboratorCountEl = $("#collaborator-count");
const shareBtn = $("#btn-share");
const downloadBtn = $("#btn-download");
const uploadInput = $("#file-upload");
const applyBtn = $("#btn-apply-ai");
const instructionInput = $("#ai-instruction");
const settingsForm = $("#settings-form");

const settings = loadSettings();
hydrateSettingsForm();
const settingsPersistence = settingsForm
  ? saveform("#settings-form", { prefix: "parallel_edit_", dropEmpty: true })
  : null;

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
  highlightStore: null,
  highlights: new Map(),
  userName: null,
  userAlias: null,
  userNumber: null,
  userColor: null,
  aiColor: "#8b5cf6",
  aiColor: "#8b5cf6",
  selectedDocId: null,
  docVersion: 0,
};

// Initialize Agent Manager
const agentManager = new AgentManager("agents-container", "agent-count");

// Wire up Agent Task Execution
agentManager.onTaskStart = async (agentId, prompt) => {
  await runAgentAi(agentId, prompt);
};

const roomName = ensureRoomParam();
stripDocParamFromUrl();
roomNameEl.textContent = roomName;

const collab = initCollaboration(roomName);
state.ydoc = collab.ydoc;
state.ytext = collab.ytext;
state.webrtcProvider = collab.webrtcProvider;
state.awareness = collab.awareness;

state.quill = initQuill(state.ytext, state.awareness);
state.cursorModule = state.quill.getModule("cursors");
setupAgentCursorSync();
setupHighlightStore();
attachExplainabilityListeners();
renderPresenceIndicators();

// --- Activity Logging Setup ---
updateActivityLog(`Connecting to room: ${roomName}...`);

state.awareness.on("change", () => {
  const states = state.awareness.getStates();
  $("#collaborator-count").innerText = states.size;
  updateActivityLog(`Collaborators count: ${states.size}`);
  renderPresenceIndicators();
});

state.webrtcProvider.on("status", (event) => {
  if (event.connected) {
    $("#connection-status").innerHTML = "<span class=\"ai-active-indicator\"></span> Connected";
    $("#connection-status").classList.replace("bg-secondary", "bg-success");
    updateActivityLog("WebRTC Connected", "success");
  } else {
    $("#connection-status").innerHTML = "<span class=\"ai-mock-indicator\"></span> Disconnected";
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
        selectDocument(doc.id, "remote", {
          broadcast: false,
          silent: true,
          applyContent: false,
          skipScroll: true,
        });
        updateActivityLog(`Host selected: ${doc.title}`, "info");
      }
    }
  }
});

renderTemplatesGrid();

renderPromptBar(null);
renderHero();
renderDemoCards();
attachEventListeners();
updateAiModeBadge();
setupThemeToggle();
bootstrapDocSelection();

// --- Activity Logger ---
function updateActivityLog(message, type = "info", meta = null) {
  const logContainer = $("#activity-log");
  if (!logContainer) return;

  const entry = document.createElement("div");
  entry.className = "mb-1 text-truncate";
  const time = new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  let colorClass = "text-muted";
  if (type === "success") colorClass = "text-success";
  if (type === "warning") colorClass = "text-warning";
  if (type === "error") colorClass = "text-danger";

  entry.innerHTML = `<span class="opacity-50 me-2">[${time}]</span><span class="${colorClass}">${message}</span>`;
  if (meta?.highlightId) {
    entry.dataset.highlightId = meta.highlightId;
    entry.dataset.agentId = meta.agentId || "";
    entry.classList.add("activity-log-link");
  }
  logContainer.prepend(entry); // Newest top
}

function renderDemoCards() {
  const listContainer = $("#demo-docs-list");
  if (!listContainer) return;

  const template = html`
        ${CARDS.map((card) => {
    const doc = DOCUMENTS.find((d) => d.id === card.docId);
    if (!doc) return null;
    const isActive = state.selectedDocId === doc.id;
    return html`
      <div class="card demo-card shadow-sm flex-shrink-0 ${isActive ? "border-primary ring-2" : ""}" style="width: 280px; white-space: normal;">
        <div class="card-body p-4 text-center d-flex flex-column h-100">
          <div class="mb-3">
             <i class=${`bi ${doc.icon || "bi-file-text"} text-primary display-6`}></i>
          </div>
          <h6 class="fw-bold mb-2">${doc.title}</h6>
          <p class="text-muted small flex-grow-1 mb-3" style="font-size: 0.85rem; line-height: 1.4;">
             ${doc.description || card.summary || "Collaborate on this document."}
          </p>
          <button
              type="button"
              class="btn btn-primary w-100 fw-bold"
               @click=${() => selectDocument(doc.id, "card")}
          >
              Use

          </button>
        </div>
      </div>
    `;
  })
    }
    `;
  render(template, listContainer);
}

function renderTemplatesGrid() {
  const gridContainer = $("#templates-grid");
  if (!gridContainer) return;

  const template = html`
        ${DOCUMENTS.map((doc) =>
    html`
            <div class="col">
                <div class="card h-100 border-0 shadow-sm template-card">
                    <div class="card-body p-4 d-flex flex-column text-center">
                        <div class="mb-3">
                            <i class=${`bi ${doc.icon || "bi-file-text"} text-primary display-5`}></i>
                        </div>
                        <h5 class="card-title fw-bold mb-2">${doc.title}</h5>
                        <p class="card-text text-muted small flex-grow-1">${doc.description}</p>
                        <button class="btn btn-primary w-100 mt-3 fw-bold py-2"
                            @click=${() => {
        selectDocument(doc.id, "template");
        const modal = bootstrap.Modal.getInstance(document.getElementById("templatesModal"));
        if (modal) modal.hide();
      }}>
                            Use

                        </button>
                    </div>
                </div>
            </div>
        `
  )
    }
    `;
  render(template, gridContainer);
}

function renderPromptBar(doc) {
  const container = $("#agent-prompts-bar");
  if (!container) return;

  if (!doc) {
    render(html``, container);
    return;
  }

  const template = html`
        <span class="text-muted small fw-bold text-uppercase me-2 prompt-label">Agent Recipes</span>
        ${(doc.prompts && doc.prompts.length)
      ? doc.prompts.map((prompt) =>
        html`
                <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm rounded-pill d-flex align-items-center gap-2 prompt-pill"
                    @click=${() => handlePromptRun(prompt)}
                >
                    <i class="bi bi-robot text-primary"></i>
                    <span class="fw-medium">${prompt.label}</span>
                </button>
            `
      )
      : html`<span class="text-muted small">No prompts configured.</span>`
    }
    `;
  render(template, container);
}

function renderHero() {
  const heroEl = document.getElementById("hero");
  if (!heroEl) return;

  const description = (APP_CONFIG.description || "").trim();
  const paragraphs = description
    ? description.split(/\n\s*\n/).filter(Boolean).slice(0, 3)
    : [];
  const bulletPoints = [
    "Parallel Yjs + WebRTC co-editing",
    "One-click agent prompts per template",
  ];

  const template = html`
    <div class="hero-copy text-center mx-auto" style="max-width: 800px;">
      <h1>${APP_CONFIG.title}</h1>
      ${paragraphs.length
      ? paragraphs.map((para) => html`<p class="lead">${para}</p>`)
      : html`<p class="lead">Collaborate with AI agents and humans on long-form documents without any backend setup.</p>`
    }
      <div class="hero-actions justify-content-center">
        <button
          class="btn btn-primary btn-lg px-4"
          @click=${() => {
      if (DOCUMENTS.length) selectDocument(DOCUMENTS[0].id, "hero");
      scrollEditorIntoView();
    }}
        >
          Start Editing
        </button>
        <button class="btn btn-outline-secondary btn-lg px-4" @click=${scrollDemoRailIntoView}>
          Browse Demo Cards
        </button>
      </div>
    </div>
  `;

  render(template, heroEl);
}

function handleCardKey(event, docId) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectDocument(docId, "card");
  }
}

function openSettingsPanel() {
  const modalEl = document.getElementById("settingsModal");
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function handlePromptRun(prompt) {
  if (!state.apiKey || state.apiKey === "" || state.apiKey === "sk-...") {
    openSettingsPanel();
    showToast("Please configure LLM API Key first!", true);
    return;
  }

  const role = getAgentRole(prompt);
  const userName = state.userName || "User";
  const purposeLine = `${role.purpose} - Requested by ${userName}`;
  agentManager.spawnAgent(role.name, role.role, role.color, prompt, prompt.section, purposeLine);
}

function selectDocument(docId, source = "demo", options = {}) {
  const {
    broadcast = true,
    silent = false,
    applyContent = source !== "remote",
    skipScroll = false,
  } = options;

  state.docVersion++; // Invalidate running agents

  const doc = DOCUMENTS.find((d) => d.id === docId) || DOCUMENTS[0];
  if (!doc) return null;

  state.selectedDocId = doc.id;
  renderDemoCards();
  renderPromptBar(doc);

  if (applyContent) {
    replaceDocumentText(doc.content, `${source}-load`);
  }

  if (broadcast && state.ydoc) {
    state.ydoc.getMap("app-state").set("selectedDocId", doc.id);
  }

  if (!silent && source !== "remote") {
    showToast(`Loaded demo: ${doc.title}`);
    updateActivityLog(`Loaded demo: ${doc.title}`, "info");
    if (!skipScroll) scrollEditorIntoView();
  }

  return doc;
}

function bootstrapDocSelection() {
  const runSelection = () => {
    const appState = state.ydoc?.getMap("app-state");
    const remoteDocId = appState?.get("selectedDocId");
    if (remoteDocId) {
      selectDocument(remoteDocId, "remote", {
        broadcast: false,
        silent: true,
        applyContent: false,
        skipScroll: true,
      });
      return;
    }
    if (DOCUMENTS.length) {
      selectDocument(DOCUMENTS[0].id, "initial", {
        silent: true,
        applyContent: (state.ytext?.length || 0) === 0,
        skipScroll: true,
      });
    }
  };

  if (!state.webrtcProvider) {
    runSelection();
    return;
  }

  if (state.webrtcProvider.synced) {
    runSelection();
  } else {
    state.webrtcProvider?.once("synced", (synced) => synced && runSelection());
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

function getAgentRole(prompt) {
  const text = ((prompt.section || "") + " " + (prompt.label || "") + " " + (prompt.instruction || "")).toLowerCase();

  if (text.includes("legal") || text.includes("indemn") || text.includes("liab")) {
    return {
      name: "Liability Strengthener",
      role: "Risk Counsel",
      purpose: "Fortifies indemnification and insurance clauses.",
      color: "#ef4444",
    };
  }
  if (text.includes("budget") || text.includes("rent") || text.includes("financ") || text.includes("pricing") || text.includes("cost")) {
    return {
      name: "Budget Balancer",
      role: "Finance Strategist",
      purpose: "Keeps rents, escalators, and deposits aligned.",
      color: "#10b981",
    };
  }
  if (text.includes("security") || text.includes("tech") || text.includes("policy") || text.includes("mfa") || text.includes("password")) {
    return {
      name: "Security Sentinel",
      role: "SecOps Specialist",
      purpose: "Locks down MFA, BYOD, and acceptable use posture.",
      color: "#f59e0b",
    };
  }
  if (text.includes("launch") || text.includes("market") || text.includes("social")) {
    return {
      name: "GTM Guru",
      role: "Marketing Lead",
      purpose: "Optimizes launch strategy and communication channels.",
      color: "#8b5cf6",
    };
  }
  return {
    name: "Clarity Editor",
    role: "Simplification Specialist",
    purpose: "Improves readability, tone, and parallel structure.",
    color: "#3b82f6",
  };
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    return {
      apiKey: stored?.apiKey || "",
      baseUrl: stored?.baseUrl || DEFAULTS.baseUrl,
      model: stored?.model || DEFAULTS.model,
      signaling: normalizeSignalingList(stored?.signaling),
    };
  } catch {
    return {
      apiKey: "",
      baseUrl: DEFAULTS.baseUrl,
      model: DEFAULTS.model,
      signaling: [...DEFAULTS.signaling],
    };
  }
}

function persistSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      apiKey: state.apiKey,
      baseUrl: state.baseUrl,
      model: state.model,
      signaling: state.signaling,
    }),
  );
}

function hydrateSettingsForm() {
  $("#api-key").value = settings.apiKey;
  $("#base-url").value = settings.baseUrl;
  $("#model-name").value = settings.model;
  const signalingField = $("#signaling-servers");
  if (signalingField) {
    signalingField.value = (settings.signaling || DEFAULTS.signaling).join("\n");
  }
}

function ensureRoomParam() {
  const url = new URL(window.location.href);
  const paramKey = DEFAULTS.roomParam || "room";
  const prefix = (APP_CONFIG?.title || "parallel").toLowerCase().split(" ").join("-");
  let room = url.searchParams.get(paramKey);
  if (!room) {
    room = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
    url.searchParams.set(paramKey, room);
    window.history.replaceState({}, "", url);
  }
  return room;
}

function stripDocParamFromUrl() {
  const url = new URL(window.location.href);
  const keys = new Set(["doc"]);
  if (DEFAULTS.docParam && DEFAULTS.docParam !== "doc") {
    keys.add(DEFAULTS.docParam);
  }
  let modified = false;
  keys.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      modified = true;
    }
  });
  if (modified) {
    window.history.replaceState({}, "", url);
  }
}

function initCollaboration(room) {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("quill");
  const signaling = state.signaling?.length ? state.signaling : DEFAULTS.signaling;
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
    number: aliasInfo.number,
  });
  state.userName = myName;
  nameInput.addEventListener("input", () => {
    const nextName = nameInput.value.trim() || "Anonymous";
    awareness.setLocalStateField("user", {
      name: nextName,
      color: myColor,
      alias: aliasInfo.alias,
      number: aliasInfo.number,
    });
    state.userName = nextName;
  });

  let rtcConnected = false;

  const updateStatus = () => {
    const peers = Math.max(awareness.getStates().size, 1);
    const connected = rtcConnected;
    statusEl.innerHTML = `<span class="ai-${connected ? "active" : "mock"}-indicator"></span>${connected ? `Connected via WebRTC` : "Waiting for peers"
      }`;
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
        ["link", "image", "clean"],
      ],
    },
    placeholder: "Waiting for contract...",
    theme: "snow",
  });
  new QuillBinding(ytext, quill, awareness);
  return quill;
}

function attachEventListeners() {
  shareBtn.addEventListener("click", copyRoomLink);
  downloadBtn?.addEventListener("click", downloadCurrentDocument);
  uploadInput.addEventListener("change", handleUpload);
  applyBtn.addEventListener("click", () => {
    const text = instructionInput.value.trim();
    if (!state.apiKey) {
      openSettingsPanel();
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
    state.baseUrl = $("#base-url").value.trim() || DEFAULTS.baseUrl;
    state.model = $("#model-name").value.trim() || DEFAULTS.model;
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

    const message = prevSignature !== nextSignature
      ? "Settings saved. Reload the tab to reconnect using the new signaling servers."
      : "Settings saved";
    showToast(message);
  });

  $("#btn-reset-settings")?.addEventListener("click", () => {
    settingsPersistence?.clear?.();
    state.apiKey = "";
    state.baseUrl = DEFAULTS.baseUrl;
    state.model = DEFAULTS.model;
    state.signaling = [...DEFAULTS.signaling];
    settings.apiKey = "";
    settings.baseUrl = DEFAULTS.baseUrl;
    settings.model = DEFAULTS.model;
    settings.signaling = [...DEFAULTS.signaling];
    hydrateSettingsForm();
    persistSettings();
    updateAiModeBadge();
    showToast("Settings reset to defaults");
  });
}

function copyRoomLink() {
  const url = window.location.href;
  if (navigator.share) {
    navigator.share({ title: "ParallelEdit room", url })
      .then(() => showToast("Session link sent. Anyone with the link can join."))
      .catch(() => { });
    return;
  }
  navigator.clipboard.writeText(url)
    .then(() => showToast("Session link copied. Anyone with the link can join."))
    .catch(() => showToast("Unable to copy automatically. Share this URL so teammates can join.", true));
}

function downloadCurrentDocument() {
  if (!state.ytext) {
    showToast("Document not ready", true);
    return;
  }
  const text = state.ytext.toString();
  const doc = DOCUMENTS.find((d) => d.id === state.selectedDocId);
  const safeName = doc?.title
    ? doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "parallel-edit-doc";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName || "parallel-edit"}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast("Downloaded current draft");
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

  // Performance: Clear cursors before massive update to avoid recalculation overhead
  state.cursorModule?.clearCursors();

  state.ydoc.transact(() => {
    state.ytext.delete(0, state.ytext.length);
    state.ytext.insert(0, nextText);
  }, origin);
}

function loadTemplate(docId = state.selectedDocId) {
  const doc = DOCUMENTS.find((d) => d.id === docId) || DOCUMENTS[0];
  if (!doc) return;
  replaceDocumentText(doc.content, "template-load");
  showToast(`Template restored: ${doc.title}`);
  updateActivityLog(`Template restored: ${doc.title}`, "success");
}

function scrollEditorIntoView() {
  const anchor = document.querySelector(".editor-container");
  if (anchor) {
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function scrollDemoRailIntoView() {
  const target = document.querySelector(".demo-bar");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function updateAiModeBadge() {
  if (state.apiKey) {
    aiStatusEl.innerHTML = "<span class=\"ai-active-indicator\"></span> Live AI Mode";
  } else {
    aiStatusEl.innerHTML = "<span class=\"ai-mock-indicator\"></span> Setup Required";
  }
}

async function applyInstruction(instruction) {
  // Manual Global Override
  if (state.isAiTyping) return;
  state.isAiTyping = true;
  updateAgentCursor("global-ai", null); // Clear

  applyBtn.disabled = true;
  applyBtn.innerHTML = "<span class=\"spinner-border spinner-border-sm me-2\"></span>Streaming...";

  try {
    await orchestrateAndSpawn(instruction);
  } catch (error) {
    console.error(error);
    showToast(`AI error: ${error.message}`, true);
  } finally {
    state.isAiTyping = false;
    applyBtn.disabled = false;
    applyBtn.innerHTML = "<i class=\"bi bi-stars\"></i> Apply Instruction";
  }
}

async function runAgentAi(agentId, promptObj) {
  const agent = agentManager.agents.get(agentId);
  if (!agent) return;

  agentManager.updateAgentLog(agentId, "Reading document...");
  const instruction = promptObj.instruction;

  agentManager.updateAgentLog(agentId, "Querying LLM...");
  agentManager.updateAgentLog(agentId, "Querying LLM...");

  if (!state.apiKey) {
    agentManager.updateAgentLog(agentId, "Error: No API Key configured.");
    throw new Error("API Key missing");
  }

  await runLiveAiTask(
    agentId,
    agent.name,
    agent.color,
    instruction,
    (msg) => agentManager.updateAgentLog(agentId, msg),
    {
      reason: agent.prompt?.label || agent.prompt?.instruction?.slice(0, 80),
      section: agent.section,
      agentRole: agent.role,
      agentPurpose: agent.purpose,
    },
  );
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
          content:
            `You are a Lead Editor. Break the user's request into 1 to 3 distinct sub-tasks for different specialists. 
RETURN JSON: { "tasks": [{ "role": "string", "name": "string", "instruction": "string", "section_context": "string" }] }.
Example: Request "Fix headers and update dates" -> tasks: [{ "role": "Formatter", "instruction": "Fix headers", "section_context": "Header" }, { "role": "Clerk", "instruction": "Update dates", "section_context": "Dates" }]`,
        },
        { role: "user", content: instruction },
      ],
      response_format: { type: "json_object" },
    };

    const orchestratorBody = applyModelGuardrails(body, "orchestrator");

    const res = await fetch(`${state.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.apiKey}` },
      body: JSON.stringify(orchestratorBody),
    });

    const data = await res.json();
    const plan = JSON.parse(data.choices[0].message.content);

    if (plan.tasks && plan.tasks.length > 0) {
      // Spawn parallel agents
      plan.tasks.forEach((task, index) => {
        const agentColor = deriveAiColor(state.userColor || "#6366f1", 15 * (index + 1));
        const purpose = task.section_context
          ? `Focus: ${task.section_context} · ${task.role}`
          : task.role || "Specialist task";
        agentManager.spawnAgent(
          task.name || task.role || "Specialist",
          task.role || "Specialist",
          agentColor,
          {
            label: task.name || "Manual Task",
            instruction: task.instruction,
          },
          task.section_context || "General",
          `${purpose} - Requested by ${state.userName || "Host"}`,
        );
      });
      return;
    }
  } catch (e) {
    console.warn("Orchestration failed, falling back to single agent", e);
  }

  // 2. Fallback (Single Agent)
  const agentName = "Manual Override";
  const agentColor = state.aiColor || "#8b5cf6";
  const defaultRole = getAgentRoleForSection("general");

  agentManager.spawnAgent(agentName, "Manual Override", agentColor, {
    label: "Manual Instruction",
    instruction: instruction,
  }, "General", `${defaultRole.purpose} - Manual instruction from ${state.userName || "Host"}`);
}

async function runLiveAiTask(agentId, name, color, instruction, logFn, context = {}) {
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
                  replacement: { type: "string", description: "The new text to insert." },
                },
                required: ["match", "replacement"],
                additionalProperties: false,
              },
            },
          },
          required: ["operations"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          `You are ${name}, a helpful assistant.Return JSON: { operations: [{ match, replacement }] }. The 'match' text must exist exactly in the document.Do not hallucinate matches.`,
      },
      {
        role: "user",
        content: `Document: \n${currentText} \n\nInstruction: ${instruction} `,
      },
    ],
  };

  const requestBody = applyModelGuardrails(body, "live-task");

  const response = await fetch(`${state.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.apiKey}` },
    body: JSON.stringify(requestBody),
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
  } catch {
    if (logFn) logFn("Failed to parse JSON, trying diff...");
  }

  if (operations.length) {
    if (logFn) logFn(`Applying ${operations.length} edits...`);
    await applyOperations(operations, agentId, name, color, context);
  } else {
    // Fallback: if text returned, diff it
    if (typeof rawContent === "string" && rawContent.length > 5) {
      if (logFn) logFn("Applying smart diff...");
      await applySmartDiffV2(currentText, rawContent, agentId, name, color, context);
    } else {
      if (logFn) logFn("No edits returned.");
    }
  }
}

async function applyOperations(operations, agentId, name, color, context = {}) {
  const startVersion = state.docVersion;
  for (const op of operations) {
    if (state.docVersion !== startVersion) break;

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
      if (state.docVersion !== startVersion) break;
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

    if (replacement.length && state.docVersion === startVersion) {
      const highlightId = registerAgentHighlight(agentId, idx, replacement.length, {
        agentName: name,
        agentRole: context.agentRole,
        agentPurpose: context.agentPurpose,
        reason: context.reason || `Updated ${context.section || "document"}`,
        section: context.section || "Document",
        color,
      });
      if (highlightId) {
        updateActivityLog(
          `${name} updated ${context.section || "the document"}`,
          "success",
          { highlightId, agentId },
        );
      }
    }
  }
}

async function applySmartDiffV2(oldText, newText, agentId, name, color, context = {}) {
  const startVersion = state.docVersion;
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
        const chunkStart = startPos.index;
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
        if (chunk.length && state.docVersion === startVersion) {
          const highlightId = registerAgentHighlight(agentId, chunkStart, chunk.length, {
            agentName: name,
            agentRole: context.agentRole,
            agentPurpose: context.agentPurpose,
            reason: context.reason || `Updated ${context.section || "document"}`,
            section: context.section || "Document",
            color,
          });
          if (highlightId) {
            updateActivityLog(
              `${name} updated ${context.section || "the document"}`,
              "success",
              { highlightId, agentId },
            );
          }
        }
        headAnchor = instAnchor;
      }
    }
    if (state.docVersion !== startVersion) break;
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

  // Debounced refresh
  let timeout;
  const debouncedRefresh = () => {
    clearTimeout(timeout);
    timeout = setTimeout(refreshCursors, 100);
  };

  // 1. Observe Map Changes (Remote Updates)
  cursorsMap.observe((event) => {
    if (event.transaction.origin === "agent-cursor-sync") return;
    debouncedRefresh();
  });

  // 2. Observe Text Changes (Local & Remote)
  state.ytext.observe(() => {
    debouncedRefresh();
  });
}

function renderPresenceIndicators() {
  const container = document.getElementById("presence-indicators");
  if (!container || !state.awareness) return;
  const states = Array.from(state.awareness.getStates().entries());
  if (!states.length) {
    container.innerHTML = `<span class="text-muted small">Waiting for collaborators...</span>`;
    return;
  }

  const chips = states.map(([clientId, data]) => {
    const user = data?.user || {};
    const isSelf = state.ydoc && clientId === state.ydoc.clientID;
    const label = isSelf ? "You" : (user.name || user.alias || `User ${clientId}`);
    const color = user.color || "#38bdf8";
    return `<span class="presence-pill" style="--presence-color:${color};">${escapeHtml(label)}</span>`;
  });
  container.innerHTML = chips.join("");
}

function setupHighlightStore() {
  if (!state.ydoc) return;
  const store = state.ydoc.getMap("agent-highlights");
  state.highlightStore = store;
  state.highlights = new Map();

  store.forEach((value, key) => {
    const normalized = normalizeHighlightPayload(value);
    if (normalized) {
      state.highlights.set(key, normalized);
    }
  });

  store.observe((event) => {
    event.keysChanged.forEach((key) => {
      if (store.has(key)) {
        const normalized = normalizeHighlightPayload(store.get(key));
        if (normalized) {
          state.highlights.set(key, normalized);
        }
      } else {
        state.highlights.delete(key);
      }
    });
  });

  renderExplainPanel();
}

function registerAgentHighlight(agentId, start, length, meta = {}) {
  if (!state.quill || !state.ytext || length <= 0) return null;
  if (!state.highlightStore && state.ydoc) {
    state.highlightStore = state.ydoc.getMap("agent-highlights");
  }
  try {
    const relPos = Y.createRelativePositionFromTypeIndex(state.ytext, start);
    const encoded = Array.from(Y.encodeRelativePosition(relPos));
    const highlightId = `hl-${agentId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const snippet = state.ytext.toString().slice(start, start + length).trim();
    const highlightData = {
      id: highlightId,
      agentId,
      agentName: meta.agentName || "AI Agent",
      agentRole: meta.agentRole || "",
      agentPurpose: meta.agentPurpose || "",
      reason: meta.reason || "Edited document",
      section: meta.section || "Document",
      color: meta.color || "#fde047",
      relPos: encoded,
      length,
      snippet,
      createdAt: Date.now(),
    };

    const blotPayload = JSON.stringify({ id: highlightId, color: highlightData.color });
    state.quill.formatText(start, length, "agent-highlight", blotPayload, "api");

    persistHighlight(highlightData);
    return highlightId;
  } catch (error) {
    console.warn("Failed to register highlight", error);
    return null;
  }
}

function persistHighlight(highlightData) {
  state.highlights.set(highlightData.id, highlightData);
  if (!state.highlightStore) return;
  state.ydoc.transact(() => {
    state.highlightStore.set(highlightData.id, highlightData);
  }, "agent-highlight-store");
}

function normalizeHighlightPayload(value) {
  if (!value) return null;
  const base = typeof value.toJSON === "function" ? value.toJSON() : { ...value };
  if (Array.isArray(base.relPos)) {
    base.relPos = base.relPos.slice();
  } else if (base.relPos && typeof base.relPos.length === "number") {
    base.relPos = Array.from(base.relPos);
  } else {
    base.relPos = [];
  }
  return base;
}

function focusHighlightById(highlightId, options = {}) {
  if (!highlightId || !state.highlights.has(highlightId)) {
    showToast("This edit can no longer be located.", true);
    return null;
  }
  const data = state.highlights.get(highlightId);
  try {
    if (!data.relPos) {
      showToast("Missing cursor data for this edit.", true);
      return null;
    }
    const compiled = new Uint8Array(data.relPos);
    const relPos = Y.decodeRelativePosition(compiled);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, state.ydoc);
    if (!absPos) {
      showToast("That edit was removed from the draft.", true);
      state.highlightStore?.delete(highlightId);
      state.highlights.delete(highlightId);
      return null;
    }
    const targetIndex = absPos.index;
    state.quill.setSelection(targetIndex, data.length, "api");
    scrollIndexIntoView(targetIndex);
    if (options.flash !== false) {
      flashHighlightDom(highlightId);
    }
    if (!options.skipPanel) {
      renderExplainPanel({ highlight: data });
    }
    return data;
  } catch (error) {
    console.warn("Unable to focus highlight", error);
    return null;
  }
}

function scrollIndexIntoView(index) {
  const bounds = state.quill?.getBounds(index, 1);
  const editor = document.querySelector(".ql-editor");
  if (!bounds || !editor) return;
  const target = bounds.top + editor.scrollTop - editor.clientHeight / 4;
  editor.scrollTo({ top: Math.max(target, 0), behavior: "smooth" });
}

function flashHighlightDom(highlightId) {
  const nodes = state.quill?.root?.querySelectorAll(`mark.agent-highlight[data-agent-highlight-id="${highlightId}"]`);
  nodes?.forEach((node) => {
    node.classList.add("agent-highlight--pulse");
    setTimeout(() => node.classList.remove("agent-highlight--pulse"), 1200);
  });
}

function renderExplainPanel(config = null) {
  const panel = document.getElementById("explain-panel");
  if (!panel) return;
  const safe = (value) => escapeHtml(value || "");

  if (!config) {
    panel.innerHTML = `
      <div class="text-muted small">
        Click a highlighted passage or agent card to see what changed.
      </div>`;
    panel.dataset.mode = "empty";
    return;
  }

  if (Array.isArray(config.highlights)) {
    if (!config.highlights.length) {
      panel.innerHTML = `
        <div class="small text-uppercase text-secondary fw-semibold mb-1">Agent</div>
        <div class="fw-bold">${safe(config.title)}</div>
        <div class="text-muted small mb-2">${safe(config.subtitle)}</div>
        <div class="text-muted small">${safe(config.description || "No tracked edits yet.")}</div>`;
      panel.dataset.mode = "agent";
      return;
    }

    const entries = config.highlights.slice(0, 4).map((item, idx) => `
      <button class="btn btn-link p-0 d-block text-start small highlight-jump" data-highlight-jump="${item.id}">
        <span class="fw-semibold me-2">Edit ${idx + 1}</span>
        <span class="text-muted">${safe(item.section || "Document")}</span>
      </button>`).join("");
    panel.innerHTML = `
      <div class="small text-uppercase text-secondary fw-semibold mb-1">Agent</div>
      <div class="fw-bold">${safe(config.title)}</div>
      <div class="text-muted small mb-2">${safe(config.subtitle)}</div>
      <div class="mb-2">${safe(config.description || "Select an edit below.")}</div>
      <div class="d-flex flex-column gap-1">${entries}</div>
      ${config.highlights.length > 4
        ? `<div class="text-muted small mt-2">${config.highlights.length - 4}+ more edits</div>`
        : ""}`;
    panel.dataset.mode = "agent";
    return;
  }

  if (config.highlight) {
    const { highlight } = config;
    panel.innerHTML = `
      <div class="d-flex align-items-center justify-content-between mb-1">
        <div>
          <div class="small text-uppercase text-secondary fw-semibold">Agent</div>
          <div class="fw-bold">${safe(highlight.agentName)}</div>
        </div>
        <span class="badge" style="background-color:${highlight.color || "#94a3b8"}20;color:${highlight.color || "#475569"}">
          ${safe(highlight.section)}
        </span>
      </div>
      <div class="small text-muted mb-2">${safe(highlight.reason)}</div>
      <div class="agent-highlight-snippet">${safe(highlight.snippet || "Edited text")}</div>
      <button class="btn btn-outline-secondary btn-sm mt-2 highlight-jump" data-highlight-jump="${highlight.id}">
        Scroll to edit
      </button>
    `;
    panel.dataset.mode = "highlight";
  }
}

function attachExplainabilityListeners() {
  const editorRoot = document.querySelector(".ql-editor");
  if (editorRoot) {
    editorRoot.addEventListener("click", (event) => {
      const highlightEl = event.target.closest("mark.agent-highlight");
      if (highlightEl?.dataset.agentHighlightId) {
        focusHighlightById(highlightEl.dataset.agentHighlightId);
      }
    });
  }

  const logContainer = document.getElementById("activity-log");
  if (logContainer) {
    logContainer.addEventListener("click", (event) => {
      const link = event.target.closest(".activity-log-link");
      if (link?.dataset.highlightId) {
        focusHighlightById(link.dataset.highlightId);
      }
    });
  }

  const agentsContainer = document.getElementById("agents-container");
  if (agentsContainer) {
    agentsContainer.addEventListener("click", (event) => {
      const card = event.target.closest("[data-agent-card]");
      if (!card) return;
      handleAgentCardInspect(card.dataset.agentCard);
    });
  }

  const explainPanel = document.getElementById("explain-panel");
  if (explainPanel) {
    explainPanel.addEventListener("click", (event) => {
      const trigger = event.target.closest(".highlight-jump");
      if (trigger?.dataset.highlightJump) {
        focusHighlightById(trigger.dataset.highlightJump);
      }
    });
  }
}

function handleAgentCardInspect(agentId) {
  if (!agentId) return;
  const agent = agentManager.agents.get(agentId);
  if (!agent) return;

  const highlights = Array.from(state.highlights.values())
    .filter((hl) => hl.agentId === agentId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!highlights.length) {
    renderExplainPanel({
      title: agent.name,
      subtitle: agent.purpose || agent.role,
      description: "No tracked edits yet. Run or wait for this agent to finish.",
      highlights: [],
    });
    return;
  }

  renderExplainPanel({
    title: agent.name,
    subtitle: agent.purpose || agent.role,
    description: agent.prompt?.label || agent.prompt?.instruction || "Agent edits",
    highlights,
  });
  focusHighlightById(highlights[0].id, { skipPanel: true });
}

function applyModelGuardrails(payload, contextLabel = "request") {
  const modelName = state.model || "";
  if (!modelName) return payload;
  const guard = MODEL_GUARDRAILS.find((entry) => entry.matcher.test(modelName));
  if (!guard) return payload;

  const sanitized = { ...payload };
  const removed = [];
  (guard.blockedParams || []).forEach((param) => {
    if (param in sanitized) {
      delete sanitized[param];
      removed.push(param);
    }
  });

  if (removed.length) {
    const warningKey = `${guard.message}-${contextLabel}`;
    if (!MODEL_WARNINGS_SEEN.has(warningKey)) {
      MODEL_WARNINGS_SEEN.add(warningKey);
      const message = `${guard.message}. Removed: ${removed.join(", ")}.`;
      showToast(message, false);
      updateActivityLog(`${message} (${contextLabel})`, "warning");
    }
  }

  return sanitized;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
