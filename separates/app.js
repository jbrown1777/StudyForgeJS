//console.log("Version: 2.03");
const versionNum = 2.06;
document.getElementById("versionID").textContent = `V${versionNum}`;

// ============================================================================
// DATA STORAGE AND MANAGEMENT
// ============================================================================
let deck = [];
let cardsData = [];
let currentIndex = 0;
let currentMode = 'flashcard';
let testData = null;
let userAnswers = {};
let hasUnsavedChanges = false;
let currentFileHandle = null;
let editorMode = "create"; // create or edit
let smartOrderEnabled = true; // default ON
let currentImportedDeckName = null;

// Learn mode state
let learnQuestions = [];
let learnCurrentIndex = 0;
let learnCorrect = 0;
let learnIncorrect = 0;
let learnAskedQuestions = new Set();
let currentLearnQuestion = null;

// ============================================================================
// LOCALSTORAGE PERSISTENCE SYSTEM
// ============================================================================

const STORAGE_KEYS = {
    DECKS: 'studyforgejs_decks',           // All saved decks
    CURRENT_DECK: 'studyforgejs_current',   // Currently active deck
    SETTINGS: 'studyforgejs_settings',      // User preferences
    STATS: 'studyforgejs_stats'             // Study statistics
};

// Storage Helper Functions
const Storage = {
    // Save data to localStorage
    save(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Storage save error:', e);
            return false;
        }
    },

    // Load data from localStorage
    load(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('Storage load error:', e);
            return defaultValue;
        }
    },

    // Remove item from localStorage
    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.error('Storage remove error:', e);
            return false;
        }
    },

    // Clear all studyforgejs data
    clearAll() {
        Object.values(STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    }
};

// Deck Management System
const DeckManager = {
    // Get all saved decks
    getAllDecks() {
        return Storage.load(STORAGE_KEYS.DECKS, []);
    },

    // Save a deck
    saveDeck(deckData) {
        const decks = this.getAllDecks();
        const existingIndex = decks.findIndex(d => d.id === deckData.id);

        // Add metadata
        deckData.lastModified = new Date().toISOString();
        if (!deckData.created) {
            deckData.created = deckData.lastModified;
        }

        if (existingIndex >= 0) {
            // Update existing deck
            decks[existingIndex] = deckData;
        } else {
            // Add new deck
            decks.push(deckData);
        }

        Storage.save(STORAGE_KEYS.DECKS, decks);
        return deckData;
    },

    // Get a specific deck by ID
    getDeck(deckId) {
        const decks = this.getAllDecks();
        return decks.find(d => d.id === deckId);
    },

    // Delete a deck
    deleteDeck(deckId) {
        const decks = this.getAllDecks();
        const filtered = decks.filter(d => d.id !== deckId);
        Storage.save(STORAGE_KEYS.DECKS, filtered);
        return true;
    },

    // Set current active deck
    setCurrentDeck(deckId) {
        Storage.save(STORAGE_KEYS.CURRENT_DECK, deckId);
    },

    // Get current active deck
    getCurrentDeckId() {
        return Storage.load(STORAGE_KEYS.CURRENT_DECK);
    },

    // Create a new deck
    createDeck(name, cards = []) {
        const deckId = 'deck_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const deckData = {
            id: deckId,
            name: name,
            cards: cards,
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            stats: {
                totalStudySessions: 0,
                cardsStudied: 0,
                accuracy: 0
            }
        };

        this.saveDeck(deckData);
        this.setCurrentDeck(deckId);
        return deckData;
    },

    // Generate a deck from current cardsData
    createDeckFromCards(name, cardsDataArray) {
        const cards = cardsDataArray.map(card => ({
            question: card.front,
            answer: card.back,
            mastery: 0,        // 0-5 scale
            correctCount: 0,
            incorrectCount: 0,
            lastReviewed: null,
            nextReview: null
        }));

        return this.createDeck(name, cards);
    }
};

// Progress Tracking
const ProgressTracker = {
    // Record a study session
    recordSession(deckId, cardsStudied, correct, incorrect) {
        const deck = DeckManager.getDeck(deckId);
        if (!deck) return;

        // Update deck stats
        deck.stats.totalStudySessions += 1;
        deck.stats.cardsStudied += cardsStudied;
        const totalAttempts = correct + incorrect;
        if (totalAttempts > 0) {
            const sessionAccuracy = (correct / totalAttempts) * 100;
            // Running average
            const prevTotal = deck.stats.cardsStudied - cardsStudied;
            deck.stats.accuracy = ((deck.stats.accuracy * prevTotal) + (sessionAccuracy * cardsStudied)) / deck.stats.cardsStudied;
        }

        // Save updated deck
        DeckManager.saveDeck(deck);

        // Update global stats
        this.updateGlobalStats(cardsStudied, correct, incorrect);
    },

    // Update card progress
    updateCardProgress(deckId, cardIndex, isCorrect) {
        const deck = DeckManager.getDeck(deckId);
        if (!deck || !deck.cards[cardIndex]) return;

        const card = deck.cards[cardIndex];
        const now = new Date().toISOString();

        if (isCorrect) {
            card.correctCount += 1;
            card.mastery = Math.min(5, card.mastery + 1);
        } else {
            card.incorrectCount += 1;
            card.mastery = Math.max(0, card.mastery - 1);
        }

        card.lastReviewed = now;

        // Calculate next review date based on mastery level
        const daysUntilReview = [0, 1, 3, 7, 14, 30][card.mastery];
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + daysUntilReview);
        card.nextReview = nextReview.toISOString();

        DeckManager.saveDeck(deck);
    },

    // Get global statistics
    getGlobalStats() {
        const stats = Storage.load(STORAGE_KEYS.STATS, {
            totalCardsStudied: 0,
            totalSessions: 0,
            totalCorrect: 0,
            totalIncorrect: 0,
            streakDays: 0,
            lastStudyDate: null,
            studyHistory: [] // Array of {date, cardsStudied, correct, incorrect}
        });

        const today = getTodayDateString();

        // Check if today already exists
        let todayEntry = stats.studyHistory.find(d => d.date === today);

        if (!todayEntry) {
            todayEntry = {
                date: today,
                cardsStudied: 0,
                correct: 0,
                incorrect: 0
            };
            stats.studyHistory.push(todayEntry);
            Storage.save(STORAGE_KEYS.STATS, stats);
        }

        return stats;
    },

    // Reset global statistics
    resetGlobalStats() {
        const defaultStats = {
            totalCardsStudied: 0,
            totalSessions: 0,
            totalCorrect: 0,
            totalIncorrect: 0,
            streakDays: 0,
            lastStudyDate: null,
            studyHistory: []
        }

        Storage.save(STORAGE_KEYS.STATS, defaultStats);
        return defaultStats;
    },

    // Update global statistics
    updateGlobalStats(cardsStudied, correct, incorrect) {
        const stats = this.getGlobalStats();
        const today = getTodayDateString();

        stats.totalCardsStudied += cardsStudied;
        stats.totalSessions += 1;
        stats.totalCorrect += correct;
        stats.totalIncorrect += incorrect;

        // Update streak
        if (!stats.lastStudyDate) {
            stats.streakDays = 1;
        }
        else {
            const lastDate = new Date(stats.lastStudyDate);
            const todayDate = new Date(today);

            //const lastMidnight = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
            //const todayMidnight = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());

            const diffDays = Math.floor((today/*Midnight*/ - last/*Midnight*/) / (1000 * 60 * 60 * 24));
            console.log(diffDays);
            console.log(stats.streakDays);

            if (diffDays === 1) {
                stats.streakDays += 1;
            } else if (diffDays > 1) {
                stats.streakDays = 1; // Streak broken
            }
            // If diffDays === 0, same day, don't change streak
        }

        stats.lastStudyDate = today;

        // Add to history
        const todayHistory = stats.studyHistory.find(h => h.date === today);
        if (todayHistory) {
            todayHistory.cardsStudied += cardsStudied;
            todayHistory.correct += correct;
            todayHistory.incorrect += incorrect;
        } else {
            stats.studyHistory.push({
                date: today,
                cardsStudied: cardsStudied,
                correct: correct,
                incorrect: incorrect
            });
        }

        // Keep only last 90 days of history
        if (stats.studyHistory.length > 90) {
            stats.studyHistory = stats.studyHistory.slice(-90);
        }

        Storage.save(STORAGE_KEYS.STATS, stats);
    }
};

// Auto-save functionality
let autoSaveTimeout = null;
function scheduleAutoSave() {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }

    autoSaveTimeout = setTimeout(() => {
        saveCurrentDeckState();
    }, 2000); // Auto-save 2 seconds after last change
}

function saveCurrentDeckState() {
    const currentDeckId = DeckManager.getCurrentDeckId();
    if (!currentDeckId || !deck || deck.length === 0) return;

    const deckData = DeckManager.getDeck(currentDeckId);
    if (!deckData) return;

    // Update cards from current deck array
    deckData.cards = deck.map((card, index) => {
        const existing = deckData.cards[index] || {};
        return {
            question: card.question,
            answer: card.answer,
            mastery: existing.mastery || 0,
            correctCount: existing.correctCount || 0,
            incorrectCount: existing.incorrectCount || 0,
            lastReviewed: existing.lastReviewed || null,
            nextReview: existing.nextReview || null
        };
    });

    DeckManager.saveDeck(deckData);
    console.log('✓ Deck auto-saved');
}

// Integration functions to call from existing code

// Call this when uploading a file
function onFileUploaded(fileName, cardsArray) {
    handleUploadedFile(fileName);
    // Check if this deck already exists by name
    const existingDecks = DeckManager.getAllDecks();
    let existingDeck = existingDecks.find(d => d.name === fileName);

    if (existingDeck) {
        // Ask user if they want to update or create new
        const update = confirm(`A deck named "${fileName}" already exists. Update it?`);
        if (update) {
            existingDeck.cards = cardsArray.map((card, index) => {
                const existing = existingDeck.cards[index] || {};
                return {
                    question: card.front,
                    answer: card.back,
                    mastery: existing.mastery || 0,
                    correctCount: existing.correctCount || 0,
                    incorrectCount: existing.incorrectCount || 0,
                    lastReviewed: existing.lastReviewed || null,
                    nextReview: existing.nextReview || null
                };
            });
            DeckManager.saveDeck(existingDeck);
            DeckManager.setCurrentDeck(existingDeck.id);

            renderDeckLibrary();
            return existingDeck;
        }
    }

    // Create new deck
    const newDeck = DeckManager.createDeckFromCards(fileName, cardsArray);

    renderDeckLibrary();
    initializeApp();
    return newDeck;
}

function handleUploadedFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    if (extension === "txt") {
        readTXT(file);
    }
    else if (extension === "docx") {
        readDOCX(file);
    }
    else if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
        readImage(file);
    }
    else {
        alert("Unsupported file type.");
    }
}

function readTXT(file){
    const reader = new FileReader();

    reader.onload = function(e) {
        const text = e.target.result;
        parseFlashcards(text);
    };

    reader.readAsText(file);
}

function readDOCX(file) {
    const reader = new FileReader();

    reader.onload = function(e) {
        mammoth.convertToHtml({ arrayBuffer: e.target.result }).then(function(result) {
            const text = result.value.replace(/<[^>]*>/g, "").replace(/\n\s*\n/g, "\n"); // strip html

            parseFlashcards(text);
        });
    };

    reader.readAsArrayBuffer(file);
}

function readImage(file) {
    const reader = new FileReader();

    reader.onload = function(e) {
        const imageData = e.target.result;

        cardsData = [{
            id: 0,
            front: `<img src="${imageData}" style="max-width:100%">`,
            back: "Describe this image"
        }];
    };

    reader.readAsDataURL(file);
}

// Call this when creating a new deck
function onCreateDeck(deckName) {
    const newDeck = DeckManager.createDeck(deckName, []);
    return newDeck;
}

// Call this after Learn mode session
function onLearnSessionComplete(correct, incorrect) {
    const currentDeckId = DeckManager.getCurrentDeckId();
    if (!currentDeckId) return;

    const totalCards = correct + incorrect;
    ProgressTracker.recordSession(currentDeckId, totalCards, correct, incorrect);

    // Update each card's progress
    learnAskedQuestions.forEach(cardId => {
        // You'll need to track which cards were correct/incorrect
        // This is a simplified version
        ProgressTracker.updateCardProgress(currentDeckId, cardId, true);
    });
}

// Call this after Test mode
function onTestComplete(results) {
    const currentDeckId = DeckManager.getCurrentDeckId();
    if (!currentDeckId) return;

    const correct = results.filter(r => r.is_correct).length;
    const incorrect = results.filter(r => !r.is_correct).length;

    ProgressTracker.recordSession(currentDeckId, results.length, correct, incorrect);

    // Update individual card progress
    results.forEach((result, index) => {
        ProgressTracker.updateCardProgress(currentDeckId, index, result.is_correct);
    });
}

// Get cards that need review (for future SRS implementation)
function getCardsForReview(deckId) {
    const deck = DeckManager.getDeck(deckId);
    if (!deck) return [];

    const now = new Date().toISOString();
    return deck.cards.filter(card => {
        return !card.nextReview || card.nextReview <= now;
    });
}

// Initialize on page load
function initializeStorage() {
    console.log('📦 Initializing localStorage...');

    // Load last active deck if exists
    const currentDeckId = DeckManager.getCurrentDeckId();
    if (currentDeckId) {
        const deckData = DeckManager.getDeck(currentDeckId);
        if (deckData) {
            console.log('📚 Loading last deck:', deckData.name);
            // Convert deck data to cardsData format
            cardsData = deckData.cards.map((card, index) => ({
                ...card,
                id: index,
                front: card.question,
                back: card.answer
            }));

            deck = deckData.cards.map(card => ({
                question: card.question,
                answer: card.answer
            }));
            deck.name = deckData.name;

            // Show the deck
            if (cardsData.length > 0) {
                initializeApp();
            }
        }
    }

    console.log('✓ Storage initialized');
}

// Export stats for display
function getStatsForDisplay() {
    const globalStats = ProgressTracker.getGlobalStats();
    const currentDeckId = DeckManager.getCurrentDeckId();
    const currentDeck = currentDeckId ? DeckManager.getDeck(currentDeckId) : null;

    return {
        global: globalStats,
        currentDeck: currentDeck ? currentDeck.stats : null,
        streakDays: globalStats.streakDays,
        accuracy: globalStats.totalCorrect + globalStats.totalIncorrect > 0
            ? Math.round((globalStats.totalCorrect / (globalStats.totalCorrect + globalStats.totalIncorrect)) * 100)
            : 0
    };
}


// ============================================================================
// DOM ELEMENTS
// ============================================================================
// Upload elements
const uploadSection = document.getElementById('upload-section');
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');

// Mode selector
const modeSelector = document.getElementById('mode-selector');
const flashcardModeBtn = document.getElementById('flashcard-mode-btn');
const learnModeBtn = document.getElementById('learn-mode-btn');
const testModeBtn = document.getElementById('test-mode-btn');
const editModeBtn = document.getElementById('edit-mode-btn');
const libraryBtn = document.getElementById('library-btn');

const flashcardModeContainer = document.getElementById('flashcard-mode-container');
const learnModeContainer = document.getElementById('learn-mode-container');
const testModeContainer = document.getElementById('test-mode-container');
const editorModeContainer = document.getElementById('editorMode');
const statsSection = document.getElementById('stats-section');

// Flashcard mode elements
const cardElement = document.getElementById('flashcard');
const frontElement = document.getElementById('card-front');
const backElement = document.getElementById('card-back');
const cardScene = document.getElementById('card-scene');
const navHints = document.getElementById('nav-hints');
const flashcardControls = document.getElementById('flashcard-controls');
const previewToggle = document.getElementById('preview-toggle-btn');
const previewList = document.getElementById('preview-list');

// Learn mode elements
const learnCard = document.getElementById('learn-card');
const learnQuestion = document.getElementById('learn-question');
const learnInputSection = document.getElementById('learn-input-section');
const learnAnswerInput = document.getElementById('learn-answer-input');
const learnSubmitBtn = document.getElementById('learn-submit-btn');
const learnFeedback = document.getElementById('learn-feedback');
const learnSkipBtn = document.getElementById('learn-skip-btn');
const learnRestartBtn = document.getElementById('learn-restart-btn');
const learnStatsCorrect = document.getElementById('learn-correct');
const learnStatsIncorrect = document.getElementById('learn-incorrect');
const learnStats = document.getElementById('learn-stats');
const learnStatsIncorrectCard = document.getElementById('learn-stats-incorrect');

// Test mode elements
const testSetup = document.getElementById('test-setup');
const numQuestionsInput = document.getElementById('num-questions');
const startTestBtn = document.getElementById('start-test-btn');
const testContainer = document.getElementById('test-container');
const submitSection = document.getElementById('submit-section');
const submitTestBtn = document.getElementById('submit-test-btn');
const resultsContainer = document.getElementById('results-container');

// Common elements
const currentIndexElement = document.getElementById('current-index');
const totalCardsElement = document.getElementById('total-cards');
const progressElement = document.getElementById('progress-percent');

// Flashcard mode buttons
const flipBtn = document.getElementById('flip-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const shuffleBtn = document.getElementById('shuffle-btn');

// Library elements
const libraryFileInput = document.getElementById('library-file-input');
const libraryModal = document.getElementById('deck-library-modal');

// Create deck elements
const createDeck = document.getElementById('create-deck');
const createSetBtn = document.getElementById("create-set-btn");

// === Edit History (Undo/Redo) ===
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

const __historyPast = [];   // stack of deck states BEFORE current
const __historyFuture = []; // stack for redo
const __HISTORY_LIMIT = 200;

function __deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

function __beginAction() {
    __historyPast.push(__deepCopy(deck));
    if (__historyPast.length > __HISTORY_LIMIT) __historyPast.shift();
    __historyFuture.length = 0;           // new branch: clear redo chain
    hasUnsavedChanges = true;             // your flag
    __updateUndoRedoButtons();
    scheduleAutoSave();
}

function __undo() {
    if (!__historyPast.length) return;
    __historyFuture.push(__deepCopy(deck));
    deck = __historyPast.pop();
    __renderEditorCardsPatched();
    __updateUndoRedoButtons();
}

function __redo() {
    if (!__historyFuture.length) return;
    __historyPast.push(__deepCopy(deck));
    deck = __historyFuture.pop();
    __renderEditorCardsPatched();
    __updateUndoRedoButtons();
}

function __updateUndoRedoButtons() {
    if (!undoBtn || !redoBtn) return;
    undoBtn.disabled = __historyPast.length === 0;
    redoBtn.disabled = __historyFuture.length === 0;
    if (undoBtn.disabled) hasUnsavedChanges = false;
}

// Ensure stable IDs on deck items (needed for reorder)
function __ensureDeckIds() {
    deck.forEach(d => { if (!d.id) d.id = (crypto?.randomUUID?.() || ('id_' + Math.random().toString(36).slice(2))); });
}

// ============================================================================
// DECK LIBRARY UI FUNCTIONS
// ============================================================================
let lastMode = '';

// Open the deck library modal
function openDeckLibrary() {
    deactivateAllModeButtons();

    libraryBtn.classList.add("active");

    libraryModal.classList.add('show');
    libraryModal.scrollTop = 0;

    lastMode = currentMode;

    testModeBtn.click();
    testContainer.classList.add('hidden');
    testModeBtn.classList.remove("active");
    libraryBtn.classList.add("active");

    testModeBtn.click();
    testContainer.classList.add('hidden');
    testModeBtn.classList.remove("active");
    libraryBtn.classList.add("active");

    renderDeckLibrary();
    updateStatsDashboard();
}

// Close the deck library modal
function closeDeckLibrary() {
    libraryModal.classList.remove('show');

    if (currentMode != 'createNewDeck') {
        if (lastMode === 'flashcard') {
            flashcardModeBtn.click();
        } else if (lastMode === 'learn') {
            learnModeBtn.click();
        } else if (lastMode === 'test') {
            testModeBtn.click();
        } else if (lastMode === 'editor') {
            editModeBtn.click();
        }
    }

    if (uploadSection.style.display !== "none") {
        hideFlashcardMode();
        statsSection.style.display = "none";
    }
}

// Upload a new deck from the library
function uploadNewDeck() {
    closeDeckLibrary();

    // Trigger the hidden file input
    if (libraryFileInput) {
        libraryFileInput.click();
    }
}

// Create a new deck from the library
function createNewDeck() {
    closeDeckLibrary();
    currentMode = 'createNewDeck';

    statsSection.classList.add('hidden');

    // Prompt for deck name
    const deckName = prompt('Enter a name for your new flashcard deck:', 'my-flashcards');
    if (!deckName) return;

    // Create empty deck
    const newDeck = DeckManager.createDeck(deckName, []);

    DeckManager.saveDeck(newDeck);
    DeckManager.setCurrentDeck(newDeck.id);

    renderDeckLibrary();

    // Clear current data
    cardsData = [];
    deck = [];
    deck.name = deckName;

    flashcardModeBtn.click();
    hideFlashcardMode();
    statsSection.style.display = 'none';

    // Show create deck UI
    showCreateDeck();
}

// Render all decks in the library
function renderDeckLibrary() {
    const deckList = document.getElementById('deck-list');
    const emptyMessage = document.getElementById('empty-deck-list');
    const decks = DeckManager.getAllDecks();
    const currentDeckId = DeckManager.getCurrentDeckId();

    if (decks.length === 0) {
        deckList.innerHTML = '';
        emptyMessage.style.display = 'block';
        return;
    }

    emptyMessage.style.display = 'none';

    deckList.innerHTML = decks.map(deck => {
        const isActive = deck.id === currentDeckId;
        const cardCount = deck.cards.length;
        const accuracy = deck.stats.accuracy.toFixed(0);
        const lastModified = new Date(deck.lastModified).toLocaleDateString();

        // Calculate cards due for review
        const now = new Date().toISOString();
        const dueCards = deck.cards.filter(card => {
            return !card.nextReview || card.nextReview <= now;
        }).length;

        return `
    <div class="deck-item ${isActive ? 'active' : ''}" onclick="loadDeckFromLibrary('${deck.id}')">
        <div class="deck-item-header">
            <div class="deck-name">${deck.name}</div>
            <div class="deck-actions">
                <button class="deck-action-btn" onclick="event.stopPropagation(); renameDeck('${deck.id}')">✏️</button>
                <button class="deck-action-btn delete" onclick="event.stopPropagation(); deleteDeckConfirm('${deck.id}')">🗑️</button>
            </div>
        </div>
        <div class="deck-info">
            <div class="deck-stat">📝 ${cardCount} cards</div>
            <div class="deck-stat">✅ ${accuracy}% accuracy</div>
            <!--${dueCards > 0 ? `<div class="deck-stat">⏰ ${dueCards} due</div>` : ''}-->
            <div class="deck-stat">📅 ${lastModified}</div>
        </div>
    </div>
`;
    }).join('');
}

// Update the stats dashboard
function updateStatsDashboard() {
    const stats = getStatsForDisplay();
    const todayEntry = stats.global.studyHistory.find(d => d.date === getTodayDateString());

    //totalCardsElement.textContent = stats.global.totalCardsStudied;
    //document.getElementById('stat-accuracy').textContent = stats.accuracy + '%';
    //document.getElementById('stat-sessions').textContent = stats.global.totalSessions;
    //document.getElementById('streak-days').textContent = stats.streak;

    document.getElementById('stat-total-cards').textContent = todayEntry ? todayEntry.cardsStudied : 0;
    document.getElementById('stat-accuracy').textContent = getTodayAccuracy() + '%';
    //document.getElementById('stat-sessions').textContent = stats.global.totalSessions;
    document.getElementById('streak-days').textContent = stats.streakDays;
    
    renderAccuracyGraph();
}

function renderAccuracyGraph() {
    const canvas = document.getElementById('accuracy-graph');
    const emptyMsg = document.getElementById('accuracy-graph-empty');
    if (!canvas) return;

    const stats = ProgressTracker.getGlobalStats();
    const streakDays = Math.max(7, stats.streakDays || 0);

    // Build list of last streakDays dates
    const dates = [];
    for (let i = streakDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }

    // Map dates to accuracy values (null if no data that day)
    const dataPoints = dates.map(date => {
        const entry = stats.studyHistory.find(h => h.date === date);
        if (!entry || entry.cardsStudied === 0) return null;
        return Math.round((entry.correct / entry.cardsStudied) * 100);
    });

    const hasAnyData = dataPoints.some(v => v !== null);
    if (!hasAnyData) {
        canvas.style.display = 'none';
        emptyMsg.style.display = 'block';
        return;
    }
    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';

    // Size canvas correctly using offsetWidth (avoids rect scaling issues)
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || canvas.parentElement.clientWidth || 600;
    const H = 120;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padL = 36;
    const padR = 16;
    const padT = 16;
    const padB = 28;

    const graphW = W - padL - padR;
    const graphH = H - padT - padB;
    const n = dataPoints.length;

    function ptX(i) {
        return padL + (i / (n - 1)) * graphW;
    }
    function ptY(v) {
        return padT + graphH - (v / 100) * graphH;
    }

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 10);
    ctx.fill();

    // Gridlines at 0%, 50%, 100%
    [0, 25, 50, 75, 100].forEach(pct => {
        const y = padT + graphH - (pct / 100) * graphH;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + graphW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '10px Outfit, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(pct + '%', padL - 4, y + 3.5);
    });

    // X-axis date labels (first, middle, last)
    const labelIndices = new Set([0, Math.floor((n - 1) / 2), n - 1]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    dates.forEach((date, i) => {
        if (!labelIndices.has(i)) return;
        ctx.fillText(date.slice(5), ptX(i), H - 6);
    });

    // Gradient fill under line
    const gradientFill = ctx.createLinearGradient(0, padT, 0, padT + graphH);
    gradientFill.addColorStop(0, 'rgba(78, 205, 196, 0.45)');
    gradientFill.addColorStop(1, 'rgba(78, 205, 196, 0.02)');

    // Fill path (treat nulls as 0 for fill only)
    ctx.beginPath();
    dataPoints.forEach((v, i) => {
        const val = v !== null ? v : 0;
        i === 0 ? ctx.moveTo(ptX(i), ptY(val)) : ctx.lineTo(ptX(i), ptY(val));
    });
    ctx.lineTo(ptX(n - 1), padT + graphH);
    ctx.lineTo(ptX(0), padT + graphH);
    ctx.closePath();
    ctx.fillStyle = gradientFill;
    ctx.fill();

    // Line (skip null gaps)
    ctx.beginPath();
    ctx.strokeStyle = '#4ecdc4';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let inLine = false;
    dataPoints.forEach((v, i) => {
        if (v === null) {
            inLine = false;
            return;
        }
        if (!inLine) {
            ctx.moveTo(ptX(i), ptY(v));
            inLine = true;
        }
        else {
            ctx.lineTo(ptX(i), ptY(v));
        }
    });
    ctx.stroke();

    // Dots
    dataPoints.forEach((v, i) => {
        if (v === null) {
            return;
        }
        ctx.beginPath();
        ctx.arc(ptX(i), ptY(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '4ecdc4';
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    ctx.restore();

    // Store data for hover
    canvas._graphData = { dataPoints, dates, padL, padT, graphW, graphH, n, W, H, dpr };

    canvas.onmousemove = function(e) {
        const { dataPoints, dates, padL, padT, graphW, graphH, n, W, H, dpr } = canvas._graphData;

        // offsetX/offsetY are already in CSS pixels — no DPR correction needed
        const mx = e.offsetX;
        const my = e.offsetY;

        // Find nearest data point horizontally
        let closest = -1, minDist = 999;
        dataPoints.forEach((v, i) => {
            if (v === null) return;
            const x = padL + (i / (n - 1)) * graphW;
            const dist = Math.abs(mx - x);
            if (dist < minDist) { minDist = dist; closest = i; }
        });

        renderAccuracyGraph();
        if (closest === -1 || minDist > graphW / n) return;

        const v = dataPoints[closest];
        const x = padL + (closest / (n - 1)) * graphW;
        const y = padT + graphH - (v / 100) * graphH;

        const ctx2 = canvas.getContext('2d');
        ctx2.save();
        ctx2.scale(dpr, dpr);

        // Highlighted dot
        ctx2.beginPath();
        ctx2.arc(x, y, 6, 0, Math.PI * 2);
        ctx2.fillStyle = '#4ecdc4';
        ctx2.fill();
        ctx2.strokeStyle = '#fff';
        ctx2.lineWidth = 2;
        ctx2.stroke();

        // Tooltip
        const label = `${dates[closest].slice(5)}: ${v}%`;
        ctx2.font = 'bold 12px Outfit, sans-serif';
        const tw = ctx2.measureText(label).width;
        const boxW = tw + 16;
        const boxH = 22;

        // Keep tooltip inside canvas, flip below dot if too close to top
        let tx = x - boxW / 2;
        tx = Math.max(2, Math.min(tx, W - boxW - 2));
        let ty = y - boxH - 8;
        if (ty < 2) ty = y + 12;

        ctx2.fillStyle = 'rgba(20,20,50,0.92)';
        ctx2.beginPath();
        ctx2.roundRect(tx, ty, boxW, boxH, 6);
        ctx2.fill();
        ctx2.fillStyle = '#fff';
        ctx2.fillText(label, tx + 8, ty + 15);

        ctx2.restore();
    };

    canvas.onmouseleave = function() {
        renderAccuracyGraph();
    };
}

// Load a deck from the library
function loadDeckFromLibrary(deckId) {
    const deckData = DeckManager.getDeck(deckId);
    if (!deckData) {
        alert('Deck not found!');
        return;
    }

    // Set as current deck
    DeckManager.setCurrentDeck(deckId);

    // Convert to app format
    cardsData = deckData.cards.map((card, index) => ({
        id: index,
        front: card.question,
        back: card.answer
    }));

    deck = deckData.cards.map(card => ({
        question: card.question,
        answer: card.answer
    }));
    deck.name = deckData.name;

    currentIndex = 0;

    const expanded = previewToggle.getAttribute("aria-expanded") === "true";

    if (expanded) previewToggle.click();

    // Close library and show the deck
    closeDeckLibrary();

    if (cardsData.length > 0) {
        flashcardModeBtn.click();
        initializeApp();
    }
}

// Rename a deck
function renameDeck(deckId) {
    const deckData = DeckManager.getDeck(deckId);
    if (!deckData) return;

    const newName = prompt('Enter new flashcard deck name:', deckData.name);
    if (!newName || newName === deckData.name) return;

    deckData.name = newName;
    DeckManager.saveDeck(deckData);
    renderDeckLibrary();
}

// Delete a deck with confirmation
function deleteDeckConfirm(deckId) {
    const deckData = DeckManager.getDeck(deckId);
    if (!deckData) return;

    const confirmed = confirm(`Are you sure you want to delete "${deckData.name}"?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    DeckManager.deleteDeck(deckId);

    // If this was the current deck, clear it
    if (DeckManager.getCurrentDeckId() === deckId) {
        DeckManager.setCurrentDeck(null);
        cardsData = [];
        deck = [];
    }

    renderDeckLibrary();
}

// Save current deck (to call when editing)
function saveCurrentDeck() {
    const currentDeckId = DeckManager.getCurrentDeckId();

    if (!currentDeckId) {
        // No current deck, prompt to create one
        const deckName = prompt('Save this deck as:', 'my-flashcards');
        if (!deckName) return;

        const newDeck = DeckManager.createDeckFromCards(deckName, cardsData);
        alert('✓ Deck saved!');
        return newDeck;
    }

    // Update existing deck
    saveCurrentDeckState();
    alert('✓ Deck updated!');
}

// Prompt to save deck when uploading file
function promptSaveDeck(fileName, cardsArray) {
    const save = confirm(`Save "${fileName}" to your deck library?`);
    if (save) {
        onFileUploaded(fileName, cardsArray);
        console.log('✓ Deck saved to library');
    }
}


// ============================================================================
// ONBOARDING LOGIC
// ============================================================================
const ONB_KEY = 'studyforgejs_onboarding_dismissed_v1';

const onbOverlay = document.getElementById('onboarding-overlay');
const onbHelpBtn = document.getElementById('onboarding-help');
const onbCloseBtn = document.getElementById('onboarding-close');

const onbPrev = document.getElementById('onb-prev');
const onbNext = document.getElementById('onb-next');
const onbDone = document.getElementById('onb-done');
const onbDontShow = document.getElementById('onb-dont-show');

const onbStepNum = 8;

let onbCurrentStep = 1;
const onbSteps = Array.from(document.querySelectorAll('.onb-step'));
const onbDots = Array.from(document.querySelectorAll('.onb-dot'));

function setOnbStep(step) {
    onbCurrentStep = Math.max(1, Math.min(onbStepNum, step));
    onbSteps.forEach(s => s.classList.toggle('hidden', Number(s.dataset.step) !== onbCurrentStep));
    onbDots.forEach(d => d.classList.toggle('onb-dot--active', Number(d.dataset.dot) === onbCurrentStep));

    onbPrev.disabled = (onbCurrentStep === 1);
    onbNext.classList.toggle('hidden', onbCurrentStep === onbStepNum);
    onbDone.classList.toggle('hidden', onbCurrentStep !== onbStepNum);

    // Manage initial focus for accessibility
    const firstFocusable = onbSteps[onbCurrentStep - 1].querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstFocusable) firstFocusable.focus({ preventScroll: true });
}

function openOnboarding(startAtStep = 1) {
    setOnbStep(startAtStep);
    onbOverlay.classList.remove('hidden');
    onbOverlay.setAttribute('aria-hidden', 'false');

    // trap focus (lightweight)
    document.addEventListener('keydown', onbKeyHandler);
}

function closeOnboarding() {
    if (onbDontShow.checked) {
        // persist preference
        localStorage.setItem(ONB_KEY, '1');
    }
    onbOverlay.classList.add('hidden');
    onbOverlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onbKeyHandler);

    // Return focus to Help button for accessible flow
    onbHelpBtn.focus({ preventScroll: true });
}

function onbKeyHandler(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        closeOnboarding();
    } else if ((e.key === 'Enter' || e.key === ' ') && !onbNext.classList.contains('hidden')) {
        // Enter/Space = Next (unless on last step)
        e.preventDefault();
        setOnbStep(onbCurrentStep + 1);
    } else if (e.key === 'ArrowRight') {
        setOnbStep(onbCurrentStep + 1);
    } else if (e.key === 'ArrowLeft') {
        setOnbStep(onbCurrentStep - 1);
    }
}

// Wire up controls
onbHelpBtn.addEventListener('click', () => openOnboarding(1));
onbCloseBtn.addEventListener('click', closeOnboarding);
onbPrev.addEventListener('click', () => setOnbStep(onbCurrentStep - 1));
onbNext.addEventListener('click', () => setOnbStep(onbCurrentStep + 1));
onbDone.addEventListener('click', closeOnboarding);

// Show on first visit (after initial layout is ready)
window.addEventListener('load', () => {
    const dismissed = localStorage.getItem(ONB_KEY) === '1';
    if (!dismissed) {
        openOnboarding(1);
    }
});

// ============================================================================
// FILE HANDLING
// ============================================================================

// Wait for DOM before attaching file input listener
document.addEventListener('DOMContentLoaded', function () {
    fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            fileNameContent = file.name;
            fileName.textContent = file.name;
            fileName.style.display = 'block';
            handleUploadedFile(file);
            /*
            const reader = new FileReader();
            reader.onload = function (event) {
                const content = event.target.result;
                parseFlashcards(content);
            };
            reader.onerror = function () {
                alert('Error reading file. Please try again.');
            };
            reader.readAsText(file);
            */
        }
    });
}); // End DOMContentLoaded for file input

let fileNameContent = "";

function parseFlashcards(content) {
    const lines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (lines.length < 2 || lines.length % 2 !== 0) {
        alert('Invalid file format. Make sure you have pairs of questions and answers.');
        return;
    }

    // RESET BOTH
    cardsData = [];
    deck = [];

    for (let i = 0; i < lines.length; i += 2) {
        const question = lines[i];
        const answer = lines[i + 1];

        // Study representation
        cardsData.push({ id: i / 2, front: question, back: answer });

        // Editor / save representation
        deck.push({ question, answer });
    }
    //deck.name = DeckManager.getDeck(DeckManager.getCurrentDeckId()).name;

    editorMode = "edit";
    hasUnsavedChanges = false;

    if (cardsData.length > 0) {
        // Prompt to save the deck to library
        const fileNameText = fileName?.textContent || 'Flashcards';
        promptSaveDeck(fileNameText, cardsData);
        fileName.textContent = fileNameText;
        initializeApp();
    }
}

function initializeApp() {
    uploadSection.style.display = 'none';
    modeSelector.style.display = 'flex';
    statsSection.style.display = 'flex';
    flashcardModeContainer.classList.remove('hidden');

    // CRITICAL FIX: Re-show ALL the flashcard UI elements that may have been hidden by showCreateDeck()
    const previewWrapper = document.querySelector('.preview-wrapper');

    if (cardScene) cardScene.style.display = 'block';
    if (navHints) navHints.style.display = 'flex';
    if (flashcardControls) flashcardControls.style.display = 'flex';
    if (createDeck) createDeck.style.display = 'none';  // Make sure create-deck is hidden

    // Re-show preview elements that were hidden in showCreateDeck
    if (previewWrapper) previewWrapper.classList.remove('hidden');
    if (previewToggle) {
        previewToggle.classList.remove('hidden');
        previewToggle.textContent = '▲ Show Flashcard Deck';
    }

    currentIndex = 0;
    showDeck(0);
    updateStats();

    numQuestionsInput.max = cardsData.length;
    numQuestionsInput.value = Math.min(10, cardsData.length);
    renderDeckPreview();
}

function deckToText() {
    return deck
        .map(card => `${card.question}\n${card.answer}`)
        .join("\n");
}

function saveDeckToFile() {
    const name = prompt("Deck name:", deck ? deck.name : "my-flashcards");
    if (!name) return;
    const filename = name.endsWith(".txt") ? name : `${name}.txt`;
    const text = deckToText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    hasUnsavedChanges = false;
    fileNameContent = filename;
}

// ============================================================================
// CREATE NEW FLASHCARD DECK
// ============================================================================
function backToFileSelect() {
    if (hasUnsavedChanges) {
        const confirmLeave = confirm("Are you sure you want to leave this page?\n\nAll unsaved progress will be lost.");
        if (!confirmLeave) { return; }
    }

    // Reset create-deck state
    deck = [];
    cardsData = [];
    hasUnsavedChanges = false;

    // Safe element access with null checks
    const questionInput = document.getElementById("questionInput");
    const answerInput = document.getElementById("answerInput");
    const cardCount = document.getElementById("cardCount");

    if (createDeck) createDeck.style.display = "none";
    if (flashcardModeContainer) flashcardModeContainer.classList.add("hidden");
    if (flashcardModeContainer) flashcardModeContainer.style.display = "none";
    if (modeSelector) modeSelector.style.display = "none";
    if (statsSection) statsSection.style.display = "none";
    if (testContainer) testContainer.style.display = "none";
    if (uploadSection) uploadSection.style.display = "block";

    if (fileName) {
        //fileName.textContent = "No file selected";
        fileName.style.display = "none";
    }

    if (createSetBtn) createSetBtn.style.display = "block";
    if (fileInput) fileInput.value = "";
    if (questionInput) questionInput.value = "";
    if (answerInput) answerInput.value = "";
    if (cardCount) cardCount.textContent = "0 cards";

    editorMode = "create";
}

function showCreateDeck() {
    currentMode = 'createNewDeck';
    editorMode = "create";

    // Hide startup UI
    uploadSection.style.display = "none";
    createSetBtn.style.display = "none";

    modeSelector.style.display = "none";

    // Show the parent container
    flashcardModeContainer.classList.remove("hidden");

    // Show create deck UI
    createDeck.style.display = "block";

    // Hide the actual flashcard scene for now
    cardScene.style.display = "none";
    navHints.style.display = "none";
    flashcardControls.style.display = "none";

    learnModeContainer.style.display = "none";
    testContainer.style.display = "none";
    testModeContainer.style.display = "none";

    // Hide the preview button (and optionally the list)
    const previewWrapper = document.querySelector('.preview-wrapper');

    if (previewToggle) previewToggle.classList.add('hidden');
    if (previewWrapper) previewWrapper.classList.add('hidden'); // hide the whole preview UI

}

function addCard() {
    const question = document.getElementById("questionInput").value.trim();
    const answer = document.getElementById("answerInput").value.trim();

    if (!question || !answer) {
        alert("Please enter both a question and an answer.");
        return;
    }

    deck.push({ question, answer });
    hasUnsavedChanges = true; // Mark unsaved
    document.getElementById("questionInput").value = "";
    document.getElementById("answerInput").value = "";
    document.getElementById("cardCount").textContent =
        `${deck.length} Card${deck.length === 1 ? "" : "s"}`;
    scheduleAutoSave();
}

function startDeck() {
    if (!deck || deck.length === 0) return alert("Add at least one card first");

    // Merge manually created deck into cardsData
    cardsData = deck.map((card, index) => ({
        id: index,
        front: card.question,
        back: card.answer
    }));

    promptSaveDeck(fileNameContent, cardsData);

    uploadSection.style.display = "none";
    createDeck.style.display = "none";

    // show study UI
    statsSection.classList.remove('hidden');
    flashcardModeContainer.classList.remove("hidden");

    // Show study UI
    flashcardModeContainer.classList.remove("hidden");
    modeSelector.style.display = "flex";
    statsSection.style.display = "flex";
    cardScene.style.display = "flex";
    navHints.style.display = "flex";
    flashcardControls.style.display = "flex";

    // Initialize stats
    currentIndex = 0;
    showDeck(0);
    updateStats();
    hasUnsavedChanges = false;
    renderDeckPreview();

    const previewWrapper = document.querySelector('.preview-wrapper');

    if (previewToggle) previewToggle.classList.remove('hidden');
    if (previewWrapper) previewWrapper.classList.remove('hidden');
    
    flashcardModeBtn.click();

    initializeApp();
}

// ============================================================================
// EDIT CURRENT SET
// ============================================================================
function editCurrentSet() {
    hideFlashcardMode();

    // If deck is empty but we have cardsData, build deck from it
    if (!deck.length && cardsData.length) {
        deck = cardsData.map(c => ({ question: c.front, answer: c.back }));
    }
    if (!deck.length) {
        alert("No deck loaded to edit.");
        return;
    }

    editorMode = "edit";
    currentMode = "editor";
    hasUnsavedChanges = false;

    // Hide study/test UIs
    flashcardModeContainer.classList.add("hidden");
    learnModeContainer.classList.add("hidden");
    testModeContainer.classList.add("hidden");
    statsSection.style.display = "none";

    // Activate only the visible mode button
    deactivateAllModeButtons();
    editModeBtn.classList.add("active");

    // Show editor
    editorModeContainer.style.display = "block";
    renderEditorCards();

    __historyPast.length = 0;
    __historyFuture.length = 0;
    __updateUndoRedoButtons();
}

function addEmptyEditCard() {
    __ensureDeckIds();
    __beginAction();
    deck.push({ id: crypto.randomUUID(), question: "", answer: "" });
    renderEditorCards(); // alias points to patched renderer
}

// === Patched renderer (adds drag handle + events) ===
function __renderEditorCardsPatched() {
    __ensureDeckIds();
    const container = document.getElementById("editorCards");
    if (!container) return;
    container.innerHTML = "";

    const frag = document.createDocumentFragment();

    deck.forEach((card) => {
        const row = document.createElement("div");
        row.className = "editor-card";
        row.setAttribute("draggable", "true");
        row.dataset.id = card.id;

        const handle = document.createElement("button");
        handle.className = "drag-handle";
        handle.type = "button";
        handle.title = "Drag to reorder";
        handle.setAttribute("aria-label", "Drag to reorder");
        handle.textContent = "⠿";

        const q = document.createElement("textarea");
        q.className = "editor-question";
        q.placeholder = "Question";
        q.value = card.question || "";

        const a = document.createElement("textarea");
        a.className = "editor-answer";
        a.placeholder = "Answer";
        a.value = card.answer || "";

        const del = document.createElement("button");
        del.className = "editor-delete";
        del.type = "button";
        del.title = "Delete card";
        del.innerHTML = "<strong>🗑️</strong>";

        // Input: push to history on change (blur/commit), not every keystroke
        q.addEventListener("change", () => { __beginAction(); card.question = q.value; });
        a.addEventListener("change", () => { __beginAction(); card.answer = a.value; });

        // Delete
        del.addEventListener("click", () => {
            if (!confirm("Delete this card?")) return;
            __beginAction();
            const idx = deck.findIndex(d => d.id === card.id);
            if (idx !== -1) deck.splice(idx, 1);
            __renderEditorCardsPatched();
        });

        // Keyboard reorder on the handle
        handle.addEventListener("keydown", (e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const curr = deck.findIndex(d => d.id === card.id);
            const dir = e.key === "ArrowUp" ? -1 : 1;
            const next = curr + dir;
            if (next < 0 || next >= deck.length) return;
            __beginAction();
            const [moved] = deck.splice(curr, 1);
            deck.splice(next, 0, moved);
            __renderEditorCardsPatched();
            // restore focus to moved handle
            const newHandle = container.querySelector(`[data-id="${card.id}"] .drag-handle`);
            newHandle?.focus();
        });

        // Drag & Drop (row)
        row.addEventListener("dragstart", (e) => {
            row.classList.add("dragging");
            e.dataTransfer.setData("text/plain", card.id);
            e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
            container.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        });

        // Build row
        row.appendChild(handle);
        row.appendChild(q);
        row.appendChild(a);
        row.appendChild(del);
        frag.appendChild(row);
    });

    container.appendChild(frag);
}

// Alias so existing calls still work without rewriting your code
const renderEditorCards = __renderEditorCardsPatched;

// Container-level drag handlers (compute before/after by pointer Y)
(function setupEditorDnD() {
    const container = document.getElementById("editorCards");
    if (!container) return;

    container.addEventListener("dragover", (e) => {
        e.preventDefault();
        const row = e.target.closest(".editor-card");
        if (!row) return;
        container.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        row.classList.add("drag-over");
    });

    container.addEventListener("drop", (e) => {
        e.preventDefault();
        const row = e.target.closest(".editor-card");
        container.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        const draggedId = e.dataTransfer.getData("text/plain");
        if (!draggedId || !row) return;

        const toId = row.dataset.id;
        const fromIdx = deck.findIndex(d => d.id === draggedId);
        const toIdx = deck.findIndex(d => d.id === toId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

        const rect = row.getBoundingClientRect();
        const insertAfter = e.clientY > rect.top + rect.height / 2;
        let insertIdx = toIdx + (insertAfter ? 1 : 0);
        if (insertIdx > fromIdx) insertIdx--; // adjust for removal

        __beginAction();
        const [moved] = deck.splice(fromIdx, 1);
        deck.splice(insertIdx, 0, moved);
        __renderEditorCardsPatched();
    });
})();

function addEditCard() {
    const questionInput = document.getElementById("questionInput");
    const answerInput = document.getElementById("answerInput");
    const question = questionInput.value.trim();
    const answer = answerInput.value.trim();
    if (!question || !answer) return;
    deck.push({ question, answer });
    hasUnsavedChanges = true;
    questionInput.value = "";
    answerInput.value = "";
    renderEditorCards();
}

function saveDeck() {
    const editorCards = document.querySelectorAll(".editor-card");
    const name = deck.name;

    deck = [];
    cardsData = [];

    editorCards.forEach((card, index) => {
        const q = card.querySelector(".editor-question").value.trim();
        const a = card.querySelector(".editor-answer").value.trim();
        if (!q || !a) return;

        deck.push({ question: q, answer: a });
        cardsData.push({ id: index, front: q, back: a });
    });

    deck.name = name;

    hasUnsavedChanges = false;
    editorMode = "edit";

    saveDeckToFile();

    // Refresh UI with rebuilt cardsData
    //editorModeContainer.style.display = "none";
    //initializeApp();
    //renderDeckPreview();
    //deactivateAllModeButtons();
    //flashcardModeBtn.classList.add("active");
    //flashcardModeBtn.click();
}

function returnToStudy() {
    if (hasUnsavedChanges) {
        const confirmLeave = confirm("You have unsaved changes. Save before returning?");
        if (confirmLeave) saveDeck();
    }
    // Hide editor
    editorModeContainer.style.display = "none";

    // Show flashcards
    flashcardModeContainer.classList.remove("hidden");

    // Restore stats
    statsSection.style.display = "flex";

    // Reset mode buttons
    deactivateAllModeButtons();
    flashcardModeBtn.classList.add("active");
    flashcardModeBtn.click();

    // Reset card state using cardsData for consistency
    currentIndex = 0;
    showDeck(0);
    updateStats();
    renderDeckPreview();

    // Ensure preview UI is back if you want it in Flashcards
    const previewWrapper = document.querySelector('.preview-wrapper');
    if (previewWrapper) previewWrapper.classList.remove('hidden');

    // Make sure Flashcard containers are visible
    flashcardModeContainer?.classList.remove('hidden');
    flashcardModeContainer.style.display = ''; // reset inline styles if any

    // Show mode selector and stats (your app shows these in study modes)
    modeSelector?.style.removeProperty('display');
    statsSection?.style.removeProperty('display');

    // Also ensure the “upload” / “editor” sections are hidden again
    editorModeContainer?.style.setProperty('display', 'none');
    uploadSection?.style.setProperty('display', 'none');
}

function leaveEditorIfOpen(next) {
    const isOpen = editorModeContainer && editorModeContainer.style.display !== "none";

    if (!isOpen) {
        next();
        return;
    }

    // Editor is open 
    if (hasUnsavedChanges) {
        const doSave = confirm("You have unsaved changes. Save before switching modes?");
        if (doSave) {
            // saveDeck() rebuilds cardsData and closes the editor via initializeApp()
            // We want to just close the editor view and then go to the next mode,
            // so we save, then explicitly hide the editor and continue.
            saveDeck(); // this resets hasUnsavedChanges = false
        } else {
            // Discard changes
            for (i = 0; i < __historyPast.length; i++) {
                __undo();
            }
            // Discard and hide editor
            hasUnsavedChanges = false;
        }
    }

    // Ensure editor is hidden and stats visible state is controlled by the next() mode
    editorModeContainer.style.display = "none";
    // Clear active state on buttons; let next() set the right one
    deactivateAllModeButtons();
    next();
}

function deleteCard(index) {
    if (!confirm("Delete this card?")) return;
    __beginAction();
    deck.splice(index, 1);
    renderEditorCards();
}

// ============================================================================
// DECK PREVIEW
// ============================================================================

function renderDeckPreview() {
    // Null check - return early if element doesn't exist
    if (!previewList) {
        return;
    }

    previewList.innerHTML = "";

    if (!cardsData || cardsData.length === 0) {
        return;
    }

    cardsData.forEach(card => {
        const row = document.createElement("div");
        row.className = "preview-row";

        row.innerHTML = `
    <div class="preview-card question">
        <strong>Q</strong>
        <div>${card.front}</div>
    </div>
    <div class="preview-card answer">
        <strong>A</strong>
        <div>${card.back}</div>
    </div>
`;

        previewList.appendChild(row);
    });
}

// ============================================================================
// MODE SWITCHING
// ============================================================================
function hideFlashcardMode() {
    flashcardModeContainer.classList.add('hidden');
    flashcardModeBtn.classList.remove("active");

    const previewExpanded = previewToggle.getAttribute("aria-expanded") === "true";
    // Collapse the preview when leaving flashcard mode
    if (previewToggle && previewList && previewExpanded) {
        togglePreview();
    }
    previewToggle.textContent = `▲ Show Flashcard Deck`;
}

function switchToFlashcardMode() {
    leaveEditorIfOpen(() => {
        currentMode = 'flashcard';
        editorMode = 'create';

        statsSection.style.display = "flex";

        // Activate only the visible mode button
        deactivateAllModeButtons();
        flashcardModeBtn.classList.add("active");

        // Show/Hide containers
        flashcardModeContainer.classList.remove('hidden');
        learnModeContainer.classList.add('hidden');
        testModeContainer.classList.add('hidden');

        // Stats
        statsSection.classList.remove('hidden');

        // Learn stats cards hidden in flashcards
        document.getElementById('learn-stats').style.display = 'none';
        document.getElementById('learn-stats-incorrect').style.display = 'none';

        // Ensure a card is visible
        if (cardsData.length) { showDeck(currentIndex || 0); }
    });
}

function switchToLearnMode() {
    leaveEditorIfOpen(() => {
        currentMode = 'learn';

        // Activate only the visible mode button
        deactivateAllModeButtons();
        learnModeBtn.classList.add('active');

        learnModeContainer.classList.remove('hidden');
        flashcardModeContainer.classList.add('hidden');
        testModeContainer.classList.add('hidden');

        statsSection.classList.remove('hidden');
        learnStats.style.display = 'block';
        learnStatsIncorrectCard.style.display = 'block';

        startLearnMode();
    });

    hideFlashcardMode();
    statsSection.style.display = 'flex';
    learnStatsIncorrectCard.style.display = 'block';
}

function switchToTestMode() {
    leaveEditorIfOpen(() => {
        currentMode = 'test';

        // Activate only the visible mode button
        deactivateAllModeButtons();

        testModeBtn.classList.add('active');
        testModeContainer.classList.remove('hidden');
        testModeContainer.style.display = 'block';

        flashcardModeContainer.classList.add('hidden');
        learnModeContainer.classList.add('hidden');

        statsSection.classList.add('hidden');

        // Reset test state
        testSetup.classList.remove('hidden');
        submitSection.classList.add('hidden');
        resultsContainer.classList.add('hidden');
        testContainer.classList.add('hidden');
        testContainer.innerHTML = '';
        userAnswers = {};
    });
    // Set default number of test questions
    numQuestionsInput.value = deck.length;
    numQuestionsInput.max = deck.length;

    hideFlashcardMode();
}

function deactivateAllModeButtons() {
    document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
}

flashcardModeBtn.addEventListener('click', switchToFlashcardMode);
learnModeBtn.addEventListener('click', switchToLearnMode);
testModeBtn.addEventListener('click', switchToTestMode);

// ============================================================================
// FLASHCARD MODE FUNCTIONS
// ============================================================================
function showDeck(index) {
    if (!cardsData.length || cardsData.length === 0) return;
    if (!frontElement || !backElement || !cardElement) return;

    let card;

    currentIndex = ((index % cardsData.length) + cardsData.length) % cardsData.length;
    card = cardsData[currentIndex];

    showCard(index, card);

    cardElement.classList.remove('is-flipped');
    updateStats();
    renderDeckPreview();
}

function showCard(index, card='') {
    if (card === '') {card = cardsData[index];}
    
    frontElement.textContent = card.front;
    backElement.textContent = card.back;
}

function updateStats() {
    if (!currentIndexElement || !totalCardsElement || !progressElement) return;

    currentIndexElement.textContent = currentIndex + 1;

    totalCardsElement.textContent = cardsData.length;
    const progress = cardsData.length > 0
        ? Math.round(((currentIndex + 1) / cardsData.length) * 100)
        : 0;
    progressElement.textContent = `${progress}%`;
}

function nextCard() { showDeck(currentIndex + 1); }
function previousCard() { showDeck(currentIndex - 1); }
function flipCard() { cardElement.classList.toggle('is-flipped'); }

function shuffleDeck() {
    // Fisher-Yates shuffle
    for (let i = cardsData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardsData[i], cardsData[j]] = [cardsData[j], cardsData[i]];
    }
    // Reassign IDs
    cardsData.forEach((card, idx) => card.id = idx);
    currentIndex = 0;
    showDeck(0);
}

// ============================================================================
// LEARN MODE FUNCTIONS
// ============================================================================
function startLearnMode() {
    learnQuestions = [...cardsData];
    learnCurrentIndex = 1;
    learnCorrect = 0;
    learnIncorrect = 0;
    learnAskedQuestions = new Set();
    updateLearnStats();
    showNextLearnQuestion();

    document.getElementById('learn-control-buttons').style.display = 'flex';
    currentIndexElement.textContent = 1;
}

function showNextLearnQuestion() {
    if (learnAskedQuestions.size >= learnQuestions.length) {
        showLearnComplete();
        return;
    }
    let question;
    do {
        const randomIndex = Math.floor(Math.random() * learnQuestions.length);
        question = learnQuestions[randomIndex];
    } while (learnAskedQuestions.has(question.id));

    currentLearnQuestion = question;
    learnQuestion.textContent = question.front;
    learnAnswerInput.value = '';
    learnAnswerInput.disabled = false;
    learnSubmitBtn.disabled = false;
    learnFeedback.classList.add('hidden');
    learnInputSection.style.display = 'flex';
    learnAnswerInput.focus();
    updateLearnStats();
    if (learnAskedQuestions.size > 0) {
        currentIndexElement.textContent = learnCurrentIndex;
    }
}

function checkLearnAnswer() {
    const userAnswer = learnAnswerInput.value.trim();
    const correctAnswer = currentLearnQuestion.back.trim();
    const isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();

    learnAnswerInput.disabled = true;
    learnSubmitBtn.disabled = true;

    if (isCorrect) {
        learnCorrect++;
        learnCurrentIndex++;
        learnAskedQuestions.add(currentLearnQuestion.id);
        showLearnFeedback(true, correctAnswer);
        setTimeout(() => { showNextLearnQuestion(); }, 1500);
    } else {
        learnIncorrect++;
        showLearnFeedback(false, correctAnswer, userAnswer);
    }
    updateLearnStats();
    recordAnswer(isCorrect);

}

function showLearnFeedback(isCorrect, correctAnswer, userAnswer = '') {
    learnFeedback.classList.remove('hidden', 'correct', 'incorrect');
    if (isCorrect) {
        learnFeedback.classList.add('correct');
        learnFeedback.innerHTML = `
    <div style="font-size:48px; margin-bottom:10px;">✅</div>
    <div>Correct!</div>
`;
    } else {
        learnStatsIncorrect.textContent = learnIncorrect;
        learnFeedback.classList.add('incorrect');
        learnFeedback.innerHTML = `
    <div style="font-size:48px; margin-bottom:10px;">❌</div>
    <div>Incorrect</div>
    <div class="learn-correct-answer">
    Correct answer: <strong>${correctAnswer}</strong>
    </div>
    <div class="learn-override-section">
    <button class="btn btn-success" onclick="overrideCorrect()">Actually, I was correct</button>
    <button class="btn btn-primary" onclick="showNextLearnQuestion()">Continue</button>
    </div>
`;
    }
    //currentIndexElement.textContent++;
}

function overrideCorrect() {
    learnCorrect++;
    learnIncorrect--;
    currentIndex++;
    learnCurrentIndex++;
    currentIndexElement.textContent++;
    learnStatsIncorrect.textContent = learnIncorrect;
    learnAskedQuestions.add(currentLearnQuestion.id);
    updateLearnStats();
    recordAnswerOverride();
    learnFeedback.innerHTML = `
<div style="font-size:48px; margin-bottom:10px;">✅</div>
<div>Answer marked as correct!</div>
`;
    learnFeedback.classList.remove('incorrect');
    learnFeedback.classList.add('correct');
    setTimeout(() => { showNextLearnQuestion(); }, 1000);
}

function skipLearnQuestion() {
    //learnAskedQuestions.add(currentLearnQuestion.id);
    showNextLearnQuestion();
}

function showLearnComplete() {
    currentIndex = learnQuestions.length;
    const percent = learnQuestions.length > 0
        ? Math.round((learnCorrect / (learnQuestions.length + learnIncorrect)) * 100)
        : 0;

    /*
    let grade = '';
    if (percent >= 90) grade = 'A';
    else if (percent >= 80) grade = 'B';
    else if (percent >= 70) grade = 'C';
    else if (percent >= 60) grade = 'D';
    else grade = 'F';
    */

    let grade = '';
    if (percent === 100) grade = 'A+ (Perfect)';
    else if (percent >= 97) grade = 'A+';
    else if (percent >= 93) grade = 'A';
    else if (percent >= 90) grade = 'A-';
    else if (percent >= 87) grade = 'B+';
    else if (percent >= 83) grade = 'B';
    else if (percent >= 80) grade = 'B-';
    else if (percent >= 77) grade = 'C+';
    else if (percent >= 73) grade = 'C';
    else if (percent >= 70) grade = 'C-';
    else if (percent >= 67) grade = 'D+';
    else if (percent >= 63) grade = 'D';
    else if (percent >= 60) grade = 'D-';
    else if (percent > 0) grade = 'F';
    else grade = 'F-';

    let gradeColor = '#4ecdc4'; // green
    if (percent < 60) gradeColor = '#e74c3c'; // yellow-orange
    else if (percent < 80) gradeColor = '#f39c12'; // red

    learnQuestion.textContent = '🎉 Learn Session Complete!';
    learnInputSection.style.display = 'none';
    learnFeedback.classList.remove('hidden', 'incorrect');
    //learnFeedback.classList.add('correct');
    learnFeedback.style.background = gradeColor;
    learnFeedback.innerHTML = `
<div style="font-size:64px; margin-bottom:20px;">🎓</div>
<div style="font-size:48px; margin-bottom:20px;">${grade} = ${percent}%</div>
<div style="font-size:20px;">
    You answered ${learnCorrect} out of ${learnQuestions.length + learnIncorrect} questions correctly!
</div>
<div style="margin-top:30px;">
    <button class="btn btn-primary" onclick="startLearnMode()">Start Over</button>
    <button class="btn btn-secondary" onclick="switchToFlashcardMode()">Flashcard Mode</button>
</div>
`;

    document.getElementById('learn-control-buttons').style.display = 'none';

    // Record the Learn session
    onLearnSessionComplete(learnCorrect, learnIncorrect);
}

function updateLearnStats() {
    learnStatsCorrect.textContent = learnCorrect;
    //currentIndexElement.textContent = learnAskedQuestions.size + 1;
    totalCardsElement.textContent = learnQuestions.length;
    const progress = learnQuestions.length > 0
        ? Math.round((learnAskedQuestions.size / learnQuestions.length) * 100)
        : 0;
    progressElement.textContent = `${progress}%`;
    if (learnAskedQuestions.size + 1 > learnQuestions.length + learnIncorrect) {
        currentIndexElement.textContent = learnAskedQuestions.size;
    }
}

// ============================================================================
// TEST MODE FUNCTIONS
// ============================================================================
function startTest() {
    const numQuestions = parseInt(numQuestionsInput.value);
    if (numQuestions < 1 || numQuestions > cardsData.length) {
        alert(`Please enter a number between 1 and ${cardsData.length}`);
        return;
    }

    // Generate test questions
    const shuffled = [...cardsData].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, numQuestions);

    testData = selected.map((card, idx) => {
        const correctAnswer = card.back;
        const otherAnswers = cardsData
            .filter(c => c.id !== card.id && c.back !== correctAnswer)
            .map(c => c.back);

        // Get 3 random wrong answers
        const wrongAnswers = [];
        while (wrongAnswers.length < 3 && otherAnswers.length > 0) {
            const randomIdx = Math.floor(Math.random() * otherAnswers.length);
            const answer = otherAnswers.splice(randomIdx, 1)[0];
            if (!wrongAnswers.includes(answer)) { wrongAnswers.push(answer); }
        }

        // Combine and shuffle options
        const options = [correctAnswer, ...wrongAnswers].sort(() => Math.random() - 0.5);

        return {
            id: idx,
            question: card.front,
            options: options,
            correct_answer: correctAnswer
        };
    });

    displayTest();
}

function displayTest() {
    testSetup.classList.add('hidden');
    testContainer.classList.remove('hidden');
    submitSection.classList.remove('hidden');
    resultsContainer.classList.add('hidden');

    testContainer.innerHTML = '';
    userAnswers = {};

    testData.forEach((q, idx) => {
        const questionCard = document.createElement('div');
        questionCard.className = 'question-card';
        questionCard.innerHTML = `
    <div class="question-number">Question ${idx + 1} of ${testData.length}</div>
    <div class="question-text">${q.question}</div>
    <div class="options" id="options-${q.id}">
    ${q.options.map((option, optIdx) => `
        <div class="option" data-question-id="${q.id}" data-answer="${option}">
        <div class="option-letter">${String.fromCharCode(65 + optIdx)}</div>
        <div>${option}</div>
        </div>
    `).join('')}
    </div>
`;
        testContainer.appendChild(questionCard);
    });

    document.querySelectorAll('.option').forEach(option => {
        option.addEventListener('click', function () {
            const questionId = parseInt(this.dataset.questionId);
            const answer = this.dataset.answer;

            document.querySelectorAll(`[data-question-id="${questionId}"]`).forEach(opt => {
                opt.classList.remove('selected');
            });
            this.classList.add('selected');
            userAnswers[questionId] = answer;
        });
    });
}

function submitTest() {
    if (Object.keys(userAnswers).length < testData.length) {
        const unanswered = testData.length - Object.keys(userAnswers).length;
        if (!confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) {
            return;
        }
    }

    let numCorrect = 0;
    let numIncorrect = 0;
    const results = [];

    testData.forEach(q => {
        const userAnswer = userAnswers[q.id];
        const isCorrect = userAnswer === q.correct_answer;
        if (isCorrect) { numCorrect++; } else { numIncorrect++; }
        results.push({
            question: q.question,
            user_answer: userAnswer,
            correct_answer: q.correct_answer,
            is_correct: isCorrect
        });
    });

    displayResults(numCorrect, numIncorrect, results);
}

function displayResults(numCorrect, numIncorrect, results) {
    // Record test results for progress tracking
    onTestComplete(results);

    testContainer.classList.add('hidden');
    submitSection.classList.add('hidden');
    resultsContainer.classList.remove('hidden');

    const totalQuestions = numCorrect + numIncorrect;
    const percent = totalQuestions > 0 ? Math.round((numCorrect / totalQuestions) * 100) : 0;

    let grade = '';
    if (percent === 100) grade = 'A+ (Perfect)';
    else if (percent >= 97) grade = 'A+';
    else if (percent >= 93) grade = 'A';
    else if (percent >= 90) grade = 'A-';
    else if (percent >= 87) grade = 'B+';
    else if (percent >= 83) grade = 'B';
    else if (percent >= 80) grade = 'B-';
    else if (percent >= 77) grade = 'C+';
    else if (percent >= 73) grade = 'C';
    else if (percent >= 70) grade = 'C-';
    else if (percent >= 67) grade = 'D+';
    else if (percent >= 63) grade = 'D';
    else if (percent >= 60) grade = 'D-';
    else if (percent > 0) grade = 'F';
    else grade = 'F-';

    let gradeColor = '#4ecdc4';
    if (percent < 60) gradeColor = '#e74c3c';
    else if (percent < 80) gradeColor = '#f39c12';

    let resultsHTML = `
<h2>🎉 Test Complete!</h2>
<div class="grade-display" style="color:${gradeColor};">${grade}</div>
<div class="score-details">
    <div class="stat-card">
    <div class="stat-label">Score</div>
    <div class="stat-value">${percent}%</div>
    </div>
    <div class="stat-card">
    <div class="stat-label">Correct</div>
    <div class="stat-value" style="color:white/*#4ecdc4*/;">${numCorrect}</div>
    </div>
    <div class="stat-card">
    <div class="stat-label">Incorrect</div>
    <div class="stat-value" style="color:white/*#e74c3c*/;">${numIncorrect}</div>
    </div>
    <div class="stat-card">
    <div class="stat-label">Total</div>
    <div class="stat-value">${totalQuestions}</div>
    </div>
</div>
`;

    const incorrectAnswers = results.filter(r => !r.is_correct);
    if (incorrectAnswers.length > 0) {
        resultsHTML += `
    <div class="incorrect-list" style="background:(255, 255, 255, 0.9);">
    <h3>❌ Incorrect Answers (${incorrectAnswers.length})</h3>
    ${incorrectAnswers.map(r => `
        <div class="incorrect-item">
        <div class="incorrect-question">${r.question}</div>
        <div class="incorrect-answers">
            <span style="color:#e74c3c;">Your answer: ${r.user_answer || '(Not answered)'}</span>
            <span style="color:#4ecdc4;">Correct answer: ${r.correct_answer}</span>
        </div>
        </div>
    `).join('')}
    </div>
`;
    }

    resultsHTML += `
<div style="margin-top:30px; display:flex; gap:15px; justify-content:center; flex-wrap:wrap;">
    <button class="btn btn-primary" onclick="switchToTestMode()">Take Another Test</button>
    <button class="btn btn-secondary" onclick="switchToLearnMode()">Learn Mode</button>
    <button class="btn btn-success" onclick="switchToFlashcardMode()">Flashcard Mode</button>
</div>
`;

    resultsContainer.innerHTML = resultsHTML;
}

// ============================================================================
// DAILY ACCURACY LOGIC
// ============================================================================

function getTodayDateString() {
    const today = new Date();
    return today.toISOString().split("T")[0]; // YYYY-MM-DD
}

function recordAnswer(isCorrect) {
    const stats = ProgressTracker.getGlobalStats();
    const today = getTodayDateString();

    const todayEntry = stats.studyHistory.find(d => d.date === today);

    if (!todayEntry) {
        todayEntry = {
            date: today,
            cardsStudied: 0,
            correct: 0,
            incorrect: 0
        };
    }

    todayEntry.cardsStudied++;

    if (isCorrect) {
        todayEntry.correct++;
        stats.totalCorrect++;
    } else {
        todayEntry.incorrect++;
        stats.totalIncorrect++;
    }

    stats.totalCardsStudied++;

    Storage.save(STORAGE_KEYS.STATS, stats);
}

function recordAnswerOverride() {
    const stats = ProgressTracker.getGlobalStats();
    const today = getTodayDateString();

    const todayEntry = stats.studyHistory.find(d => d.date === today);

    todayEntry.correct++;
    stats.totalCorrect++;
    todayEntry.incorrect--;
    stats.totalIncorrect--;

    Storage.save(STORAGE_KEYS.STATS, stats);
}

function getTodayAccuracy() {
    const stats = ProgressTracker.getGlobalStats();
    const today = getTodayDateString();
    const todayEntry = stats.studyHistory.find(d => d.date === today);

    if (!todayEntry || todayEntry.cardsStudied === 0) return 0;

    return Math.round(
        (todayEntry.correct / todayEntry.cardsStudied) * 100
    );
}

// Download version for offline usage — inlines all CSS and JS into a single HTML file
async function downloadOfflineVersion() {
    try {
        // Fetch all external resources
        const [cssText, assetsText, appText] = await Promise.all([
            fetch('styles.css').then(r => r.text()),
            fetch('assets.js').then(r => r.text()),
            fetch('app.js').then(r => r.text()),
        ]);

        // Get the current HTML structure
        const htmlClone = document.documentElement.cloneNode(true);

        // Remove external stylesheet links pointing to our CSS files
        htmlClone.querySelectorAll('link[rel="stylesheet"][href="styles.css"]').forEach(el => el.remove());

        // Remove external script tags pointing to our JS files
        htmlClone.querySelectorAll('script[src="assets.js"], script[src="app.js"]').forEach(el => el.remove());

        // Inject inline <style> into <head>
        const styleTag = document.createElement('style');
        styleTag.textContent = cssText;
        htmlClone.querySelector('head').appendChild(styleTag);

        // Inject inline <script> tags before </body>
        const assetsScript = document.createElement('script');
        assetsScript.textContent = assetsText;
        const appScript = document.createElement('script');
        appScript.textContent = appText;
        htmlClone.querySelector('body').appendChild(assetsScript);
        htmlClone.querySelector('body').appendChild(appScript);

        // Serialize and trigger download
        const serialized = '<!DOCTYPE html>\n' + htmlClone.outerHTML;
        const blob = new Blob([serialized], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'StudyForgeJS.html';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
        console.error('Offline download failed:', err);
        alert('Could not build offline version: ' + err.message);
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Wait for DOM before attaching event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Buttons
    undoBtn?.addEventListener("click", __undo);
    redoBtn?.addEventListener("click", __redo);
    
    document.getElementById('reset-stats-btn')?.addEventListener("click", function () {
        if (confirm("Are you sure you want to delete all study history?\nThis action cannot be undone.")) {
            ProgressTracker.resetGlobalStats();
            updateStats(); // re-render UI
            alert("Stats have been reset.");
        }
    });

    // Global keyboard (only when editor is visible; don't swallow textarea typing)
    document.addEventListener("keydown", (e) => {
        const visible = editorModeContainer && editorModeContainer.style.display !== "none";
        if (!visible) return;
        const tag = document.activeElement.tagName;
        const inText = tag === "INPUT" || tag === "TEXTAREA";

        const isMac = navigator.platform.toUpperCase().includes("MAC");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (mod && !e.shiftKey && e.key.toLowerCase() === "z" && !inText) { e.preventDefault(); __undo(); }
        else if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) {
            if (!inText) { e.preventDefault(); __redo(); }
        }
    });

    // Flashcard mode
    flipBtn.addEventListener('click', flipCard);
    prevBtn.addEventListener('click', previousCard);
    nextBtn.addEventListener('click', nextCard);
    shuffleBtn.addEventListener('click', shuffleDeck);
    cardElement.addEventListener('click', flipCard);

    // Learn mode
    learnSubmitBtn.addEventListener('click', checkLearnAnswer);
    learnAnswerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { checkLearnAnswer(); }
    });
    learnSkipBtn.addEventListener('click', skipLearnQuestion);
    learnRestartBtn.addEventListener('click', startLearnMode);

    // Test mode
    startTestBtn.addEventListener('click', startTest);
    submitTestBtn.addEventListener('click', submitTest);

    // Keyboard navigation (Flashcard mode only)
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        // Ignore typing in inputs and text areas
        if (tag === "INPUT" || tag === "TEXTAREA") { return; }

        if (currentMode === 'flashcard') {
            if (e.key === 'ArrowRight') {
                nextCard();
            } else if (e.key === 'ArrowLeft') {
                previousCard();
            } else if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                flipCard();
            }
        }
    });

    // Add event listeners only if elements exist
    if (previewToggle) {
        previewToggle.addEventListener("click", togglePreview);
        previewToggle.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                togglePreview();
            }
        });
    }

    // Initialize localStorage after DOM is ready
    initializeStorage();

    // Library file input listener
    if (libraryFileInput) {
        libraryFileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];

            if (!file) { return; }

            handleUploadedFile(file);

            currentImportedDeckName = file.name.replace(/\.json$/i, '');

            // Update file name display
            if (fileName) {
                fileName.textContent = file.name;
                fileName.style.display = 'block';
            }

            const reader = new FileReader();
            reader.onload = function (event) {
                const content = event.target.result;
                parseFlashcards(content);

                // Reset the input so the same file can be selected again
                libraryFileInput.value = '';
            };
            reader.onerror = function () {
                alert('Error reading file. Please try again.');
            };
            reader.readAsText(file);

        });
    }

}); // End DOMContentLoaded for event listeners

function togglePreview() {
    if (!previewToggle || !previewList) {
        console.warn("Preview elements not found");
        return;
    }

    const expanded = previewToggle.getAttribute("aria-expanded") === "true";

    previewToggle.setAttribute("aria-expanded", !expanded);
    previewList.classList.toggle("expanded", !expanded);

    previewToggle.textContent = `${expanded ? "▲ Show" : "▼ Hide"} Flashcard Deck (${cardsData.length} Cards)`;

    if (!expanded) {
        renderDeckPreview();
        previewList.style.maxHeight = "none";
    }
    else {
        previewList.style.maxHeight = "0px";
    }
}

// ======================================
// DARK MODE
// ======================================
const DARK_KEY = 'studyforgejs_dark_mode';

function applyDarkMode(enabled) {
    document.body.classList.toggle('dark', enabled);
    const label = document.getElementById('dark-mode-label');
    if (label) label.textContent = enabled ? '☀️ Light Mode' : '🌙 Dark Mode';
}

function toggleDarkMode() {
    const isDark = document.body.classList.contains("dark");
    applyDarkMode(!isDark);
    localStorage.setItem(DARK_KEY, !isDark ? '1' : '0');
}

// Apply on load
window.addEventListener('load', function() {
    const saved = localStorage.getItem(DARK_KEY);
    if (saved === '1') applyDarkMode(true);
});