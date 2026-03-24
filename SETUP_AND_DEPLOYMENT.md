# Forecasting Dashboard - Complete Setup Guide
## Tonnage-Based Stock, Collections, and Vessel Forecasting

---

## 📦 What You Have

### **1. Enhanced Excel Template** (`Forecasting_Database_v2_TONNAGE.xlsx`)
- **Sheet 1:** Setup & Legend (stores, products, parameters)
- **Sheet 2:** Incoming Vessels (auto-pulled from uploads)
- **Sheet 3:** Supplier Delinquent (DIASUB, Gamma, etc.)
- **Sheet 4:** Customer Collection Patterns (YOU FILL IN)
- **Sheet 5:** Stock Snapshot Intake (paste weekly)
- **Sheet 6:** Contract Calendar Import (auto-pulled from uploads)
- **Sheet 7:** Weekly Forecast (auto-calculated)
- **Sheet 8:** Dashboard KPIs

### **2. Web Dashboard** (React + Node.js)
- Real-time KPI display
- File upload with historic tracking
- Collection pattern management
- Vessel tracking timeline
- 5 core decision questions answered

### **3. API Backend** (Express + SQLite)
- File upload endpoint (vessels, delinquent, contracts)
- Data storage (historic tracking)
- KPI calculation
- Collection pattern management

---

## 🚀 Quick Start (5 minutes)

### **Option A: Run Locally (Development)**

1. **Install Node.js** (if not installed)
   - Download from https://nodejs.org
   - Verify: `node --version`

2. **Navigate to project folder**
   ```bash
   cd forecasting-web-app
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Start backend server**
   ```bash
   npm start
   ```
   Expected output:
   ```
   ✅ Forecasting Dashboard API running on port 5000
   📊 Dashboard: http://localhost:5000
   ```

5. **Start React frontend** (in new terminal)
   ```bash
   cd frontend
   npm install
   npm start
   ```
   - Opens browser automatically to http://localhost:3000

6. **Start using:**
   - Upload Excel files (Incoming Vessels, Contracts, Delinquent)
   - Enter collection patterns for each customer
   - View live KPIs and dashboards

---

### **Option B: Deploy to Free Hosting (Railway)**

#### **Step 1: Create Railway Account**
1. Go to https://railway.app
2. Sign up (free tier available)
3. Create new project

#### **Step 2: Deploy Backend**
1. Connect GitHub repository (or use Railway CLI)
2. Set environment variable: `PORT=5000`
3. Set start command: `npm start`
4. Railway auto-deploys and gives you a live URL (e.g., `https://forecasting-xyz.railway.app`)

#### **Step 3: Deploy Frontend**
1. Create React app: `npx create-react-app forecasting-dashboard`
2. Copy Dashboard.jsx and Dashboard.css into `src/`
3. Update `.env`:
   ```
   REACT_APP_API_URL=https://forecasting-xyz.railway.app
   ```
4. Deploy to Vercel or Railway (free tier)

#### **Step 4: Setup is Complete**
- Backend: `https://forecasting-xyz.railway.app`
- Frontend: `https://forecasting-dashboard.vercel.app` (or Railway URL)
- Both share SQLite database stored on Railway

---

## 📋 First Week Workflow

### **Monday Morning (Week 1)**

1. **Open Excel template** (`Forecasting_Database_v2_TONNAGE.xlsx`)
2. **Fill in Collection Patterns** (Sheet 4)
   - Customer: EWOS LIMITED
   - Commodity: Organic Soymeal
   - Avg MT/Week: 290 (based on your observed pattern)
   - Basis: "Observed from last 8 weeks"
   - Repeat for each customer/commodity combo

3. **Upload your files** via web dashboard:
   - Upload "Incoming Vessels" Excel (vessel schedule)
   - Upload "Contract Calendar" export from your system
   - Upload "Supplier Delinquent" (outstanding from suppliers)

4. **Paste Stock Snapshot** (Sheet 5 of Excel)
   - From your Weekly_Physical_Stocks sheet
   - Dashboard auto-syncs

5. **Check Dashboard KPIs**
   - Current Stock: [should show total MT]
   - Incoming (4 weeks): [vessel schedule]
   - Weekly Collections: [from patterns]
   - Weeks to Stockout: [alert if < 4 weeks]

6. **Answer the 5 Questions:**
   - ⏰ **When do we run out?** → Dashboard shows weeks-to-stockout
   - 📦 **When can we fit another vessel?** → Available capacity = Stock - Collections
   - 📊 **How much are customers collecting?** → From patterns (MT/week)
   - 🚢 **When should we order?** → When weeks-to-stockout < 4
   - 🌍 **Origin-based timing?** → PO in Week X for delivery Week Y (minus transit time)

---

## 🔧 Key Configuration

### **Collection Patterns** (Critical for accuracy)
These define how much MT customers actually collect per week, NOT what the contract says.

**Example:**
```
Customer: SHIPTON MILL LTD
Commodity: Organic High Protein Wheat
Store: Newport
Avg MT/Week: 290
Basis: "Observed average over 12 weeks, consistent Mondays"
```

**Update when:**
- Customer behavior changes (mill breakdown, seasonal)
- New large customer added
- Delinquent collection push starts (can increase MT/week temporarily)

### **Transit Times** (For origin-based ordering)
```
Indian Origin:     4 weeks
Turkish Origin:    3 weeks
African Origin:    6 weeks
Moldovan Origin:   3 weeks
Thai Origin:       5 weeks
```

**Usage:**
- Target arrival: Week 6
- Choose Turkish (3-week transit) → Order this week (Week 3)
- Choose Indian (4-week transit) → Order Week 2

---

## 📊 The 5 Core Questions Your Dashboard Answers

### **1. When do we run out? ⏰**
**Formula:** Weeks to Stockout = Current Stock ÷ Weekly Collections
- **Alert:** Triggered when < 4 weeks
- **Action:** Place order immediately for delivery in Weeks 4-5

### **2. When can we fit another vessel? 📦**
**Formula:** Available Capacity = Current Stock + Incoming - (Collections × Weeks Ahead)
- **Example:** Stock 2,340 MT + Incoming 1,800 MT - (290 MT/week × 4) = 2,300 MT available
- **Action:** Can fit 2,300 MT more without overstocking

### **3. How much are customers collecting? 📊**
**Source:** Collection Patterns sheet (ACTUAL observed, not contract)
- **Example:** EWOS = 290 MT/week, SHIPTON = 180 MT/week
- **Forecast:** Week 1 collections = sum of all customer patterns
- **Accuracy:** This is MORE accurate than contract because it's real behavior

### **4. When should we order? 🚢**
**Logic:** If weeks-to-stockout < 4, order immediately for arrival in Week 4-5
- **Check:** Current Stock - (Weekly Collections × 4 weeks) = safety buffer
- **Action:** Place PO when buffer drops below 500 MT (configurable)

### **5. Origin-based timing? 🌍**
**Decision Tree:**
```
Target Arrival: Week 5
├─ Indian (4-week transit): Order Week 1 ✓ Just in time
├─ Turkish (3-week transit): Order Week 2 ✓ Bit late but acceptable
└─ African (6-week transit): Order now but arrives Week 6 (too late)

Choose Turkish or Indian based on cost/availability
```

---

## 🔄 Weekly Data Flow

```
Your System
    ↓
Monday 9 AM: Generate Weekly_Physical_Stocks.xlsx
    ↓
Login to Dashboard
    ↓
Upload 3 files:
├─ Incoming Vessels (your POs + vessel schedule)
├─ Contract Calendar (customer contracts + releases)
└─ Supplier Delinquent (what suppliers still owe)
    ↓
Paste Stock Snapshot into Excel Sheet 5
    ↓
Dashboard auto-syncs and calculates KPIs
    ↓
Answer: "When do we run out?" → Dashboard shows: Week 5 🚨 ORDER NOW
```

---

## 💾 Data Persistence & History

All uploads are **permanently stored** with timestamps:
- **Vessels:** Who, when, how much arriving
- **Delinquents:** Supplier outstanding MT over time
- **Stock:** Weekly snapshots for trend analysis
- **Collections:** Customer patterns for seasonal adjustments

**Access history:**
- Dashboard shows last 50 uploads
- Can export for analysis later
- Database stored on Railway (free tier: 5GB limit)

---

## 🎯 Dashboard Features Checklist

- ✅ Real-time KPI cards (Stock, Incoming, Collections, Weeks to Stockout)
- ✅ File upload with historic tracking
- ✅ Customer collection pattern input
- ✅ Filter by Store, Commodity, Date range
- ✅ Incoming vessels timeline
- ✅ 5 decision questions answered
- ✅ SQLite historic data (permanent)
- ✅ Mobile-friendly responsive design
- ⏳ Advanced features (coming next):
  - Vessel capacity calculator
  - Shipping recommendation engine
  - Origin selector (cost vs. time optimization)
  - Scenario modeling (what-if analysis)

---

## 🔗 Deployment Links

Once deployed to Railway/Vercel:
- **Backend API:** `https://your-app.railway.app`
- **Frontend Dashboard:** `https://your-app.vercel.app`
- **Database:** Stored on Railway (automatic backup)

**Share with team:**
- Just send the dashboard URL
- Everyone can access live KPIs
- File uploads work from any browser
- No software installation needed

---

## ❓ FAQ

**Q: Do I have to upload files every week?**
A: Yes, but it's quick (2 files, 30 seconds). This keeps you synced to reality.

**Q: What if customer collection patterns change?**
A: Update them in Sheet 4 (Customer Collection Patterns) or the Dashboard.
System uses ACTUAL patterns, not contract wishful-thinking.

**Q: Can I see historical trends?**
A: Yes, all uploads are stored with timestamps. Export feature coming soon.

**Q: What happens if the web app goes down?**
A: Your Excel template still works. Dashboard just shows cached data.

**Q: How much does it cost?**
A: FREE for free hosting tier (Railway + Vercel).
- Railway: 5GB storage free
- Vercel: unlimited React deployments
- Scale to paid ($5-20/mo) only if you exceed limits

**Q: Can I integrate with my accounting system?**
A: Yes, Phase 2 will add API hooks for AR/cash flow integration.

---

## 📞 Support

**Issues during setup?**
1. Check console for errors (browser DevTools → Console)
2. Verify Node.js installed: `node --version`
3. Check backend running: `curl http://localhost:5000/api/health`
4. Check database: `uploads/forecasting.db` exists in project folder

**Want to customize?**
- Dashboard colors: Edit `Dashboard.css`
- KPI calculations: Edit `server.js` (api/kpis endpoint)
- Add new filters: Edit `Dashboard.jsx` (useState, filter logic)

---

## 🎉 You're Ready!

Start with the **5-minute local setup**. Once comfortable, deploy to Railway (free, 2 mins).

**First week goal:** Answer all 5 questions with confidence, every Monday morning.

Good luck! 🚀
