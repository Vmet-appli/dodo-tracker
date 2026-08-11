// ============================================
// DodoTracker - Application de suivi du sommeil
// ============================================

// Configuration de la base de données IndexedDB
const DB_NAME = 'DodoTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'sleepEntries';

let db = null;
let charts = {};
let deleteEntryId = null;

// ============================================
// Initialisation de l'application
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => {
        initTabs();
        initForm();
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

        request.onerror = () => {
            console.error('Erreur IndexedDB, fallback localStorage');
            // Fallback sur localStorage si IndexedDB échoue
            resolve();
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB initialisée');
            // Synchroniser avec localStorage backup
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

// Sauvegarder une entrée
async function saveEntry(entry) {
    entry.id = entry.id || generateId();
    entry.createdAt = entry.createdAt || new Date().toISOString();
    entry.updatedAt = new Date().toISOString();

    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(entry);

            request.onsuccess = () => {
                backupToLocalStorage();
                resolve(entry);
            };
            request.onerror = () => reject(request.error);
        });
    } else {
        // Fallback localStorage
        const entries = getEntriesFromLocalStorage();
        const existingIndex = entries.findIndex(e => e.id === entry.id);
        if (existingIndex >= 0) {
            entries[existingIndex] = entry;
        } else {
            entries.push(entry);
        }
        localStorage.setItem('sleepEntries', JSON.stringify(entries));
        return entry;
    }
}

// Récupérer toutes les entrées
async function getAllEntries() {
    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result.sort((a, b) => 
                    new Date(b.date) - new Date(a.date)
                );
                resolve(entries);
            };
            request.onerror = () => reject(request.error);
        });
    } else {
        return getEntriesFromLocalStorage();
    }
}

// Supprimer une entrée
async function deleteEntry(id) {
    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => {
                backupToLocalStorage();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } else {
        const entries = getEntriesFromLocalStorage();
        const filtered = entries.filter(e => e.id !== id);
        localStorage.setItem('sleepEntries', JSON.stringify(filtered));
    }
}

// Récupérer une entrée par ID
async function getEntryById(id) {
    if (db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } else {
        const entries = getEntriesFromLocalStorage();
        return entries.find(e => e.id === id);
    }
}

// Vérifier si une entrée existe pour une date
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
        localStorage.setItem('sleepEntries_lastBackup', new Date().toISOString());
    };
}

function syncFromLocalStorage() {
    const localData = getEntriesFromLocalStorage();
    if (!localData.length || !db) return;

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    localData.forEach(entry => {
        store.put(entry);
    });
}

// ============================================
// Gestion des onglets
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

            if (targetId === 'stats') {
                updateStats();
            } else if (targetId === 'historique') {
                loadHistory();
            }
        });
    });
}

// ============================================
// Formulaire de saisie
// ============================================

function initForm() {
    const form = document.getElementById('sleep-form');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('date').value;
        
        // Vérifier si une entrée existe déjà pour cette date
        const existing = await getEntryByDate(date);
        
        const entry = {
            id: existing?.id || generateId(),
            date: date,
            bedtime: document.getElementById('bedtime').value,
            waketime: document.getElementById('waketime').value,
            quality: parseInt(document.getElementById('quality').value),
            energy: parseInt(document.getElementById('energy').value),
            awakenings: parseInt(document.getElementById('awakenings').value),
            dreams: document.getElementById('dreams').value,
            notes: document.getElementById('notes').value.trim(),
            createdAt: existing?.createdAt
        };

        try {
            await saveEntry(entry);
            showToast(existing ? '✅ Entrée mise à jour !' : '✅ Nuit enregistrée !', 'success');
            resetForm();
            loadHistory();
        } catch (error) {
            console.error('Erreur sauvegarde:', error);
            showToast('❌ Erreur lors de la sauvegarde', 'error');
        }
    });
}

function resetForm() {
    document.getElementById('sleep-form').reset();
    setDefaultDate();
    document.getElementById('quality').value = 3;
    document.getElementById('energy').value = 3;
    updateRangeDisplay('quality', 3);
    updateRangeDisplay('energy', 3);
}

function setDefaultDate() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate());
    document.getElementById('date').value = formatDateForInput(today);
}

// ============================================
// Sliders de notation
// ============================================

function initRangeInputs() {
    const ranges = ['quality', 'energy', 'edit-quality', 'edit-energy'];
    
    ranges.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', (e) => {
                updateRangeDisplay(id, e.target.value);
            });
        }
    });
}

function updateRangeDisplay(id, value) {
    const displayId = id.includes('edit') ? id + '-value' : id + '-value';
    const display = document.getElementById(displayId);
    if (display) {
        display.textContent = value;
    }
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
            </div>
        `;
        return;
    }

    container.innerHTML = entries.map(entry => createHistoryItem(entry)).join('');

    // Ajouter les événements
    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });

    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
    });
}

function createHistoryItem(entry) {
    const duration = calculateDuration(entry.bedtime, entry.waketime);
    const dateFormatted = formatDateDisplay(entry.date);
    const dreamsLabel = {
        'none': 'Pas de rêves',
        'neutral': 'Rêves neutres',
        'good': 'Bons rêves',
        'bad': 'Cauchemars'
    };

    return `
        <div class="history-item" data-id="${entry.id}">
            <div class="history-item-header">
                <span class="history-date">📅 ${dateFormatted}</span>
                <div class="history-actions-item">
                    <button class="btn-icon btn-edit" data-id="${entry.id}" title="Modifier">✏️</button>
                    <button class="btn-icon btn-delete" data-id="${entry.id}" title="Supprimer">🗑️</button>
                </div>
            </div>
            <div class="history-details">
                <div class="history-detail">
                    <span>🛏️</span>
                    <span>Coucher: ${entry.bedtime}</span>
                </div>
                <div class="history-detail">
                    <span>⏰</span>
                    <span>Réveil: ${entry.waketime}</span>
                </div>
                <div class="history-detail">
                    <span>⏱️</span>
                    <span>Durée: ${duration}</span>
                </div>
                <div class="history-detail">
                    <span>😴</span>
                    <span class="quality-${entry.quality}">Qualité: ${entry.quality}/5</span>
                </div>
                <div class="history-detail">
                    <span>⚡</span>
                    <span class="quality-${entry.energy}">Énergie: ${entry.energy}/5</span>
                </div>
                <div class="history-detail">
                    <span>🔄</span>
                    <span>Réveils: ${entry.awakenings}</span>
                </div>
                <div class="history-detail">
                    <span>💭</span>
                    <span>${dreamsLabel[entry.dreams] || entry.dreams}</span>
                </div>
            </div>
            ${entry.notes ? `<div class="history-notes">📝 ${entry.notes}</div>` : ''}
        </div>
    `;
}

// ============================================
// Modals
// ============================================

function initModals() {
    // Modal suppression
    document.getElementById('cancel-delete').addEventListener('click', closeDeleteModal);
    document.getElementById('confirm-delete').addEventListener('click', confirmDelete);

    // Modal édition
    document.getElementById('cancel-edit').addEventListener('click', closeEditModal);
    document.getElementById('edit-form').addEventListener('submit', saveEdit);

    // Fermer modal en cliquant à l'extérieur
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
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
            showToast('❌ Erreur lors de la suppression', 'error');
        }
    }
    closeDeleteModal();
}

async function openEditModal(id) {
    const entry = await getEntryById(id);
    if (!entry) return;

    document.getElementById('edit-id').value = entry.id;
    document.getElementById('edit-date').value = entry.date;
    document.getElementById('edit-bedtime').value = entry.bedtime;
    document.getElementById('edit-waketime').value = entry.waketime;
    document.getElementById('edit-quality').value = entry.quality;
    document.getElementById('edit-energy').value = entry.energy;
    document.getElementById('edit-awakenings').value = entry.awakenings;
    document.getElementById('edit-dreams').value = entry.dreams;
    document.getElementById('edit-notes').value = entry.notes || '';

    updateRangeDisplay('edit-quality', entry.quality);
    updateRangeDisplay('edit-energy', entry.energy);

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
        bedtime: document.getElementById('edit-bedtime').value,
        waketime: document.getElementById('edit-waketime').value,
        quality: parseInt(document.getElementById('edit-quality').value),
        energy: parseInt(document.getElementById('edit-energy').value),
        awakenings: parseInt(document.getElementById('edit-awakenings').value),
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
        showToast('❌ Erreur lors de la modification', 'error');
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

    // Filtrer par période
    if (period !== 'all') {
        const daysAgo = parseInt(period);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
        entries = entries.filter(e => new Date(e.date) >= cutoffDate);
    }

    // Trier par date croissante pour les graphiques
    entries = entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calcul des moyennes
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

    // Mise à jour des graphiques
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
        plugins: {
            legend: {
                display: false
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#94a3b8' }
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#94a3b8' }
            }
        }
    };

    // Graphique Qualité
    const qualityCtx = document.getElementById('quality-chart').getContext('2d');
    charts.quality = new Chart(qualityCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Qualité',
                data: qualityData,
                borderColor: '#818cf8',
                backgroundColor: 'rgba(129, 140, 248, 0.2)',
                fill: true,
                tension: 0.3
            }, {
                label: 'Énergie',
                data: energyData,
                borderColor: '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            ...chartOptions,
            plugins: {
                legend: { 
                    display: true,
                    labels: { color: '#94a3b8' }
                }
            },
            scales: {
                ...chartOptions.scales,
                y: {
                    ...chartOptions.scales.y,
                    min: 0,
                    max: 5
                }
            }
        }
    });

    // Graphique Durée
    const durationCtx = document.getElementById('duration-chart').getContext('2d');
    charts.duration = new Chart(durationCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Heures de sommeil',
                data: durationData,
                backgroundColor: 'rgba(79, 70, 229, 0.7)',
                borderRadius: 4
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: {
                    ...chartOptions.scales.y,
                    min: 0,
                    max: 12,
                    ticks: {
                        ...chartOptions.scales.y.ticks,
                        callback: (value) => value + 'h'
                    }
                }
            }
        }
    });

    // Graphique Heures de coucher
    const bedtimeCtx = document.getElementById('bedtime-chart').getContext('2d');
    charts.bedtime = new Chart(bedtimeCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Heure du coucher',
                data: bedtimeData,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: {
                    ...chartOptions.scales.y,
                    min: 20,
                    max: 26,
                    ticks: {
                        ...chartOptions.scales.y.ticks,
                        callback: (value) => {
                            const hour = value >= 24 ? value - 24 : value;
                            return hour + ':00';
                        }
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
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        entries: entries
    };

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

        if (!data.entries || !Array.isArray(data.entries)) {
            throw new Error('Format de fichier invalide');
        }

        let imported = 0;
        for (const entry of data.entries) {
            await saveEntry(entry);
            imported++;
        }

        showToast(`📥 ${imported} entrées importées`, 'success');
        loadHistory();
        updateStats();
    } catch (error) {
        console.error('Erreur import:', error);
        showToast('❌ Erreur lors de l\'import', 'error');
    }

    e.target.value = '';
}

// ============================================
// Service Worker
// ============================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('Service Worker enregistré:', registration.scope);
            })
            .catch(error => {
                console.error('Erreur Service Worker:', error);
            });
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
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    return date.toLocaleDateString('fr-FR', options);
}

function formatDateShort(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function calculateDuration(bedtime, waketime) {
    const minutes = calculateDurationMinutes(bedtime, waketime);
    return formatDuration(minutes);
}

function calculateDurationMinutes(bedtime, waketime) {
    const [bedH, bedM] = bedtime.split(':').map(Number);
    const [wakeH, wakeM] = waketime.split(':').map(Number);

    let bedMinutes = bedH * 60 + bedM;
    let wakeMinutes = wakeH * 60 + wakeM;

    // Si le réveil est avant le coucher, on est passé à minuit
    if (wakeMinutes < bedMinutes) {
        wakeMinutes += 24 * 60;
    }

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
    // Pour les heures après minuit (0h-4h), on ajoute 24 pour le graphique
    if (decimal < 12) {
        decimal += 24;
    }
    return decimal;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
