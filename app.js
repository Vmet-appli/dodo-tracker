// ============================================
// DodoTracker - Application de suivi du sommeil
// ============================================

const DB_NAME = 'DodoTrackerDB';
const DB_VERSION = 2;
const STORE_NAME = 'sleepEntries';

let db = null;
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
        tab.addEventListener('click', async () => {
            // Sauvegarder immédiatement avant de changer d'onglet
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                await saveCurrentEntry(false);
            }
            
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
    
    // Sport -> durée, heure et type de semaine
    document.getElementById('sport').addEventListener('change', (e) => {
        const showSportDetails = e.target.value !== 'no';
        const showPowerliftingDetails = e.target.value === 'intense';
        document.getElementById('sport-duration-group').style.display = showSportDetails ? 'block' : 'none';
        document.getElementById('sport-time-group').style.display = showSportDetails ? 'block' : 'none';
        document.getElementById('sport-week-group').style.display = showPowerliftingDetails ? 'block' : 'none';
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
    // Petit indicateur visuel de modification en cours
    document.getElementById('date-banner')?.classList.add('saving');
    saveTimeout = setTimeout(async () => {
        await saveCurrentEntry(false);
        document.getElementById('date-banner')?.classList.remove('saving');
    }, 300); // 300ms au lieu de 500ms
}

// Sauvegarde quand la page perd le focus (fermeture app, changement d'onglet navigateur)
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden' && saveTimeout) {
        clearTimeout(saveTimeout);
        await saveCurrentEntry(false);
    }
});

// Sauvegarde avant fermeture de page
window.addEventListener('beforeunload', () => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        // Note: saveCurrentEntry est async, on fait notre possible
        saveCurrentEntry(false);
    }
});

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
        supplements: {
            magnesium: document.getElementById('supp-magnesium').checked,
            creatine: document.getElementById('supp-creatine').checked,
            omega3: document.getElementById('supp-omega3').checked,
            glutamine: document.getElementById('supp-glutamine').checked,
            kefir: document.getElementById('supp-kefir').checked
        },
        // Activité
        sport: document.getElementById('sport').value,
        sportDuration: document.getElementById('sport').value !== 'no' ? 
            parseInt(document.getElementById('sportDuration').value) : 0,
        sportTime: document.getElementById('sport').value !== 'no' ? 
            document.getElementById('sportTime').value : null,
        sportWeekType: document.getElementById('sport').value === 'intense' ? 
            document.getElementById('sportWeekType').value : null,
        work: document.getElementById('work').value,
        workLocation: document.getElementById('work').value === 'yes' ? 
            document.getElementById('workLocation').value : null,
        outdoorTime: parseInt(document.getElementById('outdoorTime').value),
        steps: parseInt(document.getElementById('steps').value) || 0,
        nap: document.getElementById('nap').value,
        screenTime: parseInt(document.getElementById('screenTime').value),
        hydration: parseFloat(document.getElementById('hydration').value),
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
            roomTemp: document.getElementById('roomTemp').value,
            noise: document.getElementById('noise').value,
            darkness: document.getElementById('darkness').value,
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
    
    // Ajouter la sauvegarde automatique sur tous les champs
    const formInputs = form.querySelectorAll('input, select, textarea');
    console.log('Nombre de champs trouvés dans le formulaire:', formInputs.length);
    formInputs.forEach(input => {
        if (input.id === 'date') return; // Date gérée automatiquement
        
        // Écouter à la fois 'input', 'change' et 'blur' pour couvrir tous les cas (surtout iOS)
        input.addEventListener('input', debouncedSave);
        input.addEventListener('change', debouncedSave);
        input.addEventListener('blur', debouncedSave);
    });
    
    // Ajouter explicitement pour les champs problématiques sur iOS
    ['outdoorTime', 'steps', 'screenTime', 'hydration', 'nap'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', debouncedSave);
            el.addEventListener('change', debouncedSave);
            el.addEventListener('blur', debouncedSave);
            console.log('Event listener ajouté pour:', id);
        } else {
            console.warn('Champ non trouvé:', id);
        }
    });
    
    // Sauvegarde aussi sur les radios
    document.querySelectorAll('input[name="dayQuality"]').forEach(radio => {
        radio.addEventListener('change', debouncedSave);
    });
    
    // Sauvegarde aussi sur les checkboxes de suppléments
    document.querySelectorAll('.supplement-checkbox input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', debouncedSave);
    });
    
    // Le bouton Enregistrer sert maintenant à VALIDER la nuit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('date').value;
        const entry = await saveCurrentEntry(true);
        
        if (entry && isEntryComplete(entry)) {
            showToast('✅ Nuit validée !', 'success');
            loadHistory();
            
            // Passer automatiquement à la prochaine nuit à compléter
            const nextDate = await findNextEntryToComplete();
            document.getElementById('date').value = nextDate;
            updateDateBanner(nextDate);
            loadExistingEntry(nextDate);
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
    // Trouver la première nuit non validée à compléter
    findNextEntryToComplete().then(date => {
        document.getElementById('date').value = date;
        updateDateBanner(date);
        loadExistingEntry(date);
    });
}

async function findNextEntryToComplete() {
    const entries = await getAllEntries();
    const today = formatDateForInput(new Date());
    
    // Date de début de l'application - ne pas chercher avant
    const appStartDate = '2026-08-11';
    
    // Chercher la première date non validée en partant de la date de début
    const startDate = new Date(appStartDate);
    const todayDate = new Date(today);
    
    // Parcourir du début jusqu'à aujourd'hui
    let currentDate = new Date(startDate);
    while (currentDate <= todayDate) {
        const dateStr = formatDateForInput(currentDate);
        const entry = entries.find(e => e.date === dateStr);
        
        // Si pas d'entrée ou entrée non validée, c'est celle-ci
        if (!entry || !entry.validated) {
            return dateStr;
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Si tout est validé, retourner aujourd'hui
    return today;
}

function updateDateBanner(date) {
    const banner = document.getElementById('date-banner');
    const display = document.getElementById('current-date-display');
    const today = formatDateForInput(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDateForInput(yesterday);
    
    // Date de début de l'app - pas de retard avant cette date
    const appStartDate = '2026-08-11';
    
    const dateFormatted = formatDateDisplay(date);
    
    banner.classList.remove('late', 'today');
    
    if (date === today) {
        display.textContent = `📅 ${dateFormatted} (aujourd'hui)`;
        banner.classList.add('today');
    } else if (date === yesterdayStr && date >= appStartDate) {
        display.textContent = `📅 ${dateFormatted} (hier - à compléter)`;
        banner.classList.add('late');
    } else if (date < today && date >= appStartDate) {
        const daysLate = Math.floor((new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24));
        display.textContent = `📅 ${dateFormatted} (${daysLate} jour${daysLate > 1 ? 's' : ''} en retard)`;
        banner.classList.add('late');
    } else {
        display.textContent = `📅 ${dateFormatted}`;
    }
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
        // Charger les suppléments
        const supps = entry.supplements || { magnesium: true, creatine: true, omega3: true, glutamine: true, kefir: true };
        document.getElementById('supp-magnesium').checked = supps.magnesium !== false;
        document.getElementById('supp-creatine').checked = supps.creatine !== false;
        document.getElementById('supp-omega3').checked = supps.omega3 !== false;
        document.getElementById('supp-glutamine').checked = supps.glutamine !== false;
        document.getElementById('supp-kefir').checked = supps.kefir !== false;
        document.getElementById('sport').value = entry.sport || 'intense';
        document.getElementById('sportDuration').value = entry.sportDuration || 120;
        document.getElementById('sportTime').value = entry.sportTime || 'evening';
        document.getElementById('sportWeekType').value = entry.sportWeekType || 'intensity';
        const showSportDetails = (entry.sport || 'intense') !== 'no';
        const showPowerliftingDetails = (entry.sport || 'intense') === 'intense';
        document.getElementById('sport-duration-group').style.display = showSportDetails ? 'block' : 'none';
        document.getElementById('sport-time-group').style.display = showSportDetails ? 'block' : 'none';
        document.getElementById('sport-week-group').style.display = showPowerliftingDetails ? 'block' : 'none';
        document.getElementById('work').value = entry.work || 'yes';
        document.getElementById('workLocation').value = entry.workLocation || 'remote';
        document.getElementById('work-location-group').style.display = (entry.work || 'yes') === 'yes' ? 'block' : 'none';
        document.getElementById('outdoorTime').value = entry.outdoorTime || 0;
        document.getElementById('steps').value = entry.steps || '';
        document.getElementById('nap').value = entry.nap || 'no';
        document.getElementById('screenTime').value = entry.screenTime || 2;
        document.getElementById('hydration').value = entry.hydration || 1.5;
        document.getElementById('stress').value = entry.stress || 1;
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
    document.getElementById('edit-stress').value = entry.stress || 1;
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
    
    // Inclure toutes les entrées complètes (avec les 4 champs obligatoires remplis)
    entries = entries.filter(e => isEntryComplete(e));

    if (period !== 'all') {
        const daysAgo = parseInt(period);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
        entries = entries.filter(e => new Date(e.date) >= cutoffDate);
    }

    entries = entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (entries.length === 0) {
        document.getElementById('avg-bed-time').textContent = '--';
        document.getElementById('avg-duration').textContent = '--';
        document.getElementById('avg-quality').textContent = '--';
        document.getElementById('avg-energy').textContent = '--';
        document.getElementById('total-entries').textContent = '0';
        resetAdvancedStats();
        return;
    }

    // === Stats de base ===
    const totalBedTime = entries.reduce((sum, e) => sum + calculateDurationMinutes(e.bedtime, e.waketime), 0);
    const avgBedTime = totalBedTime / entries.length;
    const totalDuration = entries.reduce((sum, e) => sum + calculateEffectiveSleepMinutes(e), 0);
    const avgDuration = totalDuration / entries.length;
    const avgQuality = entries.reduce((sum, e) => sum + e.quality, 0) / entries.length;
    const avgEnergy = entries.reduce((sum, e) => sum + e.energy, 0) / entries.length;

    document.getElementById('avg-bed-time').textContent = formatDuration(avgBedTime);
    document.getElementById('avg-duration').textContent = formatDuration(avgDuration);
    document.getElementById('avg-quality').textContent = avgQuality.toFixed(1) + '/10';
    document.getElementById('avg-energy').textContent = avgEnergy.toFixed(1) + '/10';
    document.getElementById('total-entries').textContent = entries.length;

    // === Efficacité du sommeil ===
    const sleepEfficiency = avgBedTime > 0 ? (avgDuration / avgBedTime * 100) : 0;
    const avgAwakenings = entries.reduce((sum, e) => sum + (e.awakenings || 0), 0) / entries.length;
    const entriesWithAwakenings = entries.filter(e => e.awakenings > 0 && e.awakeningDuration > 0);
    const avgAwakeningDuration = entriesWithAwakenings.length > 0 
        ? entriesWithAwakenings.reduce((sum, e) => sum + e.awakeningDuration, 0) / entriesWithAwakenings.length 
        : 0;
    const avgTimeLost = avgAwakenings * avgAwakeningDuration;

    document.getElementById('sleep-efficiency').textContent = sleepEfficiency.toFixed(0) + '%';
    document.getElementById('avg-awakenings').textContent = avgAwakenings.toFixed(1);
    document.getElementById('avg-awakening-duration').textContent = avgAwakeningDuration.toFixed(0) + ' min';
    document.getElementById('time-lost').textContent = avgTimeLost.toFixed(0) + ' min';

    // === Impact du sport ===
    const withSport = entries.filter(e => e.sport && e.sport !== 'no');
    const withoutSport = entries.filter(e => !e.sport || e.sport === 'no');
    const deloadDays = entries.filter(e => e.sportWeekType === 'deload');
    const peakDays = entries.filter(e => e.sportWeekType === 'peak' || e.sportWeekType === 'test');
    const sportMorning = entries.filter(e => e.sport !== 'no' && (e.sportTime === 'morning' || e.sportTime === 'afternoon'));
    const sportEvening = entries.filter(e => e.sport !== 'no' && (e.sportTime === 'evening' || e.sportTime === 'late'));

    document.getElementById('quality-with-sport').textContent = withSport.length > 0 
        ? (withSport.reduce((sum, e) => sum + e.quality, 0) / withSport.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-without-sport').textContent = withoutSport.length > 0 
        ? (withoutSport.reduce((sum, e) => sum + e.quality, 0) / withoutSport.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-deload').textContent = deloadDays.length > 0 
        ? (deloadDays.reduce((sum, e) => sum + e.quality, 0) / deloadDays.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-peak').textContent = peakDays.length > 0 
        ? (peakDays.reduce((sum, e) => sum + e.quality, 0) / peakDays.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-sport-morning').textContent = sportMorning.length > 0 
        ? (sportMorning.reduce((sum, e) => sum + e.quality, 0) / sportMorning.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-sport-evening').textContent = sportEvening.length > 0 
        ? (sportEvening.reduce((sum, e) => sum + e.quality, 0) / sportEvening.length).toFixed(1) + '/10' : '--';

    // === Impact du SJSR ===
    const sjsrNights = entries.filter(e => e.sjsr === 'yes');
    const noSjsrNights = entries.filter(e => e.sjsr === 'no');
    const sjsrFrequency = entries.length > 0 ? (sjsrNights.length / entries.length * 100) : 0;
    const avgSjsrCount = sjsrNights.length > 0 
        ? sjsrNights.reduce((sum, e) => sum + (e.sjsrCount || 1), 0) / sjsrNights.length : 0;
    
    const sjsrWithMagnesium = sjsrNights.filter(e => e.supplements && e.supplements.magnesium);
    const sjsrWithoutMagnesium = sjsrNights.filter(e => !e.supplements || !e.supplements.magnesium);
    const daysWithMagnesium = entries.filter(e => e.supplements && e.supplements.magnesium);
    const daysWithoutMagnesium = entries.filter(e => !e.supplements || !e.supplements.magnesium);
    
    const sjsrRateWithMag = daysWithMagnesium.length > 0 
        ? (sjsrWithMagnesium.length / daysWithMagnesium.length * 100) : 0;
    const sjsrRateWithoutMag = daysWithoutMagnesium.length > 0 
        ? (sjsrWithoutMagnesium.length / daysWithoutMagnesium.length * 100) : 0;

    document.getElementById('sjsr-frequency').textContent = sjsrFrequency.toFixed(0) + '%';
    document.getElementById('sjsr-avg-count').textContent = avgSjsrCount.toFixed(1);
    document.getElementById('quality-with-sjsr').textContent = sjsrNights.length > 0 
        ? (sjsrNights.reduce((sum, e) => sum + e.quality, 0) / sjsrNights.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-without-sjsr').textContent = noSjsrNights.length > 0 
        ? (noSjsrNights.reduce((sum, e) => sum + e.quality, 0) / noSjsrNights.length).toFixed(1) + '/10' : '--';
    document.getElementById('sjsr-with-magnesium').textContent = sjsrRateWithMag.toFixed(0) + '%';
    document.getElementById('sjsr-without-magnesium').textContent = sjsrRateWithoutMag.toFixed(0) + '%';

    // === Impact de l'alimentation ===
    const dinnerMeat = entries.filter(e => e.dinner === 'meat');
    const dinnerFish = entries.filter(e => e.dinner === 'fish');
    const dinnerVegetal = entries.filter(e => e.dinner === 'vegetal');
    const dinnerCheat = entries.filter(e => e.dinner === 'cheatmeal');
    const coffeeLow = entries.filter(e => e.coffeeCount <= 2);
    const coffeeHigh = entries.filter(e => e.coffeeCount >= 3);

    document.getElementById('quality-dinner-meat').textContent = dinnerMeat.length > 0 
        ? (dinnerMeat.reduce((sum, e) => sum + e.quality, 0) / dinnerMeat.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-dinner-fish').textContent = dinnerFish.length > 0 
        ? (dinnerFish.reduce((sum, e) => sum + e.quality, 0) / dinnerFish.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-dinner-vegetal').textContent = dinnerVegetal.length > 0 
        ? (dinnerVegetal.reduce((sum, e) => sum + e.quality, 0) / dinnerVegetal.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-dinner-cheat').textContent = dinnerCheat.length > 0 
        ? (dinnerCheat.reduce((sum, e) => sum + e.quality, 0) / dinnerCheat.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-coffee-low').textContent = coffeeLow.length > 0 
        ? (coffeeLow.reduce((sum, e) => sum + e.quality, 0) / coffeeLow.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-coffee-high').textContent = coffeeHigh.length > 0 
        ? (coffeeHigh.reduce((sum, e) => sum + e.quality, 0) / coffeeHigh.length).toFixed(1) + '/10' : '--';

    // === Impact du bien-être mental ===
    const highStress = entries.filter(e => e.stress >= 4);
    const lowStress = entries.filter(e => e.stress <= 2);
    const highRumination = entries.filter(e => e.rumination >= 4);
    const lowRumination = entries.filter(e => e.rumination <= 2);

    document.getElementById('quality-high-stress').textContent = highStress.length > 0 
        ? (highStress.reduce((sum, e) => sum + e.quality, 0) / highStress.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-low-stress').textContent = lowStress.length > 0 
        ? (lowStress.reduce((sum, e) => sum + e.quality, 0) / lowStress.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-high-rumination').textContent = highRumination.length > 0 
        ? (highRumination.reduce((sum, e) => sum + e.quality, 0) / highRumination.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-low-rumination').textContent = lowRumination.length > 0 
        ? (lowRumination.reduce((sum, e) => sum + e.quality, 0) / lowRumination.length).toFixed(1) + '/10' : '--';

    // === Impact des écrans et lumière ===
    const screenEvening = entries.filter(e => e.eveningActivity === 'screen');
    const readingEvening = entries.filter(e => e.eveningActivity === 'reading');
    const outdoorHigh = entries.filter(e => e.outdoorTime >= 60);
    const outdoorLow = entries.filter(e => e.outdoorTime <= 30);

    document.getElementById('quality-screen-evening').textContent = screenEvening.length > 0 
        ? (screenEvening.reduce((sum, e) => sum + e.quality, 0) / screenEvening.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-reading-evening').textContent = readingEvening.length > 0 
        ? (readingEvening.reduce((sum, e) => sum + e.quality, 0) / readingEvening.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-outdoor-high').textContent = outdoorHigh.length > 0 
        ? (outdoorHigh.reduce((sum, e) => sum + e.quality, 0) / outdoorHigh.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-outdoor-low').textContent = outdoorLow.length > 0 
        ? (outdoorLow.reduce((sum, e) => sum + e.quality, 0) / outdoorLow.length).toFixed(1) + '/10' : '--';

    // === Impact des compléments ===
    const withMagnesium = entries.filter(e => e.supplements && e.supplements.magnesium);
    const withoutMagnesium = entries.filter(e => !e.supplements || !e.supplements.magnesium);
    const withOmega3 = entries.filter(e => e.supplements && e.supplements.omega3);
    const withoutOmega3 = entries.filter(e => !e.supplements || !e.supplements.omega3);
    const withKefir = entries.filter(e => e.supplements && e.supplements.kefir);
    const withoutKefir = entries.filter(e => !e.supplements || !e.supplements.kefir);

    document.getElementById('quality-with-magnesium').textContent = withMagnesium.length > 0 
        ? (withMagnesium.reduce((sum, e) => sum + e.quality, 0) / withMagnesium.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-without-magnesium').textContent = withoutMagnesium.length > 0 
        ? (withoutMagnesium.reduce((sum, e) => sum + e.quality, 0) / withoutMagnesium.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-with-omega3').textContent = withOmega3.length > 0 
        ? (withOmega3.reduce((sum, e) => sum + e.quality, 0) / withOmega3.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-without-omega3').textContent = withoutOmega3.length > 0 
        ? (withoutOmega3.reduce((sum, e) => sum + e.quality, 0) / withoutOmega3.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-with-kefir').textContent = withKefir.length > 0 
        ? (withKefir.reduce((sum, e) => sum + e.quality, 0) / withKefir.length).toFixed(1) + '/10' : '--';
    document.getElementById('quality-without-kefir').textContent = withoutKefir.length > 0 
        ? (withoutKefir.reduce((sum, e) => sum + e.quality, 0) / withoutKefir.length).toFixed(1) + '/10' : '--';

    // === Facteurs cumulés ===
    analyzeCumulativeFactors(entries);
}

function analyzeCumulativeFactors(entries) {
    const terribleNights = entries.filter(e => e.quality <= 2);
    const badNights = entries.filter(e => e.quality > 2 && e.quality <= 4);
    const okNights = entries.filter(e => e.quality >= 5 && e.quality <= 6);
    const goodNights = entries.filter(e => e.quality >= 7);
    
    const negativeFactors = [
        { name: 'SJSR présent', check: e => e.sjsr === 'yes' },
        { name: 'Sport intense', check: e => e.sport === 'intense' },
        { name: 'Sport le soir', check: e => e.sport !== 'no' && (e.sportTime === 'evening' || e.sportTime === 'late') },
        { name: 'Semaine peak/test', check: e => e.sportWeekType === 'peak' || e.sportWeekType === 'test' },
        { name: 'Stress élevé (≥4)', check: e => e.stress >= 4 },
        { name: 'Rumination élevée (≥4)', check: e => e.rumination >= 4 },
        { name: 'Tristesse élevée (≥4)', check: e => e.sadness >= 4 },
        { name: 'Écran le soir', check: e => e.eveningActivity === 'screen' },
        { name: 'Café 3+', check: e => e.coffeeCount >= 3 },
        { name: 'Cheatmeal dîner', check: e => e.dinner === 'cheatmeal' },
        { name: 'Pas de petit-déj', check: e => e.breakfast === 'no' },
        { name: 'Peu dehors (<30min)', check: e => e.outdoorTime <= 30 },
        { name: 'Nez bouché', check: e => e.stuffyNose === 'yes' },
        { name: 'Sans magnésium', check: e => !e.supplements || !e.supplements.magnesium },
        { name: 'Sans kéfir', check: e => !e.supplements || !e.supplements.kefir },
        { name: 'Sans oméga 3', check: e => !e.supplements || !e.supplements.omega3 },
        { name: '5+ réveils', check: e => e.awakenings >= 5 },
    ];
    
    const positiveFactors = [
        { name: 'Pas de SJSR', check: e => e.sjsr === 'no' },
        { name: 'Sport modéré/léger', check: e => e.sport === 'light' || e.sport === 'moderate' },
        { name: 'Sport le matin', check: e => e.sport !== 'no' && e.sportTime === 'morning' },
        { name: 'Semaine deload', check: e => e.sportWeekType === 'deload' },
        { name: 'Stress bas (≤2)', check: e => e.stress <= 2 },
        { name: 'Pas de rumination (≤2)', check: e => e.rumination <= 2 },
        { name: 'Bonne humeur (≤2)', check: e => e.sadness <= 2 },
        { name: 'Lecture le soir', check: e => e.eveningActivity === 'reading' },
        { name: 'Café ≤2', check: e => e.coffeeCount <= 2 },
        { name: 'Dîner poisson', check: e => e.dinner === 'fish' },
        { name: 'Dîner végétal', check: e => e.dinner === 'vegetal' },
        { name: 'Temps dehors +1h', check: e => e.outdoorTime >= 60 },
        { name: 'Nez dégagé', check: e => e.stuffyNose === 'no' },
        { name: 'Avec magnésium', check: e => e.supplements && e.supplements.magnesium },
        { name: 'Avec kéfir', check: e => e.supplements && e.supplements.kefir },
        { name: 'Avec oméga 3', check: e => e.supplements && e.supplements.omega3 },
        { name: '≤3 réveils', check: e => e.awakenings <= 3 },
    ];
    
    // Fonction pour analyser et afficher les facteurs
    function displayFactors(nightsArray, containerId, factors, minNights = 1) {
        const container = document.getElementById(containerId);
        if (nightsArray.length >= minNights) {
            const factorCounts = factors.map(f => ({
                name: f.name,
                count: nightsArray.filter(f.check).length,
                percent: (nightsArray.filter(f.check).length / nightsArray.length * 100).toFixed(0)
            })).filter(f => f.count > 0 && parseInt(f.percent) >= 30)
              .sort((a, b) => b.count - a.count)
              .slice(0, 5);
            
            container.innerHTML = factorCounts.length > 0 
                ? factorCounts.map(f => `
                    <div class="factor-item">
                        <span class="factor-name">${f.name}</span>
                        <span class="factor-percent">${f.percent}%</span>
                    </div>
                `).join('')
                : `<p class="no-data">Aucun facteur dominant (${nightsArray.length} nuit${nightsArray.length > 1 ? 's' : ''})</p>`;
        } else {
            container.innerHTML = '<p class="no-data">Pas assez de données</p>';
        }
    }
    
    // Analyser chaque catégorie
    displayFactors(terribleNights, 'terrible-nights-factors', negativeFactors, 1);
    displayFactors(badNights, 'bad-nights-factors', negativeFactors, 1);
    displayFactors(okNights, 'ok-nights-factors', [...negativeFactors, ...positiveFactors], 1);
    displayFactors(goodNights, 'good-nights-factors', positiveFactors, 1);
}

function resetAdvancedStats() {
    // Efficacité
    document.getElementById('sleep-efficiency').textContent = '--%';
    document.getElementById('avg-awakenings').textContent = '--';
    document.getElementById('avg-awakening-duration').textContent = '--';
    document.getElementById('time-lost').textContent = '--';
    // Sport
    document.getElementById('quality-with-sport').textContent = '--/10';
    document.getElementById('quality-without-sport').textContent = '--/10';
    document.getElementById('quality-deload').textContent = '--/10';
    document.getElementById('quality-peak').textContent = '--/10';
    document.getElementById('quality-sport-morning').textContent = '--/10';
    document.getElementById('quality-sport-evening').textContent = '--/10';
    // SJSR
    document.getElementById('sjsr-frequency').textContent = '--%';
    document.getElementById('sjsr-avg-count').textContent = '--';
    document.getElementById('quality-with-sjsr').textContent = '--/10';
    document.getElementById('quality-without-sjsr').textContent = '--/10';
    document.getElementById('sjsr-with-magnesium').textContent = '--%';
    document.getElementById('sjsr-without-magnesium').textContent = '--%';
    // Alimentation
    document.getElementById('quality-dinner-meat').textContent = '--/10';
    document.getElementById('quality-dinner-fish').textContent = '--/10';
    document.getElementById('quality-dinner-vegetal').textContent = '--/10';
    document.getElementById('quality-dinner-cheat').textContent = '--/10';
    document.getElementById('quality-coffee-low').textContent = '--/10';
    document.getElementById('quality-coffee-high').textContent = '--/10';
    // Bien-être mental
    document.getElementById('quality-high-stress').textContent = '--/10';
    document.getElementById('quality-low-stress').textContent = '--/10';
    document.getElementById('quality-high-rumination').textContent = '--/10';
    document.getElementById('quality-low-rumination').textContent = '--/10';
    // Écrans et lumière
    document.getElementById('quality-screen-evening').textContent = '--/10';
    document.getElementById('quality-reading-evening').textContent = '--/10';
    document.getElementById('quality-outdoor-high').textContent = '--/10';
    document.getElementById('quality-outdoor-low').textContent = '--/10';
    // Compléments
    document.getElementById('quality-with-magnesium').textContent = '--/10';
    document.getElementById('quality-without-magnesium').textContent = '--/10';
    document.getElementById('quality-with-omega3').textContent = '--/10';
    document.getElementById('quality-without-omega3').textContent = '--/10';
    document.getElementById('quality-with-kefir').textContent = '--/10';
    document.getElementById('quality-without-kefir').textContent = '--/10';
    // Facteurs cumulés
    document.getElementById('terrible-nights-factors').innerHTML = '<p class="no-data">Pas assez de données</p>';
    document.getElementById('bad-nights-factors').innerHTML = '<p class="no-data">Pas assez de données</p>';
    document.getElementById('ok-nights-factors').innerHTML = '<p class="no-data">Pas assez de données</p>';
    document.getElementById('good-nights-factors').innerHTML = '<p class="no-data">Pas assez de données</p>';
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

// Calcule le temps de sommeil effectif (durée totale - temps éveillé)
function calculateEffectiveSleepMinutes(entry) {
    if (!entry.bedtime || !entry.waketime) return 0;
    
    const totalMinutes = calculateDurationMinutes(entry.bedtime, entry.waketime);
    
    // Temps passé éveillé = nombre de réveils × durée moyenne des réveils
    const awakenings = entry.awakenings || 0;
    const awakeningDuration = entry.awakeningDuration || 0; // en minutes
    const timeAwake = awakenings * awakeningDuration;
    
    // Temps effectif de sommeil
    const effectiveMinutes = totalMinutes - timeAwake;
    
    return Math.max(0, effectiveMinutes); // Ne pas retourner de valeur négative
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


// ============================================
// Conseils intelligents et contextuels
// ============================================

async function generateSmartTips() {
    const entries = await getAllEntries();
    const completedEntries = entries.filter(e => isEntryComplete(e));
    
    if (completedEntries.length < 2) {
        document.getElementById('tips-section').style.display = 'none';
        return;
    }
    
    const tips = [];
    const recent = completedEntries.slice(0, 7); // 7 derniers jours
    const currentEntry = completedEntries[0];
    
    // Analyse SJSR
    const sjsrNights = recent.filter(e => e.sjsr === 'yes');
    if (sjsrNights.length >= 2) {
        // Corrélation SJSR et stress
        const sjsrWithHighStress = sjsrNights.filter(e => e.stress >= 4);
        if (sjsrWithHighStress.length >= 2) {
            tips.push({
                type: 'science',
                icon: '🦵',
                title: 'SJSR et stress',
                content: 'Vos épisodes de SJSR coïncident souvent avec un stress élevé. Le stress augmente la libération de glutamate, un neurotransmetteur excitateur qui aggrave le SJSR. La relaxation progressive de Jacobson avant le coucher a montré une réduction de 40% des symptômes.',
                source: 'Neurologie clinique, Allen et al. 2017'
            });
        }
        
        // Corrélation SJSR et café
        const sjsrWithCoffee = sjsrNights.filter(e => e.coffee === 'yes' && e.coffeeCount >= 2);
        if (sjsrWithCoffee.length >= 2) {
            tips.push({
                type: 'warning',
                icon: '☕',
                title: 'Caféine et SJSR',
                content: 'La caféine bloque les récepteurs d\'adénosine et peut exacerber le SJSR. Essayez de limiter le café avant 14h pendant une semaine pour observer l\'effet sur vos symptômes.',
                source: 'Sleep Medicine Reviews, Trenkwalder 2016'
            });
        }
        
        // SJSR et magnésium (lié à l'exercice intense)
        const sjsrAfterIntense = sjsrNights.filter(e => e.sport === 'intense');
        if (sjsrAfterIntense.length >= 2) {
            tips.push({
                type: 'science',
                icon: '💊',
                title: 'SJSR et exercice intense',
                content: 'Le powerlifting augmente les besoins en magnésium (perdu par la sueur et utilisé pour la contraction musculaire). Une carence en magnésium aggrave le SJSR. Apport recommandé : 400-420mg/jour. Sources : légumes verts, noix, graines, chocolat noir.',
                source: 'Magnesium Research, Hornyak et al. 1998'
            });
        }
        
        // SJSR et pas de magnésium pris
        const sjsrNoMagnesium = sjsrNights.filter(e => e.supplements && !e.supplements.magnesium);
        if (sjsrNoMagnesium.length >= 2) {
            tips.push({
                type: 'warning',
                icon: '💊',
                title: 'SJSR sans magnésium',
                content: `${sjsrNoMagnesium.length} nuits avec SJSR sans prise de magnésium ce jour-là. Le magnésium est un relaxant musculaire naturel et un cofacteur de la synthèse de dopamine. Pour le SJSR, le glycinate ou thréonate de magnésium sont préférés (meilleure absorption et passage barrière hémato-encéphalique).`,
                source: 'Sleep Medicine, Hornyak et al. 1998'
            });
        }
    }
    
    // Analyse suppléments et sommeil
    const withSupplements = recent.filter(e => e.supplements);
    if (withSupplements.length >= 3) {
        // Glutamine et GABA
        const noGlutamine = withSupplements.filter(e => !e.supplements.glutamine);
        const withGlutamine = withSupplements.filter(e => e.supplements.glutamine);
        if (noGlutamine.length >= 2 && withGlutamine.length >= 2) {
            const avgQualityWithout = noGlutamine.reduce((sum, e) => sum + e.quality, 0) / noGlutamine.length;
            const avgQualityWith = withGlutamine.reduce((sum, e) => sum + e.quality, 0) / withGlutamine.length;
            if (avgQualityWith > avgQualityWithout + 0.5) {
                tips.push({
                    type: 'insight',
                    icon: '🧬',
                    title: 'Glutamine et sommeil',
                    content: `Qualité ${avgQualityWith.toFixed(1)}/10 avec glutamine vs ${avgQualityWithout.toFixed(1)}/10 sans. La glutamine est un précurseur du GABA (neurotransmetteur inhibiteur). Elle peut aussi réduire les douleurs musculaires post-entraînement qui perturbent le sommeil.`,
                    source: 'Journal of Nutritional Science, Welbourne 1995'
                });
            }
        }
        
        // Omega 3 et inflammation
        const noOmega3 = withSupplements.filter(e => !e.supplements.omega3);
        const withOmega3 = withSupplements.filter(e => e.supplements.omega3);
        if (noOmega3.length >= 2 && withOmega3.length >= 2) {
            const avgQualityWithout = noOmega3.reduce((sum, e) => sum + e.quality, 0) / noOmega3.length;
            const avgQualityWith = withOmega3.reduce((sum, e) => sum + e.quality, 0) / withOmega3.length;
            if (avgQualityWith > avgQualityWithout + 0.5) {
                tips.push({
                    type: 'insight',
                    icon: '🐟',
                    title: 'Oméga 3 et sommeil',
                    content: `Qualité ${avgQualityWith.toFixed(1)}/10 avec oméga 3 vs ${avgQualityWithout.toFixed(1)}/10 sans. Les oméga 3 (EPA/DHA) régulent la mélatonine et réduisent l'inflammation liée à l'entraînement intense. Effet cumulatif : les bénéfices apparaissent après plusieurs semaines de prise régulière.`,
                    source: 'Journal of Sleep Research, Hansen et al. 2014'
                });
            }
        }
        
        // Kéfir et axe intestin-cerveau
        const noKefir = withSupplements.filter(e => !e.supplements.kefir);
        const withKefir = withSupplements.filter(e => e.supplements.kefir);
        if (noKefir.length >= 2 && withKefir.length >= 2) {
            const avgAwakeningsWithout = noKefir.reduce((sum, e) => sum + e.awakenings, 0) / noKefir.length;
            const avgAwakeningsWith = withKefir.reduce((sum, e) => sum + e.awakenings, 0) / withKefir.length;
            if (avgAwakeningsWithout > avgAwakeningsWith + 0.5) {
                tips.push({
                    type: 'science',
                    icon: '🥛',
                    title: 'Kéfir et microbiote',
                    content: `${avgAwakeningsWith.toFixed(1)} réveils avec kéfir vs ${avgAwakeningsWithout.toFixed(1)} sans. Le microbiote intestinal produit ~95% de la sérotonine corporelle, précurseur de la mélatonine. Les probiotiques du kéfir modulent l'axe intestin-cerveau et peuvent améliorer la continuité du sommeil.`,
                    source: 'Frontiers in Psychiatry, Marotta et al. 2019'
                });
            }
        }
    }
    
    // Analyse powerlifting/musculation intense et sommeil
    const intenseWorkouts = recent.filter(e => e.sport === 'intense');
    if (intenseWorkouts.length >= 2) {
        // Entraînement tardif
        const lateWorkouts = intenseWorkouts.filter(e => e.sportTime === 'evening' || e.sportTime === 'late');
        if (lateWorkouts.length >= 2) {
            const avgQualityLate = lateWorkouts.reduce((sum, e) => sum + e.quality, 0) / lateWorkouts.length;
            const morningWorkouts = intenseWorkouts.filter(e => e.sportTime === 'morning' || e.sportTime === 'afternoon');
            if (morningWorkouts.length > 0) {
                const avgQualityEarly = morningWorkouts.reduce((sum, e) => sum + e.quality, 0) / morningWorkouts.length;
                if (avgQualityLate < avgQualityEarly - 0.5) {
                    tips.push({
                        type: 'insight',
                        icon: '🏋️',
                        title: 'Timing powerlifting',
                        content: `Qualité sommeil ${avgQualityLate.toFixed(1)}/10 après entraînement tardif vs ${avgQualityEarly.toFixed(1)}/10 plus tôt. L'exercice intense élève la température corporelle et l'activité du système nerveux sympathique pendant 2-3h. Idéalement, terminer l'entraînement 4h avant le coucher.`,
                        source: 'European Journal of Applied Physiology, Myllymäki et al. 2011'
                    });
                }
            }
        }
        
        // Long entraînement et récupération
        const longWorkouts = intenseWorkouts.filter(e => e.sportDuration >= 120);
        if (longWorkouts.length >= 2) {
            const avgAwakeningsLong = longWorkouts.reduce((sum, e) => sum + e.awakenings, 0) / longWorkouts.length;
            if (avgAwakeningsLong >= 3) {
                tips.push({
                    type: 'science',
                    icon: '⚡',
                    title: 'Récupération système nerveux',
                    content: `Séances de 2h+ de powerlifting avec ${avgAwakeningsLong.toFixed(1)} réveils en moyenne. L'entraînement lourd stimule fortement le système nerveux sympathique. La variabilité cardiaque (HRV) peut rester perturbée 24-48h. Considérez : magnésium glycinate le soir, respiration 4-7-8, éviter les écrans post-entraînement.`,
                    source: 'Journal of Strength & Conditioning Research, Chen et al. 2019'
                });
            }
        }
        
        // Analyse par type de semaine
        const peakWeeks = intenseWorkouts.filter(e => e.sportWeekType === 'peak' || e.sportWeekType === 'test');
        if (peakWeeks.length >= 1) {
            const avgQualityPeak = peakWeeks.reduce((sum, e) => sum + e.quality, 0) / peakWeeks.length;
            const avgAwakeningsPeak = peakWeeks.reduce((sum, e) => sum + e.awakenings, 0) / peakWeeks.length;
            if (avgQualityPeak < 6 || avgAwakeningsPeak >= 4) {
                tips.push({
                    type: 'science',
                    icon: '🏆',
                    title: 'Semaines peak/test et sommeil',
                    content: `Qualité ${avgQualityPeak.toFixed(1)}/10 et ${avgAwakeningsPeak.toFixed(1)} réveils en semaine peak. Les charges maximales créent un stress important sur le système nerveux central (SNC). Le SNC récupère principalement pendant le sommeil profond. Priorisez : coucher plus tôt, éviter stimulants après 14h, sieste de 20min si possible.`,
                    source: 'Strength & Conditioning Journal, Halson 2014'
                });
            }
        }
        
        const deloadWeeks = intenseWorkouts.filter(e => e.sportWeekType === 'deload');
        const nonDeloadWeeks = intenseWorkouts.filter(e => e.sportWeekType !== 'deload' && e.sportWeekType);
        if (deloadWeeks.length >= 1 && nonDeloadWeeks.length >= 2) {
            const avgQualityDeload = deloadWeeks.reduce((sum, e) => sum + e.quality, 0) / deloadWeeks.length;
            const avgQualityIntense = nonDeloadWeeks.reduce((sum, e) => sum + e.quality, 0) / nonDeloadWeeks.length;
            if (avgQualityDeload > avgQualityIntense + 0.5) {
                tips.push({
                    type: 'insight',
                    icon: '📉',
                    title: 'Deload et récupération',
                    content: `Qualité sommeil ${avgQualityDeload.toFixed(1)}/10 en deload vs ${avgQualityIntense.toFixed(1)}/10 en semaines intenses. C'est normal ! Les semaines de deload permettent au SNC de récupérer. Si vous dormez mal en semaines intenses, c'est peut-être un signe de surmenage - envisagez des deloads plus fréquents.`,
                    source: 'Sports Medicine, Pritchard et al. 2015'
                });
            }
        }
    }
    
    // Analyse dette de sommeil (utilise le temps effectif)
    const avgDuration = recent.reduce((sum, e) => sum + calculateEffectiveSleepMinutes(e), 0) / recent.length;
    if (avgDuration < 390 && recent.length >= 3) { // Moins de 6h30 en moyenne
        const avgQuality = recent.reduce((sum, e) => sum + e.quality, 0) / recent.length;
        if (avgQuality < 5) {
            tips.push({
                type: 'warning',
                icon: '⚠️',
                title: 'Dette de sommeil détectée',
                content: `Moyenne de ${formatDuration(avgDuration)} sur ${recent.length} nuits avec qualité ${avgQuality.toFixed(1)}/10. La dette de sommeil chronique affecte la régulation du cortisol et amplifie la sensibilité au stress. Une nuit de récupération ne suffit pas : privilégiez 30min de plus par nuit pendant 1-2 semaines.`,
                source: 'Sleep Research Society, Banks & Dinges 2007'
            });
        }
    }
    
    // Analyse température + réveils
    const hotNights = recent.filter(e => e.roomTemp === 'hot');
    if (hotNights.length >= 2) {
        const avgAwakeningsHot = hotNights.reduce((sum, e) => sum + e.awakenings, 0) / hotNights.length;
        const avgAwakeningsOther = recent.filter(e => e.roomTemp !== 'hot').reduce((sum, e) => sum + e.awakenings, 0) / Math.max(1, recent.filter(e => e.roomTemp !== 'hot').length);
        if (avgAwakeningsHot > avgAwakeningsOther + 1) {
            tips.push({
                type: 'insight',
                icon: '🌡️',
                title: 'Thermorégulation et réveils',
                content: `Vos nuits chaudes ont ${avgAwakeningsHot.toFixed(1)} réveils vs ${avgAwakeningsOther.toFixed(1)} normalement. La température corporelle doit baisser de 1°C pour initier le sommeil profond. Température idéale : 16-18°C. Un bain chaud 1-2h avant le coucher provoque une baisse réflexe de température.`,
                source: 'Journal of Physiological Anthropology, Okamoto-Mizuno 2012'
            });
        }
    }
    
    // Analyse nez bouché + qualité
    const stuffyNights = recent.filter(e => e.stuffyNose === 'yes');
    if (stuffyNights.length >= 3) {
        const avgQualityStuffy = stuffyNights.reduce((sum, e) => sum + e.quality, 0) / stuffyNights.length;
        if (avgQualityStuffy < 5) {
            tips.push({
                type: 'science',
                icon: '👃',
                title: 'Obstruction nasale chronique',
                content: 'L\'obstruction nasale force la respiration buccale, réduisant l\'oxygénation et fragmentant le sommeil. Causes fréquentes post-ménopause : sécheresse muqueuse (taux d\'œstrogènes). Solution : humidificateur + sérum physiologique + surélever légèrement la tête.',
                source: 'Rhinology Journal, Virkkula et al. 2005'
            });
        }
    }
    
    // Analyse lumière bleue (écran le soir + temps écran élevé)
    const screenNights = recent.filter(e => e.eveningActivity === 'screen' && e.screenTime >= 6);
    if (screenNights.length >= 3) {
        const avgQualityScreen = screenNights.reduce((sum, e) => sum + e.quality, 0) / screenNights.length;
        const avgQualityNoScreen = recent.filter(e => e.eveningActivity !== 'screen').reduce((sum, e) => sum + e.quality, 0) / Math.max(1, recent.filter(e => e.eveningActivity !== 'screen').length);
        if (avgQualityScreen < avgQualityNoScreen - 0.5) {
            tips.push({
                type: 'insight',
                icon: '📱',
                title: 'Impact écran détecté',
                content: `Qualité ${avgQualityScreen.toFixed(1)}/10 avec écran vs ${avgQualityNoScreen.toFixed(1)}/10 sans. La lumière bleue supprime la mélatonine pendant 90min après exposition. Les lunettes filtrantes réduisent cet effet de 58%. Alternative : mode nuit + luminosité minimale 2h avant coucher.`,
                source: 'Chronobiology International, Shechter et al. 2018'
            });
        }
    }
    
    // Analyse rumination/stress combiné
    const highRuminationNights = recent.filter(e => e.rumination >= 4 && e.stress >= 4);
    if (highRuminationNights.length >= 2) {
        tips.push({
            type: 'science',
            icon: '🧠',
            title: 'Hyperactivation cognitive',
            content: 'Combinaison stress + rumination élevés détectée. Cette hyperactivation du cortex préfrontal empêche le basculement vers le sommeil. Technique validée : "worry time" programmé (15min en début de soirée pour écrire ses préoccupations) réduit les ruminations nocturnes de 50%.',
            source: 'Behaviour Research and Therapy, Carney & Waters 2006'
        });
    }
    
    // Corrélation positive à souligner
    const goodNights = recent.filter(e => e.quality >= 7);
    if (goodNights.length >= 2) {
        // Chercher un pattern commun
        const sportGoodNights = goodNights.filter(e => e.sport === 'yes').length;
        const outdoorGoodNights = goodNights.filter(e => e.outdoorTime >= 60).length;
        
        if (sportGoodNights >= 2 && sportGoodNights / goodNights.length > 0.6) {
            tips.push({
                type: 'insight',
                icon: '✨',
                title: 'Pattern positif identifié',
                content: `${Math.round(sportGoodNights / goodNights.length * 100)}% de vos bonnes nuits incluent du sport. L\'activité physique augmente le sommeil profond (stade N3) de 20-30% selon les études. Continuez !`,
                source: 'Journal of Clinical Sleep Medicine, Kredlow et al. 2015'
            });
        } else if (outdoorGoodNights >= 2 && outdoorGoodNights / goodNights.length > 0.6) {
            tips.push({
                type: 'insight',
                icon: '☀️',
                title: 'Pattern positif identifié',
                content: `${Math.round(outdoorGoodNights / goodNights.length * 100)}% de vos bonnes nuits suivent 1h+ d'exposition extérieure. La lumière naturelle recalibre l'horloge circadienne et augmente l'amplitude de la mélatonine nocturne.`,
                source: 'Sleep Medicine Reviews, Blume et al. 2019'
            });
        }
    }
    
    // Afficher les conseils (max 3 pour ne pas surcharger)
    displayTips(tips.slice(0, 3));
}

function displayTips(tips) {
    const section = document.getElementById('tips-section');
    const content = document.getElementById('tips-content');
    
    if (tips.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    content.innerHTML = tips.map(tip => `
        <div class="tip-card ${tip.type}">
            <div class="tip-title">${tip.icon} ${tip.title}</div>
            <div class="tip-content">${tip.content}</div>
            <div class="tip-source">📚 ${tip.source}</div>
        </div>
    `).join('');
}

// Mettre à jour les conseils au chargement et après sauvegarde
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(generateSmartTips, 1000);
});
