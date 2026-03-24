import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css';

const Dashboard = () => {
  const [kpis, setKpis] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [vessels, setVessels] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [forecastData, setForecastData] = useState([]);
  
  const [filters, setFilters] = useState({
    store: '',
    commodity: '',
    week: ''
  });
  
  const [newPattern, setNewPattern] = useState({
    customer_name: '',
    commodity: '',
    store: 'All',
    avg_mt_week: '',
    basis: ''
  });
  
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadType, setUploadType] = useState('vessels');

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  // Load data on mount
  useEffect(() => {
    loadKPIs();
    loadUploads();
    loadVessels();
    loadPatterns();
  }, [filters]);

  const loadKPIs = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/kpis`, { params: filters });
      setKpis(response.data);
    } catch (error) {
      console.error('Error loading KPIs:', error);
    }
  };

  const loadUploads = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/uploads-history`);
      setUploads(response.data);
    } catch (error) {
      console.error('Error loading uploads:', error);
    }
  };

  const loadVessels = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/incoming-vessels`);
      setVessels(response.data);
    } catch (error) {
      console.error('Error loading vessels:', error);
    }
  };

  const loadPatterns = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/collection-patterns`);
      setPatterns(response.data);
    } catch (error) {
      console.error('Error loading patterns:', error);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      alert('Please select a file');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('fileType', uploadType);

    try {
      const response = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert(`✅ ${response.data.message}`);
      setUploadFile(null);
      loadUploads();
      loadVessels();
    } catch (error) {
      alert(`❌ Upload failed: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleSavePattern = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/api/collection-patterns`, newPattern);
      alert('✅ Collection pattern saved');
      setNewPattern({ customer_name: '', commodity: '', store: 'All', avg_mt_week: '', basis: '' });
      loadPatterns();
    } catch (error) {
      alert(`❌ Failed to save: ${error.message}`);
    }
  };

  return (
    <div className="dashboard">
      <header className="header">
        <h1>📊 Forecasting Dashboard - Tonnage Based</h1>
        <p>Real-time stock, collections, and vessel tracking</p>
      </header>

      {/* KEY METRICS */}
      {kpis && (
        <section className="kpi-section">
          <h2>Key Metrics</h2>
          <div className="kpi-grid">
            <div className="kpi-card">
              <h3>Current Stock</h3>
              <p className="kpi-value">{kpis.currentStock?.toFixed(0) || 0}</p>
              <p className="kpi-unit">MT</p>
            </div>
            <div className="kpi-card">
              <h3>Incoming (Next 4 Weeks)</h3>
              <p className="kpi-value">{kpis.incomingMT?.toFixed(0) || 0}</p>
              <p className="kpi-unit">MT</p>
            </div>
            <div className="kpi-card">
              <h3>Weekly Collections</h3>
              <p className="kpi-value">{kpis.weeklyCollections?.toFixed(0) || 0}</p>
              <p className="kpi-unit">MT/week</p>
            </div>
            <div className={`kpi-card ${kpis.weekToStockout <= 4 ? 'alert' : ''}`}>
              <h3>Weeks to Stockout</h3>
              <p className="kpi-value">{kpis.weekToStockout || '∞'}</p>
              <p className="kpi-unit">weeks</p>
            </div>
          </div>
        </section>
      )}

      {/* FILTERS */}
      <section className="filters-section">
        <h2>Filters</h2>
        <div className="filter-group">
          <input 
            type="text" 
            placeholder="Store (Newport, Liverpool, etc.)" 
            value={filters.store}
            onChange={(e) => setFilters({ ...filters, store: e.target.value })}
          />
          <input 
            type="text" 
            placeholder="Commodity" 
            value={filters.commodity}
            onChange={(e) => setFilters({ ...filters, commodity: e.target.value })}
          />
          <input 
            type="number" 
            placeholder="Week" 
            value={filters.week}
            onChange={(e) => setFilters({ ...filters, week: e.target.value })}
          />
          <button onClick={loadKPIs}>Apply Filters</button>
        </div>
      </section>

      {/* FILE UPLOAD */}
      <section className="upload-section">
        <h2>📤 Upload Data Files</h2>
        <form onSubmit={handleFileUpload}>
          <select value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
            <option value="vessels">Incoming Vessels</option>
            <option value="delinquent">Supplier Delinquent</option>
            <option value="contract">Contract Calendar</option>
          </select>
          <input 
            type="file" 
            accept=".xlsx,.xls" 
            onChange={(e) => setUploadFile(e.target.files[0])}
            required
          />
          <button type="submit">Upload</button>
        </form>
      </section>

      {/* UPLOAD HISTORY */}
      <section className="history-section">
        <h2>📋 Upload History</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>File Type</th>
              <th>Filename</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {uploads.slice(0, 10).map((upload, idx) => (
              <tr key={idx}>
                <td>{new Date(upload.upload_date).toLocaleDateString()}</td>
                <td>{upload.file_type}</td>
                <td>{upload.filename}</td>
                <td>{upload.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* INCOMING VESSELS */}
      <section className="vessels-section">
        <h2>🚢 Incoming Vessels</h2>
        <table>
          <thead>
            <tr>
              <th>Vessel</th>
              <th>Commodity</th>
              <th>MT</th>
              <th>Expected Week</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {vessels.slice(0, 15).map((vessel, idx) => (
              <tr key={idx}>
                <td>{vessel.vessel_name}</td>
                <td>{vessel.commodity}</td>
                <td>{vessel.mt?.toFixed(2)}</td>
                <td>{vessel.expected_week}</td>
                <td>{vessel.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* COLLECTION PATTERNS */}
      <section className="patterns-section">
        <h2>📊 Customer Collection Patterns</h2>
        
        <div className="pattern-input">
          <h3>Add/Update Pattern</h3>
          <form onSubmit={handleSavePattern}>
            <input 
              type="text" 
              placeholder="Customer Name (e.g., EWOS LIMITED)" 
              value={newPattern.customer_name}
              onChange={(e) => setNewPattern({ ...newPattern, customer_name: e.target.value })}
              required
            />
            <input 
              type="text" 
              placeholder="Commodity" 
              value={newPattern.commodity}
              onChange={(e) => setNewPattern({ ...newPattern, commodity: e.target.value })}
              required
            />
            <input 
              type="text" 
              placeholder="Store (or 'All')" 
              value={newPattern.store}
              onChange={(e) => setNewPattern({ ...newPattern, store: e.target.value })}
            />
            <input 
              type="number" 
              placeholder="Avg MT/Week" 
              step="0.01"
              value={newPattern.avg_mt_week}
              onChange={(e) => setNewPattern({ ...newPattern, avg_mt_week: e.target.value })}
              required
            />
            <input 
              type="text" 
              placeholder="Basis/Notes" 
              value={newPattern.basis}
              onChange={(e) => setNewPattern({ ...newPattern, basis: e.target.value })}
            />
            <button type="submit">Save Pattern</button>
          </form>
        </div>

        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Commodity</th>
              <th>Store</th>
              <th>Avg MT/Week</th>
              <th>Basis</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((pattern, idx) => (
              <tr key={idx}>
                <td>{pattern.customer_name}</td>
                <td>{pattern.commodity}</td>
                <td>{pattern.store}</td>
                <td>{pattern.avg_mt_week?.toFixed(2)}</td>
                <td>{pattern.basis}</td>
                <td>{new Date(pattern.last_updated).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* DECISION TREE */}
      <section className="decision-section">
        <h2>🎯 Decision Questions Answered</h2>
        <div className="decision-grid">
          <div className="decision-card">
            <h3>When do we run out?</h3>
            <p>Stockout warning triggered when projected closing stock hits 0</p>
            <p className="answer">{kpis?.weekToStockout <= 4 ? '🚨 ALERT - Check immediately' : '✓ No stockout risk (4+ weeks)'}</p>
          </div>
          <div className="decision-card">
            <h3>When can we fit another vessel?</h3>
            <p>Available capacity = Current stock + Incoming - Forecast collections</p>
            <p className="answer">Shown in vessel capacity calculator (coming soon)</p>
          </div>
          <div className="decision-card">
            <h3>How much are customers collecting?</h3>
            <p>From collection patterns × customer schedule</p>
            <p className="answer">{kpis?.weeklyCollections?.toFixed(0)} MT/week forecast</p>
          </div>
          <div className="decision-card">
            <h3>When should we order?</h3>
            <p>Order NOW if: (Stock - (Collections × Weeks)) {'<'} Safety Stock</p>
            <p className="answer">Shipping recommendation engine (coming soon)</p>
          </div>
          <div className="decision-card">
            <h3>Origin-based timing?</h3>
            <p>Indian: 4w | Turkish: 3w | African: 6w | Thai: 5w</p>
            <p className="answer">Order calculation engine (coming soon)</p>
          </div>
          <div className="decision-card">
            <h3>Capacity Planning</h3>
            <p>Multi-origin optimization for delivery week target</p>
            <p className="answer">Origin selector (coming soon)</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>✅ Tonnage-based forecasting | 📊 Real-time data sync | 📤 Excel upload with historic tracking</p>
      </footer>
    </div>
  );
};

export default Dashboard;
