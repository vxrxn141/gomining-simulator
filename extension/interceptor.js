// Ce script est injecté dans la page pour intercepter les requêtes fetch/XHR
// Il tourne dans le contexte de la page (pas du content script)

(function() {
    const capturedData = {};

    // Intercepter fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

        try {
            const clone = response.clone();
            const text = await clone.text();

            // Envoyer au content script
            window.postMessage({
                type: 'GOMINING_FETCH',
                url: url,
                status: response.status,
                body: text
            }, '*');
        } catch(e) {}

        return response;
    };

    // Intercepter XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._gmUrl = url;
        this._gmMethod = method;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            try {
                window.postMessage({
                    type: 'GOMINING_XHR',
                    url: this._gmUrl,
                    status: this.status,
                    body: this.responseText
                }, '*');
            } catch(e) {}
        });
        return originalSend.apply(this, arguments);
    };

    console.log('[GoMining Extractor] Intercepteur réseau actif');
})();
