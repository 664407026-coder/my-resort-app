import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC8shKbvqwEgBXqRzfnboALb2kPyvv5UnA",
  authDomain: "my-resort-app-60d6e.firebaseapp.com",
  projectId: "my-resort-app-60d6e",
  storageBucket: "my-resort-app-60d6e.firebasestorage.app",
  messagingSenderId: "30815932961",
  appId: "1:30815932961:web:2684a3a53d195ad4f00960",
  measurementId: "G-FZYK7V66RY"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const money = n => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const defaultCategories = ["ค่าน้ำ", "ค่าไฟ", "ค่าอุปกรณ์", "ค่าซ่อมบำรุง", "ค่าจ้างพนักงาน"];
const pricing = { vip: { label: "VIP", overnight: 500, short: 300 }, standard: { label: "ห้องแอร์", overnight: 400, short: 250 }, fan: { label: "ห้องพัดลม", overnight: 300, short: 200 } };
let appData = { rooms: [], transactions: [], expenseCategories: [...defaultCategories] };
let currentUser = null, isAdmin = false, unsubscribeData = null, selectedRoomId = null, toastTimer;

function icons() { if (window.lucide) window.lucide.createIcons(); }
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3500); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function monthKey(date) { const d = new Date(date); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function txForMonth(key) { return appData.transactions.filter(tx => monthKey(tx.date) === key); }
function totals(items) { return items.reduce((sum, tx) => { const amount = Number(tx.amount) || 0; if (tx.type === "income") sum.income += amount; else if (tx.type === "expense") sum.expense += amount; return sum; }, { income: 0, expense: 0 }); }
function safeRooms() { return Array.isArray(appData.rooms) ? appData.rooms : []; }
function newId() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); }

function generateMonths() {
  const now = new Date();
  const options = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: monthKey(d), label: new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(d) };
  });
  for (const id of ["monthSelector", "transactionsMonth"]) {
    const select = $(id);
    select.replaceChildren(...options.map(({ value, label }) => { const option = new Option(label, value); return option; }));
  }
}
generateMonths();
$("todayLabel").textContent = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
icons();

function closeSidebar() { $("sidebar").classList.remove("open"); $("sidebarOverlay").hidden = true; $("menuToggle").setAttribute("aria-expanded", "false"); }
function showPage(page) {
  if (page === "admin" && !isAdmin) return;
  if (!["dashboard", "rooms", "expenses", "admin"].includes(page)) page = "dashboard";
  document.querySelectorAll(".page").forEach(el => { const active = el.id === "page-" + page; el.hidden = !active; el.classList.toggle("active", active); });
  document.querySelectorAll(".nav-link").forEach(el => { const active = el.dataset.page === page; el.classList.toggle("active", active); if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); });
  $("topbarTitle").textContent = ({ dashboard: "แดชบอร์ด", rooms: "จัดการห้องพัก", expenses: "รายรับรายจ่าย", admin: "ผู้ใช้งานระบบ" })[page];
  closeSidebar();
  window.scrollTo(0, 0);
  if (page === "admin") loadUsers();
}
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
$("menuToggle").addEventListener("click", () => { const open = $("sidebar").classList.toggle("open"); $("sidebarOverlay").hidden = !open; $("menuToggle").setAttribute("aria-expanded", String(open)); });
$("sidebarOverlay").addEventListener("click", closeSidebar);
window.addEventListener("resize", () => { if (window.innerWidth > 780) closeSidebar(); });

let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  $("authTitle").textContent = registering ? "สร้างบัญชีใหม่" : "I-Thara Cloud";
  $("authSubtitle").textContent = registering ? "สมัครด้วยอีเมลและตั้งรหัสผ่านสำหรับเข้าสู่ระบบ" : "จัดการห้องพักและดูผลประกอบการได้ในที่เดียว";
  $("confirmPasswordGroup").hidden = !registering;
  $("confirmPassword").required = registering;
  $("confirmPassword").value = "";
  $("loginPassword").autocomplete = registering ? "new-password" : "current-password";
  $("authSubmitLabel").textContent = registering ? "สมัครสมาชิกด้วยอีเมล" : "เข้าสู่ระบบ";
  $("authToggleLabel").textContent = registering ? "มีบัญชีแล้ว? เข้าสู่ระบบ" : "สร้างบัญชีใหม่ด้วยอีเมล";
  $("authMessage").textContent = "";
}
function authErrorMessage(error, registering) {
  const common = {
    "auth/invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
    "auth/network-request-failed": "เชื่อมต่อ Firebase ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต",
    "auth/too-many-requests": "มีการลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
    "auth/operation-not-allowed": "ระบบยังไม่เปิดการสมัครด้วยอีเมล กรุณาให้ผู้ดูแลเปิด Email/Password ใน Firebase Authentication",
    "auth/configuration-not-found": "ไม่พบการตั้งค่า Email/Password ใน Firebase Authentication",
    "auth/invalid-api-key": "การเชื่อมต่อ Firebase ตั้งค่าไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ",
    "auth/app-not-authorized": "โดเมนเว็บไซต์นี้ยังไม่ได้รับอนุญาตใน Firebase Authentication"
  };
  const signup = {
    "auth/email-already-in-use": "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ",
    "auth/weak-password": "รหัสผ่านสั้นหรือไม่ปลอดภัยพอ กรุณาตั้งรหัสผ่านใหม่",
    "auth/password-does-not-meet-requirements": "รหัสผ่านไม่ผ่านข้อกำหนดของระบบ กรุณาตั้งรหัสผ่านใหม่"
  };
  return (registering && signup[error.code]) || common[error.code] ||
    ((registering ? "สมัครสมาชิกไม่สำเร็จ" : "เข้าสู่ระบบไม่สำเร็จ") + (error.code ? " (" + error.code + ")" : " กรุณาลองอีกครั้ง"));
}
$("btnRegister").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("authMessage").textContent = "";
  const registering = authMode === "register";
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (registering && password !== $("confirmPassword").value) {
    $("authMessage").textContent = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
    $("confirmPassword").focus();
    return;
  }
  $("btnLogin").disabled = true; $("btnRegister").disabled = true;
  try {
    if (registering) {
      await createUserWithEmailAndPassword(auth, email, password);
      toast("สมัครสมาชิกด้วยอีเมลสำเร็จ");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    console.error("Firebase Authentication failed:", error.code);
    $("authMessage").textContent = authErrorMessage(error, registering);
  } finally {
    $("btnLogin").disabled = false; $("btnRegister").disabled = false;
  }
});
$("btnLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async user => {
  if (unsubscribeData) { unsubscribeData(); unsubscribeData = null; }
  currentUser = user; isAdmin = false;
  $("adminNav").hidden = true;
  if (!user) {
    appData = { rooms: [], transactions: [], expenseCategories: [...defaultCategories] };
    $("authView").hidden = false; $("appView").hidden = true; showPage("dashboard"); return;
  }
  $("authView").hidden = true; $("appView").hidden = false;
  $("userEmailDisplay").textContent = user.email || "บัญชีผู้ใช้";
  $("userRoleDisplay").textContent = "เจ้าของพื้นที่";
  $("loginPassword").value = "";
  setAuthMode("login");
  showPage("dashboard");
  try {
    const claims = await getIdTokenResult(user, true);
    if (currentUser?.uid !== user.uid) return;
    isAdmin = claims.claims.admin === true;
    $("adminNav").hidden = !isAdmin;
    $("userRoleDisplay").textContent = isAdmin ? "ผู้ดูแลระบบ" : "เจ้าของพื้นที่";
  } catch (error) { console.error("Admin role check failed", error); }
  try {
    const profileRef = doc(db, "userProfiles", user.uid);
    const existing = await getDoc(profileRef);
    if (!existing.exists()) await setDoc(profileRef, { email: user.email || "", createdAt: serverTimestamp() });
  } catch (error) { console.error("Profile registration failed", error); toast("ไม่สามารถบันทึกโปรไฟล์บัญชีได้"); }
  if (currentUser?.uid !== user.uid) return;
  let initializing = false;
  unsubscribeData = onSnapshot(doc(db, "resortData", user.uid), snapshot => {
    if (!snapshot.exists()) {
      if (!initializing) {
        initializing = true;
        appData = { rooms: [{ id: "r_1", name: "ห้องตัวอย่าง 1", type: "standard", status: "available" }], transactions: [], expenseCategories: [...defaultCategories] };
        saveData().finally(() => { initializing = false; });
      }
    } else {
      const data = snapshot.data();
      appData = { rooms: Array.isArray(data.rooms) ? data.rooms : [], transactions: Array.isArray(data.transactions) ? data.transactions : [], expenseCategories: Array.isArray(data.expenseCategories) ? data.expenseCategories : [...defaultCategories] };
      appData.rooms = appData.rooms.map(room => ({ ...room, type: pricing[room.type] ? room.type : "standard" }));
    }
    renderAll();
  }, error => { console.error("Data sync failed", error); toast("ไม่สามารถโหลดข้อมูลที่พักได้ กรุณาตรวจสอบสิทธิ์หรือเครือข่าย"); });
});

async function saveData() {
  if (!currentUser) return false;
  try { await setDoc(doc(db, "resortData", currentUser.uid), appData); renderAll(); return true; }
  catch (error) { console.error("Save failed", error); toast("บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง"); return false; }
}
function renderAll() { renderRooms(); renderCategories(); renderDashboard(); renderTransactions(); icons(); }

function renderRooms() {
  const rooms = safeRooms(), occupied = rooms.filter(room => room.status === "occupied").length;
  $("allRoomsCount").textContent = rooms.length; $("availableCount").textContent = rooms.length - occupied; $("occupiedCount").textContent = occupied;
  $("occupiedRooms").textContent = occupied + " / " + rooms.length;
  $("occupancyRate").textContent = "อัตราเข้าพัก " + (rooms.length ? Math.round(occupied / rooms.length * 100) : 0) + "%";
  const search = $("roomSearch").value.trim().toLocaleLowerCase("th-TH"), filter = $("roomFilter").value;
  const matching = rooms.filter(room => (filter === "all" || room.status === filter) && String(room.name).toLocaleLowerCase("th-TH").includes(search));
  const container = $("roomContainer"); container.replaceChildren();
  if (!matching.length) { container.innerHTML = '<div class="empty-state">ไม่พบห้องพักตามเงื่อนไข</div>'; return; }
  matching.forEach(room => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "room-card";
    button.innerHTML = '<span class="room-card-top"><i data-lucide="bed-double"></i><span class="status-chip ' + (room.status === "occupied" ? "occupied" : "available") + '">' + (room.status === "occupied" ? "มีผู้เข้าพัก" : "ว่าง") + '</span></span><strong>' + escapeHtml(room.name) + '</strong><small>' + escapeHtml(pricing[room.type]?.label || "ห้องแอร์") + '</small>';
    button.addEventListener("click", () => openStay(room.id)); container.appendChild(button);
  });
}
$("roomSearch").addEventListener("input", renderRooms);
$("roomFilter").addEventListener("change", renderRooms);
function openRoomForm(room = null) {
  $("roomForm").reset(); $("roomId").value = room?.id || "";
  $("roomName").value = room?.name || ""; $("roomType").value = room?.type || "standard";
  $("roomDialogTitle").textContent = room ? "แก้ไขห้องพัก" : "เพิ่มห้องพัก";
  $("btnDeleteRoom").hidden = !room;
  $("roomDialog").showModal(); $("roomName").focus();
}
$("btnAddRoom").addEventListener("click", () => openRoomForm());
$("roomForm").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("roomName").value.trim(), type = $("roomType").value, id = $("roomId").value;
  if (!name) return;
  if (safeRooms().some(room => room.name.toLocaleLowerCase("th-TH") === name.toLocaleLowerCase("th-TH") && room.id !== id)) { toast("ชื่อห้องนี้มีอยู่แล้ว"); return; }
  if (id) { const room = appData.rooms.find(room => room.id === id); if (!room) return; room.name = name; room.type = type; }
  else appData.rooms.push({ id: newId(), name, type, status: "available" });
  if (await saveData()) { $("roomDialog").close(); toast("บันทึกห้องพักแล้ว"); }
});
$("btnDeleteRoom").addEventListener("click", async () => {
  const id = $("roomId").value, room = appData.rooms.find(room => room.id === id);
  if (!room || !confirm("ลบห้อง " + room.name + " อย่างถาวร? ประวัติรายรับยังคงอยู่")) return;
  appData.rooms = appData.rooms.filter(item => item.id !== id);
  if (await saveData()) { $("roomDialog").close(); toast("ลบห้องพักแล้ว"); }
});
$("btnClearAll").addEventListener("click", async () => {
  if (!safeRooms().some(room => room.status === "occupied")) { toast("ทุกห้องว่างอยู่แล้ว"); return; }
  if (!confirm("รีเซ็ตสถานะทุกห้องเป็นว่าง?")) return;
  appData.rooms.forEach(room => { room.status = "available"; });
  if (await saveData()) toast("รีเซ็ตสถานะห้องแล้ว");
});
function openStay(id) {
  const room = appData.rooms.find(room => room.id === id); if (!room) return;
  selectedRoomId = id; $("stayDialogTitle").textContent = room.name;
  const occupied = room.status === "occupied";
  $("stayAvailable").hidden = occupied; $("stayOccupied").hidden = !occupied;
  $("checkInForm").reset(); $("customPrice").value = pricing[room.type]?.overnight ?? 400;
  $("stayDialog").showModal();
}
$("stayType").addEventListener("change", () => {
  const room = appData.rooms.find(room => room.id === selectedRoomId);
  if (room) $("customPrice").value = pricing[room.type]?.[$("stayType").value] ?? 0;
});
$("checkInForm").addEventListener("submit", async event => {
  event.preventDefault();
  const room = appData.rooms.find(room => room.id === selectedRoomId);
  const amount = Number($("customPrice").value);
  if (!room || room.status !== "available" || !Number.isFinite(amount) || amount < 0) return;
  room.status = "occupied";
  appData.transactions.push({ id: newId(), type: "income", amount, roomId: room.id, date: new Date().toISOString(), desc: "เช็คอิน " + room.name, customer: $("customerInfo").value.trim() || "ลูกค้า Walk-in" });
  if (await saveData()) { $("stayDialog").close(); toast("บันทึกการเข้าพักแล้ว"); }
});
$("btnConfirmCheckOut").addEventListener("click", async () => {
  const room = appData.rooms.find(room => room.id === selectedRoomId);
  if (!room) return;
  room.status = "available";
  if (await saveData()) { $("stayDialog").close(); toast("เช็คเอาท์แล้ว"); }
});
$("btnEditRoom").addEventListener("click", () => {
  const room = appData.rooms.find(room => room.id === selectedRoomId);
  $("stayDialog").close(); if (room) openRoomForm(room);
});
document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); }));

function renderCategories() {
  const select = $("expenseCategory"), previous = select.value;
  select.replaceChildren(new Option("เลือกหมวดหมู่", ""));
  appData.expenseCategories.forEach(category => select.add(new Option(category, category)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
$("btnAddCategory").addEventListener("click", async () => {
  const category = prompt("ชื่อหมวดหมู่รายจ่ายใหม่");
  if (!category?.trim()) return;
  const name = category.trim();
  if (appData.expenseCategories.some(item => item.toLocaleLowerCase("th-TH") === name.toLocaleLowerCase("th-TH"))) { toast("หมวดหมู่นี้มีอยู่แล้ว"); return; }
  appData.expenseCategories.push(name);
  if (await saveData()) { $("expenseCategory").value = name; toast("เพิ่มหมวดหมู่แล้ว"); }
});
$("expenseForm").addEventListener("submit", async event => {
  event.preventDefault();
  const category = $("expenseCategory").value, amount = Number($("expenseAmount").value);
  if (!category || !Number.isFinite(amount) || amount <= 0) return;
  appData.transactions.push({ id: newId(), type: "expense", amount, date: new Date().toISOString(), desc: category });
  if (await saveData()) { $("expenseForm").reset(); toast("บันทึกรายจ่ายแล้ว"); }
});

function renderDashboard() {
  const key = $("monthSelector").value, { income, expense } = totals(txForMonth(key)), net = income - expense;
  $("totalIncome").textContent = money(income); $("totalExpense").textContent = money(expense);
  $("netProfit").textContent = net < 0 ? "-" + money(Math.abs(net)) : money(net);
  $("netProfit").classList.toggle("negative", net < 0);
  renderChart(key);
  renderTransactionList($("recentTransactions"), txForMonth(key).slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5), false);
}
function renderChart(selectedKey) {
  const [year, month] = selectedKey.split("-").map(Number);
  if (!year) return;
  const months = Array.from({ length: 6 }, (_, i) => new Date(year, month - 6 + i, 1));
  const data = months.map(date => ({ date, ...totals(txForMonth(monthKey(date))) }));
  const max = Math.max(1, ...data.flatMap(item => [item.income, item.expense]));
  $("trendChart").replaceChildren();
  data.forEach(({ date, income, expense }) => {
    const group = document.createElement("div"); group.className = "chart-month";
    const label = new Intl.DateTimeFormat("th-TH", { month: "short" }).format(date);
    group.innerHTML = '<div class="chart-bars"><span class="chart-bar income" style="height:' + (income ? Math.max(3, income / max * 100) : 0) + '%;min-height:' + (income ? 3 : 0) + 'px" title="' + escapeHtml(label) + ' รายรับ ' + escapeHtml(money(income)) + '"></span><span class="chart-bar expense" style="height:' + (expense ? Math.max(3, expense / max * 100) : 0) + '%;min-height:' + (expense ? 3 : 0) + 'px" title="' + escapeHtml(label) + ' รายจ่าย ' + escapeHtml(money(expense)) + '"></span></div><span class="chart-label">' + escapeHtml(label) + '</span>';
    $("trendChart").appendChild(group);
  });
  $("trendSummary").textContent = data.map(({ date, income, expense }) => new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(date) + ": รายรับ " + money(income) + " รายจ่าย " + money(expense)).join("; ");
}
function renderTransactionList(container, items, canDelete) {
  container.replaceChildren();
  if (!items.length) { container.innerHTML = '<div class="empty-state">ยังไม่มีรายการในเดือนนี้</div>'; return; }
  items.forEach(tx => {
    const income = tx.type === "income", row = document.createElement("div"); row.className = "transaction-row";
    const when = new Date(tx.date), date = Number.isNaN(when.getTime()) ? "ไม่ทราบวันที่" : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(when);
    row.innerHTML = '<span class="transaction-icon ' + (income ? "income" : "expense") + '"><i data-lucide="' + (income ? "arrow-down-left" : "arrow-up-right") + '"></i></span><div class="transaction-info"><strong>' + escapeHtml(tx.desc || (income ? "รายรับ" : "รายจ่าย")) + '</strong><span>' + escapeHtml(date) + (tx.customer ? " · " + escapeHtml(tx.customer) : "") + '</span></div><span class="transaction-amount ' + (income ? "positive" : "negative") + '">' + (income ? "+" : "-") + escapeHtml(money(tx.amount)) + '</span>';
    if (canDelete) { const button = document.createElement("button"); button.className = "icon-button delete-transaction"; button.type = "button"; button.title = "ลบรายการ"; button.setAttribute("aria-label", "ลบรายการ " + (tx.desc || "")); button.innerHTML = '<i data-lucide="trash-2"></i>'; button.addEventListener("click", () => deleteTransaction(tx.id)); row.appendChild(button); }
    container.appendChild(row);
  });
}
function renderTransactions() {
  const key = $("transactionsMonth").value, items = txForMonth(key).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const { income, expense } = totals(items), net = income - expense;
  $("expensePageIncome").textContent = money(income); $("expensePageExpense").textContent = money(expense);
  $("expensePageNet").textContent = net < 0 ? "-" + money(Math.abs(net)) : money(net);
  $("expensePageNet").classList.toggle("negative", net < 0);
  $("transactionCount").textContent = items.length + " รายการ";
  renderTransactionList($("allTransactions"), items, true);
}
async function deleteTransaction(id) {
  const tx = appData.transactions.find(item => String(item.id) === String(id));
  if (!tx || !confirm("ลบรายการ " + (tx.desc || "") + " อย่างถาวร?")) return;
  appData.transactions = appData.transactions.filter(item => String(item.id) !== String(id));
  if (await saveData()) toast("ลบรายการแล้ว");
}
$("monthSelector").addEventListener("change", renderDashboard);
$("transactionsMonth").addEventListener("change", renderTransactions);

async function loadUsers() {
  if (!isAdmin || !currentUser) return;
  $("adminMessage").textContent = "กำลังโหลดบัญชี...";
  $("usersTable").replaceChildren();
  try {
    const snapshot = await getDocs(collection(db, "userProfiles"));
    if (!isAdmin || !currentUser) return;
    const users = snapshot.docs.map(item => ({ uid: item.id, ...item.data() })).sort((a, b) => (a.email || "").localeCompare(b.email || ""));
    $("userCount").textContent = users.length + " บัญชี";
    $("adminMessage").textContent = users.length ? "" : "ยังไม่มีบัญชีในรายการ";
    users.forEach(user => {
      const row = document.createElement("tr");
      const date = user.createdAt?.toDate?.();
      for (const value of [user.email || "ไม่มีอีเมล", user.uid, date ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date) : "ไม่ทราบวันที่"]) {
        const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell);
      }
      $("usersTable").appendChild(row);
    });
  } catch (error) { console.error("User directory failed", error); $("adminMessage").textContent = "โหลดรายชื่อไม่ได้ กรุณาตรวจสอบสิทธิ์แอดมินและ Firestore Rules"; }
}
