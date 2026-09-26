/**
 * StockSense - Main Frontend Application Logic
 * Implements all specifications from StockSense.pdf
 */

// Global State
let currentUser = {
  id: 1,
  name: "Khushi Saharan",
  email: "manager@stocksense.com",
  role: "manager"
};

let allProducts = [];
let allWarehouses = [];
let allLocations = [];
let allDocuments = [];
let stockChartInstance = null;
let currentView = "dashboard";
let currentProductSubTab = "catalog";

// WebSocket connection
let ws = null;

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  checkAuthSession();
  setupWebSocket();
  await loadInitialData();
  navigateTo("dashboard");
});

// Authentication session
function checkAuthSession() {
  const saved = localStorage.getItem("stocksense_user");
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      updateUserUI();
    } catch (e) {
      console.error(e);
    }
  } else {
    updateUserUI();
  }
}

function updateUserUI() {
  document.getElementById("headerUserName").textContent = currentUser.name || currentUser.email;
  document.getElementById("headerUserRole").textContent = currentUser.role === "manager" ? "Inventory Manager" : "Warehouse Staff";
  
  const initials = (currentUser.name || currentUser.email)
    .split(" ")
    .map(n => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
    
  document.getElementById("userAvatar").textContent = initials || "U";
  document.getElementById("profileBigAvatar").textContent = initials || "U";
  document.getElementById("profileName").textContent = currentUser.name;
  document.getElementById("profileEmail").textContent = currentUser.email;
  document.getElementById("profileRoleBadge").textContent = currentUser.role === "manager" ? "Inventory Manager" : "Warehouse Staff";
  document.getElementById("profileRoleDesc").textContent = currentUser.role === "manager" 
    ? "Full inventory & warehouse authority (Manager)" 
    : "Warehouse operations, picking, transfers (Staff)";
}

function setQuickRole(role) {
  if (role === "manager") {
    document.getElementById("loginEmail").value = "manager@stocksense.com";
    document.getElementById("loginPassword").value = "admin123";
    document.getElementById("btnQuickManager").className = "flex-1 py-1.5 px-3 rounded-xl text-xs font-bold bg-white text-indigo-700 shadow-xs transition";
    document.getElementById("btnQuickStaff").className = "flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition";
  } else {
    document.getElementById("loginEmail").value = "staff@stocksense.com";
    document.getElementById("loginPassword").value = "staff123";
    document.getElementById("btnQuickStaff").className = "flex-1 py-1.5 px-3 rounded-xl text-xs font-bold bg-white text-indigo-700 shadow-xs transition";
    document.getElementById("btnQuickManager").className = "flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition";
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  try {
    const res = await fetch("/auth/login-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Authentication failed");

    currentUser = data.user;
    localStorage.setItem("stocksense_token", data.access_token);
    localStorage.setItem("stocksense_user", JSON.stringify(data.user));
    updateUserUI();
    closeModal("loginModal");
    showToast(`Welcome back, ${currentUser.name}!`, "success");
    await loadInitialData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function handleLogout() {
  localStorage.removeItem("stocksense_token");
  localStorage.removeItem("stocksense_user");
  currentUser = { id: 0, name: "Guest User", email: "guest@stocksense.com", role: "staff" };
  updateUserUI();
  showToast("Logged out successfully.", "info");
}

// OTP Password Reset Flow (PDF Page 1)
function switchAuthView(view) {
  if (view === "otp") {
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("otpResetView").classList.remove("hidden");
    document.getElementById("authModalTitle").textContent = "Reset Password";
    document.getElementById("authModalSubtitle").textContent = "OTP Verification";
  } else {
    document.getElementById("otpResetView").classList.add("hidden");
    document.getElementById("loginForm").classList.remove("hidden");
    document.getElementById("authModalTitle").textContent = "StockSense Sign In";
    document.getElementById("authModalSubtitle").textContent = "Modular Inventory Management System";
  }
}

async function handleGenerateOtp() {
  const email = document.getElementById("otpEmail").value.trim();
  if (!email) return showToast("Enter your email address", "error");

  try {
    const res = await fetch(`/otp/generate/${encodeURIComponent(email)}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to generate OTP");

    showToast(`OTP generated: ${data.code} (Expires in 5 mins)`, "success");
    document.getElementById("otpStep2").classList.remove("hidden");
    document.getElementById("otpCode").value = data.code;
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleResetPassword() {
  const email = document.getElementById("otpEmail").value.trim();
  const code = document.getElementById("otpCode").value.trim();
  const new_password = document.getElementById("otpNewPassword").value;

  if (!code || !new_password) {
    return showToast("Provide both the OTP code and new password", "error");
  }

  try {
    const res = await fetch("/otp/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, new_password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Reset failed");

    showToast("Password reset successfully! Please sign in.", "success");
    switchAuthView("login");
    document.getElementById("loginEmail").value = email;
    document.getElementById("loginPassword").value = new_password;
  } catch (err) {
    showToast(err.message, "error");
  }
}

// WebSocket real-time updates
function setupWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      document.getElementById("wsStatusBadge").innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="hidden sm:inline">Live Sync</span>
      `;
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "stock_updated") {
          showToast(`Stock updated: ${payload.data.trigger} (${payload.data.change > 0 ? '+' : ''}${payload.data.change})`, "info");
          // Refresh background data
          refreshCurrentViewData();
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      document.getElementById("wsStatusBadge").innerHTML = `
        <span class="w-2 h-2 rounded-full bg-amber-400"></span>
        <span class="hidden sm:inline">Polling</span>
      `;
      setTimeout(setupWebSocket, 3000);
    };
  } catch (e) {
    console.error("WS error:", e);
  }
}

// Load Core Data
async function loadInitialData() {
  await Promise.all([
    fetchWarehousesAndLocations(),
    fetchProducts(),
    fetchCategories(),
  ]);
  populateLocationDropdowns();
  populateProductDropdowns();
}

async function fetchWarehousesAndLocations() {
  try {
    const [whRes, locRes] = await Promise.all([
      fetch("/warehouses/"),
      fetch("/warehouses/locations")
    ]);
    allWarehouses = await whRes.json();
    allLocations = await locRes.json();
    renderWarehousesSettings();
  } catch (e) {
    console.error(e);
  }
}

async function fetchProducts() {
  try {
    const res = await fetch("/products/");
    allProducts = await res.json();
    document.getElementById("productCountBadge").textContent = allProducts.length;
    renderProductCatalog(allProducts);
    renderLowStockAlerts(allProducts);
  } catch (e) {
    console.error(e);
  }
}

async function fetchCategories() {
  try {
    const res = await fetch("/products/categories");
    const categories = await res.json();
    
    const filterCat = document.getElementById("filterCategory");
    const catalogCat = document.getElementById("catalogCategorySelect");
    
    let html = `<option value="all">All Categories</option>`;
    categories.forEach(c => {
      html += `<option value="${c}">${c}</option>`;
    });
    filterCat.innerHTML = html;
    catalogCat.innerHTML = html;
  } catch (e) {
    console.error(e);
  }
}

function populateLocationDropdowns() {
  const ids = ["recDestLocation", "delSourceLocation", "traSourceLocation", "traDestLocation", "adjLocation", "newProdInitialLocation", "filterLocation"];
  
  ids.forEach(elemId => {
    const el = document.getElementById(elemId);
    if (!el) return;
    
    let html = elemId === "filterLocation" ? `<option value="">All Locations</option>` : "";
    allLocations.forEach(loc => {
      const whName = loc.warehouse ? loc.warehouse.name : "Warehouse";
      html += `<option value="${loc.id}">${loc.name} (${whName})</option>`;
    });
    el.innerHTML = html;
  });

  const parentWhEl = document.getElementById("locParentWh");
  if (parentWhEl) {
    let whHtml = "";
    allWarehouses.forEach(wh => {
      whHtml += `<option value="${wh.id}">${wh.name} (${wh.code || 'WH'})</option>`;
    });
    parentWhEl.innerHTML = whHtml;
  }
}

function populateProductDropdowns() {
  const ids = ["recProduct", "delProduct", "traProduct", "adjProduct"];
  ids.forEach(elemId => {
    const el = document.getElementById(elemId);
    if (!el) return;
    let html = "";
    allProducts.forEach(p => {
      html += `<option value="${p.id}">${p.name} [SKU: ${p.sku}] (${p.total_stock} ${p.uom})</option>`;
    });
    el.innerHTML = html;
  });
}

// Navigation Handler
function navigateTo(view) {
  currentView = view;
  // Update sidebar active class
  document.querySelectorAll(".nav-btn").forEach(btn => {
    const nav = btn.getAttribute("data-nav");
    if (nav === view || (view.startsWith("operations") && nav === view)) {
      btn.className = "nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold bg-indigo-50 text-indigo-700 transition";
    } else {
      btn.className = "nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition";
    }
  });

  // Hide all views
  const views = ["dashboard", "products", "operations-single", "ledger", "settings"];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add("hidden");
  });

  // Close mobile sidebar
  if (window.innerWidth < 1024) {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("mobileBackdrop");
    sidebar.classList.add("-translate-x-full");
    backdrop.classList.add("hidden");
  }

  if (view === "dashboard") {
    document.getElementById("view-dashboard").classList.remove("hidden");
    loadDashboardData();
  } else if (view === "products") {
    document.getElementById("view-products").classList.remove("hidden");
    switchProductTab(currentProductSubTab);
  } else if (["receipts", "deliveries", "transfers", "adjustments"].includes(view)) {
    document.getElementById("view-operations-single").classList.remove("hidden");
    loadSingleOperationsView(view);
  } else if (view === "ledger") {
    document.getElementById("view-ledger").classList.remove("hidden");
    loadLedgerData();
  } else if (view === "settings") {
    document.getElementById("view-settings").classList.remove("hidden");
    renderWarehousesSettings();
  }

  lucide.createIcons();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("mobileBackdrop");
  const isClosed = sidebar.classList.contains("-translate-x-full");
  if (isClosed) {
    sidebar.classList.remove("-translate-x-full");
    backdrop.classList.remove("hidden");
  } else {
    sidebar.classList.add("-translate-x-full");
    backdrop.classList.add("hidden");
  }
}

function toggleQuickActions() {
  const dropdown = document.getElementById("quickActionsDropdown");
  dropdown.classList.toggle("hidden");
}

// Dashboard Data Loading (PDF Page 1)
async function loadDashboardData() {
  try {
    // 1. Fetch KPIs
    const kpiRes = await fetch("/operations/kpis");
    const kpis = await kpiRes.json();
    document.getElementById("kpiTotalProducts").textContent = kpis.total_products;
    document.getElementById("kpiStockUnits").textContent = `${kpis.total_stock_units} units on hand`;
    document.getElementById("kpiLowStock").textContent = kpis.low_stock_count;
    document.getElementById("kpiPendingReceipts").textContent = kpis.pending_receipts;
    document.getElementById("kpiPendingDeliveries").textContent = kpis.pending_deliveries;
    document.getElementById("kpiScheduledTransfers").textContent = kpis.scheduled_transfers;

    // 2. Fetch filtered documents
    applyFilters();

    // 3. Render Chart
    renderStockChart();
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

// Dynamic Filter Application (PDF Page 1)
async function applyFilters() {
  const docType = document.getElementById("filterDocType").value;
  const status = document.getElementById("filterStatus").value;
  const locId = document.getElementById("filterLocation").value;
  const category = document.getElementById("filterCategory").value;
  const search = document.getElementById("globalSearchInput") ? document.getElementById("globalSearchInput").value.trim() : "";

  let url = `/operations/documents?limit=100`;
  if (docType && docType !== "all") url += `&doc_type=${docType}`;
  if (status && status !== "all") url += `&status=${status}`;
  if (locId) url += `&location_id=${locId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(url);
    allDocuments = await res.json();
    renderOperationsTable(allDocuments, "operationsTableBody");
    document.getElementById("filteredDocCount").textContent = `Showing ${allDocuments.length} documents`;
  } catch (err) {
    console.error(err);
  }
}

function resetFilters() {
  document.getElementById("filterDocType").value = "all";
  document.getElementById("filterStatus").value = "all";
  document.getElementById("filterLocation").value = "";
  document.getElementById("filterCategory").value = "all";
  if (document.getElementById("globalSearchInput")) document.getElementById("globalSearchInput").value = "";
  applyFilters();
}

function handleGlobalSearch(e) {
  if (currentView === "dashboard") {
    applyFilters();
  } else if (currentView === "products") {
    document.getElementById("catalogSearchInput").value = e.target.value;
    filterProductCatalog();
  } else if (currentView === "ledger") {
    document.getElementById("ledgerSearchInput").value = e.target.value;
    filterLedgerTable();
  }
}

// Operations Table Renderer
function renderOperationsTable(documents, tableBodyId) {
  const tbody = document.getElementById(tableBodyId);
  if (!tbody) return;

  if (documents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-8 text-center text-slate-400">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
          No operations match the selected filters.
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  const typeConfig = {
    receipt: { label: "Receipt", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "arrow-down-left" },
    delivery: { label: "Delivery", color: "bg-blue-50 text-blue-700 border-blue-200", icon: "arrow-up-right" },
    transfer: { label: "Transfer", color: "bg-amber-50 text-amber-700 border-amber-200", icon: "repeat" },
    adjustment: { label: "Adjustment", color: "bg-purple-50 text-purple-700 border-purple-200", icon: "sliders" }
  };

  const statusConfig = {
    draft: { label: "Draft", color: "bg-slate-100 text-slate-600 border-slate-200" },
    waiting: { label: "Waiting", color: "bg-amber-100 text-amber-700 border-amber-200" },
    ready: { label: "Ready", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
    done: { label: "Done", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    canceled: { label: "Canceled", color: "bg-rose-100 text-rose-700 border-rose-200" },
  };

  tbody.innerHTML = documents.map(doc => {
    const tCfg = typeConfig[doc.doc_type] || { label: doc.doc_type, color: "bg-slate-100 text-slate-600", icon: "file" };
    const sCfg = statusConfig[doc.status] || { label: doc.status, color: "bg-slate-100 text-slate-600" };
    
    const itemsSummary = (doc.lines && doc.lines.length > 0)
      ? doc.lines.map(l => `${l.quantity} × ${l.product ? l.product.name : 'Item'}`).join(", ")
      : "No items";

    const targetDesc = doc.partner_name || (doc.dest_location ? doc.dest_location.name : "Warehouse");
    const dateStr = new Date(doc.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    let actionBtn = "";
    if (doc.status !== "done" && doc.status !== "canceled") {
      actionBtn = `
        <button onclick="handleValidateDocument(${doc.id})" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition">
          Validate
        </button>
      `;
    }

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-bold text-slate-900 flex items-center gap-1.5">
          <i data-lucide="${tCfg.icon}" class="w-3.5 h-3.5 text-slate-400"></i>
          <span>${doc.reference}</span>
        </td>
        <td class="px-4 py-3.5">
          <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tCfg.color}">
            ${tCfg.label}
          </span>
        </td>
        <td class="px-4 py-3.5 font-medium text-slate-800 max-w-xs truncate">${targetDesc}</td>
        <td class="px-4 py-3.5 text-slate-600 text-xs max-w-xs truncate">${itemsSummary}</td>
        <td class="px-4 py-3.5">
          <span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${sCfg.color}">
            ${sCfg.label}
          </span>
        </td>
        <td class="px-4 py-3.5 text-xs text-slate-400 whitespace-nowrap">${dateStr}</td>
        <td class="px-5 py-3.5 text-right whitespace-nowrap">
          ${actionBtn}
        </td>
      </tr>
    `;
  }).join("");

  lucide.createIcons();
}

// Single Operations Views (Receipts, Deliveries, Transfers, Adjustments)
async function loadSingleOperationsView(typeSingular) {
  const typeMap = {
    receipts: { type: "receipt", title: "1. Receipts (Incoming Stock)", subtitle: "Process arrival of goods from suppliers. Validating increases stock.", modal: "receiptModal" },
    deliveries: { type: "delivery", title: "2. Delivery Orders (Outgoing Stock)", subtitle: "Dispatch goods to customers. Validating decreases stock.", modal: "deliveryModal" },
    transfers: { type: "transfer", title: "3. Internal Transfers", subtitle: "Move inventory between warehouses and locations.", modal: "transferModal" },
    adjustments: { type: "adjustment", title: "4. Inventory Adjustments", subtitle: "Fix physical count and recorded stock discrepancies.", modal: "adjustmentModal" },
  };

  const info = typeMap[typeSingular];
  document.getElementById("operationsViewTitle").textContent = info.title;
  document.getElementById("operationsViewSubtitle").textContent = info.subtitle;
  
  const addBtn = document.getElementById("operationsViewAddBtn");
  addBtn.onclick = () => openModal(info.modal);

  try {
    const res = await fetch(`/operations/documents?doc_type=${info.type}&limit=100`);
    const docs = await res.json();
    renderOperationsTable(docs, "singleOperationsTableBody");
  } catch (err) {
    console.error(err);
  }
}

async function handleValidateDocument(docId) {
  try {
    const res = await fetch(`/operations/documents/${docId}/validate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Validation failed");

    showToast(`Document ${data.reference} validated successfully!`, "success");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Operations Creation Handlers
async function handleCreateReceipt(e) {
  e.preventDefault();
  const supplier_name = document.getElementById("recSupplierName").value;
  const dest_location_id = parseInt(document.getElementById("recDestLocation").value);
  const product_id = parseInt(document.getElementById("recProduct").value);
  const quantity = parseFloat(document.getElementById("recQuantity").value);
  const notes = document.getElementById("recNotes").value;
  const validate_immediately = document.getElementById("recValidateImmediately").checked;

  try {
    const res = await fetch("/operations/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_name,
        dest_location_id,
        notes,
        validate_immediately,
        items: [{ product_id, quantity, dest_location_id }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create receipt");

    closeModal("receiptModal");
    e.target.reset();
    showToast(`Receipt ${data.reference} created (${validate_immediately ? 'Stock increased' : 'Ready'})`, "success");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleCreateDelivery(e) {
  e.preventDefault();
  const customer_name = document.getElementById("delCustomerName").value;
  const source_location_id = parseInt(document.getElementById("delSourceLocation").value);
  const product_id = parseInt(document.getElementById("delProduct").value);
  const quantity = parseFloat(document.getElementById("delQuantity").value);
  const notes = document.getElementById("delNotes").value;
  const validate_immediately = document.getElementById("delValidateImmediately").checked;

  try {
    const res = await fetch("/operations/delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name,
        source_location_id,
        notes,
        validate_immediately,
        items: [{ product_id, quantity, source_location_id }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create delivery");

    closeModal("deliveryModal");
    e.target.reset();
    showToast(`Delivery ${data.reference} created (${validate_immediately ? 'Stock decreased' : 'Ready'})`, "success");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleCreateTransfer(e) {
  e.preventDefault();
  const source_location_id = parseInt(document.getElementById("traSourceLocation").value);
  const dest_location_id = parseInt(document.getElementById("traDestLocation").value);
  const product_id = parseInt(document.getElementById("traProduct").value);
  const quantity = parseFloat(document.getElementById("traQuantity").value);
  const notes = document.getElementById("traNotes").value;
  const validate_immediately = document.getElementById("traValidateImmediately").checked;

  if (source_location_id === dest_location_id) {
    return showToast("Source and Destination locations must be different", "error");
  }

  try {
    const res = await fetch("/operations/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_location_id,
        dest_location_id,
        notes,
        validate_immediately,
        items: [{ product_id, quantity, source_location_id, dest_location_id }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create transfer");

    closeModal("transferModal");
    e.target.reset();
    showToast(`Transfer ${data.reference} executed!`, "success");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Stock Adjustment Calculation & Submission (PDF Page 3)
async function updateRecordedStockDisplay() {
  const prodId = parseInt(document.getElementById("adjProduct").value);
  const locId = parseInt(document.getElementById("adjLocation").value);
  const recEl = document.getElementById("adjRecordedQty");

  if (!prodId || !locId) {
    recEl.textContent = "--";
    return;
  }

  try {
    const pRes = await fetch(`/products/${prodId}`);
    const product = await pRes.json();
    const quant = product.quants.find(q => q.location_id === locId);
    const recorded = quant ? quant.quantity : 0.0;
    recEl.textContent = `${recorded} ${product.uom}`;
    recEl.setAttribute("data-raw-recorded", recorded);
    calculateAdjustmentDelta();
  } catch (e) {
    recEl.textContent = "0.00";
  }
}

function calculateAdjustmentDelta() {
  const recEl = document.getElementById("adjRecordedQty");
  const recorded = parseFloat(recEl.getAttribute("data-raw-recorded") || 0);
  const counted = parseFloat(document.getElementById("adjCountedQty").value || 0);
  const delta = counted - recorded;
  
  const deltaEl = document.getElementById("adjDeltaDisplay");
  deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
  deltaEl.className = delta < 0 ? "text-lg font-bold text-rose-600" : (delta > 0 ? "text-lg font-bold text-emerald-600" : "text-lg font-bold text-slate-500");
}

async function handleCreateAdjustment(e) {
  e.preventDefault();
  const product_id = parseInt(document.getElementById("adjProduct").value);
  const location_id = parseInt(document.getElementById("adjLocation").value);
  const counted_quantity = parseFloat(document.getElementById("adjCountedQty").value);
  const notes = document.getElementById("adjNotes").value;

  try {
    const res = await fetch("/operations/adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id,
        location_id,
        counted_quantity,
        notes
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to adjust stock");

    closeModal("adjustmentModal");
    e.target.reset();
    showToast(`Inventory adjusted! Reference: ${data.reference}`, "success");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Product Management (PDF Page 2)
async function handleCreateProduct(e) {
  e.preventDefault();
  const name = document.getElementById("newProdName").value;
  const sku = document.getElementById("newProdSku").value;
  const category = document.getElementById("newProdCategory").value || "General";
  const uom = document.getElementById("newProdUom").value;
  const reorder_point = parseFloat(document.getElementById("newProdReorderPoint").value || 10);
  const initial_stock = parseFloat(document.getElementById("newProdInitialStock").value || 0);
  const initial_location_id = document.getElementById("newProdInitialLocation").value ? parseInt(document.getElementById("newProdInitialLocation").value) : null;

  try {
    const res = await fetch("/products/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        sku,
        category,
        uom,
        reorder_point,
        initial_stock,
        initial_location_id
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create product");

    closeModal("productModal");
    e.target.reset();
    showToast(`Product "${data.name}" created!`, "success");
    await loadInitialData();
    if (currentView === "products") renderProductCatalog(allProducts);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function switchProductTab(tab) {
  currentProductSubTab = tab;
  const tabs = ["catalog", "availability", "reorder"];
  tabs.forEach(t => {
    const btn = document.getElementById(`prodTab-${t}`);
    const subview = document.getElementById(`subview-${t}`);
    if (t === tab) {
      btn.className = "pb-3 border-b-2 border-indigo-600 text-indigo-600 transition";
      subview.classList.remove("hidden");
    } else {
      btn.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 transition";
      subview.classList.add("hidden");
    }
  });

  if (tab === "catalog") {
    renderProductCatalog(allProducts);
  } else if (tab === "availability") {
    loadStockMatrix();
  } else if (tab === "reorder") {
    loadReorderingRules();
  }
}

function renderProductCatalog(products) {
  const tbody = document.getElementById("productCatalogTableBody");
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-6 text-center text-slate-400">No products found.</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const isLow = p.is_low_stock;
    const statusBadge = isLow
      ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Low Stock</span>`
      : `<span class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Sufficient</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-mono font-bold text-xs text-indigo-700">${p.sku}</td>
        <td class="px-4 py-3.5 font-bold text-slate-900">${p.name}</td>
        <td class="px-4 py-3.5 text-slate-600">${p.category}</td>
        <td class="px-4 py-3.5 text-slate-500">${p.uom}</td>
        <td class="px-4 py-3.5 text-slate-600 font-semibold">${p.reorder_point} ${p.uom}</td>
        <td class="px-4 py-3.5 font-black text-slate-900 text-sm ${isLow ? 'text-rose-600' : ''}">
          ${p.total_stock} ${p.uom}
        </td>
        <td class="px-5 py-3.5 text-right">${statusBadge}</td>
      </tr>
    `;
  }).join("");

  lucide.createIcons();
}

function filterProductCatalog() {
  const q = document.getElementById("catalogSearchInput").value.toLowerCase();
  const cat = document.getElementById("catalogCategorySelect").value;
  
  const filtered = allProducts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchCat = cat === "all" || p.category === cat;
    return matchSearch && matchCat;
  });
  renderProductCatalog(filtered);
}

// Stock Availability Matrix (PDF Page 2)
async function loadStockMatrix() {
  try {
    const res = await fetch("/warehouses/stock-matrix");
    const data = await res.json();
    const table = document.getElementById("stockMatrixTable");

    let headerHtml = `
      <thead class="bg-slate-50 text-xs uppercase font-bold text-slate-400 border-b border-slate-200">
        <tr>
          <th class="px-4 py-3">Product (SKU)</th>
          <th class="px-4 py-3">Total</th>
    `;
    data.locations.forEach(loc => {
      headerHtml += `<th class="px-4 py-3 text-right">${loc.name}</th>`;
    });
    headerHtml += `</tr></thead>`;

    let rowsHtml = `<tbody class="divide-y divide-slate-100">`;
    data.products.forEach(p => {
      rowsHtml += `
        <tr class="hover:bg-slate-50 transition">
          <td class="px-4 py-3 font-semibold text-slate-900">${p.product_name} <span class="text-xs text-slate-400 font-mono">(${p.sku})</span></td>
          <td class="px-4 py-3 font-bold text-indigo-700">${p.total_stock} ${p.uom}</td>
      `;
      data.locations.forEach(loc => {
        const qty = p.locations[String(loc.id)] || 0;
        rowsHtml += `
          <td class="px-4 py-3 text-right font-medium ${qty > 0 ? 'text-slate-800' : 'text-slate-300'}">
            ${qty > 0 ? `${qty} ${p.uom}` : '-'}
          </td>
        `;
      });
      rowsHtml += `</tr>`;
    });
    rowsHtml += `</tbody>`;

    table.innerHTML = headerHtml + rowsHtml;
  } catch (e) {
    console.error(e);
  }
}

// Reordering Rules (PDF Page 2)
async function loadReorderingRules() {
  try {
    const res = await fetch("/products/reordering-rules");
    const rules = await res.json();
    const tbody = document.getElementById("reorderRulesTableBody");
    
    tbody.innerHTML = rules.map(r => {
      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="px-5 py-3.5 font-bold text-slate-900">${r.product_name}</td>
          <td class="px-4 py-3.5 font-mono text-xs text-slate-600">${r.sku}</td>
          <td class="px-4 py-3.5 font-black ${r.alert ? 'text-rose-600' : 'text-slate-800'}">${r.current_stock} ${r.uom}</td>
          <td class="px-4 py-3.5 text-slate-700 font-semibold">${r.reorder_point} ${r.uom}</td>
          <td class="px-4 py-3.5 font-bold text-indigo-600">${r.suggested_order_qty > 0 ? `+${r.suggested_order_qty} ${r.uom}` : 'Optimal'}</td>
          <td class="px-4 py-3.5">
            ${r.alert 
              ? `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">Below Minimum</span>` 
              : `<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Safe Stock</span>`}
          </td>
          <td class="px-5 py-3.5 text-right">
            ${r.alert ? `
              <button onclick="quickOrderReceipt(${r.product_id})" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs">
                Order Inbound
              </button>
            ` : '-'}
          </td>
        </tr>
      `;
    }).join("");
    lucide.createIcons();
  } catch (e) {
    console.error(e);
  }
}

function quickOrderReceipt(productId) {
  openModal("receiptModal");
  document.getElementById("recProduct").value = productId;
}

// Move History / Stock Ledger (PDF Page 3)
async function loadLedgerData() {
  try {
    const res = await fetch("/operations/ledger?limit=150");
    const ledger = await res.json();
    renderLedgerTable(ledger);
    document.getElementById("ledgerCountBadge").textContent = `${ledger.length} total movements logged`;
  } catch (err) {
    console.error(err);
  }
}

function renderLedgerTable(entries) {
  const tbody = document.getElementById("ledgerTableBody");
  if (!tbody) return;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400">No ledger entries recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(item => {
    const dateStr = new Date(item.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const isPositive = item.quantity_change > 0;
    const qtyBadge = isPositive
      ? `<span class="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">+${item.quantity_change}</span>`
      : `<span class="text-xs font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">${item.quantity_change}</span>`;

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">${dateStr}</td>
        <td class="px-4 py-3 font-mono font-bold text-xs text-indigo-700">${item.reference || '-'}</td>
        <td class="px-4 py-3 font-bold text-slate-900">${item.product_name} <span class="text-xs font-normal text-slate-400">(${item.product_sku})</span></td>
        <td class="px-4 py-3 text-slate-700 font-medium">${item.location_name}</td>
        <td class="px-4 py-3">${qtyBadge}</td>
        <td class="px-4 py-3 font-bold text-slate-800 text-xs">${item.balance_after !== null ? item.balance_after : '-'}</td>
        <td class="px-5 py-3 text-xs text-slate-500">${item.note || '-'}</td>
      </tr>
    `;
  }).join("");
}

function filterLedgerTable() {
  const q = document.getElementById("ledgerSearchInput").value.toLowerCase();
  const rows = document.querySelectorAll("#ledgerTableBody tr");
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(q) ? "" : "none";
  });
}

// Warehouses Settings (PDF Page 2)
function renderWarehousesSettings() {
  const container = document.getElementById("warehousesContainer");
  if (!container) return;

  if (allWarehouses.length === 0) {
    container.innerHTML = `<p class="text-slate-400">No warehouses configured yet.</p>`;
    return;
  }

  container.innerHTML = allWarehouses.map(wh => {
    const locs = allLocations.filter(l => l.warehouse_id === wh.id);
    const locChips = locs.map(l => `
      <div class="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
        <div class="flex items-center gap-2">
          <i data-lucide="map-pin" class="w-4 h-4 text-indigo-600"></i>
          <span class="text-xs font-bold text-slate-800">${l.name}</span>
        </div>
        <span class="text-[10px] uppercase font-semibold text-slate-400 bg-white px-2 py-0.5 rounded-md border border-slate-200">${l.location_type || 'internal'}</span>
      </div>
    `).join("");

    return `
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
                <i data-lucide="warehouse" class="w-5 h-5"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-900">${wh.name}</h3>
                <span class="text-xs text-slate-400 font-mono">${wh.code || 'WH'}</span>
              </div>
            </div>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${locs.length} Locations</span>
          </div>
          <p class="text-xs text-slate-500 mb-4">${wh.address || 'Standard Storage Facility'}</p>

          <div class="space-y-2 mb-4">
            <span class="text-xs font-bold text-slate-500 uppercase">Locations under this warehouse:</span>
            ${locChips || '<p class="text-xs text-slate-400">No locations added yet.</p>'}
          </div>
        </div>
        <button onclick="openAddLocationForWh(${wh.id})" class="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition flex items-center justify-center gap-1">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add Location to this Warehouse
        </button>
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

function openAddLocationForWh(whId) {
  openModal("locationModal");
  document.getElementById("locParentWh").value = whId;
}

async function handleCreateWarehouse(e) {
  e.preventDefault();
  const name = document.getElementById("whName").value;
  const code = document.getElementById("whCode").value;
  const address = document.getElementById("whAddress").value;

  try {
    const res = await fetch("/warehouses/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, address })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create warehouse");

    closeModal("warehouseModal");
    e.target.reset();
    showToast(`Warehouse "${data.name}" added!`, "success");
    await fetchWarehousesAndLocations();
    populateLocationDropdowns();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleCreateLocation(e) {
  e.preventDefault();
  const warehouse_id = parseInt(document.getElementById("locParentWh").value);
  const name = document.getElementById("locName").value;
  const location_type = document.getElementById("locType").value;

  try {
    const res = await fetch("/warehouses/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouse_id, name, location_type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create location");

    closeModal("locationModal");
    e.target.reset();
    showToast(`Location "${data.name}" created!`, "success");
    await fetchWarehousesAndLocations();
    populateLocationDropdowns();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Low Stock Alerts (PDF Page 3)
function renderLowStockAlerts(products) {
  const container = document.getElementById("lowStockAlertsList");
  const countText = document.getElementById("lowStockCountText");
  if (!container) return;

  const lowProducts = products.filter(p => p.is_low_stock);
  countText.textContent = `${lowProducts.length} items`;

  if (lowProducts.length === 0) {
    container.innerHTML = `
      <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-xs text-emerald-800 flex items-center gap-2">
        <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i>
        <span>All stock levels are above reorder thresholds.</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = lowProducts.map(p => {
    return `
      <div class="p-2.5 bg-rose-50/70 border border-rose-100 rounded-xl flex items-center justify-between">
        <div>
          <span class="block text-xs font-bold text-rose-950">${p.name}</span>
          <span class="text-[11px] text-rose-700">Stock: ${p.total_stock} ${p.uom} (Min: ${p.reorder_point})</span>
        </div>
        <button onclick="quickOrderReceipt(${p.id})" class="px-2 py-1 bg-white text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg text-[11px] font-bold shadow-2xs">
          Replenish
        </button>
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

// Stock Distribution Bar Chart
function renderStockChart() {
  const canvas = document.getElementById("stockBarChart");
  if (!canvas) return;

  const labels = allLocations.map(l => l.name);
  // Calculate quantity per location
  const quantities = allLocations.map(loc => {
    let sum = 0;
    allProducts.forEach(p => {
      const q = p.quants.find(quant => quant.location_id === loc.id);
      if (q) sum += q.quantity;
    });
    return sum;
  });

  if (stockChartInstance) {
    stockChartInstance.destroy();
  }

  stockChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Stock Quantity (Units/kg)',
        data: quantities,
        backgroundColor: '#6366f1',
        borderRadius: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { family: 'Inter', size: 11 } }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Inter', size: 11 } }
        }
      }
    }
  });
}

// 4-STEP INTERACTIVE PDF FLOW (PDF Pages 3 & 4)
async function runPdfDemoWorkflow() {
  const btn = document.getElementById("demoWorkflowBtn");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Running...`;

  try {
    // Find Steel Rods product and Main Store / Production Rack locations
    const steel = allProducts.find(p => p.sku === "STL-ROD-01") || allProducts[0];
    const mainStore = allLocations.find(l => l.name === "Main Store") || allLocations[0];
    const prodRack = allLocations.find(l => l.name === "Production Rack") || allLocations[1];

    // Step 1: Receive 100 kg Steel from Vendor -> Stock: +100
    showToast("Step 1: Receiving 100 kg Steel Rods from Tata Steel (+100)...", "info");
    await fetch("/operations/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_name: "Tata Steel Ltd (PDF Step 1)",
        dest_location_id: mainStore.id,
        notes: "PDF Flow: Receive 100 kg Steel from Vendor",
        validate_immediately: true,
        items: [{ product_id: steel.id, quantity: 100.0, dest_location_id: mainStore.id }]
      })
    });

    await new Promise(r => setTimeout(r, 600));

    // Step 2: Internal Transfer: Main Store -> Production Rack (25 kg)
    showToast("Step 2: Internal Transfer: Main Store → Production Rack...", "info");
    await fetch("/operations/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_location_id: mainStore.id,
        dest_location_id: prodRack.id,
        notes: "PDF Flow: Move to production rack",
        validate_immediately: true,
        items: [{ product_id: steel.id, quantity: 25.0, source_location_id: mainStore.id, dest_location_id: prodRack.id }]
      })
    });

    await new Promise(r => setTimeout(r, 600));

    // Step 3: Deliver finished goods: Deliver 20 steel (-20)
    showToast("Step 3: Delivering 20 steel to Customer (-20)...", "info");
    await fetch("/operations/delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: "Apex Engineering (PDF Step 3)",
        source_location_id: prodRack.id,
        notes: "PDF Flow: Deliver finished goods",
        validate_immediately: true,
        items: [{ product_id: steel.id, quantity: 20.0, source_location_id: prodRack.id }]
      })
    });

    await new Promise(r => setTimeout(r, 600));

    // Step 4: Adjust damaged items: 3 kg steel damaged (-3)
    showToast("Step 4: Adjusting 3 kg damaged steel items...", "info");
    // Get current stock at prodRack for steel
    const prodRes = await fetch(`/products/${steel.id}`);
    const steelDetail = await prodRes.json();
    const curQuant = steelDetail.quants.find(q => q.location_id === prodRack.id);
    const counted = Math.max(0, (curQuant ? curQuant.quantity : 5.0) - 3.0);

    await fetch("/operations/adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: steel.id,
        location_id: prodRack.id,
        counted_quantity: counted,
        notes: "PDF Flow: 3 kg steel damaged"
      })
    });

    showToast("Completed all 4 PDF steps! Opening Move History...", "success");
    await loadInitialData();
    navigateTo("ledger");
  } catch (err) {
    showToast(`PDF Flow Error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Run 4-Step Flow`;
    lucide.createIcons();
  }
}

// Refresh Current Active View Data
function refreshCurrentViewData() {
  if (currentView === "dashboard") {
    loadDashboardData();
  } else if (currentView === "products") {
    switchProductTab(currentProductSubTab);
  } else if (["receipts", "deliveries", "transfers", "adjustments"].includes(currentView)) {
    loadSingleOperationsView(currentView);
  } else if (currentView === "ledger") {
    loadLedgerData();
  }
}

// Toast System
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  const bg = type === "success" 
    ? "bg-emerald-600 text-white" 
    : (type === "error" ? "bg-rose-600 text-white" : "bg-slate-900 text-white");

  toast.className = `${bg} px-4 py-3 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-circle' : 'info')}" class="w-4 h-4 shrink-0"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-x-4");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Modal Helpers
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("hidden");
  lucide.createIcons();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("hidden");
}
