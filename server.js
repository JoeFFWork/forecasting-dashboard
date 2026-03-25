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

// Upload setup
const upload = multer({ dest: 'uploads/' });

// Database
const db = new sqlite3.Database('./forecasting.db', (err) => {
    if (err) console.error('DB error:', err);
    else console.log('✓ SQLite connected');
});

// Initialize DB
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS batches (
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
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS incoming_vessels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        eta TEXT NOT NULL,
        commodity TEXT NOT NULL,
        tonnage REAL NOT NULL,
        origin TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS warehouse_capacity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT NOT NULL,
        commodity TEXT NOT NULL,
        max_mt REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store, commodity)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS file_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        batch_count INTEGER,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Excel parsing
const SHEET_NAMES = {
    'kenyon': 'This Week Kenyon',
    'newport': 'NP This Week',
    'avonmouth': 'This Week AV',
    'halder': 'This Week HA',
    'garston': 'This Week GA'
};

function parseExcelFile(filePath) {
    const workbook = XLSX.readFile(filePath);
    const batches = [];
    const processedStores = new Set();

    Object.entries(SHEET_NAMES).forEach(([storeKey, sheetName]) => {
        if (processedStores.has(storeKey)) return;

        if (!workbook.SheetNames.includes(sheetName)) {
            console.log(`⚠️  Sheet not found: ${sheetName}`);
            return;
        }

        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 0 });
        const store = storeKey.charAt(0).toUpperCase() + storeKey.slice(1);

        console.log(`\n📖 Parsing ${storeKey}:`);
        const commoditiesInStore = new Map();

        data.forEach((row) => {
            try {
                const colNames = Object.keys(row);
                let balance = null;
                let commodity = null;
                let batch = null;
                let origin = null;
                let vessel = null;
                let spec = null;

                colNames.forEach((col) => {
                    const colLower = col.toLowerCase().trim();
                    if (colLower.includes('batch')) batch = row[col];
                    if (colLower.includes('commodit') || colLower.includes('product')) commodity = row[col];
                    if (colLower.includes('balance') || colLower.includes('weight') || colLower.includes('total')) balance = row[col];
                    if (colLower.includes('origin')) origin = row[col];
                    if (colLower.includes('vessel')) vessel = row[col];
                    if (colLower.includes('spec')) spec = row[col];
                });

                if (balance) {
                    balance = parseFloat(balance);
                    if (isNaN(balance)) balance = 0;
                }

                if (!commodity || balance === 0 || balance === null || balance === '') return;

                commodity = String(commodity).trim().toUpperCase();

                if (!commoditiesInStore.has(commodity)) {
                    commoditiesInStore.set(commodity, 0);
                }
                commoditiesInStore.set(commodity, commoditiesInStore.get(commodity) + balance);

                batches.push({
                    store,
                    batch: batch ? parseInt(batch) : null,
                    commodity,
                    balance,
                    origin: origin ? String(origin).trim() : null,
                    vessel: vessel ? String(vessel).trim() : null,
                    spec: spec ? String(spec).trim() : null
                });

            } catch (e) {
                console.error(`Error parsing row:`, e.message);
            }
        });

        console.log(`✓ Found ${commoditiesInStore.size} commodities:`);
        commoditiesInStore.forEach((qty, commodity) => {
            console.log(`  • ${commodity}: ${qty.toFixed(1)} MT`);
        });

        processedStores.add(storeKey);
    });

    console.log(`\n✓ Total batches: ${batches.length}`);
    return batches;
}

// API Endpoints

app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file' });
        }

        console.log(`\n📤 Uploading: ${req.file.filename}`);
        const batches = parseExcelFile(req.file.path);

        db.run('DELETE FROM batches', (err) => {
            if (err) return res.status(500).json({ error: 'DB error' });

            batches.forEach(batch => {
                db.run(
                    `INSERT INTO batches (store, batch, commodity, balance, origin, vessel, spec, uid)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [batch.store, batch.batch, batch.commodity, batch.balance, batch.origin, batch.vessel, batch.spec, batch.uid]
                );
            });

            db.run(`INSERT INTO file_uploads (filename, batch_count) VALUES (?, ?)`, [req.file.filename, batches.length]);

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

app.get('/api/vessels', (req, res) => {
    db.all('SELECT * FROM incoming_vessels ORDER BY eta ASC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/vessels', (req, res) => {
    const { name, eta, commodity, tonnage, origin } = req.body;

    if (!name || !eta || !commodity || !tonnage || !origin) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    db.run(
        `INSERT INTO incoming_vessels (name, eta, commodity, tonnage, origin) 
         VALUES (?, ?, ?, ?, ?)`,
        [name, eta, commodity, parseFloat(tonnage), origin],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.delete('/api/vessels/:id', (req, res) => {
    db.run('DELETE FROM incoming_vessels WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/capacity', (req, res) => {
    db.all('SELECT * FROM warehouse_capacity ORDER BY store, commodity ASC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/capacity', (req, res) => {
    const { store, commodity, max_mt } = req.body;

    if (!store || !commodity || max_mt === undefined) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    db.run(
        `INSERT OR REPLACE INTO warehouse_capacity (store, commodity, max_mt) 
         VALUES (?, ?, ?)`,
        [store, commodity, parseFloat(max_mt)],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/capacity/:id', (req, res) => {
    db.run('DELETE FROM warehouse_capacity WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════╗
║  Dashboard Running on Port ${PORT}     ║
║  http://localhost:${PORT}             ║
╚════════════════════════════════════╝
    `);
});
