/* ============================================================
   EMBER — standalone backend  ·  DGA Consulting
   - POST /api/chat            → server-side Anthropic proxy (key never leaves the server)
   - GET/PUT/DELETE /api/projects[/:name] → on-disk project persistence
   - serves the built React frontend from /dist
   Node 18+ required (uses global fetch).
   ============================================================ */
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

const app = express();
app.use(express.json({ limit: "5mb" }));

/* ---------- persistence: one JSON file per project under /data ----------
   Simple, robust, zero native dependencies, and trivially backed up
   (the /data folder is the entire database — copy it or commit it).
   Upgrade path: swap these four helpers for SQLite/Postgres later. */
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const safeName = (n) => String(n).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "untitled";
const fileFor = (n) => path.join(DATA_DIR, safeName(n) + ".json");

function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // atomic on the same filesystem — avoids partial writes
}

/* ---------- AI proxy ---------- */
app.post("/api/chat", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart." });
  try {
    const body = { ...req.body, model: req.body?.model || MODEL };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();          // pass Anthropic's response straight through
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Proxy request failed: " + (e.message || String(e)) });
  }
});

/* ---------- projects ---------- */
app.get("/api/projects", (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f.replace(/\.json$/, ""), mtime: fs.statSync(path.join(DATA_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.name);
    res.json({ keys: files });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get("/api/projects/:name", (req, res) => {
  const file = fileFor(req.params.name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    res.json({ value: stored.value });   // {value:<stringified project>}
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.put("/api/projects/:name", (req, res) => {
  try {
    const value = typeof req.body?.value === "string" ? req.body.value : JSON.stringify(req.body?.value ?? req.body ?? {});
    writeAtomic(fileFor(req.params.name), JSON.stringify({ value, updatedAt: Date.now() }));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.delete("/api/projects/:name", (req, res) => {
  try {
    const file = fileFor(req.params.name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

/* ---------- serve built frontend ---------- */
const DIST = path.join(__dirname, "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (req, res) => res.sendFile(path.join(DIST, "index.html")));
} else {
  app.get("/", (req, res) =>
    res.send("<pre>Frontend not built yet. Run:  npm run build   then restart, or use  npm run dev  for development.</pre>"));
}

app.listen(PORT, () => {
  console.log(`\nEMBER  ·  DGA Consulting`);
  console.log(`  running at  http://localhost:${PORT}`);
  console.log(`  AI proxy    ${API_KEY ? "ready" : "DISABLED (set ANTHROPIC_API_KEY in .env)"}`);
  console.log(`  projects    ${DATA_DIR}\n`);
});
