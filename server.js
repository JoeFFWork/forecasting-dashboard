const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload setup
const upload = multer({ dest: 'uploads/' });

// Database setup
const db = new sqlite3.Database('./forecasting.db', (err) => {
    if (err) console.error('DB connection error:', err);
    else console.log('Connected to SQLite database');
});

// Create tables if they don't exist
const initDB = () => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store TEXT NOT NULL,
                batch INTEGER,
                commodity TEXT NOT NULL,
                balance REAL,
                origin TEXT,
                vessel TEXT,
                spec TEXT,
                uid TEXT,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS incoming_vessels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                eta TEXT NOT NULL,
                commodity TEXT NOT NULL,
                tonnage REAL NOT NULL,
                origin TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS warehouse_capacity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store TEXT NOT NULL,
                commodity TEXT NOT NULL,
                max_mt REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store, commodity)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS file_uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                batch_count INTEGER,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    });
};

initDB();

// ============= EXCEL PARSING LOGIC =============

const SHEET_NAMES = {
    'kenyon': 'This Week Kenyon',
    'newport': 'NP This Week',
    'avonmouth': 'This Week AV',
    'halder': 'This Week HA',
    'garston': 'This Week GA'
};

const COLUMN_MAPPING = {
    'kenyon': { batch: 0, commodity: 1, balance: 3, origin: 4, vessel: 2, spec: 5 },
    'newport': { commodity: 0, balance: 1, batch: 3, origin: 6, vessel: 4, spec: 7 },
    'avonmouth': { batch: 0, commodity: 2, balance: 1, origin: 3, vessel: null, spec: 4 },
    'halder': { batch: 0, commodity: 2, balance: 1, origin: 3, vessel: null, spec: 4 },
    'garston': { batch: 0, commodity: 1, balance: 2, origin: 4, vessel: 3, spec: 5 }
};

function parseExcelFile(filePath) {
    const workbook = XLSX.readFile(filePath);
    const batches = [];
    const processedStores = new Set();

    Object.entries(SHEET_NAMES).forEach(([storeKey, sheetName]) => {
        // Check if store already processed (avoid duplicates)
        if (processedStores.has(storeKey)) {
            console.log(`⚠️  Skipping duplicate store: ${storeKey}`);
            return;
        }

        if (!workbook.SheetNames.includes(sheetName)) {
            console.log(`Sheet not found: ${sheetName}`);
            return;
        }

        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 0 });
        const mapping = COLUMN_MAPPING[storeKey];
        const store = storeKey.charAt(0).toUpperCase() + storeKey.slice(1);

        console.log(`\n📖 Parsing ${storeKey.toUpperCase()}:`);
        console.log(`   Sheet: ${sheetName}, Rows: ${data.length}`);

        // Track commodities in this store
        const commoditiesInStore = new Map();

        data.forEach((row, idx) => {
            try {
                // Get column values
                const colNames = Object.keys(row);
                let balance = null;
                let commodity = null;
                let batch = null;
                let origin = null;
                let vessel = null;
                let spec = null;

                // Flexible column parsing - look for key column names
                colNames.forEach((col, colIdx) => {
                    const colLower = col.toLowerCase().trim();
                    
                    if (colLower.includes('batch')) batch = row[col];
                    if (colLower.includes('commodit') || colLower.includes('product')) commodity = row[col];
                    if (colLower.includes('balance') || colLower.includes('weight') || colLower.includes('total')) balance = row[col];
                    if (colLower.includes('origin')) origin = row[col];
                    if (colLower.includes('vessel')) vessel = row[col];
                    if (colLower.includes('spec')) spec = row[col];
                });

                // Parse balance as number
                if (balance) {
                    balance = parseFloat(balance);
                    if (isNaN(balance)) balance = 0;
                }

                // Skip rows with no commodity or zero balance
                if (!commodity || balance === 0 || balance === null || balance === '') {
                    return;
                }

                // Normalize commodity name
                commodity = String(commodity).trim().toUpperCase();

                // Track this commodity
                if (!commoditiesInStore.has(commodity)) {
                    commoditiesInStore.set(commodity, 0);
                }
                commoditiesInStore.set(commodity, commoditiesInStore.get(commodity) + balance);

                batches.push({
                    store: store,
                    batch: batch ? parseInt(batch) : null,
                    commodity: commodity,
                    balance: balance,
                    origin: origin ? String(origin).trim() : null,
                    vessel: vessel ? String(vessel).trim() : null,
                    spec: spec ? String(spec).trim() : null
                });

            } catch (e) {
                console.error(`   ✗ Row ${idx + 1} error:`, e.message);
            }
        });

        // Log summary for this store
        console.log(`   ✓ Found ${commoditiesInStore.size} commodities:`);
        commoditiesInStore.forEach((qty, commodity) => {
            console.log(`     • ${commodity}: ${qty.toFixed(1)} MT`);
        });

        processedStores.add(storeKey);
    });

    console.log(`\n📊 Total batches parsed: ${batches.length}`);
    return batches;
}

// ============= API ENDPOINTS =============

// Upload Excel file
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`\n📤 Processing upload: ${req.file.filename}`);

        const batches = parseExcelFile(req.file.path);

        // Clear old batches and insert new ones
        db.run('DELETE FROM batches', (err) => {
            if (err) {
                console.error('DB error clearing batches:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            // Insert new batches
            let inserted = 0;
            batches.forEach(batch => {
                db.run(
                    `INSERT INTO batches (store, batch, commodity, balance, origin, vessel, spec, uid)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [batch.store, batch.batch, batch.commodity, batch.balance, batch.origin, batch.vessel, batch.spec, batch.uid],
                    (err) => {
                        if (err) console.error('Insert error:', err);
                        else inserted++;
                    }
                );
            });

            // Log upload
            db.run(
                `INSERT INTO file_uploads (filename, batch_count) VALUES (?, ?)`,
                [req.file.filename, batches.length]
            );

            // Cleanup uploaded file
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('File cleanup error:', err);
            });

            res.json({
                success: true,
                message: `Uploaded ${batches.length} batches`,
                batch_count: batches.length
            });
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all batches (filtered - only non-zero commodities per store)
app.get('/api/batches', (req, res) => {
    db.all(
        `SELECT DISTINCT 
            store, 
            commodity, 
            SUM(balance) as total_balance,
            origin
         FROM batches 
         WHERE balance > 0
         GROUP BY store, commodity
         ORDER BY store, total_balance DESC`,
        (err, rows) => {
            if (err) {
                console.error('Query error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json(rows || []);
        }
    );
});

// Get batches for timeline (with week calculations)
app.get('/api/batches/timeline/:store', (req, res) => {
    const { store } = req.params;

    db.all(
        `SELECT 
            store, 
            commodity, 
            SUM(balance) as total_balance,
            COUNT(DISTINCT batch) as batch_count
         FROM batches 
         WHERE store = ? AND balance > 0
         GROUP BY commodity
         ORDER BY commodity`,
        [store],
        (err, rows) => {
            if (err) {
                console.error('Query error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json(rows || []);
        }
    );
});

// Get incoming vessels
app.get('/api/vessels', (req, res) => {
    db.all(
        'SELECT * FROM incoming_vessels ORDER BY eta ASC',
        (err, rows) => {
            if (err) {
                console.error('Query error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json(rows || []);
        }
    );
});

// Add vessel
app.post('/api/vessels', express.json(), (req, res) => {
    const { name, eta, commodity, tonnage, origin } = req.body;

    if (!name || !eta || !commodity || !tonnage || !origin) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.run(
        `INSERT INTO incoming_vessels (name, eta, commodity, tonnage, origin) 
         VALUES (?, ?, ?, ?, ?)`,
        [name, eta, commodity, parseFloat(tonnage), origin],
        function(err) {
            if (err) {
                console.error('Insert error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, success: true });
        }
    );
});

// Delete vessel
app.delete('/api/vessels/:id', (req, res) => {
    db.run(
        'DELETE FROM incoming_vessels WHERE id = ?',
        [req.params.id],
        (err) => {
            if (err) {
                console.error('Delete error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true });
        }
    );
});

// Get warehouse capacity
app.get('/api/capacity', (req, res) => {
    db.all(
        'SELECT * FROM warehouse_capacity ORDER BY store, commodity ASC',
        (err, rows) => {
            if (err) {
                console.error('Query error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json(rows || []);
        }
    );
});

// Set warehouse capacity
app.post('/api/capacity', express.json(), (req, res) => {
    const { store, commodity, max_mt } = req.body;

    if (!store || !commodity || max_mt === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.run(
        `INSERT OR REPLACE INTO warehouse_capacity (store, commodity, max_mt) 
         VALUES (?, ?, ?)`,
        [store, commodity, parseFloat(max_mt)],
        function(err) {
            if (err) {
                console.error('Insert error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true });
        }
    );
});

// Delete capacity
app.delete('/api/capacity/:id', (req, res) => {
    db.run(
        'DELETE FROM warehouse_capacity WHERE id = ?',
        [req.params.id],
        (err) => {
            if (err) {
                console.error('Delete error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true });
        }
    );
});

// Get dashboard overview
app.get('/api/overview', (req, res) => {
    db.all(
        `SELECT 
            COUNT(DISTINCT store) as store_count,
            COUNT(DISTINCT commodity) as commodity_count,
            SUM(balance) as total_inventory
         FROM batches
         WHERE balance > 0`,
        (err, rows) => {
            if (err) {
                console.error('Query error:', err);
                return res.status(500).json({ error: err.message });
            }

            const overview = rows[0] || { store_count: 0, commodity_count: 0, total_inventory: 0 };

            db.all('SELECT COUNT(*) as count FROM incoming_vessels', (err, vessels) => {
                if (err) {
                    console.error('Query error:', err);
                    return res.status(500).json({ error: err.message });
                }

                res.json({
                    total_inventory: overview.total_inventory || 0,
                    commodity_count: overview.commodity_count || 0,
                    store_count: overview.store_count || 5,
                    vessel_count: vessels[0]?.count || 0
                });
            });
        }
    );
});

// Serve static files
app.use(express.static('public'));

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  Forecasting Dashboard Server Started  ║
║  Port: ${PORT}                            ║
║  Ready to process uploads              ║
╚════════════════════════════════════════╝
    `);
});
