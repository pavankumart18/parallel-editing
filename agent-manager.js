export class AgentManager {
  constructor(containerId, countId) {
    this.agents = new Map();
    this.container = document.getElementById(containerId);
    this.countBadge = document.getElementById(countId);
    this.onTaskStart = null; // Callback assigned by main script
  }

  /**
   * Spawns a new agent with a specific role/task
   */
  spawnAgent(name, role, color, prompt, section, purpose = "") {
    const id = `agent-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const agent = {
      id,
      name,
      role,
      color,
      purpose,
      prompt,
      section,
      status: "idle", // idle, working, done, error
      logs: [],
      progress: 5,
    };
    this.agents.set(id, agent);
    this.render();

    // Auto-start
    this.startAgentTask(id);
    return id;
  }

  startAgentTask(id) {
    const agent = this.agents.get(id);
    if (!agent) return;

    agent.status = "working";
    agent.progress = 25;
    agent.logs.push(`Started task: ${agent.prompt.label}`);
    this.renderAgent(agent);

    if (this.onTaskStart) {
      this.onTaskStart(agent.id, agent.prompt)
        .then(() => {
          agent.status = "done";
          agent.logs.push("Task completed successfully.");
          agent.progress = 100;
          this.renderAgent(agent);
        })
        .catch((err) => {
          agent.status = "error";
          agent.logs.push(`Error: ${err.message}`);
          agent.progress = 100;
          this.renderAgent(agent);
          // Show global toast for visibility
          // Using a global function if available
          if (window.showToast) window.showToast(`Agent Error: ${err.message}`, true);
        });
    }
  }

  updateAgentLog(id, message) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.logs.push(message);
      if (agent.status === "working") {
        agent.progress = Math.min(95, agent.progress + 5);
        this.updateProgressVisual(agent);
      }
      // Only re-render if visible or optimize
      const logEl = document.getElementById(`log-${id}`);
      if (logEl) {
        const entry = document.createElement("div");
        entry.className = "text-truncate";
        entry.textContent = `> ${message}`;
        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
  }

  render() {
    if (this.agents.size === 0) {
      this.container.innerHTML = `
                <div class="text-center text-muted mt-4 small">
                    <i class="bi bi-robot fs-3 d-block mb-2 opacity-50"></i>
                    No active agents.<br>Select a prompt above to spawn.
                </div>`;
      this.countBadge.textContent = "0";
      return;
    }

    // We re-render the list (simple approach for now)
    // Optimization: ideally diff the DOM, but for < 10 agents this is fine.
    // We preserve scroll position or content if possible.
    // Actually, full re-render is jarring for logs.
    // I will only append new ones or update existing DOM nodes.

    this.countBadge.textContent = this.agents.size;

    this.agents.forEach(agent => {
      let el = document.getElementById(`card-${agent.id}`);
      if (!el) {
        el = document.createElement("div");
        el.id = `card-${agent.id}`;
        el.className = "card mb-2 shadow-sm border-0";
        el.innerHTML = this.getAgentTemplate(agent);
        // DESCENDING ORDER: Newest first
        this.container.prepend(el);
        this.updateProgressVisual(agent);
      } else {
        // Update status only
        const statusEl = el.querySelector(".agent-status-badge");
        if (statusEl) statusEl.innerHTML = this.getStatusHtml(agent.status);
        this.updateProgressVisual(agent);
      }
    });
  }

  renderAgent(agent) {
    // Force update of specific agent card
    const el = document.getElementById(`card-${agent.id}`);
    if (el) {
      el.innerHTML = this.getAgentTemplate(agent);
      this.updateProgressVisual(agent);
    }
  }

  getAgentTemplate(agent) {
    const borderStyle = `border-left: 3px solid ${agent.color} !important;`;
    const purpose = agent.purpose || agent.prompt?.label || agent.role;
    const targetLabel = agent.section || "Document";
    const taskLabel = agent.prompt?.label || "Ad-hoc edit";
    return `
            <div class="card-body p-2" style="${borderStyle}" data-agent-card="${agent.id}">
                <div class="d-flex justify-content-between align-items-start mb-1 gap-2">
                    <div>
                        <div class="fw-bold" style="color:${agent.color}; font-size: 0.8rem;">${this.escape(agent.name)}</div>
                        <div class="text-muted" style="font-size: 0.7rem;">${this.escape(agent.role)}</div>
                    </div>
                    <div class="agent-status-badge scale-90 text-nowrap" style="transform-origin: right center;">${this.getStatusHtml(agent.status)}</div>
                </div>
                <div class="text-muted small mb-2">${this.escape(purpose)}</div>
                <div class="d-flex justify-content-between align-items-center text-muted" style="font-size: 0.65rem;">
                    <span><i class="bi bi-crosshair me-1"></i>${this.escape(targetLabel)}</span>
                    <span><i class="bi bi-lightning me-1"></i>${this.escape(taskLabel)}</span>
                </div>
                <div class="progress progress-thin my-2" style="height: 4px;">
                    <div class="progress-bar" id="progress-${agent.id}" role="progressbar" style="width: ${agent.progress}%"></div>
                </div>
                <div class="bg-dark text-success p-1 rounded font-monospace" 
                     id="log-${agent.id}" 
                     style="height: 50px; overflow-y: auto; font-size: 0.65rem; line-height: 1.3;">
                    ${agent.logs.map(l => `<div class="text-truncate">> ${this.escape(l)}</div>`).join("")}
                </div>
            </div>
        `;
  }

  getStatusHtml(status) {
    switch (status) {
      case "working":
        return `<span class="badge bg-warning text-dark"><span class="spinner-grow spinner-grow-sm me-1" style="width:6px;height:6px"></span>Running</span>`;
      case "done":
        return `<span class="badge bg-success">Completed</span>`;
      case "error":
        return `<span class="badge bg-danger">Failed</span>`;
      default:
        return `<span class="badge bg-secondary">Idle</span>`;
    }
  }

  updateProgressVisual(agent) {
    const bar = document.getElementById(`progress-${agent.id}`);
    if (!bar) return;
    bar.style.width = `${agent.progress}%`;
    bar.className = "progress-bar";
    if (agent.status === "working") {
      bar.classList.add("bg-info", "progress-bar-striped", "progress-bar-animated");
    } else if (agent.status === "done") {
      bar.classList.add("bg-success");
    } else if (agent.status === "error") {
      bar.classList.add("bg-danger");
    } else {
      bar.classList.add("bg-secondary");
    }
  }

  escape(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
