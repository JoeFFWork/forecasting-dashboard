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

  db.run(`CREATE TABLE IF NOT EXISTS incoming_vessels (
    id INTEGER PRIMARY KEY,
    vessel_name TEXT NOT NULL,
    commodity TEXT NOT NULL,
    store TEXT NOT NULL,
    tonnage REAL NOT NULL,
    origin TEXT,
    eta_date DATE NOT NULL,
    status TEXT DEFAULT 'pending',
    date_added DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS warehouse_capacity (
    id INTEGER PRIMARY KEY,
    store TEXT NOT NULL,
    commodity TEXT NOT NULL,
    max_capacity REAL NOT NULL,
    date_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store, commodity)
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

// ============ BATCH ROUTES ============
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

// ============ INCOMING VESSELS ROUTES ============
app.get('/api/incoming-vessels', (req, res) => {
  const { store, commodity } = req.query;
  let query = 'SELECT * FROM incoming_vessels WHERE 1=1';
  const params = [];
  
  if (store) { query += ' AND store = ?'; params.push(store); }
  if (commodity) { query += ' AND commodity = ?'; params.push(commodity); }
  
  query += ' ORDER BY eta_date ASC';
  
  db.all(query, params, (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/incoming-vessels', (req, res) => {
  const { vessel_name, commodity, store, tonnage, origin, eta_date } = req.body;
  
  if (!vessel_name || !commodity || !store || !tonnage || !eta_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  db.run(`INSERT INTO incoming_vessels (vessel_name, commodity, store, tonnage, origin, eta_date, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [vessel_name, commodity, store, parseFloat(tonnage), origin || '', eta_date],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to add vessel' });
      }
      res.json({ success: true, message: 'Vessel added', id: this.lastID });
    }
  );
});

app.delete('/api/incoming-vessels/:id', (req, res) => {
  db.run(`DELETE FROM incoming_vessels WHERE id = ?`, [req.params.id], function(err) {
    res.json({ success: true, message: 'Vessel deleted' });
  });
});

// ============ WAREHOUSE CAPACITY ROUTES ============
app.get('/api/warehouse-capacity', (req, res) => {
  db.all(`SELECT * FROM warehouse_capacity ORDER BY store, commodity`, (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/warehouse-capacity', (req, res) => {
  const { store, commodity, max_capacity } = req.body;
  
  if (!store || !commodity || max_capacity === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  db.run(`INSERT OR REPLACE INTO warehouse_capacity (store, commodity, max_capacity)
    VALUES (?, ?, ?)`,
    [store, commodity, parseFloat(max_capacity)],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to save capacity' });
      }
      res.json({ success: true, message: 'Capacity saved' });
    }
  );
});

// ============ FORECAST TIMELINE ROUTES ============
app.get('/api/forecast-timeline', (req, res) => {
  const { store, commodity, weeks = 12 } = req.query;
  
  const today = new Date();
  const timeline = [];
  
  // Get current stock
  db.all(`SELECT store, commodity, SUM(tonnage) as current_stock
    FROM batches WHERE status = 'in_stock'
    GROUP BY store, commodity`, (err, stocks) => {
    
    // Get collection patterns
    db.all(`SELECT * FROM collection_patterns`, (err, patterns) => {
      
      // Get incoming vessels
      db.all(`SELECT * FROM incoming_vessels WHERE status = 'pending'`, (err, vessels) => {
        
        // Get warehouse capacity
        db.all(`SELECT * FROM warehouse_capacity`, (err, capacities) => {
          
          // Build timeline
          for (let w = 0; w < parseInt(weeks); w++) {
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() + (w * 7));
            weekStart.setHours(0, 0, 0, 0);
            
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            
            const weekData = {
              week: w + 1,
              weekStart: weekStart.toISOString().split('T')[0],
              weekEnd: weekEnd.toISOString().split('T')[0],
              stores: {}
            };
            
            // Process each store/commodity combo
            const storeFilters = store ? [store] : ['Newport', 'Kenyon', 'Avonmouth', 'Halder', 'Garston'];
            
            storeFilters.forEach(s => {
              if (!weekData.stores[s]) weekData.stores[s] = {};
              
              const commodityFilters = commodity ? [commodity] : ['SOYA', 'FEED WHEAT (<12%)', 'MAIZE', 'TAPIOCA', 'LUCERNE', 'SWEET POTATO', 'SOYAMEAL'];
              
              commodityFilters.forEach(c => {
                const currentStockRow = stocks.find(st => st.store === s && st.commodity === c);
                const currentStock = currentStockRow ? currentStockRow.current_stock : 0;
                
                const collectionRate = patterns.find(p => p.commodity === c) ? patterns.find(p => p.commodity === c).avg_mt_week : 0;
                
                const incomingThisWeek = (vessels || [])
                  .filter(v => v.store === s && v.commodity === c && 
                    new Date(v.eta_date) >= weekStart && new Date(v.eta_date) <= weekEnd)
                  .reduce((sum, v) => sum + v.tonnage, 0);
                
                const capacity = capacities.find(cap => cap.store === s && cap.commodity === c) ? capacities.find(cap => cap.store === s && cap.commodity === c).max_capacity : 10000;
                
                weekData.stores[s][c] = {
                  startStock: currentStock,
                  collections: collectionRate,
                  incoming: incomingThisWeek,
                  endStock: Math.max(0, currentStock + incomingThisWeek - collectionRate),
                  capacity: capacity,
                  utilizationPercent: ((Math.max(0, currentStock + incomingThisWeek - collectionRate) / capacity) * 100).toFixed(1),
                  stockoutRisk: (Math.max(0, currentStock + incomingThisWeek - collectionRate) < (collectionRate * 1.5))
                };
              });
            });
            
            timeline.push(weekData);
          }
          
          res.json(timeline);
        });
      });
    });
  });
});

// ============ FILE UPLOAD ============
app.post('/api/upload-stock', upload.single('file'), (req, res) => {
  try {
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    
    let batchesImported = 0;

    // Kenyon sheet
    if (workbook.SheetNames.includes('This Week Kenyon')) {
      const ws = workbook.Sheets['This Week Kenyon'];
      const data = XLSX.utils.sheet_to_json(ws);
      data.forEach(row => {
        if (!row.Batch || row.Balance === 0 || row.Balance === undefined) return;
        db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [String(row.Batch), 'Kenyon', row.Commodity || '', parseFloat(row.Balance) || 0, 
           row.Origin || '', row.Vessel || '', row.Spec || ''],
          function(err) { if (!err) batchesImported++; }
        );
      });
    }

    if (workbook.SheetNames.includes('NP This Week')) {
      const ws = workbook.Sheets['NP This Week'];
      const data = XLSX.utils.sheet_to_json(ws);
      data.forEach(row => {
        if (!row.Batch || row.Weight === 0 || row.Weight === undefined) return;
        db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [String(row.Batch), 'Newport', row.Product || '', parseFloat(row.Weight) || 0, 
           row.Origin || '', row.Visit || '', row.SPEC || ''],
          function(err) { if (!err) batchesImported++; }
        );
      });
    }

    if (workbook.SheetNames.includes('This Week AV')) {
      const ws = workbook.Sheets['This Week AV'];
      const data = XLSX.utils.sheet_to_json(ws);
      data.forEach(row => {
        if (!row.BATCH || row['TOTAL '] === 0 || row['TOTAL '] === undefined) return;
        db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [String(row.BATCH), 'Avonmouth', row.COMMODITY || row.PRODUCT || '', parseFloat(row['TOTAL ']) || 0, 
           row.ORIGIN || '', '', row.SPEC || ''],
          function(err) { if (!err) batchesImported++; }
        );
      });
    }

    if (workbook.SheetNames.includes('This Week HA')) {
      const ws = workbook.Sheets['This Week HA'];
      const data = XLSX.utils.sheet_to_json(ws);
      data.forEach(row => {
        if (!row.BATCH || row['TOTAL '] === 0 || row['TOTAL '] === undefined) return;
        db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [String(row.BATCH), 'Halder', row.COMMODITY || '', parseFloat(row['TOTAL ']) || 0, 
           row.ORIGIN || '', '', row.SPEC || ''],
          function(err) { if (!err) batchesImported++; }
        );
      });
    }

    if (workbook.SheetNames.includes('This Week GA')) {
      const ws = workbook.Sheets['This Week GA'];
      const data = XLSX.utils.sheet_to_json(ws);
      data.forEach(row => {
        if (!row.BATCH || row['TOTAL '] === 0 || row['TOTAL '] === undefined) return;
        db.run(`INSERT OR REPLACE INTO batches (batch_id, store, commodity, tonnage, origin, vessel, spec, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [String(row.BATCH), 'Garston', row.PRODUCT || '', parseFloat(row['TOTAL ']) || 0, 
           row.ORIGIN || '', row.Vessel || '', row.SPEC || ''],
          function(err) { if (!err) batchesImported++; }
        );
      });
    }

    setTimeout(() => {
      db.run(`INSERT INTO file_uploads (filename, file_type, batches_imported) VALUES (?, ?, ?)`,
        [req.file.filename, 'stock_sheet', batchesImported],
        function(err) {
          res.json({ success: true, message: `✅ ${batchesImported} batches imported`, batches_imported: batchesImported });
        }
      );
    }, 1500);

  } catch (error) {
    res.status(500).json({ error: 'File processing failed', details: error.message });
  }
});

// ============ COLLECTION PATTERNS ============
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

// ============ UTILITIES ============
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
