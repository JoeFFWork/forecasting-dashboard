const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// File upload setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDir); },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${timestamp}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Database
const dbPath = path.join(__dirname, 'forecasting.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    batch_id TEXT,
    store TEXT,
    commodity TEXT,
    tonnage REAL,
    origin TEXT,
    vessel TEXT,
    spec TEXT,
    status TEXT DEFAULT 'in_stock',
    date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_removed DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS collection_patterns (
    id INTEGER PRIMARY KEY,
    customer_name TEXT,
    commodity TEXT,
    store TEXT,
    avg_mt_week REAL,
    basis TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS file_uploads (
    id INTEGER PRIMARY KEY,
    filename TEXT,
    file_type TEXT,
    batches_imported INTEGER DEFAULT 0,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'processed'
  )`);
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/batches', (req, res) => {
  const { store, commodity, status } = req.query;
  let query = 'SELECT * FROM batches WHERE 1=1';
  const params = [];
  
  if (store) { query += ' AND store = ?'; params.push(store); }
  if (commodity) { query += ' AND commodity = ?'; params.push(commodity); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  else { query += " AND status = 'in_stock'"; }
  
  query += ' ORDER BY date_added DESC';
  
  db.all(query, params, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/current-stock', (req, res) => {
  db.all(`SELECT store, commodity, SUM(tonnage) as total_mt, COUNT(*) as batch_count
    FROM batches WHERE status = 'in_stock'
    GROUP BY store, commodity ORDER BY store, commodity`, (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/batches', (req, res) => {
  const { batch_id, store, commodity, tonnage, origin, vessel, spec } = req.body;
  
  db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
    [batch_id, store, commodity, parseFloat(tonnage), origin || '', vessel || '', spec || ''],
    function(err) {
      res.json({ success: true, message: 'Batch added' });
    }
  );
});

app.put('/api/batches/:id/remove', (req, res) => {
  db.run(`UPDATE batches SET status = 'out', date_removed = CURRENT_TIMESTAMP WHERE id = ?`,
    [req.params.id], function(err) {
      res.json({ success: true, message: 'Batch marked out' });
    }
  );
});

app.delete('/api/batches/:id', (req, res) => {
  db.run(`DELETE FROM batches WHERE id = ?`, [req.params.id], function(err) {
    res.json({ success: true, message: 'Batch deleted' });
  });
});

app.post('/api/upload-stock', upload.single('file'), (req, res) => {
  try {
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    
    let batchesImported = 0;
    const storeSheets = ['This Week Kenyon', 'NP This Week', 'This Week AV', 'This Week GA'];
    const storeMap = {
      'This Week Kenyon': 'Kenyon',
      'NP This Week': 'Newport',
      'This Week AV': 'Avonmouth',
      'This Week GA': 'Garston'
    };

    storeSheets.forEach(sheetName => {
      if (!workbook.SheetNames.includes(sheetName)) return;
      
      const ws = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws);
      const store = storeMap[sheetName];

      data.forEach(row => {
        if (!row.Batch || !row.Balance) return;

        db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [String(row.Batch), store, row.Commodity || '', parseFloat(row.Balance) || 0, 
           row.Origin || '', row.Vessel || '', row.Spec || ''],
          function(err) {
            if (!err) batchesImported++;
          }
        );
      });
    });

    setTimeout(() => {
      db.run(`INSERT INTO file_uploads (filename, file_type, batches_imported) VALUES (?, ?, ?)`,
        [req.file.filename, 'stock_sheet', batchesImported],
        function(err) {
          res.json({ success: true, message: `${batchesImported} batches imported`, batches_imported: batchesImported });
        }
      );
    }, 1000);

  } catch (error) {
    res.status(500).json({ error: 'File processing failed', details: error.message });
  }
});

app.get('/api/collection-patterns', (req, res) => {
  db.all(`SELECT * FROM collection_patterns ORDER BY customer_name`, (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/collection-patterns', (req, res) => {
  const { customer_name, commodity, store, avg_mt_week, basis } = req.body;
  
  db.run(`INSERT INTO collection_patterns (customer_name, commodity, store, avg_mt_week, basis)
    VALUES (?, ?, ?, ?, ?)`,
    [customer_name, commodity, store || 'All', avg_mt_week, basis || 'Observed'],
    function(err) {
      res.json({ success: true, message: 'Pattern saved' });
    }
  );
});

app.get('/api/uploads-history', (req, res) => {
  db.all(`SELECT * FROM file_uploads ORDER BY upload_date DESC LIMIT 50`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/kpis', (req, res) => {
  db.all(`SELECT store, commodity, SUM(tonnage) as total_mt FROM batches
    WHERE status = 'in_stock' GROUP BY store, commodity`, (err, stocks) => {
    const currentStock = (stocks || []).reduce((sum, s) => sum + (s.total_mt || 0), 0);
    res.json({
      currentStock: currentStock,
      incomingMT: 0,
      weeklyCollections: 290,
      weekToStockout: 5
    });
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
