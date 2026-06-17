# EMBER — Fire Sprinkler Hydraulic Calculator (standalone)
### DGA Consulting

A self-contained build of EMBER that runs on your own machine or server, with no
dependency on the Claude.ai runtime. It includes:

- the full EMBER frontend (Hazen-Williams nodal solver, gridded loops, US/metric,
  CMDA/CMSA/ESFR, density/area auto-calc, pump & hydrant supply records);
- a **parametric Sizer** that lays out the whole system (branch lines × heads,
  branch/line spacing) and auto-selects the most-remote operating area from a
  selectable NFPA remote-area factor (1.0 / 1.2 / 1.4), highlighting it on the
  editable plan view;
- **PDF export in two styles**, chosen from the dropdown next to *Export PDF*:
  - **NFPA worksheet** — the AHJ-standard HydraCALC-style report: title page,
    N^1.85 water-supply/demand curve, the node-to-node *Final Calculations:
    Hazen-Williams* worksheet, *Flow Summary* (supply + node analysis), and the
    fittings legend;
  - **Branded report** — a modern letterhead summary with the plan-view drawing;
- a small **AI proxy** so the "AI review" tab works while keeping your Anthropic
  API key on the server (never exposed to the browser);
- an on-disk **persistence layer** so Save / Load stores projects as files you own.

The same `src/App.jsx` is the component used inside Claude.ai — it auto-detects which
environment it's in, so you can keep both in sync.

---

## 1. Prerequisites

- **Node.js 18 or newer** (`node -v` to check). The server uses the built-in `fetch`.
- An **Anthropic API key** (only needed for the AI review tab). Get one at
  https://console.anthropic.com.

## 2. Install

```bash
cd ember-standalone
npm install
```

## 3. Add your API key

```bash
cp .env.example .env
```

Open `.env` and paste your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The key is read only by `server.js`. It is never bundled into the frontend.

## 4a. Run for development (hot reload)

```bash
npm run dev
```

- UI on **http://localhost:5173** (auto-reloads as you edit)
- API on **http://localhost:8787** (Vite forwards `/api` to it)

## 4b. Run as a production app (single server)

```bash
npm run serve      # builds the UI, then starts the server
```

Then open **http://localhost:8787**. The Express server serves the built UI and
the API from the same origin. (You can also run `npm run build` once and then
`npm start` on subsequent launches.)

---

## Where your data lives

Saved projects are written to **`./data/`**, one `<project-name>.json` file each.
That folder *is* the database — back it up by copying it, or commit it to a private
git repo. To start fresh, delete the files inside `data/`.

To move to a heavier datastore later (SQLite, Postgres), replace the four file
helpers in `server.js` (`/api/projects` routes) — the frontend contract won't change.

## What works offline vs. online

- **Hydraulics, schematic, results, Save/Load** — fully local, no internet needed.
- **AI review** — needs internet + a valid API key (it calls Anthropic via the proxy).
- **PDF export** (both the NFPA worksheet and the branded report) — loads the
  jsPDF library from a CDN at click time, so it needs internet on first use. For
  a fully air-gapped setup, self-host jsPDF and jspdf-autotable and point
  `ensurePdfLibs()` in `App.jsx` at the local copies.

## Security notes (read before exposing it beyond your machine)

- The server has **no authentication**. That's fine on `localhost` or a trusted LAN.
  Before putting it on the public internet, add auth (a reverse proxy with basic
  auth, an SSO layer, or an app-level check) so the AI proxy and project store
  aren't open to anyone.
- Keep `.env` out of version control (it's already in `.gitignore`).
- Consider rate-limiting `/api/chat` if multiple people will use it, to control
  API spend.

## Project layout

```
ember-standalone/
  server.js          Express: AI proxy + projects API + serves the built UI
  vite.config.js     Dev server + /api proxy
  index.html         Sets window.__EMBER_API_BASE__ = "/api" (standalone mode)
  .env.example       Copy to .env and add your key
  src/
    main.jsx         React mount
    App.jsx          The EMBER component (same file used in Claude.ai)
  data/              Saved projects (one JSON per project)
```
