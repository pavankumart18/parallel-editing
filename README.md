# ParallelEdit – AI + Human contract demo

This is a pure front-end demo that mirrors the WebRTC/Yjs setup from [Ritesh17rb/parallel-editing](https://github.com/Ritesh17rb/parallel-editing) but keeps the original ParallelEdit UI. It follows the [agents/demos guidelines](https://github.com/sanand0/scripts/tree/live/agents/demos): self-serve, upload-friendly, demo cards, settings form, and a concise README that explains how to run it.

## Features

- **Real-time collaboration** – Yjs + y-webrtc keep every open tab in sync. Room IDs are encoded in the URL, so sharing a room is as easy as copying the link.
- **Upload & template** – Drop in your own `.txt/.md/.doc/.pdf` files or reload the sample employment contract.
- **AI co-pilot** – Enter instructions in the sidebar. Without a key, a mock AI manipulates placeholders; add an API key (Settings) to stream live completions via any OpenAI-compatible `/chat/completions` endpoint.
- **History & dataset** – The change history list shows recent edits, and a synthetic dataset (≤5 MB) keeps the demo self-contained for one-click run-throughs.
- **Configurable relays** – If your network blocks the public signaling servers you can point the app at your own WebRTC/WebSocket relays directly from the Settings modal.

## Running locally

```bash
python -m http.server 8080
# open http://localhost:8080/?room=demo
```

Open the same `?room=` link in a second browser window (or incognito tab) to see multi-user editing in action. Use the **Share** button to copy the exact URL.

## Mock vs live AI

| Mode | How to use | Example |
|------|------------|---------|
| Mock | Leave API key blank | “Add remote work clause”, “Update salary” |
| Live | Open **Settings**, enter API key / base URL / model | “Rewrite the confidentiality clause to be mutual” |

All live completions are diffed against the current Y.Text using `fast-diff`, so only the changed ranges stream into the shared document.

## Troubleshooting

- **“Waiting for peers”** – the default signalers (`signaling.yjs.dev`, etc.) may be blocked. Open **Settings → Signaling servers** and paste URLs for relays you control (e.g., `ws://localhost:4444` when running `npx y-webrtc-signaling-server --port 4444`).
- **File uploads look odd** – browsers cannot parse DOC/DOCX/PDF structures natively; the demo reads the raw text stream. Prefer `.txt` or `.md` for best fidelity.
- **History is empty** – the change log only tracks edits that happened in the current session. Reloading clears the in-memory log.

## License

MIT. Feel free to fork, remix, and deploy anywhere (GitHub Pages, Netlify, S3, …).

