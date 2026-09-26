# StockSense — Modular Inventory Management System (IMS)

StockSense is an enterprise-grade, modular, and real-time Inventory Management System designed to digitize and streamline all stock-related operations within a business, replacing manual registers and scattered spreadsheets.

Built in exact accordance with the **Odoo Hackathon Problem Statement (`StockSense.pdf`)**, powered by **PostgreSQL 18**, **FastAPI**, and a **100% Responsive Web UI** (no Android framework needed).

---

## 🚀 Key Features (From Problem Statement)

### 1. Target Users & Authentication
- **Inventory Managers**: Complete authority over catalog, reordering thresholds, supplier receipts, and multi-warehouse configurations.
- **Warehouse Staff**: Execute internal transfers, pick/pack outgoing orders, physical count inventory adjustments.
- **Sign In & Sign Up**: Role-based access with JWT authentication.
- **OTP Password Reset**: Time-based One-Time Password (TOTP) generator & verification with a 5-minute expiry window stored in cache/database.
- **Redirect**: Instant landing on the Inventory Dashboard.
- **Left Sidebar Profile Menu**: Quick access to **My Profile** and **Logout**.

### 2. Dashboard View & Dynamic KPIs
- **5 Real-Time KPIs**:
  1. **Total Products in Stock**: Catalog size and total unit volume.
  2. **Low Stock / Out of Stock Items**: Automatic alerts when on-hand quantity falls at or below the reorder point.
  3. **Pending Receipts**: Inbound purchase batches awaiting validation.
  4. **Pending Deliveries**: Scheduled customer dispatches.
  5. **Internal Transfers Scheduled**: Intra-facility movements awaiting completion.
- **Dynamic Filters**:
  - By **Document Type**: Receipts, Deliveries, Internal Transfers, Adjustments.
  - By **Status**: Draft, Waiting, Ready, Done (Validated), Canceled.
  - By **Warehouse or Location**: Multi-location filtering.
  - By **Product Category**: Filter by Raw Materials, Finished Goods, Hardware, etc.
- **Visual Analytics**: Interactive stock distribution bar chart powered by Chart.js.

### 3. Core Operations Workflow
1. **Receipts (Incoming Goods)**:
   - Create receipt from vendors (e.g. Tata Steel).
   - Input received quantities into target location.
   - **Validate** → Stock increases automatically in `stock_quants` and creates an append-only entry in `stock_ledger`.
2. **Delivery Orders (Outgoing Goods)**:
   - Create shipment for customers (e.g. Apex Corp).
   - Pick & pack workflow with strict stock availability checks (prevents negative balances).
   - **Validate** → Stock decreases automatically.
3. **Internal Transfers**:
   - Move stock between locations (e.g., `Main Store` → `Production Rack`, `Rack A` → `Rack B`, `Warehouse 1` → `Warehouse 2`).
   - Atomically updates source and destination locations and logs both legs in the Stock Ledger.
4. **Stock Adjustments**:
   - Fix mismatches between recorded stock and physical counts.
   - User inputs physical counted quantity; system computes the delta (+ or -) and logs the adjustment reason.

### 4. Move History (Stock Ledger)
- Chronological, append-only ledger logging every single transaction:
  - Timestamp, Document Reference (`WH/IN/...`, `WH/OUT/...`, `WH/INT/...`, `WH/ADJ/...`), Product, Location, Quantity Change (+/-), and Balance After.

### 5. Multi-Warehouse & Location Settings
- Configure multiple warehouses (e.g. *Main Warehouse*, *Warehouse 2*).
- Configure distinct locations (stores, production racks, storage yards).
- **Stock Availability Matrix**: Live 2D grid showing product on-hand quantities across all locations simultaneously.

### 6. 1-Click Interactive PDF Demo Walkthrough
A dedicated button in the sidebar runs the exact 4-step scenario from page 3-4 of the PDF:
1. **Step 1**: Receive 100 kg Steel Rods from Vendor (+100)
2. **Step 2**: Move to production rack (Internal Transfer 25 kg: Main Store → Production Rack)
3. **Step 3**: Deliver finished goods (20 kg Steel to Customer)
4. **Step 4**: Adjust damaged items (3 kg damaged steel recorded and subtracted)
5. Automatically redirects to **Move History** for visual verification!

---

## 💻 Tech Stack

- **Backend**: FastAPI, SQLAlchemy (Async), asyncpg, Pydantic v2, PyOTP, Passlib (bcrypt), python-jose
- **Database**: PostgreSQL 18 (`localhost:5432/stocksense`)
- **Frontend**: Responsive Web SPA (HTML5, Tailwind CSS, Lucide Icons, Chart.js, ES6 JavaScript)
- **Real-Time**: WebSockets with In-Memory Pub/Sub event bus

---

## 🏃 Running StockSense

### Quick Start
Double-click `start.bat` or run:
```powershell
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
Then open: **`http://localhost:8000`** in any web browser (Chrome, Edge, Firefox, Safari).

### Default Demo Logins
- **Inventory Manager**: `manager@stocksense.com` / `admin123`
- **Warehouse Staff**: `staff@stocksense.com` / `staff123`
