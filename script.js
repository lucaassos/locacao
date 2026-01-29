// script.js - Ajustado (CSS/UX + Lógica + Dashboard com filtros)
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  limit,
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

/** =========================
 * Utils
 * ========================= */
const $ = (sel) => document.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toMonthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const safeText = (v) => (v ?? "").toString();

function formatPtMonthYear(date) {
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatTimePt(value) {
  if (!value) return "--:--";
  if (value?.toDate) {
    const d = value.toDate();
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const d = new Date(value);
  if (!isNaN(d)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return "--:--";
}

/** =========================
 * Estado
 * ========================= */
let currentDate = new Date();
let currentSelectedDay = null;
let allAgentsCache = []; // [{id, nome, email, bitrixId}]
let currentQueue = [];

/** =========================
 * Auth guard
 * ========================= */
onAuthStateChanged(auth, (user) => {
  if (!user) window.location.href = "index.html";
  initApp();
});

$("#btn-logout")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

/** =========================
 * Init
 * ========================= */
async function initApp() {
  setupNavigation();

  // Botões globais
  $("#prevMonth")?.addEventListener("click", () => changeMonth(-1));
  $("#nextMonth")?.addEventListener("click", () => changeMonth(1));
  $("#btnAddAgent")?.addEventListener("click", addAgent);
  $("#btnSaveSchedule")?.addEventListener("click", saveDaySchedule);

  // Dashboard
  $("#btnFilterDash")?.addEventListener("click", applyDashboardFilter);
  $("#btnClearDash")?.addEventListener("click", setDashboardToday);

  try {
    await loadAgentsCache();
    await renderCalendar(currentDate);
    await loadAgentsTable();
    await initDashboard();
  } catch (err) {
    console.error("Erro init:", err);
    toastError(`Erro ao iniciar: ${err.message}`);
  }
}

/** =========================
 * Navegação
 * ========================= */
function setupNavigation() {
  const map = {
    "nav-escala": "escala",
    "nav-colab": "colaboradoras",
    "nav-dash": "dashboard",
  };

  Object.keys(map).forEach((navId) => {
    const btn = document.getElementById(navId);
    btn?.addEventListener("click", (e) => {
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));

      e.currentTarget.classList.add("active");
      document.getElementById(map[navId])?.classList.add("active");

      // Acessibilidade: foco no primeiro H2 da seção
      const sec = document.getElementById(map[navId]);
      sec?.querySelector("h2")?.focus?.();
    });
  });
}

/** =========================
 * Toast simples (sem lib)
 * ========================= */
function toastError(message) {
  const el = document.createElement("div");
  el.className = "toast toast--error";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, 3800);
}

function toastOk(message) {
  const el = document.createElement("div");
  el.className = "toast toast--ok";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

/** =========================
 * Agents cache
 * ========================= */
async function loadAgentsCache() {
  const q = query(collection(db, "colaboradoras"), orderBy("nome"));
  const snapshot = await getDocs(q);

  allAgentsCache = [];
  snapshot.forEach((d) => {
    const data = d.data();
    allAgentsCache.push({
      id: d.id,
      ...data,
      bitrixId: safeText(data.bitrixId).trim(),
      nome: safeText(data.nome).trim(),
      email: safeText(data.email).trim(),
    });
  });

  // Preencher select do dashboard
  const sel = $("#dashAgentFilter");
  if (sel) {
    sel.innerHTML = `<option value="todos">Todas</option>`;
    allAgentsCache.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.bitrixId;
      opt.textContent = a.nome;
      sel.appendChild(opt);
    });
  }
}

function getAgentNameByBitrixId(bitrixId) {
  const id = safeText(bitrixId).trim();
  const a = allAgentsCache.find((x) => x.bitrixId === id);
  if (!a) return `ID: ${id}`;
  // exibe "Primeiro Nome" no calendário e lista
  return a.nome.split(" ")[0] || a.nome;
}

/** =========================
 * Calendário
 * ========================= */
async function renderCalendar(date) {
  const grid = $("#calendarGrid");
  const label = $("#currentMonthLabel");
  if (!grid || !label) return;

  grid.innerHTML = `<div class="skeleton">Carregando…</div>`;
  label.textContent = formatPtMonthYear(date);

  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthKey = `${year}-${pad2(month + 1)}`;

  // 1) Busca otimizada por monthKey (novo)
  // 2) Se ainda não existir monthKey em docs antigos, faz fallback para fetch geral + filter.
  let scheduleMap = {};
  try {
    const qMonth = query(collection(db, "escala"), where("monthKey", "==", monthKey));
    const snap = await getDocs(qMonth);

    // Se vier vazio, pode ser base antiga: fallback
    if (snap.size === 0) {
      const all = await getDocs(collection(db, "escala"));
      all.forEach((d) => {
        if (d.id.startsWith(monthKey)) {
          scheduleMap[d.id] = d.data()?.agentes || [];
        }
      });
    } else {
      snap.forEach((d) => {
        scheduleMap[d.id] = d.data()?.agentes || [];
      });
    }
  } catch (err) {
    console.error("Erro fetch escala:", err);
    toastError("Erro ao carregar escala. Verifique regras/índices.");
    scheduleMap = {};
  }

  grid.innerHTML = "";

  // Ajuste: alinhar primeiro dia do mês na grade (domingo = 0)
  const firstWeekday = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstWeekday; i++) {
    const spacer = document.createElement("div");
    spacer.className = "calendar-spacer";
    grid.appendChild(spacer);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayString = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    const ids = (scheduleMap[dayString] || []).map((x) => safeText(x).trim());
    const names = ids.map(getAgentNameByBitrixId);

    const el = document.createElement("button");
    el.type = "button";
    el.className = "calendar-day";
    el.setAttribute("aria-label", `Dia ${day}`);
    el.innerHTML = `
      <div class="day-header">
        <span class="day-number">${day}</span>
        <span class="day-dot ${names.length ? "on" : "off"}" aria-hidden="true"></span>
      </div>
      <div class="day-preview">
        ${
          names.length
            ? names
                .slice(0, 4)
                .map((n, idx) => `<div class="preview-item"><strong>${idx + 1}º</strong> ${n}</div>`)
                .join("")
            : `<span class="muted small">Sem escala</span>`
        }
        ${names.length > 4 ? `<div class="muted small">+${names.length - 4} na fila</div>` : ""}
      </div>
    `;

    el.addEventListener("click", () => openDayModal(dayString, ids));
    grid.appendChild(el);
  }
}

function changeMonth(offset) {
  currentDate.setMonth(currentDate.getMonth() + offset);
  renderCalendar(currentDate);
}

/** =========================
 * Modal (escala)
 * ========================= */
function openDayModal(dateString, existingIds) {
  currentSelectedDay = dateString;
  currentQueue = (existingIds || []).map((id) => safeText(id).trim());

  $("#modalDateTitle").textContent = `Escala: ${dateString.split("-").reverse().join("/")}`;
  $("#dayModal")?.showModal();

  renderModalLists();
}

function renderModalLists() {
  const listAvailable = $("#listAvailable");
  const listQueue = $("#listQueue");
  if (!listAvailable || !listQueue) return;

  listAvailable.innerHTML = "";
  listQueue.innerHTML = "";

  // Fila
  currentQueue.forEach((bitrixId, index) => {
    const displayName = allAgentsCache.find((a) => a.bitrixId === bitrixId)?.nome || `ID: ${bitrixId}`;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "agent-card in-queue";
    card.innerHTML = `
      <span class="agent-name">${displayName}</span>
      <span class="queue-number">${index + 1}</span>
    `;
    card.title = "Clique para remover da fila";
    card.addEventListener("click", () => {
      currentQueue.splice(index, 1);
      renderModalLists();
    });

    listQueue.appendChild(card);
  });

  // Disponíveis (não presentes na fila)
  const available = allAgentsCache.filter((a) => !currentQueue.includes(a.bitrixId));
  if (available.length === 0) {
    listAvailable.innerHTML = `<div class="muted small">Sem colaboradoras disponíveis.</div>`;
    return;
  }

  available.forEach((agent) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "agent-card";
    card.innerHTML = `
      <span class="agent-name">${agent.nome}</span>
      <span class="agent-plus">+</span>
    `;
    card.title = "Clique para adicionar na fila";
    card.addEventListener("click", () => {
      currentQueue.push(agent.bitrixId);
      renderModalLists();
    });

    listAvailable.appendChild(card);
  });
}

async function saveDaySchedule() {
  if (!currentSelectedDay) return;

  const monthKey = currentSelectedDay.slice(0, 7); // YYYY-MM

  try {
    await setDoc(doc(db, "escala", currentSelectedDay), {
      agentes: currentQueue,
      last_agent_index: -1,
      monthKey, // >>> melhora performance de leitura do calendário
      updatedAt: new Date(),
    });

    $("#dayModal")?.close();
    toastOk("Escala salva!");
    renderCalendar(currentDate);
  } catch (e) {
    console.error(e);
    toastError(`Erro ao salvar: ${e.message}`);
  }
}

/** =========================
 * Cadastro de colaboradoras
 * ========================= */
async function addAgent() {
  const nome = safeText($("#newAgentName")?.value).trim();
  const email = safeText($("#newAgentEmail")?.value).trim();
  const bitrixId = safeText($("#newAgentBitrixId")?.value).trim();

  if (!nome || !bitrixId) return toastError("Preencha nome e ID do Bitrix.");

  // Evita duplicidade de ID Bitrix
  if (allAgentsCache.some((a) => a.bitrixId === bitrixId)) {
    return toastError("Já existe colaboradora com esse ID Bitrix.");
  }

  try {
    await addDoc(collection(db, "colaboradoras"), { nome, email, bitrixId });

    $("#newAgentName").value = "";
    $("#newAgentEmail").value = "";
    $("#newAgentBitrixId").value = "";

    await loadAgentsCache();
    await loadAgentsTable();
    toastOk("Colaboradora cadastrada!");
  } catch (e) {
    console.error(e);
    toastError(`Erro ao cadastrar: ${e.message}`);
  }
}

async function loadAgentsTable() {
  const tbody = $("#agentsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (allAgentsCache.length === 0) await loadAgentsCache();

  allAgentsCache.forEach((agent) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${agent.nome}</td>
      <td>${agent.email || "-"}</td>
      <td>${agent.bitrixId}</td>
      <td class="col-actions">
        <button class="btn-danger" type="button" data-id="${agent.id}">Excluir</button>
      </td>
    `;
    tr.querySelector("button")?.addEventListener("click", () => window.deleteAgent(agent.id));
    tbody.appendChild(tr);
  });
}

// Função global (mantida)
window.deleteAgent = async (id) => {
  if (!confirm("Tem certeza que deseja excluir esta colaboradora?")) return;

  try {
    await deleteDoc(doc(db, "colaboradoras", id));
    await loadAgentsCache();
    await loadAgentsTable();
    toastOk("Excluída.");
  } catch (e) {
    console.error(e);
    toastError(`Erro ao excluir: ${e.message}`);
  }
};

/** =========================
 * Dashboard (com filtros)
 * Coleção: historico_leads
 * Campos esperados:
 * - dataString: "YYYY-MM-DD"
 * - dataHora: Timestamp (ideal) ou string ISO
 * - consultorId: string/number (Bitrix ID)
 * - leadId: opcional
 * ========================= */
async function initDashboard() {
  setDashboardToday();
  await applyDashboardFilter();
}

function setDashboardToday() {
  const today = new Date();
  const ymd = toYMD(today);
  $("#dashStartDate").value = ymd;
  $("#dashEndDate").value = ymd;
  $("#dashAgentFilter").value = "todos";
}

async function applyDashboardFilter() {
  const container = $("#dashboardContainer");
  if (!container) return;

  const start = $("#dashStartDate")?.value || "";
  const end = $("#dashEndDate")?.value || "";
  const agent = $("#dashAgentFilter")?.value || "todos";

  if (!start || !end) {
    container.innerHTML = `<div class="card-panel"><p class="muted">Selecione início e fim.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="card-panel">
      <div class="skeleton">Carregando dashboard…</div>
    </div>
  `;

  try {
    // Firestore: para range em string YYYY-MM-DD funciona bem (lexicográfico).
    // Atenção: pode exigir índice composto ao usar consultorId + range + orderBy.
    let qBase = query(
      collection(db, "historico_leads"),
      where("dataString", ">=", start),
      where("dataString", "<=", end),
      orderBy("dataString", "desc"),
      orderBy("dataHora", "desc"),
      limit(300)
    );

    if (agent !== "todos") {
      qBase = query(
        collection(db, "historico_leads"),
        where("consultorId", "==", agent),
        where("dataString", ">=", start),
        where("dataString", "<=", end),
        orderBy("dataString", "desc"),
        orderBy("dataHora", "desc"),
        limit(300)
      );
    }

    const snap = await getDocs(qBase);

    const leads = [];
    snap.forEach((d) => leads.push({ id: d.id, ...d.data() }));

    // KPIs
    const total = leads.length;
    const byAgent = new Map();
    leads.forEach((l) => {
      const id = safeText(l.consultorId).trim() || "—";
      byAgent.set(id, (byAgent.get(id) || 0) + 1);
    });

    // Render
    container.innerHTML = `
      <div class="dash-kpis">
        <div class="kpi-card">
          <div class="kpi-label">Leads no período</div>
          <div class="kpi-value">${total}</div>
          <div class="kpi-sub">${start.split("-").reverse().join("/")} → ${end.split("-").reverse().join("/")}</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Consultoras ativas</div>
          <div class="kpi-value">${byAgent.size}</div>
          <div class="kpi-sub">${agent === "todos" ? "Todas" : getAgentNameByBitrixId(agent)}</div>
        </div>
      </div>

      <div class="card-panel">
        <div class="panel-title">
          <h3>Últimos leads</h3>
          <span class="muted small">Mostrando até 300 registros</span>
        </div>

        <div class="lead-list">
          ${
            leads.length === 0
              ? `<div class="muted">Nenhum lead encontrado nesse filtro.</div>`
              : leads.map(renderLeadRow).join("")
          }
        </div>
      </div>

      <div class="card-panel">
        <div class="panel-title">
          <h3>Leads por consultora</h3>
          <span class="muted small">Contagem no período</span>
        </div>

        <div class="agent-stats">
          ${renderAgentStats(byAgent)}
        </div>
      </div>
    `;

    // Clique para abrir detalhes (modal pronto)
    container.querySelectorAll("[data-lead-json]").forEach((el) => {
      el.addEventListener("click", () => {
        const raw = el.getAttribute("data-lead-json");
        const lead = JSON.parse(raw);
        openLeadDetails(lead);
      });
    });
  } catch (err) {
    console.error("Erro dashboard:", err);
    container.innerHTML = `
      <div class="card-panel">
        <p class="error-text">Erro ao carregar dashboard: ${err.message}</p>
        <p class="muted small">Se você usou filtro por consultora + período, o Firestore pode exigir um índice composto.</p>
      </div>
    `;
  }
}

function renderLeadRow(lead) {
  const hora = formatTimePt(lead.dataHora);
  const id = safeText(lead.leadId) ? `#${lead.leadId}` : "Sem ID";
  const consultorId = safeText(lead.consultorId).trim();
  const consultor = consultorId ? getAgentNameByBitrixId(consultorId) : "—";
  const data = safeText(lead.dataString) || "";

  // guard: evitar quebrar JSON em atributo
  const safeJson = JSON.stringify(lead).replaceAll('"', "&quot;");

  return `
    <button type="button" class="lead-row" data-lead-json="${safeJson}">
      <div class="lead-left">
        <div class="lead-time">${hora}</div>
        <div class="lead-meta">
          <span class="lead-id">Lead ${id}</span>
          <span class="dot">•</span>
          <span class="lead-date">${data.split("-").reverse().join("/")}</span>
        </div>
      </div>

      <div class="lead-right">
        <span class="pill">${consultor}</span>
      </div>
    </button>
  `;
}

function renderAgentStats(map) {
  // ordena desc por quantidade
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return `<div class="muted">Sem dados.</div>`;

  return rows
    .map(([id, count]) => {
      const name = id === "—" ? "Sem consultora" : getAgentNameByBitrixId(id);
      return `
        <div class="agent-stat-row">
          <div class="agent-stat-name">${name}</div>
          <div class="agent-stat-count">${count}</div>
        </div>
      `;
    })
    .join("");
}

function openLeadDetails(lead) {
  const modal = $("#leadDetailsModal");
  const body = $("#leadDetailsBody");
  if (!modal || !body) return;

  const leadId = safeText(lead.leadId) ? `#${lead.leadId}` : "Sem ID";
  const consultor = safeText(lead.consultorId).trim() ? getAgentNameByBitrixId(lead.consultorId) : "—";
  const hora = formatTimePt(lead.dataHora);
  const data = safeText(lead.dataString) ? lead.dataString.split("-").reverse().join("/") : "-";

  body.innerHTML = `
    <div class="details-grid">
      <div class="detail">
        <div class="detail-label">Lead</div>
        <div class="detail-value">${leadId}</div>
      </div>
      <div class="detail">
        <div class="detail-label">Data</div>
        <div class="detail-value">${data}</div>
      </div>
      <div class="detail">
        <div class="detail-label">Hora</div>
        <div class="detail-value">${hora}</div>
      </div>
      <div class="detail">
        <div class="detail-label">Consultora</div>
        <div class="detail-value">${consultor}</div>
      </div>
    </div>

    <div class="detail-block">
      <div class="detail-label">Raw (para debug)</div>
      <pre class="code-block">${escapeHtml(JSON.stringify(lead, null, 2))}</pre>
    </div>
  `;

  modal.showModal();
}

function escapeHtml(str) {
  return safeText(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
