# StockSense — Modular Real-Time Inventory Management System (IMS)

[![Render Deployment](https://img.shields.io/badge/Render-Live%20Deploy-success?style=flat&logo=render)](https://stocksense-web-1z1f.onrender.com)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18%20%7C%2016-336791?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org)

StockSense is an enterprise-grade, modular, real-time Inventory Management System built strictly in accordance with the **Odoo Hackathon Problem Statement (`StockSense.pdf`)**. It digitizes and centralizes all stock operations within a modern business—replacing manual registers and disconnected spreadsheets with automated receipts, delivery orders, internal multi-warehouse transfers, physical count adjustments, and an immutable stock ledger audit trail.

---

## 🌐 Live Deployment & Links

* **Live Application:** [https://stocksense-web-1z1f.onrender.com](https://stocksense-web-1z1f.onrender.com)
* **Interactive Swagger API Docs:** [https://stocksense-web-1z1f.onrender.com/docs](https://stocksense-web-1z1f.onrender.com/docs)
* **GitHub Repository:** [https://github.com/Khushi-888/AJL](https://github.com/Khushi-888/AJL)

---

## 🔑 Default Demo Credentials

| Role | Email | Password | Access Privileges |
| :--- | :--- | :--- | :--- |
| **Inventory Manager** | `manager@stocksense.com` | `admin123` | Full access: catalogs, warehouses, reorder thresholds, operation validation |
| **Warehouse Staff** | `staff@stocksense.com` | `staff123` | Operational access: pick/pack deliveries, execute transfers, perform counts |

---

## 🚀 Key Modules & Capabilities (From Problem Statement)

### 1. Authentication & Security
- **Role-Based Access Control (RBAC):** Distinct roles for *Inventory Managers* and *Warehouse Staff*.
- **JWT Authentication:** Secure stateless JSON Web Token sessions with auto-refresh.
- **OTP Password Reset:** Time-based One-Time Password (TOTP) generator and verification system with a 5-minute expiry window cached in Redis / MemoryBus.
- **Quick Profile Menu:** Left sidebar dropdown for profile info and single-click logout.

### 2. Live Dashboard View & Dynamic KPIs
- **5 Real-Time Critical KPIs:**
  1. **Total Products in Stock:** Real-time catalog SKU volume and physical unit balance.
  2. **Low Stock / Out of Stock Items:** Dynamic alerts whenever on-hand stock falls below safety reorder levels.
  3. **Pending Receipts:** Inbound vendor shipments awaiting verification and reception.
  4. **Pending Deliveries:** Customer dispatches ready for fulfillment.
  5. **Internal Transfers Scheduled:** Inter-location stock movements in waiting status.
- **Dynamic Multi-Criteria Filters:**
  - By **Operation Type:** Receipts, Deliveries, Internal Transfers, Adjustments.
  - By **Status:** `Draft`, `Waiting`, `Ready`, `Done` (Validated), `Canceled`.
  - By **Warehouse & Location:** Multi-facility filtering.
  - By **Category:** Raw Materials, Finished Goods, Hardware, Furniture, Components.
- **Visual Analytics:** Interactive stock distribution chart powered by Chart.js.

### 3. Core Stock Operations Workflow
1. **Receipts (Incoming Goods):**
   - Record inbound shipments from vendors (e.g., Tata Steel Ltd).
   - Validating automatically increments `stock_quants` and writes an append-only entry to the `stock_ledger`.
2. **Delivery Orders (Outgoing Goods):**
   - Fulfill customer purchase orders (e.g., Apex Corp).
   - Strict availability checking protects against negative stock anomalies.
   - Validating decrements quantities atomically.
3. **Internal Transfers:**
   - Transfer stock across locations or warehouses (`Main Store` → `Production Rack`, `Rack A` → `Rack B`, `WH-MAIN` → `WH-NORTH`).
   - Simultaneously updates source and destination locations in an atomic transaction.
4. **Stock Adjustments:**
   - Resolve discrepancies between recorded system quantities and physical counts.
   - Calculates the net delta (+ or -) and records the justification.

### 4. Move History (Immutable Stock Ledger)
- Chronological, append-only ledger tracking every stock mutation:
  - Timestamp, Document Reference (`WH/IN/...`, `WH/OUT/...`, `WH/INT/...`, `WH/ADJ/...`), Product SKU/Name, Location, Quantity Change (+/-), and Resulting Balance After.

### 5. Multi-Warehouse & Location Architecture
- Hierarchical structure: **Warehouse** $\rightarrow$ **Internal Locations** (Main Store, Production Rack, Rack A, Storage Yard).
- **Stock Availability Matrix:** Live 2D grid reporting on-hand inventory across all locations simultaneously.

### 6. 1-Click Interactive PDF Demo Walkthrough
A dedicated button in the sidebar automates the 4-step real-world flow from pages 3–4 of `StockSense.pdf`:
1. **Step 1:** Receive 100 kg Steel Rods from Vendor (+100 kg to Main Store)
2. **Step 2:** Transfer 25 kg to Production Rack (Main Store $\rightarrow$ Production Rack)
3. **Step 3:** Deliver 20 kg to Customer (Dispatch and decrement)
4. **Step 4:** Adjust damaged items (Record 3 kg damaged steel discrepancy)
5. **Step 5:** Automatically loads **Move History** for instant audit verification!

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend Framework** | FastAPI (Python 3.11), Uvicorn ASGI Server |
| **Database & ORM** | PostgreSQL 18 / 16, SQLAlchemy 2.0 (Async), `asyncpg` driver |
| **Authentication** | Native `bcrypt` hashing, `python-jose` JWT tokens, `pyotp` (TOTP) |
| **Validation** | Pydantic v2, `email-validator`, `python-multipart` |
| **Real-Time & Cache** | WebSockets, Redis with in-memory PubSub fallback |
| **Frontend UI** | Responsive Web SPA (HTML5, Tailwind CSS, Lucide Icons, Chart.js) |
| **Cloud Deployment** | Render Cloud Platform (Free Tier Blueprint: Web Service + Postgres + Redis) |

---

## 🏃 Local Setup & Execution

### Prerequisites
- Python 3.11+ installed
- PostgreSQL 16+ or 18 running locally on port 5432

### Quick Start (Windows)
Double-click `start.bat` or run:
```powershell
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run database migration / seed (automatic on startup)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
Open **`http://localhost:8000`** in any web browser.

---

## ☁️ Cloud Deployment (Render Infrastructure as Code)

StockSense includes a turnkey [`render.yaml`](file:///D:/Odoo-Hackathon/render.yaml) blueprint configuring:
1. `stocksense-web`: Web Service (Python 3.11, FastAPI, Uvicorn)
2. `stocksense-db`: Managed PostgreSQL database (version 16)
3. `stocksense-redis`: Redis Cache & Broker

All configured under Render's **Free Tier** for instant deployment.

---

## 📂 Project Directory Structure

```text
Odoo-Hackathon/
├── backend/
│   ├── main.py              # FastAPI app, lifespan DB init, static file serving
│   ├── database.py          # SQLAlchemy async engine & PostgreSQL session maker
│   ├── models.py            # Relational models (Users, Warehouses, Quants, Documents, Ledger)
│   ├── schemas.py           # Pydantic v2 request/response schemas
│   ├── auth.py              # Native bcrypt password hashing & JWT token validation
│   ├── events.py            # Pub/Sub event bus with in-memory fallback
│   ├── seed.py              # Idempotent database seeder with sample data
│   └── routers/
│       ├── auth.py          # User registration, OAuth2 login, JWT endpoint
│       ├── operations.py    # Receipts, deliveries, transfers, adjustments, ledger, KPIs
│       ├── products.py      # Product catalog, SKU & reorder thresholds
│       ├── warehouses.py    # Multi-warehouse and location management
│       ├── otp.py           # TOTP password reset generator and verifier
│       └── websocket.py     # Live WebSocket real-time event broadcaster
├── frontend/
│   ├── index.html           # Full responsive Single Page Application (SPA)
│   ├── app.js               # Client controller, API client, charts, workflows
│   ├── style.css            # Custom responsive styles & animations
│   └── views/               # Modular view components
├── agents/                  # AI inventory agent workflows (LangGraph & LangChain)
├── render.yaml              # Render Infrastructure-as-Code Blueprint specification
├── requirements.txt         # Production Python dependencies
├── start.bat                # 1-click Windows local launch script
└── README.md                # Project documentation and specifications
```

---

## 📄 License
This project was developed for the **Odoo Hackathon**. All rights reserved.
