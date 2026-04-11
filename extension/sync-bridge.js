// GoMining Sync Bridge — Content script for simulator pages
// Receives push from background worker + polls as fallback

(function() {
    'use strict';

    const POLL_INTERVAL = 15000;
    const STORAGE_KEY = 'gomining_autosync';

    function writeToLocalStorage(data) {
        const json = JSON.stringify(data);
        const prev = window.localStorage.getItem(STORAGE_KEY);
        if (json === prev) return;

        window.localStorage.setItem(STORAGE_KEY, json);
        window.dispatchEvent(new StorageEvent('storage', {
            key: STORAGE_KEY,
            oldValue: prev,
            newValue: json,
            storageArea: window.localStorage
        }));
    }

    // Receive push from background worker (instant)
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'GOMINING_SYNC_PUSH' && msg.data) {
            writeToLocalStorage(msg.data);
        }
    });

    // Poll fallback
    function syncData() {
        chrome.storage.local.get('gominingAutoSync', (result) => {
            if (chrome.runtime.lastError || !result.gominingAutoSync) return;
            writeToLocalStorage(result.gominingAutoSync);
        });
    }

    // Signal to the simulator that the extension is present
    document.dispatchEvent(new Event('gomining-bridge-ready'));

    // Initial sync + polling fallback
    setTimeout(syncData, 1000);
    setInterval(syncData, POLL_INTERVAL);
})();
