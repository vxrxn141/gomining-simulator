// Background service worker — push sync to simulator tabs

// When extractor saves new data, push to all simulator tabs immediately
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.gominingAutoSync) return;

    const data = changes.gominingAutoSync.newValue;
    if (!data) return;

    // Find all simulator tabs and push data
    const patterns = ['http://localhost:*/*', 'file:///*', 'https://jaygauvin2002.github.io/*'];
    for (const pattern of patterns) {
        chrome.tabs.query({ url: pattern }, (tabs) => {
            if (chrome.runtime.lastError) return;
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'GOMINING_SYNC_PUSH',
                    data: data
                }).catch(() => {}); // tab may not have content script
            }
        });
    }
});
