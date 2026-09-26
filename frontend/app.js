/**
 * StockSense - Main Frontend Application Logic
 * Integrates Babylon.js 3D Digital Twin & Motion.dev
 * Aligned with StockSense.pdf Problem Statement
 */

// Dynamic Backend Resolver & Resilient Networking
let API_BASE = "";

function initApiBase() {
  const savedBase = localStorage.getItem("stocksense_api_base");
  if (savedBase) {
    API_BASE = savedBase;
    updateBackendUI();
    return;
  }
  // If running via file:/// or static server port (e.g. Live Server 5500, Vite 5173, etc.)
  if (window.location.protocol === "file:" || (window.location.port && window.location.port !== "8000" && window.location.port !== "80" && window.location.port !== "443")) {
    API_BASE = "https://stocksense-web-1z1f.onrender.com";
  } else {
    API_BASE = ""; // Relative to origin
  }
  updateBackendUI();
}

function toggleBackendTarget() {
  if (API_BASE.includes("onrender.com") || (!API_BASE && window.location.host.includes("onrender.com"))) {
    API_BASE = "http://localhost:8000";
    localStorage.setItem("stocksense_api_base", API_BASE);
    showToast("Target switched to Localhost Backend (http://localhost:8000)", "info");
  } else {
    API_BASE = "https://stocksense-web-1z1f.onrender.com";
    localStorage.setItem("stocksense_api_base", API_BASE);
    showToast("Target switched to Render Cloud Backend", "info");
  }
  updateBackendUI();
  setupWebSocket();
  loadInitialData();
  refreshCurrentViewData();
}

function updateBackendUI() {
  const dot = document.getElementById("backendDot");
  const label = document.getElementById("backendLabel");
  const badge = document.getElementById("backendTargetBadge");
  if (!label || !badge) return;

  const isCloud = API_BASE.includes("onrender.com") || (!API_BASE && window.location.host.includes("onrender.com"));
  if (isCloud) {
    label.textContent = "Cloud API";
    badge.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition shadow-xs cursor-pointer";
    if (dot) dot.className = "w-2 h-2 rounded-full bg-indigo-500 animate-pulse";
  } else {
    label.textContent = "Local API";
    badge.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition shadow-xs cursor-pointer";
    if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
  }
}

// Resilient network fetcher with auto-failover to cloud & token injection
async function apiFetch(endpoint, options = {}) {
  let url = endpoint;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    const cleanEp = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    url = `${API_BASE}${cleanEp}`;
  }

  options.headers = options.headers || {};
  const token = localStorage.getItem("stocksense_token");
  if (token && !options.headers["Authorization"]) {
    options.headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await _nativeFetch(url, options);
    return res;
  } catch (err) {
    // If local fetch failed, auto fallback to Render cloud
    if ((API_BASE === "" || API_BASE.includes("localhost") || API_BASE.includes("127.0.0.1")) && !url.includes("onrender.com")) {
      console.warn("Local backend unreachable. Automatically failing over to Render Cloud...", err);
      const cleanEp = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
      const cloudUrl = `https://stocksense-web-1z1f.onrender.com${cleanEp}`;
      try {
        const fallbackRes = await _nativeFetch(cloudUrl, options);
        API_BASE = "https://stocksense-web-1z1f.onrender.com";
        localStorage.setItem("stocksense_api_base", API_BASE);
        updateBackendUI();
        showToast("Connected to StockSense Cloud (Render)", "info");
        return fallbackRes;
      } catch (cloudErr) {
        console.warn("Cloud failover failed:", cloudErr);
      }
    }

    if (url.includes("onrender.com")) {
      throw new Error("Render Cloud server is waking up from free-tier sleep. Please wait a few seconds and try again.");
    }
    throw new Error(err.message === "Failed to fetch" ? "Network connection error. Server may be offline or unreachable." : err.message);
  }
}

// Intercept standard fetch calls for API paths
const _nativeFetch = window.fetch;
window.fetch = function(input, init) {
  if (typeof input === "string" && (
    input.startsWith("/auth") ||
    input.startsWith("/products") ||
    input.startsWith("/operations") ||
    input.startsWith("/warehouses") ||
    input.startsWith("/otp") ||
    input.startsWith("/ws") ||
    input.startsWith("/health")
  )) {
    return apiFetch(input, init);
  }
  return _nativeFetch.apply(this, arguments);
};

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
let currentSelected3DRack = null;

// WebSocket connection
let ws = null;

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  initApiBase();
  lucide.createIcons();
  checkAuthSession();
  setupWebSocket();
  await loadInitialData();
  init3DWarehouse();
  navigateTo("dashboard");
  initMotionAnimations();
});

// Initialize Babylon.js 3D Digital Twin
function init3DWarehouse() {
  try {
    if (typeof BABYLON !== "undefined" && typeof Warehouse3D !== "undefined") {
      window.warehouse3D = new Warehouse3D("babylonCanvas");
      
      // Hook 3D interaction callback
      window.on3DRackSelected = (rackName) => {
        showRackHUD(rackName);
      };

      // Update 3D beacons based on stock
      updateAll3DBeacons();
    }
  } catch (err) {
    console.error("Babylon.js 3D Init error:", err);
  }
}

function set3DPreset(preset) {
  if (window.warehouse3D) {
    window.warehouse3D.setCameraPreset(preset);
  }
}

function trigger3DFlowStep(stepNum) {
  // Update button active state in top scrubber
  for (let i = 0; i <= 4; i++) {
    const btn = document.getElementById(`flowStepBtn-${i}`);
    if (btn) {
      if (i === stepNum) {
        btn.className = "flow-step-btn px-2.5 py-1 text-xs font-semibold rounded-xl active";
      } else {
        btn.className = "flow-step-btn px-2.5 py-1 text-xs font-semibold rounded-xl text-slate-600 hover:text-slate-900";
      }
    }
  }

  if (window.warehouse3D) {
    window.warehouse3D.playFlowStep(stepNum);
  }
  lucide.createIcons();
}

function closeFlowBanner() {
  if (window.warehouse3D) {
    window.warehouse3D.hideProcessBanner();
  } else {
    const banner = document.getElementById("flowExplanationCard");
    if (banner) banner.classList.add("hidden");
  }
}

function toggle3DRotation() {
  if (window.warehouse3D) {
    const isRotating = window.warehouse3D.toggleAutoRotate();
    const btn = document.getElementById("btnAutoRotate");
    btn.className = isRotating 
      ? "p-1.5 rounded-xl bg-indigo-50 text-indigo-700 transition" 
      : "p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 transition";
  }
}

function showRackHUD(rackName) {
  currentSelected3DRack = rackName;
  const hud = document.getElementById("rackInspectorHUD");
  const title = document.getElementById("hudRackTitle");
  const wh = document.getElementById("hudRackWh");
  const itemsContainer = document.getElementById("hudRackItemsList");

  const loc = allLocations.find(l => l.name === rackName);
  title.textContent = rackName;
  wh.textContent = loc && loc.warehouse ? loc.warehouse.name : "Warehouse Facility";

  // Find products stored in this location
  let itemsHtml = "";
  let totalInRack = 0;
  if (loc) {
    allProducts.forEach(p => {
      const q = p.quants.find(quant => quant.location_id === loc.id);
      if (q && q.quantity > 0) {
        totalInRack += q.quantity;
        itemsHtml += `
          <div class="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <div>
              <span class="font-bold text-slate-800">${p.name}</span>
              <span class="text-[10px] text-slate-500 block font-mono">${p.sku}</span>
            </div>
            <span class="font-mono font-bold text-indigo-600">${q.quantity} ${p.uom}</span>
          </div>
        `;
      }
    });
  }

  if (!itemsHtml) {
    itemsHtml = `<p class="text-xs text-slate-500 italic py-2">No stock currently stored on this shelf.</p>`;
  }

  itemsContainer.innerHTML = itemsHtml;
  hud.classList.remove("hidden");

  // Motion pop-in
  if (window.Motion) {
    Motion.animate(hud, { opacity: [0, 1], y: [15, 0], scale: [0.96, 1] }, { easing: "ease-out", duration: 0.3 });
  }
  lucide.createIcons();
}

function closeRackHUD() {
  document.getElementById("rackInspectorHUD").classList.add("hidden");
}

function quickTransferFromRack() {
  if (!currentSelected3DRack) return;
  const loc = allLocations.find(l => l.name === currentSelected3DRack);
  if (loc) {
    openModal("transferModal");
    document.getElementById("traSourceLocation").value = loc.id;
  }
}

function quickAdjustRack() {
  if (!currentSelected3DRack) return;
  const loc = allLocations.find(l => l.name === currentSelected3DRack);
  if (loc) {
    openModal("adjustmentModal");
    document.getElementById("adjLocation").value = loc.id;
    updateRecordedStockDisplay();
  }
}

function updateAll3DBeacons() {
  if (!window.warehouse3D) return;

  allLocations.forEach(loc => {
    let hasLowStock = false;
    let hasStock = false;

    allProducts.forEach(p => {
      const q = p.quants.find(quant => quant.location_id === loc.id);
      if (q && q.quantity > 0) {
        hasStock = true;
        if (p.is_low_stock) hasLowStock = true;
      }
    });

    const status = hasLowStock ? "low" : (hasStock ? "normal" : "medium");
    window.warehouse3D.updateRackStatus(loc.name, status);
  });
}

// Motion.dev animations
function initMotionAnimations() {
  if (window.Motion) {
    Motion.animate(".kpi-card", { opacity: [0, 1], y: [18, 0] }, {
      delay: Motion.stagger(0.06),
      easing: "ease-out",
      duration: 0.45
    });
  }
}

function animateCounter(elementId, targetValue) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const diff = targetValue - start;
  const duration = 600;
  const startTime = performance.now();

  function updateNumber(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + diff * easeOut);
    el.textContent = current;
    if (progress < 1) requestAnimationFrame(updateNumber);
  }
  requestAnimationFrame(updateNumber);
}

// Authentication state
let selectedAuthRole = "manager";
let selectedAuthMode = "signin";

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
  const isManager = currentUser.role === "manager";
  
  // Header texts
  const headerName = document.getElementById("headerUserName");
  const headerRole = document.getElementById("headerUserRole");
  if (headerName) headerName.textContent = currentUser.name || currentUser.email;
  if (headerRole) headerRole.textContent = isManager ? "Inventory Manager" : "Warehouse Staff";
  
  // Header quick role toggle button
  const toggleBtn = document.getElementById("headerRoleToggleBadge");
  const toggleText = document.getElementById("headerRoleToggleText");
  const toggleIcon = document.getElementById("headerRoleToggleIcon");
  if (toggleBtn && toggleText) {
    if (isManager) {
      toggleBtn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition shadow-xs cursor-pointer";
      toggleText.textContent = "👑 Manager Mode";
    } else {
      toggleBtn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition shadow-xs cursor-pointer";
      toggleText.textContent = "👷 Staff Mode";
    }
  }

  // Initials
  const initials = (currentUser.name || currentUser.email)
    .split(" ")
    .map(n => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
    
  const uAvatar = document.getElementById("userAvatar");
  const pAvatar = document.getElementById("profileBigAvatar");
  if (uAvatar) uAvatar.textContent = initials || "U";
  if (pAvatar) pAvatar.textContent = initials || "U";

  // Profile modal elements
  const pName = document.getElementById("profileName");
  const pEmail = document.getElementById("profileEmail");
  const pBadge = document.getElementById("profileRoleBadge");
  const pDesc = document.getElementById("profileRoleDesc");
  const pCurEmail = document.getElementById("profileCurrentEmail");
  if (pName) pName.textContent = currentUser.name;
  if (pEmail) pEmail.textContent = currentUser.email;
  if (pBadge) {
    pBadge.textContent = isManager ? "Inventory Manager" : "Warehouse Staff";
    pBadge.className = isManager 
      ? "inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
      : "inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800";
  }
  if (pDesc) {
    pDesc.textContent = isManager 
      ? "Executive Authority: Incoming & Outgoing stock, vendors, deliveries & catalog" 
      : "Ground Operations: Internal transfers, order picking, putaway shelving & cycle counts";
  }
  if (pCurEmail) pCurEmail.value = currentUser.email;

  // Toggle Role-Specific Sidebar Menus
  const sideMgr = document.getElementById("sidebarManagerNav");
  const sideStf = document.getElementById("sidebarStaffNav");
  if (sideMgr && sideStf) {
    if (isManager) {
      sideMgr.classList.remove("hidden");
      sideStf.classList.add("hidden");
    } else {
      sideMgr.classList.add("hidden");
      sideStf.classList.remove("hidden");
    }
  }

  // Dashboard role adaptation
  const mgrCenter = document.getElementById("managerStockCenter");
  if (mgrCenter) {
    if (isManager) {
      mgrCenter.classList.remove("hidden");
      renderManagerStockCenter();
    } else {
      mgrCenter.classList.add("hidden");
    }
  }

  // Quick Action menu adaptation
  const qMgr = document.getElementById("quickActionsManagerSection");
  const qStf = document.getElementById("quickActionsStaffSection");
  if (qMgr && qStf) {
    if (isManager) {
      qMgr.classList.remove("hidden");
      qStf.classList.remove("hidden");
    } else {
      qMgr.classList.add("hidden");
      qStf.classList.remove("hidden");
    }
  }

  lucide.createIcons();
}

// 1. SELECT USER ROLE IN AUTH MODAL (Manager vs Staff)
function selectAuthRole(role) {
  selectedAuthRole = role;
  const btnMgr = document.getElementById("btnAuthRoleManager");
  const btnStf = document.getElementById("btnAuthRoleStaff");
  const btnSignSub = document.getElementById("btnSignInSubmit");
  const badge = document.getElementById("signupRoleBadge");
  const btnSignReg = document.getElementById("btnSignUpSubmit");
  const emailIn = document.getElementById("loginEmail");
  const passIn = document.getElementById("loginPassword");

  if (role === "manager") {
    if (btnMgr) btnMgr.className = "flex flex-col items-center py-2 px-3 rounded-xl text-xs font-bold bg-white text-indigo-700 shadow-xs border border-indigo-200 transition";
    if (btnStf) btnStf.className = "flex flex-col items-center py-2 px-3 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition";
    if (btnSignSub) btnSignSub.textContent = "Sign In as Inventory Manager";
    if (badge) {
      badge.textContent = "Inventory Manager";
      badge.className = "font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700";
    }
    if (btnSignReg) btnSignReg.textContent = "Create Inventory Manager Account";
    if (emailIn && (!emailIn.value || emailIn.value.includes("stocksense.com"))) emailIn.value = "manager@stocksense.com";
    if (passIn && (!passIn.value || passIn.value.includes("123"))) passIn.value = "admin123";
  } else {
    if (btnMgr) btnMgr.className = "flex flex-col items-center py-2 px-3 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition";
    if (btnStf) btnStf.className = "flex flex-col items-center py-2 px-3 rounded-xl text-xs font-bold bg-white text-amber-800 shadow-xs border border-amber-300 transition";
    if (btnSignSub) btnSignSub.textContent = "Sign In as Warehouse Staff";
    if (badge) {
      badge.textContent = "Warehouse Staff";
      badge.className = "font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800";
    }
    if (btnSignReg) btnSignReg.textContent = "Create Warehouse Staff Account";
    if (emailIn && (!emailIn.value || emailIn.value.includes("stocksense.com"))) emailIn.value = "staff@stocksense.com";
    if (passIn && (!passIn.value || passIn.value.includes("123"))) passIn.value = "staff123";
  }
}

// 2. SWITCH AUTH MODAL MODE (Sign In / Sign Up / Reset with OTP)
function switchAuthMode(mode) {
  selectedAuthMode = mode;
  const formIn = document.getElementById("authSignInForm");
  const formUp = document.getElementById("authSignUpForm");
  const viewOtp = document.getElementById("otpResetView");
  const tabIn = document.getElementById("tabAuthSignIn");
  const tabUp = document.getElementById("tabAuthSignUp");
  const tabOtp = document.getElementById("tabAuthOtp");

  [tabIn, tabUp, tabOtp].forEach(t => {
    if (t) t.className = "flex-1 py-2 text-center text-slate-400 hover:text-slate-700 transition";
  });

  if (formIn) formIn.classList.add("hidden");
  if (formUp) formUp.classList.add("hidden");
  if (viewOtp) viewOtp.classList.add("hidden");

  if (mode === "signin") {
    if (formIn) formIn.classList.remove("hidden");
    if (tabIn) tabIn.className = "flex-1 py-2 text-center text-indigo-600 border-b-2 border-indigo-600 font-bold transition";
    document.getElementById("authModalTitle").textContent = "StockSense Sign In";
  } else if (mode === "signup") {
    if (formUp) formUp.classList.remove("hidden");
    if (tabUp) tabUp.className = "flex-1 py-2 text-center text-indigo-600 border-b-2 border-indigo-600 font-bold transition";
    document.getElementById("authModalTitle").textContent = "Create New Account";
  } else if (mode === "otp") {
    if (viewOtp) viewOtp.classList.remove("hidden");
    if (tabOtp) tabOtp.className = "flex-1 py-2 text-center text-indigo-600 border-b-2 border-indigo-600 font-bold transition";
    document.getElementById("authModalTitle").textContent = "Reset Password";
    const curEmail = document.getElementById("loginEmail") ? document.getElementById("loginEmail").value : "";
    if (curEmail && document.getElementById("otpEmail")) document.getElementById("otpEmail").value = curEmail;
  }
}

// Quick demo buttons helper
function setQuickRole(role) {
  selectAuthRole(role);
  switchAuthMode("signin");
}

// 3. HANDLE SIGN IN
async function handleLogin(e) {
  if (e) e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
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
    showToast(`Welcome back, ${currentUser.name}! (${currentUser.role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff'})`, "success");
    await loadInitialData();
    if (currentUser.role === "staff") {
      navigateTo("staff");
    } else {
      navigateTo("dashboard");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 4. HANDLE SIGN UP (NEW ACCOUNT)
async function handleSignUp(e) {
  if (e) e.preventDefault();
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const role = selectedAuthRole;

  if (!email || !password) return showToast("Please fill all required fields", "error");

  try {
    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Sign up failed");

    showToast(`Account created as ${role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff'}! Logging in...`, "success");

    // Automatically sign in
    const loginRes = await fetch("/auth/login-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();
    if (loginRes.ok) {
      currentUser = loginData.user;
      localStorage.setItem("stocksense_token", loginData.access_token);
      localStorage.setItem("stocksense_user", JSON.stringify(loginData.user));
      updateUserUI();
      closeModal("loginModal");
      await loadInitialData();
      if (currentUser.role === "staff") {
        navigateTo("staff");
      } else {
        navigateTo("dashboard");
      }
    } else {
      switchAuthMode("signin");
      document.getElementById("loginEmail").value = email;
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 5. GOOGLE AUTHENTICATION INTEGRATION
function openGoogleAuthModal() {
  openModal("googleAuthModal");
}

async function selectGooglePreset(email, name, role) {
  try {
    const res = await fetch("/auth/google-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Google authentication failed");

    currentUser = data.user;
    localStorage.setItem("stocksense_token", data.access_token);
    localStorage.setItem("stocksense_user", JSON.stringify(data.user));
    updateUserUI();
    closeModal("googleAuthModal");
    closeModal("loginModal");
    showToast(`Signed in with Google as ${currentUser.name}! (${currentUser.role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff'})`, "success");
    await loadInitialData();
    if (currentUser.role === "staff") {
      navigateTo("staff");
    } else {
      navigateTo("dashboard");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleCustomGoogleLogin(e) {
  if (e) e.preventDefault();
  const email = document.getElementById("customGoogleEmail").value.trim();
  const name = document.getElementById("customGoogleName").value.trim() || email.split("@")[0];
  const role = document.getElementById("customGoogleRole").value;
  await selectGooglePreset(email, name, role);
}

// 6. FAST HEADER ROLE SWITCHER
async function toggleQuickRoleSwitch() {
  if (currentUser.role === "manager") {
    // Switch to Staff demo user
    showToast("Switching to Warehouse Staff mode...", "info");
    document.getElementById("loginEmail").value = "staff@stocksense.com";
    document.getElementById("loginPassword").value = "staff123";
    await handleLogin();
  } else {
    // Switch to Manager demo user
    showToast("Switching to Inventory Manager mode...", "info");
    document.getElementById("loginEmail").value = "manager@stocksense.com";
    document.getElementById("loginPassword").value = "admin123";
    await handleLogin();
  }
}

function handleLogout() {
  localStorage.removeItem("stocksense_token");
  localStorage.removeItem("stocksense_user");
  currentUser = { id: 0, name: "Guest User", email: "guest@stocksense.com", role: "staff" };
  updateUserUI();
  showToast("Logged out successfully.", "info");
}

// 7. PRE-LOGIN OTP PASSWORD RESET
async function handleGenerateOtp() {
  const email = document.getElementById("otpEmail").value.trim();
  if (!email) return showToast("Enter your email address", "error");

  try {
    const res = await fetch(`/otp/generate/${encodeURIComponent(email)}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to generate OTP");

    showToast(`OTP generated: ${data.code} (Valid for 5 mins)`, "success");
    const step2 = document.getElementById("otpStep2");
    if (step2) step2.classList.remove("hidden");
    const codeIn = document.getElementById("otpCode");
    if (codeIn) codeIn.value = data.code;
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

    showToast("Password reset successfully! Please sign in with your new password.", "success");
    switchAuthMode("signin");
    document.getElementById("loginEmail").value = email;
    document.getElementById("loginPassword").value = new_password;
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 8. IN-PROFILE OTP PASSWORD CHANGE
function toggleProfilePasswordChange() {
  const sec = document.getElementById("profilePasswordChangeSection");
  const btn = document.getElementById("btnToggleProfileOtp");
  if (!sec) return;
  const isHidden = sec.classList.contains("hidden");
  if (isHidden) {
    sec.classList.remove("hidden");
    if (btn) btn.textContent = "Hide Form";
    document.getElementById("profileCurrentEmail").value = currentUser.email;
  } else {
    sec.classList.add("hidden");
    if (btn) btn.textContent = "Show Form";
  }
}

async function handleProfileSendOtp() {
  const email = currentUser.email;
  if (!email) return showToast("User email not found", "error");

  try {
    const res = await fetch(`/otp/generate/${encodeURIComponent(email)}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to generate OTP");

    showToast(`OTP Code: ${data.code} sent to ${email}`, "success");
    const step2 = document.getElementById("profileOtpStep2");
    if (step2) step2.classList.remove("hidden");
    const codeIn = document.getElementById("profileOtpCode");
    if (codeIn) codeIn.value = data.code;
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleProfileChangePasswordSubmit() {
  const email = currentUser.email;
  const code = document.getElementById("profileOtpCode").value.trim();
  const new_password = document.getElementById("profileNewPassword").value;

  if (!code || !new_password) {
    return showToast("Please enter both the OTP code and new password", "error");
  }

  try {
    const res = await fetch("/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, new_password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Password change failed");

    showToast("Password updated successfully in PostgreSQL!", "success");
    toggleProfilePasswordChange();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// WebSocket real-time updates
function setupWebSocket() {
  let wsUrl;
  if (API_BASE && API_BASE.startsWith("http")) {
    const urlObj = new URL(API_BASE);
    const wsProto = urlObj.protocol === "https:" ? "wss:" : "ws:";
    wsUrl = `${wsProto}//${urlObj.host}/ws/dashboard`;
  } else if (window.location.protocol === "file:") {
    wsUrl = "wss://stocksense-web-1z1f.onrender.com/ws/dashboard";
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:8000";
    wsUrl = `${protocol}//${host}/ws/dashboard`;
  }

  try {
    if (ws) {
      try { ws.close(); } catch (_) {}
    }
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const badge = document.getElementById("wsStatusBadge");
      if (badge) {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span class="hidden sm:inline">PostgreSQL 18 Sync</span>
        `;
      }
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "stock_updated") {
          showToast(`Stock Telemetry: ${payload.data.trigger} (${payload.data.change > 0 ? '+' : ''}${payload.data.change})`, "info");
          refreshCurrentViewData();
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      const badge = document.getElementById("wsStatusBadge");
      if (badge) {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-amber-400"></span>
          <span class="hidden sm:inline">Polling</span>
        `;
      }
      setTimeout(setupWebSocket, 4000);
    };
    ws.onerror = (e) => {
      // Quiet WebSocket errors to avoid notification spam
    };
  } catch (e) {
    console.warn("WS error:", e);
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
  updateAll3DBeacons();
}

async function fetchWarehousesAndLocations() {
  try {
    const [whRes, locRes] = await Promise.all([
      fetch("/warehouses/"),
      fetch("/warehouses/locations")
    ]);
    if (whRes.ok) {
      const data = await whRes.json();
      allWarehouses = Array.isArray(data) ? data : [];
    }
    if (locRes.ok) {
      const data = await locRes.json();
      allLocations = Array.isArray(data) ? data : [];
    }
    renderWarehousesSettings();
  } catch (e) {
    console.error("Warehouses fetch error:", e);
  }
}

async function fetchProducts() {
  try {
    const res = await fetch("/products/");
    if (res.ok) {
      const data = await res.json();
      allProducts = Array.isArray(data) ? data : [];
      const badge = document.getElementById("productCountBadge");
      if (badge) badge.textContent = allProducts.length;
      renderProductCatalog(allProducts);
      renderLowStockAlerts(allProducts);
    }
  } catch (e) {
    console.error("Products fetch error:", e);
  }
}

async function fetchCategories() {
  try {
    const res = await fetch("/products/categories");
    if (res.ok) {
      const categories = await res.json();
      const filterCat = document.getElementById("filterCategory");
      const catalogCat = document.getElementById("catalogCategorySelect");
      if (Array.isArray(categories)) {
        let html = `<option value="all">All Categories</option>`;
        categories.forEach(c => {
          html += `<option value="${c}">${c}</option>`;
        });
        if (filterCat) filterCat.innerHTML = html;
        if (catalogCat) catalogCat.innerHTML = html;
      }
    }
  } catch (e) {
    console.error("Categories fetch error:", e);
  }
}

function populateLocationDropdowns() {
  if (!Array.isArray(allWarehouses)) allWarehouses = [];
  if (!Array.isArray(allLocations)) allLocations = [];
  const ids = ["recDestLocation", "delSourceLocation", "traSourceLocation", "traDestLocation", "adjLocation", "newProdInitialLocation", "filterLocation"];
  
  ids.forEach(elemId => {
    const el = document.getElementById(elemId);
    if (!el) return;
    
    let html = "";
    if (elemId === "filterLocation") {
      html += `<option value="">All Warehouses & Locations</option>`;
      if (allWarehouses.length > 0) {
        html += `<optgroup label="🏢 Warehouses">`;
        allWarehouses.forEach(wh => {
          html += `<option value="wh_${wh.id}">🏢 ${wh.name} (${wh.code || 'WH'})</option>`;
        });
        html += `</optgroup>`;
      }
      if (allLocations.length > 0) {
        html += `<optgroup label="📍 Specific Locations">`;
        allLocations.forEach(loc => {
          const whName = loc.warehouse ? loc.warehouse.name : "Warehouse";
          html += `<option value="${loc.id}">📍 ${loc.name} (${whName})</option>`;
        });
        html += `</optgroup>`;
      }
    } else {
      allLocations.forEach(loc => {
        const whName = loc.warehouse ? loc.warehouse.name : "Warehouse";
        html += `<option value="${loc.id}">${loc.name} (${whName})</option>`;
      });
    }
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
  if (!Array.isArray(allProducts)) allProducts = [];
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
  
  document.querySelectorAll(".nav-btn").forEach(btn => {
    const nav = btn.getAttribute("data-nav");
    if (nav === view || (view.startsWith("operations") && nav === view) || (view === "staff" && nav === "staff")) {
      btn.className = "nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80 transition";
    } else {
      btn.className = "nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition";
    }
  });

  const views = ["dashboard", "products", "operations-single", "ledger", "settings", "staff"];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add("hidden");
  });

  if (window.innerWidth < 1024) {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("mobileBackdrop");
    if (sidebar) sidebar.classList.add("-translate-x-full");
    if (backdrop) backdrop.classList.add("hidden");
  }

  if (view === "dashboard") {
    const dEl = document.getElementById("view-dashboard");
    if (dEl) dEl.classList.remove("hidden");
    loadDashboardData();
    renderManagerStockCenter();
    if (window.warehouse3D) {
      setTimeout(() => window.warehouse3D.engine.resize(), 100);
    }
  } else if (view === "staff") {
    const sEl = document.getElementById("view-staff");
    if (sEl) sEl.classList.remove("hidden");
    loadStaffTasks();
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
    if (kpiRes.ok) {
      const kpis = await kpiRes.json();
      animateCounter("kpiTotalProducts", kpis.total_products || 0);
      const unitsEl = document.getElementById("kpiStockUnits");
      if (unitsEl) unitsEl.textContent = `${kpis.total_stock_units || 0} units on hand`;
      animateCounter("kpiLowStock", kpis.low_stock_count || 0);
      animateCounter("kpiPendingReceipts", kpis.pending_receipts || 0);
      animateCounter("kpiPendingDeliveries", kpis.pending_deliveries || 0);
      animateCounter("kpiScheduledTransfers", kpis.scheduled_transfers || 0);
    }

    // 2. Fetch filtered documents
    applyFilters();

    // 3. Render Chart
    renderStockChart();

    // 4. Update 3D beacons
    updateAll3DBeacons();
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

// Dynamic Filter Application (PDF Page 1)
async function applyFilters() {
  const docType = document.getElementById("filterDocType").value;
  const status = document.getElementById("filterStatus").value;
  const locVal = document.getElementById("filterLocation").value;
  const category = document.getElementById("filterCategory").value;
  const search = document.getElementById("globalSearchInput") ? document.getElementById("globalSearchInput").value.trim() : "";

  let url = `/operations/documents?limit=100`;
  if (docType && docType !== "all") url += `&doc_type=${encodeURIComponent(docType)}`;
  if (status && status !== "all") url += `&status=${encodeURIComponent(status)}`;
  if (locVal) {
    if (locVal.startsWith("wh_")) {
      url += `&warehouse_id=${encodeURIComponent(locVal.replace("wh_", ""))}`;
    } else {
      url += `&location_id=${encodeURIComponent(locVal)}`;
    }
  }
  if (category && category !== "all") {
    url += `&category=${encodeURIComponent(category)}`;
  }
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      allDocuments = Array.isArray(data) ? data : [];
      renderOperationsTable(allDocuments, "operationsTableBody");
      const countEl = document.getElementById("filteredDocCount");
      if (countEl) countEl.textContent = `Showing ${allDocuments.length} documents`;
    }
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
        <td colspan="7" class="px-5 py-8 text-center text-slate-500 font-mono text-xs">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-600"></i>
          No operations match the selected dynamic filters.
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
    waiting: { label: "Waiting", color: "bg-amber-50 text-amber-700 border-amber-200" },
    ready: { label: "Ready", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
    done: { label: "Done", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    canceled: { label: "Canceled", color: "bg-rose-50 text-rose-700 border-rose-200" },
  };

  tbody.innerHTML = documents.map(doc => {
    const tCfg = typeConfig[doc.doc_type] || { label: doc.doc_type, color: "bg-slate-100 text-slate-600 border-slate-200", icon: "file" };
    const sCfg = statusConfig[doc.status] || { label: doc.status, color: "bg-slate-100 text-slate-600 border-slate-200" };
    
    const itemsSummary = (doc.lines && doc.lines.length > 0)
      ? doc.lines.map(l => `${l.quantity} × ${l.product ? l.product.name : 'Item'}`).join(", ")
      : "No items";

    const targetDesc = doc.partner_name || (doc.dest_location ? doc.dest_location.name : "Warehouse");
    const dateStr = new Date(doc.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    let actionBtn = "";
    if (doc.status !== "done" && doc.status !== "canceled") {
      actionBtn = `
        <button onclick="handleValidateDocument(${doc.id})" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition active:scale-95">
          Validate
        </button>
      `;
    }

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-bold font-mono text-indigo-600 flex items-center gap-1.5 text-xs">
          <i data-lucide="${tCfg.icon}" class="w-3.5 h-3.5 text-slate-400"></i>
          <span>${doc.reference}</span>
        </td>
        <td class="px-4 py-3.5">
          <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tCfg.color} font-mono">
            ${tCfg.label}
          </span>
        </td>
        <td class="px-4 py-3.5 font-medium text-slate-800 max-w-xs truncate">${targetDesc}</td>
        <td class="px-4 py-3.5 text-slate-500 text-xs max-w-xs truncate">${itemsSummary}</td>
        <td class="px-4 py-3.5">
          <span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${sCfg.color} font-mono">
            ${sCfg.label}
          </span>
        </td>
        <td class="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap font-mono">${dateStr}</td>
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
    transfers: { type: "transfer", title: "3. Internal Transfers", subtitle: "Move inventory between warehouses and locations with 3D paths.", modal: "transferModal" },
    adjustments: { type: "adjustment", title: "4. Inventory Adjustments", subtitle: "Fix physical count and recorded stock discrepancies.", modal: "adjustmentModal" },
  };

  const info = typeMap[typeSingular];
  document.getElementById("operationsViewTitle").textContent = info.title;
  document.getElementById("operationsViewSubtitle").textContent = info.subtitle;
  
  const addBtn = document.getElementById("operationsViewAddBtn");
  addBtn.onclick = () => openModal(info.modal);

  try {
    const res = await fetch(`/operations/documents?doc_type=${info.type}&limit=100`);
    if (res.ok) {
      const docs = await res.json();
      renderOperationsTable(Array.isArray(docs) ? docs : [], "singleOperationsTableBody");
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleValidateDocument(docId) {
  try {
    const res = await fetch(`/operations/documents/${docId}/validate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Validation failed");

    showToast(`Document ${data.reference} validated!`, "success");
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
    showToast(`Receipt ${data.reference} created!`, "success");

    // Animate 3D Receiving dock
    const destLoc = allLocations.find(l => l.id === dest_location_id);
    if (window.warehouse3D && destLoc) {
      window.warehouse3D.animateTransfer("Inbound Dock", destLoc.name, quantity, "Steel Rods");
    }

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
    showToast(`Delivery ${data.reference} created!`, "success");

    // Animate 3D Dispatch dock
    const srcLoc = allLocations.find(l => l.id === source_location_id);
    if (window.warehouse3D && srcLoc) {
      window.warehouse3D.animateTransfer(srcLoc.name, "Outbound Dock", quantity, "Finished Goods");
    }

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

    // Trigger 3D Material Transfer Animation between racks
    const srcLoc = allLocations.find(l => l.id === source_location_id);
    const dstLoc = allLocations.find(l => l.id === dest_location_id);
    if (window.warehouse3D && srcLoc && dstLoc) {
      window.warehouse3D.animateTransfer(srcLoc.name, dstLoc.name, quantity, "Goods");
    }

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
  deltaEl.className = delta < 0 ? "text-lg font-black text-rose-400" : (delta > 0 ? "text-lg font-black text-emerald-400" : "text-lg font-black text-slate-400");
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
  const tabs = ["catalog", "availability", "reorder", "categories"];
  tabs.forEach(t => {
    const btn = document.getElementById(`prodTab-${t}`);
    const subview = document.getElementById(`subview-${t}`);
    if (!btn || !subview) return;
    if (t === tab) {
      btn.className = "pb-3 border-b-2 border-indigo-600 text-indigo-600 font-bold whitespace-nowrap transition";
      subview.classList.remove("hidden");
    } else {
      btn.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 whitespace-nowrap transition";
      subview.classList.add("hidden");
    }
  });

  if (tab === "catalog") {
    renderProductCatalog(allProducts);
  } else if (tab === "availability") {
    loadStockMatrix();
  } else if (tab === "reorder") {
    loadReorderingRules();
  } else if (tab === "categories") {
    renderProductCategories();
  }
}

function renderProductCatalog(products) {
  const tbody = document.getElementById("productCatalogTableBody");
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-6 text-center text-slate-500 font-mono">No products registered in catalog.</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const isLow = p.is_low_stock;
    const statusBadge = isLow
      ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-mono"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Low Stock</span>`
      : `<span class="inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">Safe Stock</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-5 py-3.5 font-mono font-bold text-xs text-indigo-600">${p.sku}</td>
        <td class="px-4 py-3.5 font-bold text-slate-900">${p.name}</td>
        <td class="px-4 py-3.5 text-slate-600">${p.category}</td>
        <td class="px-4 py-3.5 text-slate-500 font-mono">${p.uom}</td>
        <td class="px-4 py-3.5 text-slate-600 font-semibold font-mono">${p.reorder_point} ${p.uom}</td>
        <td class="px-4 py-3.5 font-black text-sm font-mono ${isLow ? 'text-rose-600' : 'text-slate-900'}">
          ${p.total_stock} ${p.uom}
        </td>
        <td class="px-4 py-3.5">${statusBadge}</td>
        <td class="px-5 py-3.5 text-right whitespace-nowrap">
          <button onclick="openEditProductModal(${p.id})" class="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition">
            <i data-lucide="edit-3" class="w-3.5 h-3.5 inline mr-1"></i> Edit
          </button>
        </td>
      </tr>
    `;
  }).join("");

  lucide.createIcons();
}

function renderProductCategories() {
  const container = document.getElementById("productCategoriesGrid");
  const countBadge = document.getElementById("categoryCountSummary");
  if (!container) return;

  const catMap = {};
  allProducts.forEach(p => {
    const cat = p.category || "General";
    if (!catMap[cat]) {
      catMap[cat] = {
        name: cat,
        products: [],
        totalUnits: 0,
        lowStockCount: 0
      };
    }
    catMap[cat].products.push(p);
    catMap[cat].totalUnits += (p.total_stock || 0);
    if (p.is_low_stock) catMap[cat].lowStockCount++;
  });

  const catList = Object.values(catMap);
  if (countBadge) countBadge.textContent = `${catList.length} Active Categories`;

  if (catList.length === 0) {
    container.innerHTML = `<p class="col-span-full text-center py-8 text-slate-400 font-mono">No product categories registered.</p>`;
    return;
  }

  const categoryIcons = {
    "Raw Materials": "layers",
    "Furniture": "armchair",
    "Components": "cpu",
    "Hardware": "wrench",
    "General": "package"
  };

  container.innerHTML = catList.map(c => {
    const iconName = categoryIcons[c.name] || "boxes";
    const prodItemsHtml = c.products.slice(0, 4).map(p => `
      <div class="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
        <span class="text-slate-700 font-medium truncate max-w-[150px]">${p.name}</span>
        <span class="font-mono font-bold ${p.is_low_stock ? 'text-rose-600' : 'text-slate-600'}">${p.total_stock} ${p.uom}</span>
      </div>
    `).join("");

    return `
      <div class="bg-slate-50/70 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between hover:border-indigo-200 hover:shadow-xs transition">
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                <i data-lucide="${iconName}" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="text-sm font-bold text-slate-900">${c.name}</h4>
                <span class="text-[11px] text-slate-500 font-mono">${c.products.length} products</span>
              </div>
            </div>
            ${c.lowStockCount > 0 ? `<span class="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">${c.lowStockCount} Low</span>` : `<span class="text-[10px] font-semibold font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Healthy</span>`}
          </div>

          <div class="bg-white rounded-xl p-2.5 border border-slate-100 mb-3 space-y-1">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono mb-1">Products in Category</div>
            ${prodItemsHtml}
          </div>
        </div>

        <div class="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs">
          <span class="font-mono font-bold text-indigo-700">${c.totalUnits} units total</span>
          <button onclick="viewCategoryInCatalog('${c.name}')" class="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 transition">
            View in Catalog <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

function viewCategoryInCatalog(categoryName) {
  switchProductTab('catalog');
  const catSelect = document.getElementById("catalogCategorySelect");
  if (catSelect) {
    catSelect.value = categoryName;
    filterProductCatalog();
  }
}

function openEditProductModal(productId) {
  const p = allProducts.find(prod => prod.id === productId);
  if (!p) return showToast("Product not found", "error");

  document.getElementById("editProdId").value = p.id;
  document.getElementById("editProdName").value = p.name;
  document.getElementById("editProdSku").value = p.sku;
  document.getElementById("editProdCategory").value = p.category || "General";
  document.getElementById("editProdUom").value = p.uom || "Units";
  document.getElementById("editProdReorderPoint").value = p.reorder_point || 10;

  openModal("editProductModal");
}

async function handleUpdateProduct(e) {
  e.preventDefault();
  const id = document.getElementById("editProdId").value;
  const name = document.getElementById("editProdName").value.trim();
  const category = document.getElementById("editProdCategory").value.trim();
  const uom = document.getElementById("editProdUom").value;
  const reorder_point = parseFloat(document.getElementById("editProdReorderPoint").value) || 10;

  try {
    const res = await fetch(`/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, uom, reorder_point })
    });
    const updated = await res.json();
    if (!res.ok) throw new Error(updated.detail || "Failed to update product");

    showToast(`Product "${updated.name}" updated successfully!`, "success");
    closeModal("editProductModal");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleResetDemoData() {
  const btn = document.getElementById("resetDemoBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i> Resetting...`;
  }
  try {
    const res = await fetch("/operations/reset-demo", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to reset demo");
    showToast(data.message || "Database reset to initial demo state!", "success");
    await loadInitialData();
    refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="rotate-ccw" class="w-3 h-3 text-slate-500"></i> Reset Demo State`;
      lucide.createIcons();
    }
  }
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
      <thead class="bg-slate-50 text-xs uppercase font-bold text-slate-500 border-b border-slate-200 font-mono">
        <tr>
          <th class="px-4 py-3">Product (SKU)</th>
          <th class="px-4 py-3">Total</th>
    `;
    data.locations.forEach(loc => {
      headerHtml += `<th class="px-4 py-3 text-right">${loc.name}</th>`;
    });
    headerHtml += `</tr></thead>`;

    let rowsHtml = `<tbody class="divide-y divide-slate-100 font-sans">`;
    data.products.forEach(p => {
      rowsHtml += `
        <tr class="hover:bg-slate-50/80 transition">
          <td class="px-4 py-3 font-semibold text-slate-900">${p.product_name} <span class="text-xs text-slate-400 font-mono">(${p.sku})</span></td>
          <td class="px-4 py-3 font-bold text-indigo-600 font-mono">${p.total_stock} ${p.uom}</td>
      `;
      data.locations.forEach(loc => {
        const qty = p.locations[String(loc.id)] || 0;
        rowsHtml += `
          <td class="px-4 py-3 text-right font-mono font-medium ${qty > 0 ? 'text-slate-800' : 'text-slate-400'}">
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
        <tr class="hover:bg-slate-50/80 transition font-sans">
          <td class="px-5 py-3.5 font-bold text-slate-900">${r.product_name}</td>
          <td class="px-4 py-3.5 font-mono text-xs text-indigo-600">${r.sku}</td>
          <td class="px-4 py-3.5 font-mono font-black ${r.alert ? 'text-rose-600' : 'text-slate-800'}">${r.current_stock} ${r.uom}</td>
          <td class="px-4 py-3.5 font-mono text-slate-500">${r.reorder_point} ${r.uom}</td>
          <td class="px-4 py-3.5 font-mono font-bold text-indigo-600">${r.suggested_order_qty > 0 ? `+${r.suggested_order_qty} ${r.uom}` : 'Optimal'}</td>
          <td class="px-4 py-3.5">
            ${r.alert 
              ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 font-mono">Below Min</span>` 
              : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">Safe Stock</span>`}
          </td>
          <td class="px-5 py-3.5 text-right">
            ${r.alert ? `
              <button onclick="quickOrderReceipt(${r.product_id})" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition active:scale-95">
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
    if (res.ok) {
      const ledger = await res.json();
      const entries = Array.isArray(ledger) ? ledger : [];
      renderLedgerTable(entries);
      const badge = document.getElementById("ledgerCountBadge");
      if (badge) badge.textContent = `${entries.length} total movements logged`;
    }
  } catch (err) {
    console.error(err);
  }
}

function renderLedgerTable(entries) {
  const tbody = document.getElementById("ledgerTableBody");
  if (!tbody) return;
  if (!Array.isArray(entries)) entries = [];

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500 font-mono">No ledger entries recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(item => {
    const dateStr = new Date(item.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const isPositive = item.quantity_change > 0;
    const qtyBadge = isPositive
      ? `<span class="text-xs font-mono font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">+${item.quantity_change}</span>`
      : `<span class="text-xs font-mono font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">${item.quantity_change}</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition font-sans">
        <td class="px-5 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">${dateStr}</td>
        <td class="px-4 py-3 font-mono font-bold text-xs text-indigo-600">${item.reference || '-'}</td>
        <td class="px-4 py-3 font-bold text-slate-800">${item.product_name} <span class="text-xs font-normal text-slate-400 font-mono">(${item.product_sku})</span></td>
        <td class="px-4 py-3 text-slate-600 font-medium">${item.location_name}</td>
        <td class="px-4 py-3">${qtyBadge}</td>
        <td class="px-4 py-3 font-bold font-mono text-slate-700 text-xs">${item.balance_after !== null ? item.balance_after : '-'}</td>
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
    container.innerHTML = `<p class="text-slate-500 font-mono">No warehouses configured yet.</p>`;
    return;
  }

  container.innerHTML = allWarehouses.map(wh => {
    const locs = allLocations.filter(l => l.warehouse_id === wh.id);
    const locChips = locs.map(l => `
      <div class="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
        <div class="flex items-center gap-2">
          <i data-lucide="map-pin" class="w-4 h-4 text-indigo-600"></i>
          <span class="text-xs font-bold text-slate-800">${l.name}</span>
        </div>
        <span class="text-[10px] uppercase font-mono font-semibold text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">${l.location_type || 'internal'}</span>
      </div>
    `).join("");

    return `
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                <i data-lucide="warehouse" class="w-5 h-5"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-900 font-mono">${wh.name}</h3>
                <span class="text-xs text-slate-500 font-mono">${wh.code || 'WH'}</span>
              </div>
            </div>
            <span class="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">${locs.length} Locations</span>
          </div>
          <p class="text-xs text-slate-500 mb-4">${wh.address || 'Standard Storage Facility'}</p>

          <div class="space-y-2 mb-4">
            <span class="text-xs font-bold text-slate-500 uppercase font-mono">Locations under this facility:</span>
            ${locChips || '<p class="text-xs text-slate-400">No locations added yet.</p>'}
          </div>
        </div>
        <button onclick="openAddLocationForWh(${wh.id})" class="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition flex items-center justify-center gap-1">
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
      <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
        <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i>
        <span>All stock levels are above safety reorder thresholds.</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = lowProducts.map(p => {
    return `
      <div class="p-3 bg-rose-50/80 border border-rose-200 rounded-xl flex items-center justify-between">
        <div>
          <span class="block text-xs font-bold text-slate-900 font-sans">${p.name}</span>
          <span class="text-[11px] text-rose-600 font-mono">Stock: ${p.total_stock} ${p.uom} (Min: ${p.reorder_point})</span>
        </div>
        <button onclick="quickOrderReceipt(${p.id})" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold shadow-xs transition active:scale-95 font-mono">
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
        label: 'Stock Quantity',
        data: quantities,
        backgroundColor: '#4F46E5',
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
          grid: { color: '#E2E8F0' },
          ticks: { font: { family: 'Space Grotesk', size: 11 }, color: '#64748B' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Inter', size: 11 }, color: '#64748B' }
        }
      }
    }
  });
}

// 4-STEP INTERACTIVE PDF FLOW (PDF Pages 3 & 4) WITH 3D BABYLON ANIMATION
async function runPdfDemoWorkflow() {
  const btn = document.getElementById("demoWorkflowBtn");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Executing...`;

  try {
    if (!allProducts.length || !allLocations.length) {
      await loadInitialData();
    }
    const steel = allProducts.find(p => p.sku === "STL-ROD-01") || allProducts[0];
    const mainStore = allLocations.find(l => l.name === "Main Store") || allLocations[0];
    const prodRack = allLocations.find(l => l.name === "Production Rack") || allLocations[1];

    if (!steel || !mainStore || !prodRack) {
      throw new Error("Required demo inventory records not found. Please click 'Reset Demo State' first.");
    }

    // Camera preset to overview
    if (window.warehouse3D) {
      window.warehouse3D.setCameraPreset("overview");
    }

    // Step 1: Receive 100 kg Steel from Vendor -> Stock: +100
    showToast("Step 1 (PDF Flow): Receiving 100 kg Steel from Vendor (+100)...", "info");
    if (window.warehouse3D) {
      window.warehouse3D.animateTransfer("Inbound Dock", "Main Store", 100, "Steel Rods");
    }
    const res1 = await fetch("/operations/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_name: "Tata Steel Ltd (PDF Step 1)",
        dest_location_id: mainStore.id,
        notes: "PDF Flow Step 1: Receive 100 kg Steel from Vendor",
        validate_immediately: true,
        items: [{ product_id: steel.id, quantity: 100.0, dest_location_id: mainStore.id }]
      })
    });
    if (!res1.ok) {
      let errDetail = 'Receipt failed';
      try { const err = await res1.json(); errDetail = err.detail || errDetail; } catch (_) {}
      throw new Error(`Step 1 failed: ${errDetail}`);
    }

    await new Promise(r => setTimeout(r, 1200));

    // Step 2: Internal Transfer: Main Store -> Production Rack (25 kg)
    showToast("Step 2 (PDF Flow): Moving to production rack: Main Store → Production Rack (25 kg)...", "info");
    if (window.warehouse3D) {
      window.warehouse3D.animateTransfer("Main Store", "Production Rack", 25, "Steel Rods");
    }
    const res2 = await fetch("/operations/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_location_id: mainStore.id,
        dest_location_id: prodRack.id,
        notes: "PDF Flow Step 2: Move to production rack (Main Store -> Production Rack)",
        validate_immediately: true,
        items: [{ product_id: steel.id, quantity: 25.0, source_location_id: mainStore.id, dest_location_id: prodRack.id }]
      })
    });
    if (!res2.ok) {
      let errDetail = 'Transfer failed';
      try { const err = await res2.json(); errDetail = err.detail || errDetail; } catch (_) {}
      throw new Error(`Step 2 failed: ${errDetail}`);
    }

    await new Promise(r => setTimeout(r, 1200));

    // Step 3: Deliver finished goods: Deliver 20 steel (-20)
    showToast("Step 3 (PDF Flow): Delivering finished goods to customer: Deliver 20 steel (-20)...", "info");
    if (window.warehouse3D) {
      window.warehouse3D.animateTransfer("Production Rack", "Outbound Dock", 20, "Finished Goods");
    }
    const res3 = await fetch("/operations/delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: "Apex Engineering (PDF Step 3)",
        source_location_id: prodRack.id,
        notes: "PDF Flow Step 3: Deliver finished goods (Deliver 20 steel)",
        validate_immediately: true,
        items: [{ product_id: steel.id, quantity: 20.0, source_location_id: prodRack.id }]
      })
    });
    if (!res3.ok) {
      let errDetail = 'Delivery failed';
      try { const err = await res3.json(); errDetail = err.detail || errDetail; } catch (_) {}
      throw new Error(`Step 3 failed: ${errDetail}`);
    }

    await new Promise(r => setTimeout(r, 1200));

    // Step 4: Adjust damaged items: 3 kg steel damaged (-3)
    showToast("Step 4 (PDF Flow): Adjusting damaged items: 3 kg steel damaged (-3)...", "info");
    const prodRes = await fetch(`/products/${steel.id}`);
    if (!prodRes.ok) {
      throw new Error("Could not retrieve steel product details for adjustment.");
    }
    const steelDetail = await prodRes.json();
    const curQuant = steelDetail.quants ? steelDetail.quants.find(q => q.location_id === prodRack.id) : null;
    const currentAtRack = curQuant ? curQuant.quantity : 5.0;
    const counted = Math.max(0, currentAtRack - 3.0);

    const res4 = await fetch("/operations/adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: steel.id,
        location_id: prodRack.id,
        counted_quantity: counted,
        notes: "PDF Flow Step 4: 3 kg steel damaged"
      })
    });
    if (!res4.ok) {
      let errDetail = 'Adjustment failed';
      try { const err = await res4.json(); errDetail = err.detail || errDetail; } catch (_) {}
      throw new Error(`Step 4 failed: ${errDetail}`);
    }

    showToast("Completed all 4 steps from StockSense.pdf! Redirecting to Move History...", "success");
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

// --- MANAGER STOCK PIPELINE WORKSPACE ---
async function renderManagerStockCenter() {
  const inContainer = document.getElementById("managerInboundList");
  const outContainer = document.getElementById("managerOutboundList");
  const inCount = document.getElementById("managerInboundCount");
  const outCount = document.getElementById("managerOutboundCount");
  if (!inContainer || !outContainer) return;

  try {
    const res = await fetch("/operations/documents?limit=50");
    const docs = await res.json();
    
    // Inbound receipts (status != done, != canceled)
    const pendingReceipts = docs.filter(d => d.doc_type === "receipt" && d.status !== "done" && d.status !== "canceled");
    // Outbound deliveries (status != done, != canceled)
    const pendingDeliveries = docs.filter(d => d.doc_type === "delivery" && d.status !== "done" && d.status !== "canceled");

    if (inCount) inCount.textContent = `${pendingReceipts.length} receipts awaiting receiving`;
    if (outCount) outCount.textContent = `${pendingDeliveries.length} deliveries awaiting dispatch`;

    // Render Inbound Receipts
    if (pendingReceipts.length === 0) {
      inContainer.innerHTML = `
        <div class="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
          <i data-lucide="check-circle" class="w-4 h-4 mx-auto mb-1 text-emerald-500"></i>
          All supplier receipts received and validated!
        </div>`;
    } else {
      inContainer.innerHTML = pendingReceipts.slice(0, 5).map(d => {
        const itemText = d.lines && d.lines.length > 0 ? `${d.lines[0].quantity} × ${d.lines[0].product_name || 'Units'}` : 'Items';
        return `
          <div class="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-emerald-50/50 rounded-xl border border-slate-100 transition">
            <div class="space-y-0.5">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-bold text-slate-900 font-mono">${d.reference}</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-emerald-100 text-emerald-800">${d.partner_name || 'Supplier'}</span>
              </div>
              <p class="text-[11px] text-slate-500">${itemText}</p>
            </div>
            <button onclick="handleValidateDocument(${d.id})" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1">
              <i data-lucide="check" class="w-3 h-3"></i> Receive
            </button>
          </div>
        `;
      }).join("");
    }

    // Render Outbound Deliveries
    if (pendingDeliveries.length === 0) {
      outContainer.innerHTML = `
        <div class="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
          <i data-lucide="check-circle" class="w-4 h-4 mx-auto mb-1 text-blue-500"></i>
          All customer orders packed and dispatched!
        </div>`;
    } else {
      outContainer.innerHTML = pendingDeliveries.slice(0, 5).map(d => {
        const itemText = d.lines && d.lines.length > 0 ? `${d.lines[0].quantity} × ${d.lines[0].product_name || 'Units'}` : 'Items';
        return `
          <div class="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-blue-50/50 rounded-xl border border-slate-100 transition">
            <div class="space-y-0.5">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-bold text-slate-900 font-mono">${d.reference}</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-blue-100 text-blue-800">${d.partner_name || 'Customer'}</span>
              </div>
              <p class="text-[11px] text-slate-500">${itemText}</p>
            </div>
            <button onclick="handleValidateDocument(${d.id})" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1">
              <i data-lucide="truck" class="w-3 h-3"></i> Dispatch
            </button>
          </div>
        `;
      }).join("");
    }

    lucide.createIcons();
  } catch (err) {
    console.error("renderManagerStockCenter error:", err);
  }
}

// --- WAREHOUSE STAFF OPERATIONAL HUB ---
let currentStaffTab = "picking";
let staffTasksCache = null;

async function loadStaffTasks() {
  try {
    const res = await fetch("/operations/staff/tasks");
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.metrics) return;
    staffTasksCache = data;

    // Update KPI indicators
    const kPicks = document.getElementById("staffKpiPicks");
    const kShelves = document.getElementById("staffKpiShelves");
    const kTransfers = document.getElementById("staffKpiTransfers");
    const kCounts = document.getElementById("staffKpiCounts");
    if (kPicks) kPicks.textContent = data.metrics.pending_picking || 0;
    if (kShelves) kShelves.textContent = data.metrics.pending_shelving || 0;
    if (kTransfers) kTransfers.textContent = data.metrics.pending_transfers || 0;
    if (kCounts) kCounts.textContent = data.metrics.pending_counts || 0;

    // Update sidebar badges
    const bPick = document.getElementById("staffNavPickBadge");
    const bShelve = document.getElementById("staffNavShelveBadge");
    const bTra = document.getElementById("staffNavTransferBadge");
    if (bPick) bPick.textContent = data.metrics.pending_picking || 0;
    if (bShelve) bShelve.textContent = data.metrics.pending_shelving || 0;
    if (bTra) bTra.textContent = data.metrics.pending_transfers || 0;

    // Render Workbenches
    renderStaffPicking(Array.isArray(data.picking_tasks) ? data.picking_tasks : []);
    renderStaffShelving(Array.isArray(data.shelving_tasks) ? data.shelving_tasks : []);
    renderStaffTransfers(Array.isArray(data.transfer_tasks) ? data.transfer_tasks : []);
    renderStaffCounting(Array.isArray(data.counting_tasks) ? data.counting_tasks : []);
    populateStaffTransferDropdowns();

    lucide.createIcons();
  } catch (err) {
    console.error("loadStaffTasks error:", err);
  }
}

function switchStaffWorkbenchTab(tab) {
  currentStaffTab = tab;
  const tabs = ["picking", "shelving", "transfers", "counting"];
  
  tabs.forEach(t => {
    const panel = document.getElementById(`staffPanel-${t}`);
    const btn = document.getElementById(`staffTabBtn-${t}`);
    if (panel) {
      if (t === tab) panel.classList.remove("hidden");
      else panel.classList.add("hidden");
    }
    if (btn) {
      if (t === tab) {
        btn.className = "px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-white text-indigo-700 shadow-xs border border-indigo-100";
      } else {
        btn.className = "px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition flex items-center gap-2";
      }
    }
  });

  lucide.createIcons();
}

function renderStaffPicking(tasks) {
  const tbody = document.getElementById("staffPickingTableBody");
  if (!tbody) return;

  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-8 text-center text-slate-400 font-mono text-xs">
          <i data-lucide="check-circle" class="w-7 h-7 mx-auto mb-2 text-emerald-500"></i>
          All customer orders picked and packed! No pending picks.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(t => `
    <tr class="hover:bg-slate-50 transition">
      <td class="px-4 py-3 font-mono font-bold text-indigo-600 text-xs">${t.reference}</td>
      <td class="px-4 py-3 font-semibold text-slate-800 text-xs">${t.customer}</td>
      <td class="px-4 py-3 text-xs">
        <span class="font-bold text-slate-900">${t.product_name}</span>
        <span class="text-[10px] text-slate-400 font-mono block">${t.sku}</span>
      </td>
      <td class="px-4 py-3 font-mono font-bold text-slate-900 text-xs">${t.quantity} ${t.uom}</td>
      <td class="px-4 py-3">
        <span class="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold font-mono">
          📍 ${t.source_location}
        </span>
      </td>
      <td class="px-4 py-3">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">${t.status}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <button onclick="staffPickItem(${t.document_id}, '${t.product_name}')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1.5 ml-auto">
          <i data-lucide="check-square" class="w-3.5 h-3.5"></i> Confirm Pick
        </button>
      </td>
    </tr>
  `).join("");
}

function renderStaffShelving(tasks) {
  const tbody = document.getElementById("staffShelvingTableBody");
  if (!tbody) return;

  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-8 text-center text-slate-400 font-mono text-xs">
          <i data-lucide="check-circle" class="w-7 h-7 mx-auto mb-2 text-blue-500"></i>
          Dock is clear! All arriving goods have been placed onto racks.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = tasks.map((t, idx) => {
    const locOptions = allLocations.map(l => 
      `<option value="${l.id}" ${l.id === t.dest_location_id ? 'selected' : ''}>${l.name} (${l.warehouse ? l.warehouse.name : 'Warehouse'})</option>`
    ).join("");

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-3 font-mono font-bold text-indigo-600 text-xs">${t.reference}</td>
        <td class="px-4 py-3 font-semibold text-slate-800 text-xs">${t.supplier}</td>
        <td class="px-4 py-3 text-xs">
          <span class="font-bold text-slate-900">${t.product_name}</span>
          <span class="text-[10px] text-slate-400 font-mono block">${t.sku}</span>
        </td>
        <td class="px-4 py-3 font-mono font-bold text-slate-900 text-xs">${t.quantity} ${t.uom}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-mono font-medium">
            ⚓ ${t.from_dock}
          </span>
        </td>
        <td class="px-4 py-3">
          <select id="staffShelveLocSelect_${idx}" class="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-600 text-slate-800">
            ${locOptions}
          </select>
        </td>
        <td class="px-4 py-3 text-right">
          <button onclick="staffShelveItem(${t.product_id}, ${t.quantity}, 'staffShelveLocSelect_${idx}', '${t.product_name}')" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1.5 ml-auto">
            <i data-lucide="archive" class="w-3.5 h-3.5"></i> Put Away
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderStaffTransfers(tasks) {
  const tbody = document.getElementById("staffTransfersTableBody");
  if (!tbody) return;

  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-8 text-center text-slate-400 font-mono text-xs">
          <i data-lucide="check-circle" class="w-7 h-7 mx-auto mb-2 text-amber-500"></i>
          No scheduled moves in queue. Use the quick form above to perform an inter-rack transfer.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(t => `
    <tr class="hover:bg-slate-50 transition">
      <td class="px-4 py-3 font-mono font-bold text-amber-700 text-xs">${t.reference}</td>
      <td class="px-4 py-3 text-xs">
        <span class="font-bold text-slate-900">${t.product_name}</span>
        <span class="text-[10px] text-slate-400 font-mono block">${t.sku}</span>
      </td>
      <td class="px-4 py-3 font-mono font-bold text-slate-900 text-xs">${t.quantity} ${t.uom}</td>
      <td class="px-4 py-3">
        <span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-mono font-bold">
          ${t.from_location} ➔ ${t.to_location}
        </span>
      </td>
      <td class="px-4 py-3">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 uppercase">${t.status}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <button onclick="staffExecuteTransfer(${t.document_id}, '${t.product_name}')" class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1.5 ml-auto">
          <i data-lucide="play" class="w-3.5 h-3.5"></i> Move Stock
        </button>
      </td>
    </tr>
  `).join("");
}

function renderStaffCounting(tasks) {
  const tbody = document.getElementById("staffCountingTableBody");
  if (!tbody) return;

  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 text-xs">No counting items loaded.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(t => {
    const prod = allProducts.find(p => p.id === t.product_id);
    const locNames = prod && prod.quants && prod.quants.length > 0 
      ? prod.quants.map(q => q.location_name || 'Store').join(", ")
      : "Main Store";

    const defaultLocId = prod && prod.quants && prod.quants.length > 0 
      ? prod.quants[0].location_id 
      : (allLocations[0] ? allLocations[0].id : 1);

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-3 text-xs">
          <span class="font-bold text-slate-900">${t.product_name}</span>
          <span class="text-[10px] text-slate-400 font-mono block">${t.sku}</span>
        </td>
        <td class="px-4 py-3 text-xs text-slate-600 font-mono">${locNames}</td>
        <td class="px-4 py-3 font-mono font-bold text-slate-800 text-xs">
          ${t.recorded_stock} <span class="text-[11px] font-normal text-slate-500">${t.uom}</span>
        </td>
        <td class="px-4 py-3">
          <input type="number" id="staffCountInput_${t.product_id}" step="any" min="0" value="${t.recorded_stock}" 
                 oninput="updateCountDelta(${t.recorded_stock}, this, 'staffCountDelta_${t.product_id}')"
                 class="w-24 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-300 rounded-xl px-2 py-1 outline-none focus:border-indigo-600 text-slate-900">
        </td>
        <td class="px-4 py-3">
          <span id="staffCountDelta_${t.product_id}" class="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            0.00 delta (Matched)
          </span>
        </td>
        <td class="px-4 py-3 text-right">
          <button onclick="staffSubmitCount(${t.product_id}, ${defaultLocId}, 'staffCountInput_${t.product_id}', '${t.product_name}')" class="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1.5 ml-auto">
            <i data-lucide="check" class="w-3.5 h-3.5"></i> Submit Count
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function updateCountDelta(recorded, inputEl, badgeId) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  const counted = parseFloat(inputEl.value);
  if (isNaN(counted)) {
    badge.textContent = "Invalid";
    badge.className = "text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500";
    return;
  }
  const delta = counted - recorded;
  if (Math.abs(delta) < 0.0001) {
    badge.textContent = "0.00 delta (Matched)";
    badge.className = "text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600";
  } else if (delta > 0) {
    badge.textContent = `+${delta.toFixed(2)} (Surplus)`;
    badge.className = "text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200";
  } else {
    badge.textContent = `${delta.toFixed(2)} (Deficit)`;
    badge.className = "text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200";
  }
}

function populateStaffTransferDropdowns() {
  const pSel = document.getElementById("staffTraProduct");
  const sSel = document.getElementById("staffTraSource");
  const dSel = document.getElementById("staffTraDest");
  if (!pSel || !sSel || !dSel) return;

  pSel.innerHTML = allProducts.map(p => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join("");
  sSel.innerHTML = allLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join("");
  dSel.innerHTML = allLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join("");
  if (allLocations.length > 1) dSel.selectedIndex = 1;
}

// Staff Action Executions
async function staffPickItem(docId, prodName) {
  try {
    const res = await fetch("/operations/staff/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: docId, notes: "Picked & packed from shelf by staff" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Picking failed");

    showToast(`Order #${docId} (${prodName || 'goods'}) picked and packed successfully!`, "success");
    await loadInitialData();
    await loadStaffTasks();
    if (window.warehouse3D) window.warehouse3D.playFlowStep(3);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function staffShelveItem(prodId, qty, selectId, prodName) {
  const sel = document.getElementById(selectId);
  const destId = sel ? parseInt(sel.value) : 1;

  try {
    const res = await fetch("/operations/staff/shelve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: prodId, quantity: qty, dest_location_id: destId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Shelving failed");

    showToast(`Shelved ${qty} units of ${prodName || 'product'} to target rack!`, "success");
    await loadInitialData();
    await loadStaffTasks();
    if (window.warehouse3D) window.warehouse3D.playFlowStep(2);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function staffExecuteTransfer(docId, prodName) {
  try {
    const res = await fetch(`/operations/staff/transfer-doc/${docId}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Transfer execution failed");

    showToast(`Internal transfer executed for ${prodName || 'goods'}!`, "success");
    await loadInitialData();
    await loadStaffTasks();
    if (window.warehouse3D) window.warehouse3D.playFlowStep(2);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleStaffQuickTransfer(e) {
  if (e) e.preventDefault();
  const product_id = parseInt(document.getElementById("staffTraProduct").value);
  const source_location_id = parseInt(document.getElementById("staffTraSource").value);
  const dest_location_id = parseInt(document.getElementById("staffTraDest").value);
  const quantity = parseFloat(document.getElementById("staffTraQty").value);

  if (source_location_id === dest_location_id) {
    return showToast("Source and destination rack must be different!", "error");
  }

  try {
    const res = await fetch("/operations/staff/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id, source_location_id, dest_location_id, quantity, notes: "Ground move by warehouse staff" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Quick transfer failed");

    showToast(`Moved ${quantity} units between racks successfully!`, "success");
    document.getElementById("staffTraQty").value = "";
    await loadInitialData();
    await loadStaffTasks();
    if (window.warehouse3D) window.warehouse3D.playFlowStep(2);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function staffSubmitCount(prodId, locId, inputId, prodName) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;
  const counted_quantity = parseFloat(inputEl.value);

  if (isNaN(counted_quantity) || counted_quantity < 0) {
    return showToast("Please input a valid counted quantity", "error");
  }

  try {
    const res = await fetch("/operations/staff/count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: prodId, location_id: locId, counted_quantity, notes: "Physical count verified by staff" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Count submission failed");

    showToast(`Physical count submitted for ${prodName || 'item'}! Stock adjusted in PostgreSQL.`, "success");
    await loadInitialData();
    await loadStaffTasks();
    if (window.warehouse3D) window.warehouse3D.playFlowStep(4);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Refresh Current Active View Data
function refreshCurrentViewData() {
  if (currentView === "dashboard") {
    loadDashboardData();
    renderManagerStockCenter();
  } else if (currentView === "products") {
    switchProductTab(currentProductSubTab);
  } else if (["receipts", "deliveries", "transfers", "adjustments"].includes(currentView)) {
    loadSingleOperationsView(currentView);
  } else if (currentView === "ledger") {
    loadLedgerData();
  } else if (currentView === "staff") {
    loadStaffTasks();
  }
}

// Toast System (with Motion spring bounce)
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  const bg = type === "success" 
    ? "bg-white text-emerald-800 border border-emerald-200" 
    : (type === "error" ? "bg-white text-rose-800 border border-rose-200" : "bg-white text-slate-800 border border-slate-200");

  toast.className = `${bg} backdrop-blur-xl px-4 py-3 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold flex items-center gap-2.5 pointer-events-auto font-sans`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-circle' : 'info')}" class="w-4 h-4 shrink-0"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  if (window.Motion) {
    Motion.animate(toast, { opacity: [0, 1], y: [16, 0], scale: [0.95, 1] }, { duration: 0.35, easing: "ease-out" });
  }

  setTimeout(() => {
    if (window.Motion) {
      Motion.animate(toast, { opacity: [1, 0], x: [0, 40] }, { duration: 0.3 }).finished.then(() => toast.remove());
    } else {
      toast.remove();
    }
  }, 4000);
}

// Modal Helpers (with Motion spring physics)
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove("hidden");
  
  const content = m.querySelector(".modal-content") || m.children[0];
  if (content && window.Motion) {
    Motion.animate(content, { scale: [0.92, 1], opacity: [0, 1], y: [15, 0] }, { duration: 0.28, easing: "ease-out" });
  }
  lucide.createIcons();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  const content = m.querySelector(".modal-content") || m.children[0];
  if (content && window.Motion) {
    Motion.animate(content, { scale: [1, 0.94], opacity: [1, 0], y: [0, 10] }, { duration: 0.2 }).finished.then(() => {
      m.classList.add("hidden");
    });
  } else {
    m.classList.add("hidden");
  }
}
