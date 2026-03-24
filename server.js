const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// File upload setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${file.fieldname}-${timestamp}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Database setup
const dbPath = path.join(__dirname, 'forecasting.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('✅ SQLite database connected');
});

// Initialize database tables
db.serialize(() => {
  // File uploads history
  db.run(`CREATE TABLE IF NOT EXISTS file_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'processed'
  )`);

  // Customer collection patterns
  db.run(`CREATE TABLE IF NOT EXISTS collection_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    commodity TEXT NOT NULL,
    store TEXT,
    avg_mt_week REAL,
    basis TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Incoming vessels
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

  // Supplier delinquent
  db.run(`CREATE TABLE IF NOT EXISTS supplier_delinquent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier TEXT NOT NULL,
    commodity TEXT NOT NULL,
    total_mt REAL,
    collected_mt REAL,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Stock snapshots
  db.run(`CREATE TABLE IF NOT EXISTS stock_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product TEXT NOT NULL,
    store TEXT NOT NULL,
    mt REAL,
    snapshot_date DATE,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Weekly forecasts
  db.run(`CREATE TABLE IF NOT EXISTS weekly_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store TEXT NOT NULL,
    commodity TEXT NOT NULL,
    week INTEGER,
    opening_stock REAL,
    incoming_mt REAL,
    collections_forecast REAL,
    closing_stock REAL,
    calculated_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ============================================
// API ENDPOINTS
// ============================================

// Upload Excel file (incoming vessels, supplier delinquent, contract calendar)
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    const filePath = req.file.path;
    const fileType = req.body.fileType; // 'vessels', 'delinquent', 'contract'
    
    // Read Excel file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Store in database
    db.run(
      `INSERT INTO file_uploads (filename, file_type, status) VALUES (?, ?, ?)`,
      [req.file.filename, fileType, 'processed'],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database insert failed' });
        }

        // Parse data based on file type
        if (fileType === 'vessels') {
          parseVessels(data, res);
        } else if (fileType === 'delinquent') {
          parseDelinquent(data, res);
        } else if (fileType === 'contract') {
          parseContract(data, res);
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'File processing failed', details: error.message });
  }
});

// Parse and store incoming vessels
function parseVessels(data, res) {
  let inserted = 0;
  data.forEach(row => {
    db.run(
      `INSERT INTO incoming_vessels (vessel_name, commodity, batch_id, origin, mt, expected_week, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row['Vessel Name'] || '',
        row['Commodity'] || '',
        row['Batch #'] || '',
        row['Origin'] || '',
        parseFloat(row['MT']) || 0,
        parseInt(row['Expected Week']) || 0,
        row['Status'] || 'Scheduled'
      ]
    );
    inserted++;
  });
  res.json({ 
    success: true, 
    message: `${inserted} vessel(s) imported`,
    fileType: 'vessels'
  });
}

// Parse and store supplier delinquent
function parseDelinquent(data, res) {
  let inserted = 0;
  data.forEach(row => {
    db.run(
      `INSERT INTO supplier_delinquent (supplier, commodity, total_mt, collected_mt)
       VALUES (?, ?, ?, ?)`,
      [
        row['Supplier'] || '',
        row['Commodity'] || '',
        parseFloat(row['Total Outstanding (MT)']) || 0,
        parseFloat(row['Collected to Date (MT)']) || 0
      ]
    );
    inserted++;
  });
  res.json({ 
    success: true, 
    message: `${inserted} delinquent record(s) imported`,
    fileType: 'delinquent'
  });
}

// Parse and store contract calendar
function parseContract(data, res) {
  let inserted = 0;
  data.forEach(row => {
    // Extract monthly data
    const months = ['Current', 'April', 'May', 'June', 'July', 'August', 'Sept', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
    months.forEach(month => {
      const mt = parseFloat(row[month]) || 0;
      if (mt > 0) {
        // Store as separate records per month
        db.run(
          `INSERT INTO incoming_vessels (vessel_name, commodity, batch_id, origin, mt, expected_week, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            `Contract: ${row['Customer']}`,
            row['Commodity'] || '',
            row['Contract #'] || '',
            row['Location'] || '',
            mt,
            getWeekFromMonth(month),
            'Contract'
          ]
        );
        inserted++;
      }
    });
  });
  res.json({ 
    success: true, 
    message: `Contract calendar processed: ${inserted} releases loaded`,
    fileType: 'contract'
  });
}

// Get week number from month name
function getWeekFromMonth(month) {
  const monthMap = {
    'Current': 1, 'April': 1, 'May': 5, 'June': 9, 'July': 13,
    'August': 17, 'Sept': 21, 'Oct': 25, 'Nov': 29, 'Dec': 33, 'Jan': 37, 'Feb': 41
  };
  return monthMap[month] || 1;
}

// Get all file uploads history
app.get('/api/uploads-history', (req, res) => {
  db.all(
    `SELECT id, filename, file_type, upload_date, status FROM file_uploads ORDER BY upload_date DESC LIMIT 50`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Get collection patterns
app.get('/api/collection-patterns', (req, res) => {
  db.all(
    `SELECT * FROM collection_patterns ORDER BY customer_name`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Save/update collection pattern
app.post('/api/collection-patterns', (req, res) => {
  const { customer_name, commodity, store, avg_mt_week, basis } = req.body;
  
  db.run(
    `INSERT OR REPLACE INTO collection_patterns (customer_name, commodity, store, avg_mt_week, basis, last_updated)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [customer_name, commodity, store || 'All', avg_mt_week, basis],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Collection pattern saved' });
    }
  );
});

// Get incoming vessels
app.get('/api/incoming-vessels', (req, res) => {
  db.all(
    `SELECT * FROM incoming_vessels ORDER BY expected_week ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Get forecast data
app.get('/api/forecast', (req, res) => {
  const { store, commodity, week } = req.query;
  
  let query = `SELECT * FROM weekly_forecasts WHERE 1=1`;
  const params = [];
  
  if (store) {
    query += ` AND store = ?`;
    params.push(store);
  }
  if (commodity) {
    query += ` AND commodity = ?`;
    params.push(commodity);
  }
  if (week) {
    query += ` AND week = ?`;
    params.push(parseInt(week));
  }
  
  query += ` ORDER BY week ASC LIMIT 100`;
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get dashboard KPIs
app.get('/api/kpis', (req, res) => {
  const { store, commodity } = req.query;
  
  // Query latest stock snapshot
  let stockQuery = `SELECT product, store, mt FROM stock_snapshots WHERE 1=1`;
  let params = [];
  
  if (store) {
    stockQuery += ` AND store = ?`;
    params.push(store);
  }
  if (commodity) {
    stockQuery += ` AND product LIKE ?`;
    params.push(`%${commodity}%`);
  }
  
  stockQuery += ` ORDER BY snapshot_date DESC LIMIT 10`;
  
  db.all(stockQuery, params, (err, stocks) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Query incoming vessels
    let vesselQuery = `SELECT * FROM incoming_vessels WHERE expected_week BETWEEN 1 AND 4`;
    db.all(vesselQuery, (err2, vessels) => {
      if (err2) return res.status(500).json({ error: err2.message });
      
      // Calculate KPIs
      const currentStock = stocks.reduce((sum, s) => sum + (s.mt || 0), 0);
      const incomingMT = vessels.reduce((sum, v) => sum + (v.mt || 0), 0);
      const weeklyCollections = stocks.length > 0 ? Math.round(stocks[0].mt / 4) : 0;
      const weekToStockout = weeklyCollections > 0 ? Math.round(currentStock / weeklyCollections) : 999;
      
      res.json({
        currentStock,
        incomingMT,
        weeklyCollections,
        weekToStockout,
        recentUploads: stocks.length
      });
    });
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Dashboard API running' });
});

// Serve index.html for root path
   app.get('/', (req, res) => {
     res.sendFile(path.join(__dirname, 'index.html'));
   });

   // Catch-all for HTML5 history API
   app.get('*', (req, res) => {
     res.sendFile(path.join(__dirname, 'index.html'));
   });

   // Start server
   app.listen(PORT, () => {
     console.log(`\n✅ Forecasting Dashboard API running on port ${PORT}`);
     console.log(`📊 Dashboard: http://localhost:${PORT}`);
     console.log(`📤 Upload endpoint: POST /api/upload`);
     console.log(`📊 Forecast endpoint: GET /api/forecast`);
   });

   module.exports = app;
