// server.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads dir exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// SQLite setup
const db = new sqlite3.Database(path.join(__dirname, "data.sqlite"));
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      originalname TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY(dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    )
  `);
});

// Multer setup
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".xlsx", ".xls"].includes(ext)) cb(null, true);
    else cb(new Error("Only .xlsx or .xls files are allowed"));
  },
});

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Upload and parse Excel, save to SQLite
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const originalname = req.file.originalname;
  const filename = path.basename(filePath);

  try {
    const wb = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    db.serialize(() => {
      db.run(
        `INSERT INTO datasets (filename, originalname, uploaded_at) VALUES (?, ?, ?)`,
        [filename, originalname, new Date().toISOString()],
        function (err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Failed to save dataset" });
          }
          const datasetId = this.lastID;

          const stmt = db.prepare(`INSERT INTO rows (dataset_id, data) VALUES (?, ?)`);
          rows.forEach((r) => stmt.run(datasetId, JSON.stringify(r)));
          stmt.finalize((finalizeErr) => {
            if (finalizeErr) {
              console.error(finalizeErr);
              return res.status(500).json({ error: "Failed to save rows" });
            }
            res.json({
              message: "Upload successful",
              dataset_id: datasetId,
              rows_saved: rows.length,
              sheet_name: sheetName,
            });
          });
        }
      );
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to parse Excel" });
  }
});

// List datasets
app.get("/datasets", (req, res) => {
  db.all(`SELECT id, originalname, uploaded_at FROM datasets ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch datasets" });
    res.json(rows);
  });
});

// Get rows for a dataset
app.get("/rows", (req, res) => {
  const datasetId = parseInt(req.query.dataset_id, 10);
  if (!datasetId) return res.status(400).json({ error: "dataset_id is required" });

  db.all(`SELECT id, data FROM rows WHERE dataset_id = ?`, [datasetId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch rows" });
    const parsed = rows.map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
    res.json(parsed);
  });
});

// Delete a dataset (optional cleanup)
app.delete("/datasets/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  db.get(`SELECT filename FROM datasets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!row) return res.status(404).json({ error: "Not found" });

    db.run(`DELETE FROM datasets WHERE id = ?`, [id], (delErr) => {
      if (delErr) return res.status(500).json({ error: "Failed to delete dataset" });
      const filePath = path.join(uploadDir, row.filename);
      fs.existsSync(filePath) && fs.unlinkSync(filePath);
      res.json({ message: "Deleted dataset and file" });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});