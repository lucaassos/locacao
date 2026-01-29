
// script.js - Versão Final Com Dashboard e Correções
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
    where 
} from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

let currentDate = new Date();
let currentSelectedDay = null;
let allAgentsCache = []; 
let currentQueue = [];

// --- AUTH CHECK ---
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "index.html";
    } else {
        console.log("Usuário logado:", user.email);
        initApp();
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    signOut(auth).then(() => window.location.href = "index.html");
});

// --- INICIALIZAÇÃO ---
async function initApp() {
    setupNavigation();
    try {
        await loadAgentsCache(); // Carrega lista de nomes para usar no calendário e dashboard
        console.log("Agentes carregados:", allAgentsCache); 
        
        await renderCalendar(currentDate); // Monta o calendário visual
        loadAgentsTable(); // Preenche a tabela de cadastro
        loadDashboardStats(); // <--- NOVO: Carrega os números do Dashboard
    } catch (error) {
        console.error("Erro na inicialização:", error);
    }
    
    // Listeners (Botões)
    document.getElementById('prevMonth').onclick = () => changeMonth(-1);
    document.getElementById('nextMonth').onclick = () => changeMonth(1);
    document.getElementById('btnAddAgent').onclick = addAgent;
    document.getElementById('btnSaveSchedule').onclick = saveDaySchedule;
}

// --- NAVEGAÇÃO ---
function setupNavigation() {
    const sections = { 'nav-escala': 'escala', 'nav-colab': 'colaboradoras', 'nav-dash': 'dashboard' };
    Object.keys(sections).forEach(navId => {
        document.getElementById(navId).addEventListener('click', (e) => {
            // Remove classe ativa de todos
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            
            // Adiciona no clicado
            e.target.classList.add('active');
            document.getElementById(sections[navId]).classList.add('active');
        });
    });
}

// --- DADOS (CACHE DE AGENTES) ---
async function loadAgentsCache() {
    // Busca todas as colaboradoras para ter o "De/Para" de ID para Nome
    const q = query(collection(db, "colaboradoras"), orderBy("nome"));
    const snapshot = await getDocs(q);
    allAgentsCache = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        allAgentsCache.push({ 
            id: doc.id, 
            ...data, 
            bitrixId: String(data.bitrixId).trim() // Garante string para comparação segura
        });
    });
}

// --- DASHBOARD (NOVO) ---
async function loadDashboardStats() {
    const statsList = document.getElementById('statsList');
    if(!statsList) return; // Segurança caso a página mude
    
    statsList.innerHTML = '<div style="padding:20px; text-align:center;">Carregando estatísticas...</div>';

    // 1. Definir "Hoje" no formato YYYY-MM-DD para buscar no banco
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    const dataStringHoje = `${ano}-${mes}-${dia}`;

    try {
        // 2. Query: Buscar na coleção 'historico_leads' onde a dataString é igual a hoje
        const q = query(
            collection(db, "historico_leads"), 
            where("dataString", "==", dataStringHoje),
            orderBy("dataHora", "desc")
        );

        const querySnapshot = await getDocs(q);
        const totalLeads = querySnapshot.size;
        const leads = [];

        querySnapshot.forEach((doc) => {
            leads.push(doc.data());
        });

        // 3. Montar o HTML do Dashboard
        // Nota: Substituímos o conteúdo da lista por um layout mais rico
        let html = `
            <div style="display:flex; gap:20px; margin-bottom:20px;">
                <div class="card-panel" style="flex:1; text-align:center; background: #eef2ff; border: 1px solid #3d357e;">
                    <h3 style="margin:0; color:#3d357e;">Leads Hoje (${dia}/${mes})</h3>
                    <div style="font-size: 3em; font-weight:bold; color:#3d357e;">${totalLeads}</div>
                </div>
            </div>
            
            <div class="card-panel">
                <h4>Últimos Leads Distribuídos</h4>
                <ul style="list-style: none; padding: 0; margin-top: 10px;">
        `;

        if (leads.length === 0) {
            html += `<li style="color:#777; font-style:italic;">Nenhum lead recebido hoje ainda.</li>`;
        } else {
            leads.forEach(lead => {
                // Tratamento de Data/Hora (pode vir como Timestamp do Firestore ou String)
                let horaFormatada = "--:--";
                if(lead.dataHora && lead.dataHora.toDate) {
                    horaFormatada = lead.dataHora.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                } else if (lead.dataHora) {
                    // Tenta converter string ISO
                    const d = new Date(lead.dataHora);
                    if(!isNaN(d)) horaFormatada = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                }

                // Achar nome do consultor pelo ID
                const consultor = allAgentsCache.find(a => a.bitrixId == lead.consultorId);
                const nomeConsultor = consultor ? consultor.nome.split(' ')[0] : `ID ${lead.consultorId}`;
                const leadIdDisplay = lead.leadId ? `#${lead.leadId}` : "Sem ID";

                html += `
                    <li style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; align-items:center;">
                        <div>
                            <span style="font-weight:bold; color:#333;">${horaFormatada}</span> 
                            <span style="color:#666; margin-left:10px;">Lead ${leadIdDisplay}</span>
                        </div>
                        <span style="background:#e0f2f1; color:#00695c; padding:4px 8px; border-radius:4px; font-size:0.9em; font-weight:500;">
                            ${nomeConsultor}
                        </span>
                    </li>
                `;
            });
        }

        html += `</ul></div>`;
        statsList.innerHTML = html;

    } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
        statsList.innerHTML = `<div style="color:red; padding:20px;">Erro ao carregar dados: ${error.message}<br>Verifique as Regras de Segurança.</div>`;
    }
}

// --- CALENDÁRIO ---
async function renderCalendar(date) {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('currentMonthLabel');
    
    grid.innerHTML = '<p>Carregando dados...</p>';
    label.innerText = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const year = date.getFullYear();
    const month = date.getMonth(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Filtro para buscar apenas o mês atual
    const filterPrefix = `${year}-${String(month+1).padStart(2, '0')}`;
    
    const scheduleMap = {};
    const scheduleSnap = await getDocs(collection(db, "escala"));
    
    scheduleSnap.forEach(doc => {
        if(doc.id.startsWith(filterPrefix)) {
            const data = doc.data();
            scheduleMap[doc.id] = data.agentes || []; 
        }
    });

    grid.innerHTML = '';

    for(let i = 1; i <= daysInMonth; i++) {
        const dayString = `${year}-${String(month+1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayAgentsIds = scheduleMap[dayString] || [];
        
        // Converte IDs em Nomes usando o cache
        const dayAgentNames = dayAgentsIds.map(bitrixId => {
            const idToSearch = String(bitrixId).trim();
            const agent = allAgentsCache.find(a => a.bitrixId === idToSearch);
            return agent ? agent.nome.split(' ')[0] : `ID: ${idToSearch}`;
        });

        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        
        let previewHTML = '';
        if(dayAgentNames.length > 0) {
            dayAgentNames.forEach((name, idx) => {
                previewHTML += `<div class="preview-item"><strong>${idx+1}º</strong> ${name}</div>`;
            });
        } else {
            previewHTML = '<span style="color:#ccc; font-size:0.8em;">Sem escala</span>';
        }

        dayEl.innerHTML = `
            <div class="day-header">
                <span>${i}</span>
                ${dayAgentNames.length > 0 ? '🟢' : '⚪'}
            </div>
            <div class="day-preview">${previewHTML}</div>
        `;
        
        dayEl.onclick = () => openDayModal(dayString, dayAgentsIds);
        grid.appendChild(dayEl);
    }
}

function changeMonth(offset) {
    currentDate.setMonth(currentDate.getMonth() + offset);
    renderCalendar(currentDate);
}

// --- MODAL DE EDIÇÃO ---
function openDayModal(dateString, existingIds) {
    currentSelectedDay = dateString;
    currentQueue = existingIds.map(id => String(id).trim()); // Cópia segura

    document.getElementById('modalDateTitle').innerText = `Escala: ${dateString.split('-').reverse().join('/')}`;
    document.getElementById('dayModal').showModal();
    
    renderModalLists();
}

function renderModalLists() {
    const listAvailable = document.getElementById('listAvailable');
    const listQueue = document.getElementById('listQueue');
    
    listAvailable.innerHTML = '';
    listQueue.innerHTML = '';

    // Renderiza Coluna da Direita (Fila)
    currentQueue.forEach((bitrixId, index) => {
        const agent = allAgentsCache.find(a => a.bitrixId === bitrixId);
        const displayName = agent ? agent.nome : `ID: ${bitrixId}`;

        const card = document.createElement('div');
        card.className = 'agent-card in-queue';
        card.innerHTML = `
            <span>${displayName}</span>
            <div class="queue-number">${index + 1}</div>
        `;
        card.onclick = () => {
            currentQueue.splice(index, 1); // Remove da fila
            renderModalLists();
        };
        listQueue.appendChild(card);
    });

    // Renderiza Coluna da Esquerda (Disponíveis)
    const availableAgents = allAgentsCache.filter(a => !currentQueue.includes(a.bitrixId));
    
    availableAgents.forEach(agent => {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.innerHTML = `<span>${agent.nome}</span> <span>+</span>`;
        card.onclick = () => {
            currentQueue.push(agent.bitrixId); // Adiciona na fila
            renderModalLists();
        };
        listAvailable.appendChild(card);
    });
}

async function saveDaySchedule() {
    if(!currentSelectedDay) return;

    try {
        await setDoc(doc(db, "escala", currentSelectedDay), {
            agentes: currentQueue,
            last_agent_index: -1, // Reseta o ponteiro da roleta para o início
            updatedAt: new Date()
        });

        document.getElementById('dayModal').close();
        renderCalendar(currentDate); // Atualiza a tela
    } catch(e) {
        console.error(e);
        alert("Erro ao salvar: " + e.message);
    }
}

// --- CADASTRO DE COLABORADORAS ---
async function addAgent() {
    const nome = document.getElementById('newAgentName').value;
    const email = document.getElementById('newAgentEmail').value;
    const bitrixId = document.getElementById('newAgentBitrixId').value;

    if(!nome || !bitrixId) return alert("Preencha nome e ID do Bitrix!");

    try {
        await addDoc(collection(db, "colaboradoras"), { 
            nome, 
            email, 
            bitrixId: String(bitrixId).trim() 
        });
        alert("Salvo!");
        
        // Limpa formulário
        document.getElementById('newAgentName').value = '';
        document.getElementById('newAgentEmail').value = '';
        document.getElementById('newAgentBitrixId').value = '';
        
        await loadAgentsCache(); // Recarrega cache
        loadAgentsTable(); // Atualiza tabela
    } catch (e) {
        console.error(e);
        alert("Erro ao cadastrar: " + e.message);
    }
}

async function loadAgentsTable() {
    const tbody = document.getElementById('agentsTableBody');
    tbody.innerHTML = '';
    
    if(allAgentsCache.length === 0) await loadAgentsCache();

    allAgentsCache.forEach(agent => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${agent.nome}</td>
            <td>${agent.email || '-'}</td>
            <td>${agent.bitrixId}</td>
            <td><button class="btn-danger" onclick="window.deleteAgent('${agent.id}')">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// Função global para ser acessada pelo onclick do HTML
window.deleteAgent = async (id) => {
    if(confirm("Tem certeza que deseja excluir esta colaboradora?")) {
        try {
            await deleteDoc(doc(db, "colaboradoras", id));
            await loadAgentsCache();
            loadAgentsTable();
        } catch(e) {
            alert("Erro ao excluir: " + e.message);
        }
    }
};
