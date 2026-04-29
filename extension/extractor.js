// GoMining Data Extractor - Content Script
// Extrait les données du DOM et intercepte les requêtes API

(function() {
    'use strict';

    const MAX_AGE_HOURS = 24; // Durée de vie max des données
    const MAX_HISTORY_DAYS = 30; // Garder seulement 30 jours de reward history
    const AUTOSYNC_DEBOUNCE_MS = 30000; // 30 seconds debounce for auto-sync
    const AUTOSYNC_FIRST_MS = 3000; // 3 seconds for first sync

    // === Auto-sync: debounced save to chrome.storage.local ===
    let _autoSyncTimer = null;
    let _firstSyncDone = false;
    function scheduleAutoSync() {
        if (_autoSyncTimer) return; // already scheduled
        const delay = _firstSyncDone ? AUTOSYNC_DEBOUNCE_MS : AUTOSYNC_FIRST_MS;
        _autoSyncTimer = setTimeout(() => {
            _autoSyncTimer = null;
            _firstSyncDone = true;
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

            // Pour find-aggregated-by-date, merger les jours au lieu d'écraser
            // (le dashboard GoMining retourne ~6 jours, la page rewards ~20 jours)
            if (url.includes('/nft-income/find-aggregated-by-date') &&
                data?.data?.array &&
                DATA.rewards[key]?.data?.data?.array) {
                const existing = DATA.rewards[key].data.data.array;
                const newDays = data.data.array;
                const byDate = new Map();
                for (const d of existing) {
                    const dt = d.createdAt?.substring(0, 10);
                    if (dt) byDate.set(dt, d);
                }
                for (const d of newDays) {
                    const dt = d.createdAt?.substring(0, 10);
                    if (dt) byDate.set(dt, d); // nouvelles données ont priorité
                }
                data = JSON.parse(JSON.stringify(data));
                data.data.array = Array.from(byDate.values())
                    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
                log('Merge reward history: ' + existing.length + ' + ' + newDays.length + ' → ' + data.data.array.length + ' jours');
            }

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
        toggle.innerHTML = '<img src="' + chrome.runtime.getURL('icon-128.png') + '" style="width:30px;height:30px;border-radius:6px;">';
        toggle.title = 'GoMining Extractor';
        document.body.appendChild(toggle);

        // Panel
        const panel = document.createElement('div');
        panel.id = 'gm-extractor-panel';
        panel.innerHTML = `
            <div class="gm-header">
                <span>GoMining Extractor</span>
                <button id="gm-close">×</button>
            </div>
            <div class="gm-body">
                <div class="gm-status" id="gm-status">
                    <span class="gm-dot"></span>
                    <span id="gm-status-text">En attente de données...</span>
                </div>

                <div class="gm-meta" id="gm-meta"></div>

                <div class="gm-footer">
                    <span id="gm-req-count" style="display:none">0</span>
                    <span id="gm-data-size" style="display:none">0</span>
                    <span id="gm-page" style="display:none">${window.location.pathname}</span>
                    <button class="gm-link" id="gm-purge">Purger</button>
                    <button class="gm-link" id="gm-export">Exporter JSON</button>
                </div>
            </div>
            <div id="gm-dom-data" style="display:none"></div>
            <div class="gm-log" id="gm-log" style="display:none"></div>
        `;
        document.body.appendChild(panel);

        // Events
        document.getElementById('gm-close').addEventListener('click', () => {
            panel.style.display = 'none';
            toggle.style.display = 'block';
        });

        toggle.addEventListener('click', () => {
            panel.style.display = 'block';
            toggle.style.display = 'none';
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
        });

        document.getElementById('gm-purge').addEventListener('click', () => {
            DATA.miners = {};
            DATA.rewards = {};
            DATA.apiCalls = [];
            DATA.prices = {};
            DATA.discount = {};
            DATA.dom = null;
            updatePanel();
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
        // Status indicator
        const statusText = document.getElementById('gm-status-text');
        const statusDot = document.querySelector('.gm-dot');
        const hasData = Object.keys(DATA.miners).length > 0 || Object.keys(DATA.rewards).length > 0;
        if (statusText && statusDot) {
            if (hasData) {
                statusText.textContent = 'Sync auto actif · ' + DATA.apiCalls.length + ' requêtes';
                statusDot.classList.add('active');
            } else {
                statusText.textContent = 'En attente de données...';
                statusDot.classList.remove('active');
            }
        }

        // Meta: show summary of captured data
        const metaEl = document.getElementById('gm-meta');
        if (metaEl) {
            const essentials = hasData ? extractEssentials() : null;
            if (essentials) {
                const items = [];
                if (essentials.miner?.power) items.push(essentials.miner.power + ' TH');
                if (essentials.prices?.gmtPrice) items.push('GMT $' + essentials.prices.gmtPrice.toFixed(4));
                if (essentials.prices?.btcPrice) items.push('BTC $' + Math.round(essentials.prices.btcPrice).toLocaleString());
                if (essentials.rewardHistory?.length) items.push(essentials.rewardHistory.length + 'j hist.');
                metaEl.textContent = items.join(' · ');
                metaEl.style.display = items.length ? 'block' : 'none';
            } else {
                metaEl.style.display = 'none';
            }
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
            if (m.url?.includes('/nft/get-my') && m.data?.data?.array?.length > 0) {
                const nfts = m.data.data.array;
                const totalPower = nfts.reduce((sum, n) => sum + (n.power || 0), 0);
                // Use weighted average for efficiency
                const totalWatts = nfts.reduce((sum, n) => sum + (n.power || 0) * (n.energyEfficiency || 15), 0);
                const avgEfficiency = totalPower > 0 ? totalWatts / totalPower : 15;
                const main = nfts.reduce((a, b) => (b.power || 0) > (a.power || 0) ? b : a, nfts[0]);
                result.miner = {
                    power: totalPower,
                    energyEfficiency: avgEfficiency,
                    level: main.level,
                    name: main.name,
                    minerCount: nfts.length
                };
            }
            if (m.url?.includes('/wallet/find-by-user') && m.data?.data?.array) {
                const gmtW = m.data.data.array.find(w => w.type === 'VIRTUAL_GMT');
                if (gmtW) {
                    result.wallet.gmtBalance = parseFloat(gmtW.gmtValueAtSyncDate) || 0;
                    result.wallet.gmtLocked = Math.round(parseFloat(gmtW.lockedGmtInWei || '0') / 1e18);
                }
                // BTC wallet: no reliable balance field (no btcValueAtSyncDate equivalent)
                // valueNumericAtSyncDate is an internal counter, not the balance
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
                // totalIncomePerThToday is partial-day (resets at UTC midnight),
                // so it keeps "dropping" as UTC days roll over. Stash it as a last-resort
                // fallback only — the primary PR source is rewardHistory (last complete day).
                result.income._partialDayPr = r.data.data.totalIncomePerThToday;
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

        // Upgrade cost per TH — DISABLED.
        // Previous heuristic picked the first numeric field 0-1000 from
        // /nft/get-power-upgrade-info and was returning wrong values (~$7.79
        // when the real upgrade rate is $12.34). Until we can identify the
        // correct field with a captured raw payload, we don't propagate a
        // cost — the simulator falls back to its hardcoded $12.34 default.
        // For debugging when GoMining ships a new upgrade flow, log raw keys:
        result.upgrade = {};
        for (const m of Object.values(DATA.miners)) {
            if (m.url?.includes('/nft/get-power-upgrade-info') || m.url?.includes('/nft/get-upgrade-rate')) {
                const d = m.data?.data || m.data;
                if (d) log('Upgrade endpoint keys (debug): ' + Object.keys(d).join(','));
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

                    // Aggregate ALL miner NFTs for this day (exclude nft 21521713 which is staking-related).
                    // Previously we only picked the FIRST NFT, which broke for users with multiple miners
                    // (gave per-NFT power instead of total → 10 TH instead of 197 TH for example).
                    const incomes = (day.incomeListV2 || []).filter(i => i.nftId !== 21521713);
                    if (incomes.length === 0) continue;

                    const sumPower = incomes.reduce((s, i) => s + (i.power || 0), 0);
                    const sumC1 = incomes.reduce((s, i) => s + (i.c1Value || 0), 0);
                    const sumC2 = incomes.reduce((s, i) => s + (i.c2Value || 0), 0);
                    const sumPoolReward = incomes.reduce((s, i) => s + (i.metaData?.poolReward || 0), 0);
                    const sumMaintGmt = incomes.reduce((s, i) => s + (i.maintenanceForWithdrawInGmt || 0), 0);
                    const sumGmtIncome = incomes.reduce((s, i) => s + (i.gmtIncomeBasedOnBtcIncome || 0), 0);

                    // For totalDiscount, take the value from the largest NFT (they should all have the same discount)
                    const main = incomes.reduce((a, b) => (b.power || 0) > (a.power || 0) ? b : a, incomes[0]);

                    // Mark today's entry as `partial: true` — it's accumulating since
                    // 00:00 UTC and any consumer that uses `poolReward / power` for the
                    // PR display will get inflated values without this flag.
                    const todayUTC = new Date().toISOString().substring(0, 10);
                    result.rewardHistory.push({
                        date: dateStr,
                        partial: dateStr >= todayUTC,
                        valueBtc: day.valueV2 || day.value || 0,
                        power: sumPower,
                        c1: sumC1,
                        c2: sumC2,
                        poolReward: sumPoolReward,
                        totalDiscount: main.totalDiscount,
                        gmtPrice: day.incomeStatistic?.gmtPrice,
                        btcPrice: day.incomeStatistic?.btcCourseInUsd,
                        maintenanceGmt: sumMaintGmt,
                        gmtIncome: sumGmtIncome,
                        reinvestment: main.reinvestment,
                        reinvestInTH: !!main.reinvestmentInPowerNftId,
                        toWalletType: main.toWalletType
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
            const todayUTC = new Date().toISOString().substring(0, 10);

            // Find the most recent COMPLETE day (strictly before today UTC, AND with valid poolReward/power).
            // This avoids using today's partial data which makes PR drift / drop randomly.
            let completeDay = null;
            for (let i = result.rewardHistory.length - 1; i >= 0; i--) {
                const d = result.rewardHistory[i];
                if (d.date >= todayUTC) continue;           // skip today (partial)
                if (!d.poolReward || !d.power) continue;    // skip days with missing data
                completeDay = d;
                break;
            }
            // Fall back to most recent day (even if today) for prices if no complete day found
            const latest = completeDay || result.rewardHistory[result.rewardHistory.length - 1];

            if (!result.prices.gmtPrice && latest.gmtPrice) {
                result.prices.gmtPrice = latest.gmtPrice;
                result.prices.gmtPriceSource = 'reward-history';
            }
            if (!result.prices.btcPrice && latest.btcPrice) {
                result.prices.btcPrice = latest.btcPrice;
                result.prices.btcPriceSource = 'reward-history';
            }

            // PRIMARY PR source: the last COMPLETE day's poolReward / power, converted BTC→GMT
            if (completeDay && completeDay.poolReward && completeDay.power) {
                const prBtcPerTH = completeDay.poolReward / completeDay.power;
                const gp = result.prices.gmtPrice;
                const bp = result.prices.btcPrice;
                if (gp && bp) {
                    result.income.prPerThGmt = prBtcPerTH * bp / gp;
                    result.income.prPerThSource = 'reward-history:' + completeDay.date;
                }
            }
        }

        // Last-resort fallback: use partial-day value only if nothing else worked
        if (!result.income.prPerThGmt && result.income._partialDayPr) {
            result.income.prPerThGmt = result.income._partialDayPr;
            result.income.prPerThSource = 'partial-day-fallback';
        }
        delete result.income._partialDayPr;

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
