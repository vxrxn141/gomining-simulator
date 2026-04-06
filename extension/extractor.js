// GoMining Data Extractor - Content Script
// Extrait les données du DOM et intercepte les requêtes API

(function() {
    'use strict';

    const MAX_AGE_HOURS = 24; // Durée de vie max des données
    const MAX_HISTORY_DAYS = 30; // Garder seulement 30 jours de reward history
    const AUTOSYNC_DEBOUNCE_MS = 30000; // 30 seconds debounce for auto-sync

    // === Auto-sync: debounced save to chrome.storage.local ===
    let _autoSyncTimer = null;
    function scheduleAutoSync() {
        if (_autoSyncTimer) return; // already scheduled
        _autoSyncTimer = setTimeout(() => {
            _autoSyncTimer = null;
            try {
                const essentials = extractEssentials();
                // Only save if we have at least some meaningful data
                if (essentials.miner.power || essentials.income.prPerThGmt || essentials.rewardHistory?.length) {
                    chrome.storage.local.set({ gominingAutoSync: essentials }, () => {
                        if (!chrome.runtime.lastError) {
                            log('Auto-sync: données sauvegardées pour le simulateur');
                        }
                    });
                }
            } catch(e) {
                console.warn('[GoMining Extractor] Auto-sync error:', e);
            }
        }, AUTOSYNC_DEBOUNCE_MS);
    }

    const DATA = {
        apiCalls: [],
        miners: {},    // clé = endpoint, valeur = dernière réponse
        rewards: {},   // clé = endpoint, valeur = dernière réponse
        discount: {},
        prices: {},
        timestamp: null
    };

    // === Injecter l'intercepteur réseau dans la page ===
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();

    // === Écouter les requêtes interceptées ===
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.type !== 'GOMINING_FETCH' && event.data.type !== 'GOMINING_XHR') return;

        const { url, body, status } = event.data;
        if (status !== 200) return;

        // Ignorer les requêtes non pertinentes
        if (url.includes('intercom') || url.includes('scevent') || url.includes('pixel')) return;

        let parsed = null;
        try {
            parsed = JSON.parse(body);
        } catch(e) {
            return; // pas du JSON
        }

        // Logger toutes les requêtes API
        const entry = {
            time: new Date().toISOString(),
            url: url.substring(0, 120),
            size: body.length,
            keys: parsed ? Object.keys(parsed).join(', ') : ''
        };
        DATA.apiCalls.unshift(entry);
        if (DATA.apiCalls.length > 50) DATA.apiCalls.pop();

        // Analyser les données intéressantes
        analyzeResponse(url, parsed);
        updatePanel();
        scheduleAutoSync();
    });

    // === Extraire la clé unique d'un endpoint (sans query params) ===
    function extractEndpointKey(url) {
        try {
            const u = new URL(url, window.location.origin);
            return u.pathname.split('/').slice(-2).join('/');
        } catch(e) {
            return url.substring(0, 80);
        }
    }

    // === Purger les données trop vieilles ===
    function purgeOldData() {
        const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

        for (const key of Object.keys(DATA.miners)) {
            if (DATA.miners[key].time < cutoff) delete DATA.miners[key];
        }
        for (const key of Object.keys(DATA.rewards)) {
            if (DATA.rewards[key].time < cutoff) delete DATA.rewards[key];
        }

        // Purger apiCalls vieux
        DATA.apiCalls = DATA.apiCalls.filter(c => c.time > cutoff);

        log(`Purge: miners=${Object.keys(DATA.miners).length}, rewards=${Object.keys(DATA.rewards).length}, apiCalls=${DATA.apiCalls.length}`);
    }

    // Purge auto toutes les 30 min
    setInterval(purgeOldData, 30 * 60 * 1000);

    // === Analyser les réponses API ===
    function analyzeResponse(url, data) {
        // Chercher des patterns de données mining
        const str = JSON.stringify(data).toLowerCase();

        // Données de rewards/income — garder seulement la dernière par endpoint
        if (str.includes('reward') || str.includes('income') || str.includes('computing_power') ||
            str.includes('hashrate') || str.includes('electricity') || str.includes('service')) {
            const key = extractEndpointKey(url);
            DATA.rewards[key] = {
                url: url,
                time: new Date().toISOString(),
                data: data
            };
            log('Données rewards: ' + key);
        }

        // Données de mineur/NFT — garder seulement la dernière par endpoint
        if (str.includes('miner') || str.includes('nft') || str.includes('th/s') || str.includes('power')) {
            const key = extractEndpointKey(url);
            DATA.miners[key] = {
                url: url,
                time: new Date().toISOString(),
                data: data
            };
            log('Données mineur: ' + key);
        }

        // Prix — capturer spécifiquement les prix GoMining internes
        if (str.includes('price') || str.includes('rate') || str.includes('usd')) {
            DATA.prices = { ...DATA.prices, source: url, raw: data };

            // Prix GMT interne GoMining (endpoint getTokenPrice)
            if (url.includes('getTokenPrice') && data?.data?.price) {
                DATA.prices.gmtPriceInternal = parseFloat(data.data.price);
                log('Prix GMT interne: $' + DATA.prices.gmtPriceInternal);
            }
            // Prix depuis home-page
            if (url.includes('home-page/get-info-v2') && data?.data) {
                if (data.data.currentGmtPrice) DATA.prices.gmtPriceInternal = data.data.currentGmtPrice;
                if (data.data.currentBtcPrice) DATA.prices.btcPriceInternal = data.data.currentBtcPrice;
                log('Prix home-page: GMT=$' + data.data.currentGmtPrice + ' BTC=$' + data.data.currentBtcPrice);
            }
            log('Données prix trouvées: ' + url);
        }
    }

    // === Scanner le DOM pour extraire des données ===
    function scanDOM() {
        const extracted = {
            timestamp: new Date().toISOString(),
            page: window.location.pathname,
            texts: {}
        };

        // Chercher tous les textes qui contiennent des données numériques intéressantes
        const patterns = {
            'TH/s': /(\d+\.?\d*)\s*TH\/s/gi,
            'W/TH': /(\d+\.?\d*)\s*W\/TH/gi,
            'sat': /(\d+)\s*sat/gi,
            'GOMINING': /(\d+\.?\d*)\s*GOMINING/gi,
            'BTC': /(\d+\.?\d*)\s*BTC/gi,
            'discount': /(\d+\.?\d*)%/gi,
            'kWh': /(\d+\.?\d*)\s*\$?\/kWh/gi
        };

        const body = document.body.innerText;
        for (const [key, regex] of Object.entries(patterns)) {
            const matches = [];
            let match;
            while ((match = regex.exec(body)) !== null) {
                matches.push(match[0]);
            }
            if (matches.length > 0) {
                extracted.texts[key] = [...new Set(matches)]; // unique
            }
        }

        // Chercher spécifiquement le tableau de rewards
        const rows = document.querySelectorAll('table tr, [class*="reward"], [class*="income"]');
        if (rows.length > 0) {
            extracted.rewardRows = rows.length;
        }

        // Chercher les éléments avec des données spécifiques
        const allElements = document.querySelectorAll('[class*="card"], [class*="stat"], [class*="value"], [class*="amount"]');
        const values = [];
        allElements.forEach(el => {
            const text = el.innerText.trim();
            if (text && text.length < 100 && /\d/.test(text)) {
                values.push(text);
            }
        });
        extracted.cardValues = [...new Set(values)].slice(0, 30);

        return extracted;
    }

    // === Interface Panel ===
    function createPanel() {
        // Toggle button
        const toggle = document.createElement('button');
        toggle.id = 'gm-extractor-toggle';
        toggle.innerHTML = '<img src="' + chrome.runtime.getURL('icon.png') + '" style="width:24px;height:24px;border-radius:4px;">';
        toggle.title = 'GoMining Extractor';
        document.body.appendChild(toggle);

        // Panel
        const panel = document.createElement('div');
        panel.id = 'gm-extractor-panel';
        panel.innerHTML = `
            <div class="gm-header">
                <span>⛏ GoMining Extractor</span>
                <div>
                    <button id="gm-minimize">−</button>
                    <button id="gm-close">×</button>
                </div>
            </div>
            <div class="gm-body">
                <div class="gm-section">
                    <div class="gm-section-title">Statut</div>
                    <div class="gm-row">
                        <span class="gm-label">Intercepteur</span>
                        <span class="gm-value">Actif</span>
                    </div>
                    <div class="gm-row">
                        <span class="gm-label">Requêtes captées</span>
                        <span class="gm-value" id="gm-req-count">0</span>
                    </div>
                    <div class="gm-row">
                        <span class="gm-label">Taille données</span>
                        <span class="gm-value" id="gm-data-size">0 KB</span>
                    </div>
                    <div class="gm-row">
                        <span class="gm-label">Page</span>
                        <span class="gm-value" id="gm-page">${window.location.pathname}</span>
                    </div>
                </div>

                <div class="gm-section">
                    <div class="gm-section-title">Données extraites du DOM</div>
                    <div id="gm-dom-data">Cliquer "Scanner" pour analyser</div>
                </div>

                <div class="gm-section">
                    <div class="gm-section-title">Actions</div>
                    <button class="gm-btn" id="gm-scan">Scanner la page</button>
                    <button class="gm-btn" id="gm-sync-sim" style="background:#bc8cff">Copier données pour Simulateur</button>
                    <button class="gm-btn secondary" id="gm-export">Exporter toutes les données (JSON)</button>
                    <button class="gm-btn secondary" id="gm-copy-api">Copier les requêtes API</button>
                    <button class="gm-btn secondary" id="gm-purge" style="background:#ff4444;color:#fff">Purger les données</button>
                </div>

                <div class="gm-section">
                    <div class="gm-section-title">Log des requêtes API</div>
                    <div class="gm-log" id="gm-log"></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Events
        document.getElementById('gm-minimize').addEventListener('click', () => {
            panel.style.display = 'none';
            toggle.style.display = 'block';
        });

        document.getElementById('gm-close').addEventListener('click', () => {
            panel.style.display = 'none';
            toggle.style.display = 'block';
        });

        toggle.addEventListener('click', () => {
            panel.style.display = 'block';
            toggle.style.display = 'none';
        });

        document.getElementById('gm-scan').addEventListener('click', () => {
            const domData = scanDOM();
            DATA.dom = domData;
            updateDomDisplay(domData);
            log('Scan DOM terminé');
        });

        document.getElementById('gm-export').addEventListener('click', () => {
            DATA.timestamp = new Date().toISOString();
            DATA.dom = scanDOM();
            const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gomining-data-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            log('Données exportées !');
        });

        document.getElementById('gm-sync-sim').addEventListener('click', async () => {
            const essentials = extractEssentials();
            const json = JSON.stringify(essentials);
            navigator.clipboard.writeText('GMDATA:' + json).then(() => {
                log('Données copiées ! GMT=$' + (essentials.prices.gmtPrice || 'N/A') + ' BTC=$' + (essentials.prices.btcPrice || 'N/A'));
                const gmt = essentials.prices.gmtPrice ? '$' + essentials.prices.gmtPrice.toFixed(4) + ' (' + (essentials.prices.gmtPriceSource || 'api') + ')' : 'non capturé';
                const btc = essentials.prices.btcPrice ? '$' + Math.round(essentials.prices.btcPrice) + ' (' + (essentials.prices.btcPriceSource || 'api') + ')' : 'non capturé';
                const gmtP = essentials.prices.gmtPrice;
                const btcP = essentials.prices.btcPrice;
                const satPerTH = essentials.income.prPerThGmt && gmtP && btcP
                    ? Math.round(essentials.income.prPerThGmt * gmtP / btcP * 1e8) : '?';
                const hist = essentials.rewardHistory?.length || 0;
                alert(`Données copiées !\nGMT: ${gmt} | BTC: ${btc}\nPR: ${satPerTH} sat/TH | ${hist} jours\n\nVa sur le simulateur et clique "Sync Extension".`);
            }).catch(() => {
                prompt('Copie ce texte et colle-le dans le simulateur:', 'GMDATA:' + json);
            });
        });

        document.getElementById('gm-copy-api').addEventListener('click', () => {
            const text = DATA.apiCalls.map(c => `${c.time} | ${c.url} | ${c.keys}`).join('\n');
            navigator.clipboard.writeText(text).then(() => {
                log('Requêtes API copiées !');
            });
        });

        document.getElementById('gm-purge').addEventListener('click', () => {
            DATA.miners = {};
            DATA.rewards = {};
            DATA.apiCalls = [];
            DATA.prices = {};
            DATA.discount = {};
            DATA.dom = null;
            updatePanel();
            log('Toutes les données purgées !');
            alert('Données purgées ! Recharge la page GoMining pour recapturer les données fraîches.');
        });
    }

    function updateDomDisplay(domData) {
        const el = document.getElementById('gm-dom-data');
        if (!domData) return;

        let html = '';
        if (domData.texts) {
            for (const [key, values] of Object.entries(domData.texts)) {
                html += `<div class="gm-row">
                    <span class="gm-label">${key}</span>
                    <span class="gm-value">${values.slice(0, 5).join(', ')}</span>
                </div>`;
            }
        }
        if (domData.cardValues && domData.cardValues.length > 0) {
            html += `<div style="margin-top:8px;font-size:11px;color:#666;">
                Card values: ${domData.cardValues.slice(0, 15).join(' | ')}
            </div>`;
        }
        el.innerHTML = html || 'Aucune donnée trouvée';
    }

    function updatePanel() {
        const countEl = document.getElementById('gm-req-count');
        if (countEl) countEl.textContent = DATA.apiCalls.length;

        const sizeEl = document.getElementById('gm-data-size');
        if (sizeEl) {
            const bytes = new Blob([JSON.stringify(DATA)]).size;
            sizeEl.textContent = bytes < 1024 ? bytes + ' B' : Math.round(bytes / 1024) + ' KB';
        }

        const logEl = document.getElementById('gm-log');
        if (logEl) {
            logEl.innerHTML = DATA.apiCalls.slice(0, 20).map(c =>
                `<div><strong>${c.url.split('/').pop().split('?')[0]}</strong> — ${c.keys}</div>`
            ).join('');
        }
    }

    const logMessages = [];
    function log(msg) {
        logMessages.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        console.log('[GoMining Extractor]', msg);
    }

    // === Observer les changements de page (SPA Angular) ===
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const pageEl = document.getElementById('gm-page');
            if (pageEl) pageEl.textContent = window.location.pathname;
            log('Navigation: ' + window.location.pathname);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // === Extract essential data for simulator ===
    function extractEssentials() {
        const result = {
            timestamp: new Date().toISOString(),
            miner: {},
            wallet: {},
            discount: {},
            prices: {},
            income: {}
        };

        // Find miner data (DATA.miners est maintenant un objet clé=endpoint)
        for (const m of Object.values(DATA.miners)) {
            if (m.url?.includes('/nft/get-my') && m.data?.data?.array?.[0]) {
                const nft = m.data.data.array[0];
                result.miner = {
                    power: nft.power,
                    energyEfficiency: nft.energyEfficiency,
                    level: nft.level,
                    name: nft.name
                };
            }
            if (m.url?.includes('/wallet/find-by-user') && m.data?.data?.array) {
                const gmtW = m.data.data.array.find(w => w.type === 'VIRTUAL_GMT');
                if (gmtW) {
                    result.wallet.gmtBalance = parseFloat(gmtW.gmtValueAtSyncDate) || 0;
                    result.wallet.gmtLocked = Math.round(parseFloat(gmtW.lockedGmtInWei || '0') / 1e18);
                }
            }
        }

        // Find discount data (DATA.rewards est maintenant un objet clé=endpoint)
        for (const r of Object.values(DATA.rewards)) {
            if (r.url?.includes('/get-my-nft-discount') && r.data?.data) {
                const d = r.data.data;
                result.discount = {
                    streak: d.dailyMaintenanceDiscount || 0,
                    vip: d.levelDiscount || 0,
                    miningMode: d.rewardDistributionDiscount || 0,
                    token: d.discountByMaintenanceInGmt || 0,
                    availableDays: d.discountAvailableDays || 0
                };
            }
            if (r.url?.includes('/home-page/get-info-v2') && r.data?.data) {
                result.prices.gmtPrice = r.data.data.currentGmtPrice;
                result.prices.btcPrice = r.data.data.currentBtcPrice;
            }
            if (r.url?.includes('/nft-income-aggregation/get-last') && r.data?.data) {
                result.income.prPerThGmt = r.data.data.totalIncomePerThToday;
                result.income.c1PerThPerWt = r.data.data.c1ValuePerThPerWtToday;
                result.income.c2PerTh = r.data.data.c2ValuePerThToday;
                // Capturer le prix GMT depuis les stats si disponible
                if (r.data.data.gmtPrice) {
                    result.prices.gmtPrice = result.prices.gmtPrice || r.data.data.gmtPrice;
                }
                if (r.data.data.btcPrice) {
                    result.prices.btcPrice = result.prices.btcPrice || r.data.data.btcPrice;
                }
            }
        }

        // Also check miners for home-page data
        for (const m of Object.values(DATA.miners)) {
            if (m.url?.includes('/home-page/get-info-v2') && m.data?.data) {
                result.prices.gmtPrice = result.prices.gmtPrice || m.data.data.currentGmtPrice;
                result.prices.btcPrice = result.prices.btcPrice || m.data.data.currentBtcPrice;
            }
        }

        // veGMT staking data
        result.staking = {};
        for (const r of Object.values(DATA.rewards)) {
            // Lock details (votes, GMT locked, days to expire)
            if (r.url?.includes('/ve-gomining-lock/find-by-user') && r.data?.data?.array?.[0]) {
                const lock = r.data.data.array[0];
                result.staking.votes = lock.votes || 0;
                result.staking.gmtLocked = Math.round(parseFloat(lock.amountNumeric || '0') / 1e18);
                result.staking.daysToExpire = lock.daysToExpire || 0;
                result.staking.gmtRewardCumulative = lock.gmtReward || 0;
            }
            // Statistics (yearly income per vote)
            if (r.url?.includes('/ve-gomining-lock/statistics') && r.data?.data?.array) {
                // Find VIRTUAL_GMT stats
                const vgmt = r.data.data.array.find(s => s.network === 'VIRTUAL_GMT');
                if (vgmt) {
                    result.staking.yearlyIncomePerVote = vgmt.yearlyIncomePerVote || 0;
                }
            }
        }
        // Also check miners for these endpoints
        for (const m of Object.values(DATA.miners)) {
            if (m.url?.includes('/ve-gomining-lock/find-by-user') && m.data?.data?.array?.[0]) {
                const lock = m.data.data.array[0];
                result.staking.votes = result.staking.votes || lock.votes || 0;
                result.staking.gmtLocked = result.staking.gmtLocked || Math.round(parseFloat(lock.amountNumeric || '0') / 1e18);
                result.staking.gmtRewardCumulative = result.staking.gmtRewardCumulative || lock.gmtReward || 0;
            }
            if (m.url?.includes('/ve-gomining-lock/statistics') && m.data?.data?.array) {
                const vgmt = m.data.data.array.find(s => s.network === 'VIRTUAL_GMT');
                if (vgmt && !result.staking.yearlyIncomePerVote) {
                    result.staking.yearlyIncomePerVote = vgmt.yearlyIncomePerVote || 0;
                }
            }
        }
        // Calculate weekly GMT reward if we have the data
        if (result.staking.votes && result.staking.yearlyIncomePerVote) {
            result.staking.weeklyGmtReward = result.staking.votes * result.staking.yearlyIncomePerVote / 52;
        }

        // Fallback: utiliser les prix internes captés par DATA.prices (getTokenPrice, etc.)
        if (!result.prices.gmtPrice && DATA.prices.gmtPriceInternal) {
            result.prices.gmtPrice = DATA.prices.gmtPriceInternal;
        }
        if (!result.prices.btcPrice && DATA.prices.btcPriceInternal) {
            result.prices.btcPrice = DATA.prices.btcPriceInternal;
        }

        // Fallback ultime: CALCULER le prix GMT depuis la formule C2
        // C2 = (0.0089 / gmtPrice) * (1 - totalDiscount)
        // Donc: gmtPrice = 0.0089 * (1 - totalDiscount) / c2PerTh
        if (!result.prices.gmtPrice && result.income.c2PerTh && result.discount.streak !== undefined) {
            const totalDiscount = (result.discount.streak || 0) + (result.discount.vip || 0) +
                                  (result.discount.miningMode || 0) + (result.discount.token || 0);
            const discountMult = 1 - totalDiscount;
            if (result.income.c2PerTh > 0) {
                result.prices.gmtPrice = 0.0089 * discountMult / result.income.c2PerTh;
                result.prices.gmtPriceSource = 'derived-from-c2';
            }
        }

        // Extract reward history — limité aux MAX_HISTORY_DAYS derniers jours
        result.rewardHistory = [];
        const cutoffDate = new Date(Date.now() - MAX_HISTORY_DAYS * 24 * 3600 * 1000).toISOString().substring(0, 10);

        for (const r of Object.values(DATA.rewards)) {
            if (r.url?.includes('/nft-income/find-aggregated-by-date') && r.data?.data?.array) {
                for (const day of r.data.data.array) {
                    const dateStr = day.createdAt?.substring(0, 10);
                    if (!dateStr || dateStr < cutoffDate) continue; // Skip old data

                    const mainIncome = day.incomeListV2?.find(i => i.nftId !== 21521713);
                    if (!mainIncome) continue;
                    result.rewardHistory.push({
                        date: dateStr,
                        valueBtc: day.valueV2 || day.value || 0,
                        power: mainIncome.power,
                        c1: mainIncome.c1Value,
                        c2: mainIncome.c2Value,
                        poolReward: mainIncome.metaData?.poolReward,
                        totalDiscount: mainIncome.totalDiscount,
                        gmtPrice: day.incomeStatistic?.gmtPrice,
                        btcPrice: day.incomeStatistic?.btcCourseInUsd,
                        maintenanceGmt: mainIncome.maintenanceForWithdrawInGmt,
                        gmtIncome: mainIncome.gmtIncomeBasedOnBtcIncome,
                        reinvestment: mainIncome.reinvestment,
                        reinvestInTH: !!mainIncome.reinvestmentInPowerNftId,
                        toWalletType: mainIncome.toWalletType
                    });
                }
            }
        }
        // Deduplicate by date
        const seen = new Set();
        result.rewardHistory = result.rewardHistory.filter(r => {
            if (seen.has(r.date)) return false;
            seen.add(r.date);
            return true;
        }).sort((a, b) => a.date.localeCompare(b.date));

        // Fallback prix et PR depuis le reward history (le jour le plus récent)
        if (result.rewardHistory.length > 0) {
            const latest = result.rewardHistory[result.rewardHistory.length - 1];
            if (!result.prices.gmtPrice && latest.gmtPrice) {
                result.prices.gmtPrice = latest.gmtPrice;
                result.prices.gmtPriceSource = 'reward-history';
            }
            if (!result.prices.btcPrice && latest.btcPrice) {
                result.prices.btcPrice = latest.btcPrice;
                result.prices.btcPriceSource = 'reward-history';
            }
            // Calculer PR per TH depuis poolReward du dernier jour
            if (!result.income.prPerThGmt && latest.poolReward && latest.power) {
                // poolReward est en BTC (satoshis ou décimal), power en TH
                const prBtcPerTH = latest.poolReward / latest.power;
                const gp = result.prices.gmtPrice;
                const bp = result.prices.btcPrice;
                if (gp && bp) {
                    result.income.prPerThGmt = prBtcPerTH * bp / gp;
                    result.income.prPerThSource = 'reward-history';
                }
            }
        }

        return result;
    }

    // === Init ===
    createPanel();
    log('Extension GoMining Extractor démarrée');

    // Auto-scan après 3 secondes
    setTimeout(() => {
        const domData = scanDOM();
        DATA.dom = domData;
        updateDomDisplay(domData);
        log('Auto-scan initial');
    }, 3000);

})();
