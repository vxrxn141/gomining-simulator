// GoMining Sync Bridge - Content script for simulator pages
// Polls chrome.storage.local and writes data to window.localStorage
// so the simulator can read it without manual copy/paste.

(function() {
    'use strict';

    const POLL_INTERVAL = 15000; // 15 seconds
    const STORAGE_KEY = 'gomining_autosync';

    function syncData() {
        chrome.storage.local.get('gominingAutoSync', (result) => {
            if (chrome.runtime.lastError || !result.gominingAutoSync) return;

            const json = JSON.stringify(result.gominingAutoSync);
            const prev = window.localStorage.getItem(STORAGE_KEY);

            // Only write + dispatch if data actually changed
            if (json !== prev) {
                window.localStorage.setItem(STORAGE_KEY, json);

                // Dispatch a storage event so same-tab listeners get notified
                window.dispatchEvent(new StorageEvent('storage', {
                    key: STORAGE_KEY,
                    oldValue: prev,
                    newValue: json,
                    storageArea: window.localStorage
                }));

                console.log('[GoMining Sync Bridge] Data synced to localStorage');
            }
        });
    }

    // Initial sync after a short delay, then poll
    setTimeout(syncData, 2000);
    setInterval(syncData, POLL_INTERVAL);

    console.log('[GoMining Sync Bridge] Active - polling every ' + (POLL_INTERVAL / 1000) + 's');
})();
