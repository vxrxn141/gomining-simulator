// Background service worker - reçoit et stocke les données
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GOMINING_SAVE') {
        chrome.storage.local.set({ gominingData: message.data }, () => {
            sendResponse({ ok: true });
        });
        return true;
    }
    if (message.type === 'GOMINING_LOAD') {
        chrome.storage.local.get('gominingData', (result) => {
            sendResponse(result.gominingData || {});
        });
        return true;
    }
});
