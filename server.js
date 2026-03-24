const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/kpis', (req, res) => {
  res.json({
    currentStock: 1500,
    incomingMT: 800,
    weeklyCollections: 290,
    weekToStockout: 5,
    recentUploads: 0
  });
});

app.get('/api/uploads-history', (req, res) => res.json([]));
app.get('/api/incoming-vessels', (req, res) => res.json([]));
app.get('/api/collection-patterns', (req, res) => res.json([]));
app.post('/api/collection-patterns', (req, res) => res.json({ success: true }));
app.post('/api/upload', (req, res) => res.json({ success: true }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});
