// ============================================
// DodoTracker - Application de suivi du sommeil
// ============================================

const DB_NAME = 'DodoTrackerDB';
const DB_VERSION = 2;
const STORE_NAME = 'sleepEntries';

let db = null;
let charts = {};
let deleteEntryId = null;

// ============================================
// Initialisation
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => {
        initTabs();
        initForm();
        initConditionalFields();
        initRangeInputs();
        initModals();
        initExportImport();
        initStatsFilters();
        setDefaultDate();
        loadHistory();
        registerServiceWorker();
    });
});

// ============================================
// Base de données IndexedDB
// ============================================

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => resolve();
        request.onsuccess = (event) => {
            db = event.target.result;
            syncFromLocalStorage();
            resolve();
        };
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: true });
            }
        };
    });
}


async function saveEntry(entry) {
    entry.id = entry.id || generateId();
    entry.createdAt = entry.createdAt || new Date().toISOString();
    entry.updatedAt = new Date().toISOString();

    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(entry);
            request.onsuccess = () => { backupToLocalStorage(); resolve(entry); };
            request.onerror = () => reject(request.error);
        });
    } else {
        const entries = getEntriesFromLocalStorage();
        const idx = entries.findIndex(e => e.id === entry.id);
        if (idx >= 0) entries[idx] = entry;
        else entries.push(entry);
        localStorage.setItem('sleepEntries', JSON.stringify(entries));
        return entry;
    }
}

async function getAllEntries() {
    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                resolve(request.result.sort((a, b) => new Date(b.date) - new Date(a.date)));
            };
            request.onerror = () => reject(request.error);
        });
    }
    return getEntriesFromLocalStorage();
}

async function deleteEntry(id) {
    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => { backupToLocalStorage(); resolve(); };
            request.onerror = () => reject(request.error);
        });
    } else {
        const entries = getEntriesFromLocalStorage().filter(e => e.id !== id);
        localStorage.setItem('sleepEntries', JSON.stringify(entries));
    }
}

async function getEntryById(id) {
    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return getEntriesFromLocalStorage().find(e => e.id === id);
}

async function getEntryByDate(date) {
    const entries = await getAllEntries();
    return entries.find(e => e.date === date);
}


// ============================================
// Backup localStorage
// ============================================

function getEntriesFromLocalStorage() {
    const data = localStorage.getItem('sleepEntries');
    return data ? JSON.parse(data) : [];
}

function backupToLocalStorage() {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
        localStorage.setItem('sleepEntries', JSON.stringify(request.result));
    };
}

function syncFromLocalStorage() {
    const localData = getEntriesFromLocalStorage();
    if (!localData.length || !db) return;
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    localData.forEach(entry => store.put(entry));
}

// ============================================
// Onglets
// ============================================

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(targetId).classList.add('active');
            if (targetId === 'stats') updateStats();
            else if (targetId === 'historique') loadHistory();
        });
    });
}

// ============================================
// Champs conditionnels
// ============================================

function initConditionalFields() {
    // Café -> nombre de cafés
    document.getElementById('coffee').addEventListener('change', (e) => {
        document.getElementById('coffee-count-group').style.display = 
            e.target.value === 'yes' ? 'block' : 'none';
    });
    
    // Travail -> lieu de travail
    document.getElementById('work').addEventListener('change', (e) => {
        document.getElementById('work-location-group').style.display = 
            e.target.value === 'yes' ? 'block' : 'none';
    });
    
    // Réveils -> durée des réveils
    document.getElementById('awakenings').addEventListener('change', (e) => {
        document.getElementById('awakening-duration-group').style.display = 
            parseInt(e.target.value) > 0 ? 'block' : 'none';
    });
    
    // SJSR -> nombre de fois
    document.getElementById('sjsr').addEventListener('change', (e) => {
        document.getElementById('sjsr-count-group').style.display = 
            e.target.value === 'yes' ? 'block' : 'none';
    });
}


// ============================================
// Formulaire
// ============================================

// Champs obligatoires pour considérer une journée complète
const REQUIRED_FIELDS = ['waketime', 'bedtime', 'quality', 'energy'];

// Debounce pour éviter trop de sauvegardes
let saveTimeout = null;
function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveCurrentEntry(false), 500);
}

// Sauvegarde automatique de l'entrée courante
async function saveCurrentEntry(isValidation = false) {
    const date = document.getElementById('date').value;
    if (!date) return;
    
    const existing = await getEntryByDate(date);
    
    const entry = {
        id: existing?.id || generateId(),
        date: date,
        waketime: document.getElementById('waketime').value || null,
        // Alimentation
        breakfast: document.getElementById('breakfast').value,
        coffee: document.getElementById('coffee').value,
        coffeeCount: document.getElementById('coffee').value === 'yes' ? 
            parseInt(document.getElementById('coffeeCount').value) : 0,
        lunch: document.getElementById('lunch').value,
        dinner: document.getElementById('dinner').value,
        supplement: document.getElementById('supplement').value,
        // Activité
        sport: document.getElementById('sport').value,
        work: document.getElementById('work').value,
        workLocation: document.getElementById('work').value === 'yes' ? 
            document.getElementById('workLocation').value : null,
        outdoorTime: parseInt(document.getElementById('outdoorTime').value),
        steps: parseInt(document.getElementById('steps').value) || 0,
        nap: document.getElementById('nap').value,
        // Bien-être mental
        stress: parseInt(document.getElementById('stress').value),
        rumination: parseInt(document.getElementById('rumination').value),
        sadness: parseInt(document.getElementById('sadness').value),
        dayQuality: document.querySelector('input[name="dayQuality"]:checked')?.value || 'sun',
        // Sommeil
        eveningActivity: document.getElementById('eveningActivity').value,
        bedtime: document.getElementById('bedtime').value || null,
        awakenings: parseInt(document.getElementById('awakenings').value),
        awakeningDuration: parseInt(document.getElementById('awakenings').value) > 0 ?
            parseInt(document.getElementById('awakeningDuration').value) : 0,
        stuffyNose: document.getElementById('stuffyNose').value,
        sjsr: document.getElementById('sjsr').value,
        sjsrCount: document.getElementById('sjsr').value === 'yes' ?
            parseInt(document.getElementById('sjsrCount').value) : 0,
        // Bilan
        quality: parseInt(document.getElementById('quality').value),
        energy: parseInt(document.getElementById('energy').value),
        dreams: document.getElementById('dreams').value,
        notes: document.getElementById('notes').value.trim(),
        validated: isValidation ? true : (existing?.validated || false),
        createdAt: existing?.createdAt
    };

    try {
        await saveEntry(entry);
        if (!isValidation) {
            // Sauvegarde silencieuse
            console.log('Auto-sauvegarde:', date);
        }
        return entry;
    } catch (error) {
        console.error('Erreur auto-save:', error);
        return null;
    }
}

function initForm() {
    const form = document.getElementById('sleep-form');
    const dateInput = document.getElementById('date');
    
    // Ajouter la sauvegarde automatique sur tous les champs
    const formInputs = form.querySelectorAll('input, select, textarea');
    formInputs.forEach(input => {
        if (input.id === 'date') return; // Date gérée séparément
        
        const eventType = (input.type === 'range' || input.type === 'text' || input.tagName === 'TEXTAREA') 
            ? 'input' : 'change';
        input.addEventListener(eventType, debouncedSave);
    });
    
    // Sauvegarde aussi sur les radios
    document.querySelectorAll('input[name="dayQuality"]').forEach(radio => {
        radio.addEventListener('change', debouncedSave);
    });
    
    // Vérifier la complétude de la journée précédente lors du changement de date
    dateInput.addEventListener('change', async (e) => {
        const newDate = e.target.value;
        const today = formatDateForInput(new Date());
        
        // Si on change pour une date future ou la date du jour, vérifier les jours précédents
        if (newDate >= today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = formatDateForInput(yesterday);
            
            const yesterdayEntry = await getEntryByDate(yesterdayStr);
            if (yesterdayEntry && !yesterdayEntry.validated) {
                showToast('⚠️ Validez d\'abord la nuit du ' + formatDateDisplay(yesterdayStr), 'warning');
                e.target.value = yesterdayStr;
                loadExistingEntry(yesterdayStr);
                return;
            }
        }
        
        // Charger les données existantes pour la nouvelle date
        loadExistingEntry(newDate);
    });
    
    // Le bouton Enregistrer sert maintenant à VALIDER la journée
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('date').value;
        const entry = await saveCurrentEntry(true);
        
        if (entry && isEntryComplete(entry)) {
            showToast('✅ Nuit validée !', 'success');
            loadHistory();
            
            // Proposer de passer au jour suivant
            const tomorrow = new Date(date);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = formatDateForInput(tomorrow);
            const today = formatDateForInput(new Date());
            
            if (tomorrowStr <= today) {
                document.getElementById('date').value = tomorrowStr;
                loadExistingEntry(tomorrowStr);
            }
        } else {
            showToast('⚠️ Complétez les champs obligatoires (levé, coucher, qualité, énergie)', 'warning');
        }
    });
}

function isEntryComplete(entry) {
    if (!entry) return false;
    return REQUIRED_FIELDS.every(field => {
        const value = entry[field];
        return value !== null && value !== undefined && value !== '';
    });
}

function resetForm() {
    document.getElementById('sleep-form').reset();
    setDefaultDate();
    ['stress', 'rumination', 'sadness'].forEach(id => {
        const defaultVal = (id === 'rumination' || id === 'sadness') ? 1 : 3;
        document.getElementById(id).value = defaultVal;
        updateRangeDisplay(id, defaultVal);
    });
    ['quality', 'energy'].forEach(id => {
        document.getElementById(id).value = 5;
        updateRangeDisplay(id, 5);
    });
    document.getElementById('coffee-count-group').style.display = 'none';
    document.getElementById('awakening-duration-group').style.display = 'none';
}

function setDefaultDate() {
    const dateInput = document.getElementById('date');
    dateInput.value = formatDateForInput(new Date());
    document.getElementById('waketime').value = '08:00';
    document.getElementById('bedtime').value = '23:00';
    
    // Charger les données existantes si disponibles
    loadExistingEntry(dateInput.value);
}

async function loadExistingEntry(date) {
    const entry = await getEntryByDate(date);
    if (entry) {
        // Remplir le formulaire avec les données existantes
        if (entry.waketime) document.getElementById('waketime').value = entry.waketime;
        else document.getElementById('waketime').value = '08:00';
        if (entry.bedtime) document.getElementById('bedtime').value = entry.bedtime;
        else document.getElementById('bedtime').value = '23:00';
        document.getElementById('breakfast').value = entry.breakfast || 'yes';
        document.getElementById('coffee').value = entry.coffee || 'yes';
        document.getElementById('coffeeCount').value = entry.coffeeCount || 2;
        document.getElementById('coffee-count-group').style.display = (entry.coffee || 'yes') === 'yes' ? 'block' : 'none';
        document.getElementById('lunch').value = entry.lunch || 'meat';
        document.getElementById('dinner').value = entry.dinner || 'fish';
        document.getElementById('supplement').value = entry.supplement || 'yes';
        document.getElementById('sport').value = entry.sport || 'yes';
        document.getElementById('work').value = entry.work || 'yes';
        document.getElementById('workLocation').value = entry.workLocation || 'remote';
        document.getElementById('work-location-group').style.display = (entry.work || 'yes') === 'yes' ? 'block' : 'none';
        document.getElementById('outdoorTime').value = entry.outdoorTime || 0;
        document.getElementById('steps').value = entry.steps || '';
        document.getElementById('nap').value = entry.nap || 'no';
        document.getElementById('stress').value = entry.stress || 3;
        document.getElementById('rumination').value = entry.rumination || 1;
        document.getElementById('sadness').value = entry.sadness || 1;
        const dayQualityRadio = document.querySelector(`input[name="dayQuality"][value="${entry.dayQuality || 'sun'}"]`);
        if (dayQualityRadio) dayQualityRadio.checked = true;
        document.getElementById('eveningActivity').value = entry.eveningActivity || 'screen';
        document.getElementById('awakenings').value = entry.awakenings || 3;
        document.getElementById('awakeningDuration').value = entry.awakeningDuration || 5;
        document.getElementById('stuffyNose').value = entry.stuffyNose || 'yes';
        document.getElementById('sjsr').value = entry.sjsr || 'yes';
        document.getElementById('sjsrCount').value = entry.sjsrCount || 1;
        document.getElementById('sjsr-count-group').style.display = (entry.sjsr || 'yes') === 'yes' ? 'block' : 'none';
        document.getElementById('quality').value = entry.quality || 5;
        document.getElementById('energy').value = entry.energy || 5;
        document.getElementById('dreams').value = entry.dreams || 'none';
        document.getElementById('notes').value = entry.notes || '';
        
        // Mettre à jour les affichages des sliders
        ['stress', 'rumination', 'sadness', 'quality', 'energy'].forEach(id => {
            updateRangeDisplay(id, document.getElementById(id).value);
        });
    } else {
        // Nouvelle journée : réinitialiser aux valeurs par défaut
        document.getElementById('waketime').value = '08:00';
        document.getElementById('bedtime').value = '23:00';
        document.getElementById('notes').value = '';
        document.getElementById('steps').value = '';
    }
}


// ============================================
// Sliders
// ============================================

function initRangeInputs() {
    const ranges = [
        'quality', 'energy', 'stress', 'rumination', 'sadness',
        'edit-quality', 'edit-energy', 'edit-stress', 'edit-rumination', 'edit-sadness'
    ];
    ranges.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', (e) => updateRangeDisplay(id, e.target.value));
        }
    });
}

function updateRangeDisplay(id, value) {
    const display = document.getElementById(id + '-value');
    if (display) display.textContent = value;
}

// ============================================
// Historique
// ============================================

async function loadHistory() {
    const container = document.getElementById('history-list');
    const entries = await getAllEntries();

    if (entries.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌙</div>
                <p>Aucune nuit enregistrée</p>
                <p>Commencez par saisir votre première nuit !</p>
            </div>`;
        return;
    }

    container.innerHTML = entries.map(entry => createHistoryItem(entry)).join('');
    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
    });
}

function getQualityClass(value) {
    if (value <= 3) return 'quality-low';
    if (value <= 5) return 'quality-medium';
    if (value <= 7) return 'quality-ok';
    if (value <= 9) return 'quality-good';
    return 'quality-excellent';
}

function createHistoryItem(entry) {
    const duration = calculateDuration(entry.bedtime, entry.waketime);
    const dateFormatted = formatDateDisplay(entry.date);
    const dayIcon = { sun: '☀️', cloud: '⛅', rain: '🌧️' }[entry.dayQuality] || '☀️';
    const qualityClass = getQualityClass(entry.quality);
    const energyClass = getQualityClass(entry.energy);
    const validatedIcon = entry.validated ? '✓' : '⏳';
    
    return `
        <div class="history-item" data-id="${entry.id}">
            <div class="history-item-header">
                <span class="history-date">📅 ${dateFormatted} ${dayIcon} ${validatedIcon}</span>
                <div class="history-actions-item">
                    <button class="btn-icon btn-edit" data-id="${entry.id}" title="Modifier">✏️</button>
                    <button class="btn-icon btn-delete" data-id="${entry.id}" title="Supprimer">🗑️</button>
                </div>
            </div>
            <div class="history-details">
                <div class="history-detail"><span>🛏️</span><span>Coucher: ${entry.bedtime || '--'}</span></div>
                <div class="history-detail"><span>⏰</span><span>Levé: ${entry.waketime || '--'}</span></div>
                <div class="history-detail"><span>⏱️</span><span>Durée: ${entry.bedtime && entry.waketime ? duration : '--'}</span></div>
                <div class="history-detail"><span>😴</span><span class="${qualityClass}">Qualité: ${entry.quality}/10</span></div>
                <div class="history-detail"><span>⚡</span><span class="${energyClass}">Énergie: ${entry.energy}/10</span></div>
                <div class="history-detail"><span>🔄</span><span>Réveils: ${entry.awakenings}</span></div>
                <div class="history-detail"><span>😰</span><span>Stress: ${entry.stress}/5</span></div>
                <div class="history-detail"><span>👣</span><span>Pas: ${entry.steps || 0}</span></div>
            </div>
            ${entry.notes ? `<div class="history-notes">📝 ${entry.notes}</div>` : ''}
        </div>`;
}


// ============================================
// Modals
// ============================================

function initModals() {
    document.getElementById('cancel-delete').addEventListener('click', closeDeleteModal);
    document.getElementById('confirm-delete').addEventListener('click', confirmDelete);
    document.getElementById('cancel-edit').addEventListener('click', closeEditModal);
    document.getElementById('edit-form').addEventListener('submit', saveEdit);
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('show');
        });
    });
}

function openDeleteModal(id) {
    deleteEntryId = id;
    document.getElementById('delete-modal').classList.add('show');
}

function closeDeleteModal() {
    deleteEntryId = null;
    document.getElementById('delete-modal').classList.remove('show');
}

async function confirmDelete() {
    if (deleteEntryId) {
        try {
            await deleteEntry(deleteEntryId);
            showToast('✅ Entrée supprimée', 'success');
            loadHistory();
            updateStats();
        } catch (error) {
            showToast('❌ Erreur', 'error');
        }
    }
    closeDeleteModal();
}

async function openEditModal(id) {
    const entry = await getEntryById(id);
    if (!entry) return;

    document.getElementById('edit-id').value = entry.id;
    document.getElementById('edit-date').value = entry.date;
    document.getElementById('edit-waketime').value = entry.waketime;
    document.getElementById('edit-breakfast').value = entry.breakfast || 'yes';
    document.getElementById('edit-coffee').value = entry.coffee || 'no';
    document.getElementById('edit-coffeeCount').value = entry.coffeeCount || 0;
    document.getElementById('edit-lunch').value = entry.lunch || 'none';
    document.getElementById('edit-dinner').value = entry.dinner || 'none';
    document.getElementById('edit-supplement').value = entry.supplement || 'no';
    document.getElementById('edit-sport').value = entry.sport || 'no';
    document.getElementById('edit-work').value = entry.work || 'no';
    document.getElementById('edit-workLocation').value = entry.workLocation || 'office';
    document.getElementById('edit-outdoorTime').value = entry.outdoorTime || 0;
    document.getElementById('edit-steps').value = entry.steps || 0;
    document.getElementById('edit-nap').value = entry.nap || 'no';
    document.getElementById('edit-stress').value = entry.stress || 3;
    document.getElementById('edit-rumination').value = entry.rumination || 1;
    document.getElementById('edit-sadness').value = entry.sadness || 1;
    document.getElementById('edit-dayQuality').value = entry.dayQuality || 'sun';
    document.getElementById('edit-eveningActivity').value = entry.eveningActivity || 'screen';
    document.getElementById('edit-bedtime').value = entry.bedtime;
    document.getElementById('edit-awakenings').value = entry.awakenings;
    document.getElementById('edit-awakeningDuration').value = entry.awakeningDuration || 0;
    document.getElementById('edit-stuffyNose').value = entry.stuffyNose || 'no';
    document.getElementById('edit-sjsr').value = entry.sjsr || 'no';
    document.getElementById('edit-sjsrCount').value = entry.sjsrCount || 1;
    document.getElementById('edit-quality').value = entry.quality;
    document.getElementById('edit-energy').value = entry.energy;
    document.getElementById('edit-dreams').value = entry.dreams;
    document.getElementById('edit-notes').value = entry.notes || '';

    ['quality', 'energy', 'stress', 'rumination', 'sadness'].forEach(field => {
        updateRangeDisplay('edit-' + field, document.getElementById('edit-' + field).value);
    });

    document.getElementById('edit-modal').classList.add('show');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('show');
}


async function saveEdit(e) {
    e.preventDefault();
    const entry = {
        id: document.getElementById('edit-id').value,
        date: document.getElementById('edit-date').value,
        waketime: document.getElementById('edit-waketime').value,
        breakfast: document.getElementById('edit-breakfast').value,
        coffee: document.getElementById('edit-coffee').value,
        coffeeCount: parseInt(document.getElementById('edit-coffeeCount').value) || 0,
        lunch: document.getElementById('edit-lunch').value,
        dinner: document.getElementById('edit-dinner').value,
        supplement: document.getElementById('edit-supplement').value,
        sport: document.getElementById('edit-sport').value,
        work: document.getElementById('edit-work').value,
        workLocation: document.getElementById('edit-workLocation').value,
        outdoorTime: parseInt(document.getElementById('edit-outdoorTime').value) || 0,
        steps: parseInt(document.getElementById('edit-steps').value) || 0,
        nap: document.getElementById('edit-nap').value,
        stress: parseInt(document.getElementById('edit-stress').value),
        rumination: parseInt(document.getElementById('edit-rumination').value),
        sadness: parseInt(document.getElementById('edit-sadness').value),
        dayQuality: document.getElementById('edit-dayQuality').value,
        eveningActivity: document.getElementById('edit-eveningActivity').value,
        bedtime: document.getElementById('edit-bedtime').value,
        awakenings: parseInt(document.getElementById('edit-awakenings').value),
        awakeningDuration: parseInt(document.getElementById('edit-awakeningDuration').value) || 0,
        stuffyNose: document.getElementById('edit-stuffyNose').value,
        sjsr: document.getElementById('edit-sjsr').value,
        sjsrCount: parseInt(document.getElementById('edit-sjsrCount').value) || 0,
        quality: parseInt(document.getElementById('edit-quality').value),
        energy: parseInt(document.getElementById('edit-energy').value),
        dreams: document.getElementById('edit-dreams').value,
        notes: document.getElementById('edit-notes').value.trim()
    };

    try {
        await saveEntry(entry);
        showToast('✅ Modification enregistrée', 'success');
        closeEditModal();
        loadHistory();
        updateStats();
    } catch (error) {
        showToast('❌ Erreur', 'error');
    }
}

// ============================================
// Statistiques
// ============================================

function initStatsFilters() {
    document.getElementById('stats-period').addEventListener('change', updateStats);
}

async function updateStats() {
    const period = document.getElementById('stats-period').value;
    let entries = await getAllEntries();
    
    // Inclure les entrées validées OU les entrées complètes (rétrocompatibilité)
    entries = entries.filter(e => e.validated === true || (isEntryComplete(e) && e.validated === undefined));

    if (period !== 'all') {
        const daysAgo = parseInt(period);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
        entries = entries.filter(e => new Date(e.date) >= cutoffDate);
    }

    entries = entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (entries.length === 0) {
        document.getElementById('avg-duration').textContent = '--';
        document.getElementById('avg-quality').textContent = '--';
        document.getElementById('avg-energy').textContent = '--';
        document.getElementById('total-entries').textContent = '0';
        clearCharts();
        return;
    }

    const totalDuration = entries.reduce((sum, e) => sum + calculateDurationMinutes(e.bedtime, e.waketime), 0);
    const avgDuration = totalDuration / entries.length;
    const avgQuality = entries.reduce((sum, e) => sum + e.quality, 0) / entries.length;
    const avgEnergy = entries.reduce((sum, e) => sum + e.energy, 0) / entries.length;

    document.getElementById('avg-duration').textContent = formatDuration(avgDuration);
    document.getElementById('avg-quality').textContent = avgQuality.toFixed(1) + '/5';
    document.getElementById('avg-energy').textContent = avgEnergy.toFixed(1) + '/5';
    document.getElementById('total-entries').textContent = entries.length;

    updateCharts(entries);
}

function clearCharts() {
    Object.values(charts).forEach(chart => chart?.destroy());
    charts = {};
}


function updateCharts(entries) {
    clearCharts();
    const labels = entries.map(e => formatDateShort(e.date));
    const qualityData = entries.map(e => e.quality);
    const energyData = entries.map(e => e.energy);
    const durationData = entries.map(e => calculateDurationMinutes(e.bedtime, e.waketime) / 60);
    const bedtimeData = entries.map(e => timeToDecimal(e.bedtime));

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } }
        }
    };

    const qualityCtx = document.getElementById('quality-chart').getContext('2d');
    charts.quality = new Chart(qualityCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Qualité', data: qualityData,
                borderColor: '#818cf8', backgroundColor: 'rgba(129, 140, 248, 0.2)',
                fill: true, tension: 0.3
            }, {
                label: 'Énergie', data: energyData,
                borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.2)',
                fill: true, tension: 0.3
            }]
        },
        options: {
            ...chartOptions,
            plugins: { legend: { display: true, labels: { color: '#94a3b8' } } },
            scales: { ...chartOptions.scales, y: { ...chartOptions.scales.y, min: 0, max: 5 } }
        }
    });

    const durationCtx = document.getElementById('duration-chart').getContext('2d');
    charts.duration = new Chart(durationCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Heures', data: durationData,
                backgroundColor: 'rgba(79, 70, 229, 0.7)', borderRadius: 4
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: { ...chartOptions.scales.y, min: 0, max: 12,
                    ticks: { ...chartOptions.scales.y.ticks, callback: (v) => v + 'h' }
                }
            }
        }
    });

    const bedtimeCtx = document.getElementById('bedtime-chart').getContext('2d');
    charts.bedtime = new Chart(bedtimeCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Coucher', data: bedtimeData,
                borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.2)',
                fill: true, tension: 0.3
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: { ...chartOptions.scales.y, min: 20, max: 26,
                    ticks: { ...chartOptions.scales.y.ticks,
                        callback: (v) => (v >= 24 ? v - 24 : v) + ':00'
                    }
                }
            }
        }
    });
}


// ============================================
// Export / Import
// ============================================

function initExportImport() {
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importData);
}

async function exportData() {
    const entries = await getAllEntries();
    const data = { version: '2.0', exportDate: new Date().toISOString(), entries };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dodotracker-export-${formatDateForInput(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📤 Données exportées', 'success');
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.entries || !Array.isArray(data.entries)) throw new Error('Format invalide');
        let imported = 0;
        for (const entry of data.entries) {
            await saveEntry(entry);
            imported++;
        }
        showToast(`📥 ${imported} entrées importées`, 'success');
        loadHistory();
        updateStats();
    } catch (error) {
        showToast('❌ Erreur lors de l\'import', 'error');
    }
    e.target.value = '';
}

// ============================================
// Service Worker
// ============================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(console.error);
    }
}

// ============================================
// Utilitaires
// ============================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

function formatDateDisplay(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatDateShort(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function calculateDuration(bedtime, waketime) {
    return formatDuration(calculateDurationMinutes(bedtime, waketime));
}

function calculateDurationMinutes(bedtime, waketime) {
    const [bedH, bedM] = bedtime.split(':').map(Number);
    const [wakeH, wakeM] = waketime.split(':').map(Number);
    let bedMinutes = bedH * 60 + bedM;
    let wakeMinutes = wakeH * 60 + wakeM;
    if (wakeMinutes < bedMinutes) wakeMinutes += 24 * 60;
    return wakeMinutes - bedMinutes;
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h${mins.toString().padStart(2, '0')}`;
}

function timeToDecimal(time) {
    const [hours, minutes] = time.split(':').map(Number);
    let decimal = hours + minutes / 60;
    if (decimal < 12) decimal += 24;
    return decimal;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}
