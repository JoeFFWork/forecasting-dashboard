const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'forecasting.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Database connected');
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS collection_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    commodity TEXT NOT NULL,
    store TEXT,
    avg_mt_week REAL,
    basis TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS incoming_vessels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vessel_name TEXT NOT NULL,
    commodity TEXT NOT NULL,
    batch_id TEXT,
    origin TEXT,
    mt REAL,
    expected_week INTEGER,
    status TEXT,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS file_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'processed'
  )`);
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/kpis', (req, res) => {
  db.all(`SELECT * FROM incoming_vessels WHERE expected_week BETWEEN 1 AND 4`, (err, vessels) => {
    if (err) return res.json({ currentStock: 0, incomingMT: 0, weeklyCollections: 0, weekToStockout: 0 });
    const incomingMT = vessels.reduce((sum, v) => sum + (v.mt || 0), 0);
    res.json({
      currentStock: 1500,
      incomingMT: incomingMT,
      weeklyCollections: 290,
      weekToStockout: 5,
      recentUploads: 0
    });
  });
});

app.get('/api/uploads-history', (req, res) => {
  db.all(`SELECT * FROM file_uploads ORDER BY upload_date DESC LIMIT 50`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/incoming-vessels', (req, res) => {
  db.all(`SELECT * FROM incoming_vessels ORDER BY expected_week ASC`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/collection-patterns', (req, res) => {
  db.all(`SELECT * FROM collection_patterns ORDER BY customer_name`, (err, rows) => {
    if (err) {
      console.error('Error fetching patterns:', err);
      return res.json([]);
    }
    res.json(rows || []);
  });
});

app.post('/api/collection-patterns', (req, res) => {
  const { customer_name, commodity, store, avg_mt_week, basis } = req.body;
  
  if (!customer_name || !commodity || !avg_mt_week) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    `INSERT INTO collection_patterns (customer_name, commodity, store, avg_mt_week, basis) 
     VALUES (?, ?, ?, ?, ?)`,
    [customer_name, commodity, store || 'All', avg_mt_week, basis || 'Observed'],
    function(err) {
      if (err) {
        console.error('Error saving pattern:', err);
        return res.status(500).json({ error: 'Failed to save pattern', details: err.message });
      }
      res.json({ success: true, message: 'Collection pattern saved', id: this.lastID });
    }
  );
});

app.post('/api/upload', (req, res) => {
  const { fileType } = req.body;
  db.run(
    `INSERT INTO file_uploads (filename, file_type) VALUES (?, ?)`,
    ['uploaded-file', fileType],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Upload failed' });
      }
      res.json({ success: true, message: 'File uploaded successfully' });
    }
  );
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});  
