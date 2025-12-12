# Parallel Editing Agent Demo

ParallelEdit is a pure front-end playground where humans and sandboxed AI agents co-edit long-form documents without stepping on each other. Pick a curated card, invite a collaborator via the room URL, and watch multiple agent cursors stream live as they tackle different sections. Every UI control is wired for demos: hovers explain intent, buttons disable while jobs run, and the draft can be downloaded in one click.

The experience is entirely config-driven. `config.js` lists the hero screenshot, sample datasets, the room URL param, and the four long-form templates with their agent-ready prompts. `data/sample-documents.json` mirrors that content in JSON so you can diff or remix it offline. Settings live in a collapsible panel that persists via [`saveform`](https://www.npmjs.com/package/saveform), so API keys and signaling relays survive refreshes but can be reset instantly.

![Demo Screenshot](screenshot.webp)

## Run It Locally

1. Serve the folder (or just open `index.html`) in any modern browser.
2. The app will provision a unique `room` query param automatically; share the link for instant Yjs/WebRTC sync.
3. Configure an API key, base URL, model, and signaling relays from the collapsible **LLM & Sync Settings** panel. Values fall back to `config.js` defaults and persist via saveform.

## Demo Workflow

- **Pick a card**: The "Demo Docs" rail is generated from `APP_CONFIG.demoCards`, so updating `config.js` instantly changes the one-click scenarios.
- **Load prompts**: Selecting a card instantly re-renders the prompt bar via `lit-html` and broadcasts the choice to every peer through Yjs—no extra URL parameters required.
- **Spawn agents**: Prompt pills ensure API credentials exist, then stream progress into the Agent Manager without altering the underlying functionality.
- **Download output**: Use the `Download` button for a TXT export of whatever the room co-authored.

## Sample Data

Lightweight datasets (<12 KB) sit in `data/` and are rendered as download pills under the cards rail. They provide synthetic metadata for the included contracts, policies, proposals, and GTM plans so you can seed your own demos or power external tooling.

## Configuration & Persistence

- `config.js` centralizes defaults (`baseUrl`, `model`, WebRTC relays, room param name) plus the card metadata and templates.
- The collapsible settings form uses `saveform` with `dropEmpty` enabled, so clearing a field reverts to defaults. Use the **Reset** button to wipe the cache and fall back to the config baseline.
- All user-facing state is deep-linkable: the `room=` query param selects the collaboration session, and the selected document travels through Yjs state so collaborators always load what the host is viewing.

## License

MIT
