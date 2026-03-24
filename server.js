const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CRITICAL: Serve index.html for root
app.get('/', (req, res) => {
  console.log('GET / - serving index.html');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Dashboard running' });
});

// Mock KPIs endpoint
app.get('/api/kpis', (req, res) => {
  res.json({
    currentStock: 1500,
    incomingMT: 800,
    weeklyCollections: 290,
    weekToStockout: 5,
    recentUploads: 0
  });
});

// Mock uploads history
app.get('/api/uploads-history', (req, res) => {
  res.json([]);
});

// Mock vessels
app.get('/api/incoming-vessels', (req, res) => {
  res.json([]);
});

// Mock patterns
app.get('/api/collection-patterns', (req, res) => {
  res.json([]);
});

// Mock save pattern
app.post('/api/collection-patterns', (req, res) => {
  res.json({ success: true, message: 'Pattern saved' });
});

// Mock upload
app.post('/api/upload', (req, res) => {
  res.json({ success: true, message: 'File uploaded' });
});

// Catch-all - serve index.html for any other path
app.get('*', (req, res) => {
  console.log('GET * - serving index.html for:', req.path);
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`✅ Dashboard running on port ${PORT}`);
  console.log(`📊 Open: http://localhost:${PORT}`);
});
