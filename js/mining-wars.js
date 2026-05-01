/* =========================================================
   mining-wars.js
   Logic for /mining-wars.html — Mining mode vs Miner Wars
   comparison + Spell Bot setup.

   Math model lifted from index.html calcDailyReward, with the
   user's Part-4 corrections folded in:
     * Clan leader = 5% of GMT WON (not spent) by members
     * Service button (in MW) = base PPS × 100 score injection
   ========================================================= */

const SERVICE_FEE_TH_USD = 0.0089;   // GoMining service cost ($/TH/day)

const $ = sel => document.querySelector(sel);

/* ---------- Spell catalog & bot rules ---------- */
const SPELLS = {
  rocket:  { label:"Rocket",  costs:[1,10,100], icon:"🚀" },
  echo:    { label:"Echo",    costs:[1,10,100], icon:"📡" },
  focus:   { label:"Focus",   costs:[1,10,100], icon:"🎯" },
  instant: { label:"Instant", costs:[1,10,100], icon:"⚡" },
  turbo:   { label:"Turbo",   costs:[10],       icon:"🔥" },
  shield:  { label:"Shield",  costs:[100],      icon:"🛡" },
  // service button is FREE (you only get 1/day inside MW)
  service: { label:"Service", costs:[0],        icon:"🛠" },
};
// Block multipliers per league. Dune caps at ×32, Horizon ×64,
// Eclipse ×128, Odyssey ×256. These cascade: each higher league
// includes every multiplier below it plus its own ceiling.
function tiersFor(maxMult) {
  const all = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  return all.filter(m => m <= maxMult);
}
let currentLeague = null;        // "dune" | "horizon" | "eclipse" | "odyssey" | null
let MULT_TIERS = [1, 2, 4, 8, 16, 32];     // Dune-default until user picks
let botRules = MULT_TIERS.map(m => ({ mult:m, picks:{} }));

function rebuildBotForLeague(maxMult) {
  MULT_TIERS = tiersFor(maxMult);
  // preserve existing picks where the multiplier still applies, drop others
  const oldByMult = Object.fromEntries(botRules.map(r => [r.mult, r.picks]));
  botRules = MULT_TIERS.map(m => ({ mult:m, picks: oldByMult[m] || {} }));
  renderFreqRow();
  renderBot();
}

// Per-tier expected blocks/week — keyed by multiplier number.
// Defaults reflect that low multipliers happen often, big ones rare.
const FREQ_DEFAULTS = { 1:10, 2:4, 4:2, 8:1, 16:0.5, 32:0.2, 64:0.1, 128:0.05, 256:0.02 };
let perTierFreq = {};
function renderFreqRow() {
  const row = $("#bot-freq-row");
  if (!row) return;
  row.innerHTML = "";
  MULT_TIERS.forEach(m => {
    const cur = perTierFreq[m] ?? FREQ_DEFAULTS[m] ?? 1;
    const wrap = document.createElement("div");
    wrap.className = "price-input";
    wrap.innerHTML = `
      <label>×${m}</label>
      <input type="number" data-mult="${m}" value="${cur}" step="0.1" min="0">`;
    wrap.querySelector("input").addEventListener("input", e => {
      perTierFreq[m] = +e.target.value || 0;
      renderBot();
      updateDashboard();
    });
    row.appendChild(wrap);
    perTierFreq[m] = cur;
  });
}

function preset(kind) {
  if (kind === "clear") {
    botRules.forEach(r => r.picks = {});
  } else if (kind === "conservative") {
    botRules.forEach(r => {
      r.picks = {};
      if (r.mult >= 2 && r.mult <= 4)  r.picks.service = 1;
      if (r.mult >= 8 && r.mult <= 16) { r.picks.rocket = 1;  r.picks.echo = 1;  r.picks.service = 1; }
      if (r.mult >= 32)                { r.picks.rocket = 10; r.picks.echo = 10; r.picks.instant = 10; r.picks.service = 1; }
    });
  } else if (kind === "aggressive") {
    botRules.forEach(r => {
      r.picks = {};
      if (r.mult >= 2 && r.mult <= 4) { r.picks.rocket = 1;   r.picks.service = 1; }
      if (r.mult >= 8 && r.mult <= 16){ r.picks.rocket = 10;  r.picks.echo = 10;  r.picks.instant = 10;  r.picks.turbo = 10; r.picks.service = 1; }
      if (r.mult >= 32)               { r.picks.rocket = 100; r.picks.echo = 100; r.picks.focus = 100;
                                        r.picks.instant = 100; r.picks.turbo = 10; r.picks.shield = 100; r.picks.service = 1; }
    });
  }
  renderBot();
}

function renderBot() {
  const body = $("#bot-rules-body");
  body.innerHTML = "";

  const blocksDefault = +$("#bot-blocks-per-tier").value || 1;
  const edgeRate      = +$("#bot-edge-rate").value || 1;
  const gmtUsd        = +$("#in-gmt").value || 0;

  let weekGmtTotal = 0, weekPrizeUsd = 0;

  botRules.forEach((rule, idx) => {
    const tr = document.createElement("tr");
    let rowCost = 0;
    let cells = `<td class="bot-multcell"><strong>×${rule.mult}</strong></td>`;
    Object.keys(SPELLS).forEach(key => {
      const s = SPELLS[key];
      const cur = rule.picks[key] || 0;
      const opts = ['<option value="0">off</option>']
        .concat(s.costs.map(c => `<option value="${c}" ${cur===c?"selected":""}>${c} GMT${key==="service"?" (free)":""}</option>`))
        .join("");
      if (key === "service") {
        cells += `<td><label class="service-toggle"><input type="checkbox" data-rule="${idx}" data-key="service" ${cur?"checked":""}> use</label></td>`;
      } else {
        cells += `<td><select data-rule="${idx}" data-key="${key}">${opts}</select></td>`;
      }
      rowCost += +cur || 0;
    });
    const blocksThisTier = perTierFreq[rule.mult] ?? blocksDefault;
    weekGmtTotal += rowCost * blocksThisTier;
    cells += `<td style="text-align:right;font-weight:700">${rowCost.toLocaleString()} GMT</td>`;

    // verdict per row
    const rowCostUsd  = rowCost * gmtUsd;
    const rowPrizeUsd = rowCostUsd * edgeRate;
    weekPrizeUsd += rowPrizeUsd * blocksThisTier;
    const net = rowPrizeUsd - rowCostUsd;
    let verdict = "";
    if (rowCost === 0)         verdict = '<span style="color:var(--text-mute)">no boost</span>';
    else if (net > 0)          verdict = `<span style="color:var(--green);font-weight:700">+$${net.toFixed(2)}</span>`;
    else if (net < 0)          verdict = `<span style="color:var(--red);font-weight:700">-$${Math.abs(net).toFixed(2)} ⚠</span>`;
    else                       verdict = '<span style="color:var(--text-dim)">break even</span>';
    cells += `<td style="text-align:right">${verdict}</td>`;
    tr.innerHTML = cells;
    body.appendChild(tr);
  });

  // wire selectors
  body.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", e => {
      const ri = +e.target.dataset.rule, key = e.target.dataset.key;
      const v  = +e.target.value;
      if (v) botRules[ri].picks[key] = v;
      else delete botRules[ri].picks[key];
      renderBot();
    });
  });
  body.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", e => {
      const ri = +e.target.dataset.rule;
      if (e.target.checked) botRules[ri].picks.service = 1;
      else delete botRules[ri].picks.service;
      renderBot();
    });
  });

  // headline numbers
  $("#bot-week-cost").textContent     = weekGmtTotal.toLocaleString() + " GMT";
  $("#bot-week-cost-usd").textContent = "≈ " + fmtUsd(weekGmtTotal * gmtUsd) + " / week";
  $("#bot-week-prize").textContent    = fmtUsd(weekPrizeUsd);
  const edge = weekPrizeUsd - weekGmtTotal * gmtUsd;
  $("#bot-week-edge").textContent     = fmtUsd(edge);
  $("#bot-week-edge").style.color     = edge >= 0 ? "var(--green)" : "var(--red)";
  $("#bot-week-edge-sub").textContent = edge >= 0
    ? "Net positive at the assumed conversion rate"
    : "⚠ Bot loses money at this rate — lower spell tier or stop boosting low multipliers";
}

function exportBotConfig() {
  const cfg = {
    note: "Generated by gmsim.ca / Mining Wars · paste into your spell-bot",
    generatedAt: new Date().toISOString(),
    rules: botRules.map(r => ({ multiplier: r.mult, fire: r.picks })),
  };
  const json = JSON.stringify(cfg, null, 2);
  navigator.clipboard?.writeText(json).then(() => {
    const btn = document.getElementById("bot-export");
    const orig = btn.textContent;
    btn.textContent = "✓ copied to clipboard";
    setTimeout(() => btn.textContent = orig, 1800);
  }).catch(() => alert(json));
}

/* ---------- Mining vs Miner Wars comparison ---------- */
function read() {
  return {
    th:        +$("#in-th").value || 0,
    eff:       +$("#in-eff").value || 15,
    btcUsd:    +$("#in-btc").value || 0,
    netEh:     +$("#in-net").value || 1,
    blockBtc:  +$("#in-block").value || 3.125,
    elecKwh:   +$("#in-elec").value || 0.05,
    discService: (+$("#in-disc-service").value || 0) / 100,
    discMining:  (+$("#in-disc-mining").value  || 0) / 100,
    discVip:     (+$("#in-disc-vip").value     || 0) / 100,
    discToken:   (+$("#in-disc-token").value   || 0) / 100,
    leagueWth: +$("#in-league-wth").value || 19,
    warGross:  +$("#in-war-gross").value || 0,
    warGmt:    +$("#in-war-gmt").value || 0,
    gmtUsd:    +$("#in-gmt").value || 0,
  };
}

function fmtUsd(n)  { return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:2}); }
function fmtBtc(n)  { return (n < 0 ? "" : "") + n.toFixed(8); }

/* ============ DASHBOARD live KPIs ============ */
function updateDashboard() {
  const out = simulate();
  const m = out.mining, w = out.wars, p = out.p;

  const mEl = document.getElementById("kpi-mining");
  const wEl = document.getElementById("kpi-wars");
  const winEl = document.getElementById("kpi-winner");
  const botEl = document.getElementById("kpi-bot");

  if (mEl) {
    mEl.querySelector(".val").textContent = fmtUsd(m.netUsd);
    mEl.classList.toggle("green", m.netUsd >= 0);
    mEl.classList.toggle("red", m.netUsd < 0);
    mEl.querySelector(".sub").textContent = fmtBtc(m.netBtc) + " BTC · all 4 discounts";
  }
  if (wEl) {
    wEl.querySelector(".val").textContent = fmtUsd(w.netUsd);
    wEl.classList.toggle("green", w.netUsd >= 0);
    wEl.classList.toggle("red", w.netUsd < 0);
    wEl.querySelector(".sub").textContent =
      `Excess tax: -${fmtUsd(w.feesExcess)} · Retention ${w.retention.toFixed(1)}%`;
  }
  if (winEl) {
    const diff = w.netUsd - m.netUsd;
    const winner = m.netUsd >= w.netUsd ? "Mining mode" : "Miner Wars";
    const v = winEl.querySelector(".val");
    v.textContent = winner;
    winEl.classList.remove("green", "red", "purple", "accent");
    winEl.classList.add(winner === "Mining mode" ? "green" : "purple");
    document.getElementById("kpi-winner-diff").textContent =
      (diff >= 0 ? "+" : "-") + fmtUsd(Math.abs(diff));
  }
  if (botEl) {
    // re-run a lightweight version of the bot edge calc
    const blocksDefault = +($("#bot-blocks-per-tier")?.value) || 1;
    const edgeRate      = +($("#bot-edge-rate")?.value) || 1;
    const gmtUsd        = +$("#in-gmt").value || 0;
    let weekGmt = 0, weekPrize = 0;
    botRules.forEach(rule => {
      const blocks = perTierFreq[rule.mult] ?? blocksDefault;
      const cost = Object.values(rule.picks).reduce((a, b) => a + (+b || 0), 0);
      weekGmt   += cost * blocks;
      weekPrize += cost * gmtUsd * edgeRate * blocks;
    });
    const edge = weekPrize - weekGmt * gmtUsd;
    botEl.querySelector(".val").textContent = fmtUsd(edge);
    botEl.classList.remove("green", "red", "dim");
    if (edge > 0) botEl.classList.add("green");
    else if (edge < 0) botEl.classList.add("red");
    else botEl.classList.add("dim");
    botEl.querySelector(".sub").textContent =
      weekGmt > 0
        ? `Spends ${weekGmt.toLocaleString()} GMT/wk for ~${fmtUsd(weekPrize)} return`
        : "No bot rules set yet — configure in Spell Bot tab";
  }
}

/* ============ Variance scenarios (Compare tab) ============ */
function renderVariance(out) {
  const el = document.getElementById("variance-grid");
  if (!el) return;
  document.getElementById("variance-card").style.display = "block";
  const p = out.p;
  const scenarios = [
    { label:"BAD LUCK · 0.5×", mul:0.5, cls:"bad",   note:"Half of expected wins" },
    { label:"AVERAGE · 1.0×",  mul:1.0, cls:"avg",   note:"Your expected gross" },
    { label:"LUCKY · 3.0×",    mul:3.0, cls:"lucky", note:"Heavy block-win streak" },
  ];
  el.innerHTML = scenarios.map(s => {
    const grossBtc = p.warGross * s.mul;
    const grossUsd = grossBtc * p.btcUsd;
    // recompute fees with adjusted gross
    const elecPerDayUsd = (p.elecKwh * 24 * p.eff * p.th) / 1000;
    const servPerDayUsd = SERVICE_FEE_TH_USD * p.th;
    const warsDisc = p.discService + p.discVip + p.discToken;
    const baseFees = (elecPerDayUsd + servPerDayUsd) * (1 - warsDisc) * 7;
    const excessBtc = Math.max(0, grossBtc - out.mining.ceilingBtc);
    const excessUsd = excessBtc * p.btcUsd;
    const leagueElec = (p.elecKwh * 24 * p.leagueWth * p.th) / 1000;
    const ratio = (leagueElec + servPerDayUsd) / (elecPerDayUsd + servPerDayUsd);
    const excessFee = excessUsd * (ratio - 1) * (1 - warsDisc);
    const net = grossUsd - baseFees - excessFee;
    const beatSolo = net > out.mining.netUsd;
    return `
      <div class="variance-card ${s.cls}">
        <span class="luck">${s.label}</span>
        <div class="vc-net ${net >= 0 ? "green" : "red"}">${fmtUsd(net)}</div>
        <div class="vc-sub">${s.note} · ${beatSolo ? "✅ beats solo" : "❌ solo wins"}</div>
        <div class="vc-row"><span class="l">Gross BTC</span><span class="r">${fmtBtc(grossBtc)}</span></div>
        <div class="vc-row"><span class="l">Excess tax</span><span class="r">-${fmtUsd(excessFee)}</span></div>
        <div class="vc-row"><span class="l">vs Mining</span><span class="r ${net >= out.mining.netUsd ? "green" : "red"}" style="color:${net >= out.mining.netUsd ? "var(--green)" : "var(--red)"}">${(net >= out.mining.netUsd ? "+" : "")}${fmtUsd(net - out.mining.netUsd)}</span></div>
      </div>`;
  }).join("");
}

/* ============ Break-even calculator (Compare tab) ============ */
function renderBreakeven(out) {
  document.getElementById("breakeven-card").style.display = "block";
  const p = out.p;
  const elecPerDayUsd = (p.elecKwh * 24 * p.eff * p.th) / 1000;
  const servPerDayUsd = SERVICE_FEE_TH_USD * p.th;
  const warsDisc = p.discService + p.discVip + p.discToken;
  const baseFees = (elecPerDayUsd + servPerDayUsd) * (1 - warsDisc) * 7;
  const leagueElec = (p.elecKwh * 24 * p.leagueWth * p.th) / 1000;
  const ratio = (leagueElec + servPerDayUsd) / (elecPerDayUsd + servPerDayUsd);
  // Solve: gross_usd - baseFees - max(0, gross_btc - ceilingBtc) * btcUsd * (ratio-1) * (1-disc) = miningNetUsd
  // Two regimes: gross_btc <= ceiling → excessFee = 0
  //              gross_btc > ceiling  → excessFee scales with overage
  const ceilingUsd = out.mining.ceilingBtc * p.btcUsd;
  // Try below-ceiling regime
  let beUsd = out.mining.netUsd + baseFees;     // pure (no excess fee)
  let regime = "below ceiling";
  if (beUsd > ceilingUsd) {
    // has to be above-ceiling. Solve:
    // beUsd - baseFees - (beUsd - ceilingUsd)*(ratio-1)*(1-disc) = miningNetUsd
    // beUsd*(1 - (ratio-1)*(1-disc)) = miningNetUsd + baseFees - ceilingUsd*(ratio-1)*(1-disc)
    const a = 1 - (ratio - 1) * (1 - warsDisc);
    if (a > 0.001) {
      beUsd = (out.mining.netUsd + baseFees - ceilingUsd * (ratio - 1) * (1 - warsDisc)) / a;
    }
    regime = "above ceiling";
  }
  const beBtc = p.btcUsd > 0 ? beUsd / p.btcUsd : 0;
  const yourGap = p.warGross - beBtc;
  const gapPct = beBtc > 0 ? (yourGap / beBtc) * 100 : 0;

  document.getElementById("breakeven-row").innerHTML = `
    <div class="be-block">
      <div class="be-lbl">Break-even gross BTC / week</div>
      <div class="be-val">${fmtBtc(beBtc)}</div>
      <div class="be-sub">≈ ${fmtUsd(beUsd)} · regime: <strong>${regime}</strong></div>
    </div>
    <div class="be-block">
      <div class="be-lbl">Your gap to break-even</div>
      <div class="be-val ${yourGap >= 0 ? "green" : "red"}">${(yourGap >= 0 ? "+" : "")}${fmtBtc(yourGap)}</div>
      <div class="be-sub">${
        yourGap >= 0
        ? `You're <strong>${gapPct.toFixed(1)}%</strong> above break-even — Wars is profitable at your expected gross.`
        : `You need <strong>${Math.abs(gapPct).toFixed(1)}%</strong> more weekly gross BTC for Wars to beat solo.`
      }</div>
    </div>`;
}

function simulate() {
  const p = read();
  const networkTh = p.netEh * 1_000_000;     // EH/s → TH/s

  // ---------- MINING MODE ----------
  const grossPerDayBtc = (p.th / networkTh) * 144 * p.blockBtc;
  const elecPerDayUsd  = (p.elecKwh * 24 * p.eff * p.th) / 1000;
  const servPerDayUsd  = SERVICE_FEE_TH_USD * p.th;
  const miningDisc     = p.discService + p.discMining + p.discVip + p.discToken;
  const maintPerDayUsd = (elecPerDayUsd + servPerDayUsd) * (1 - miningDisc);
  const maintPerDayBtc = p.btcUsd > 0 ? maintPerDayUsd / p.btcUsd : 0;
  const miningWeekNetBtc = (grossPerDayBtc - maintPerDayBtc) * 7;
  const miningWeekNetUsd = miningWeekNetBtc * p.btcUsd;
  const miningWeekGrossUsd = grossPerDayBtc * 7 * p.btcUsd;
  const miningWeekMaintUsd = maintPerDayUsd * 7;
  const soloCeilingBtc = miningWeekNetBtc;            // excess-fee threshold

  // ---------- MINER WARS ----------
  const warsDisc = p.discService + p.discVip + p.discToken;     // mining-mode bonus does NOT apply
  const warsFeesBaseUsd = (elecPerDayUsd + servPerDayUsd) * (1 - warsDisc) * 7;
  const excessBtc = Math.max(0, p.warGross - soloCeilingBtc);
  const excessUsd = excessBtc * p.btcUsd;
  const leagueElecPerDay = (p.elecKwh * 24 * p.leagueWth * p.th) / 1000;
  const leagueRatio = (leagueElecPerDay + servPerDayUsd) / (elecPerDayUsd + servPerDayUsd);
  const warsExcessFeeUsd = excessUsd * (leagueRatio - 1) * (1 - warsDisc);
  const warsGrossUsd = p.warGross * p.btcUsd;
  const warsGmtUsd   = p.warGmt   * p.gmtUsd;
  const warsNetUsd   = warsGrossUsd + warsGmtUsd - warsFeesBaseUsd - warsExcessFeeUsd;
  const warsNetBtc   = p.btcUsd > 0 ? warsNetUsd / p.btcUsd : 0;
  const warsRetention = warsGrossUsd > 0
    ? ((warsGrossUsd - warsFeesBaseUsd - warsExcessFeeUsd) / warsGrossUsd) * 100
    : 0;

  return {
    p,
    mining: {
      gross: miningWeekGrossUsd,
      maint: miningWeekMaintUsd,
      netBtc: miningWeekNetBtc,
      netUsd: miningWeekNetUsd,
      ceilingBtc: soloCeilingBtc,
    },
    wars: {
      gross: warsGrossUsd,
      gmt:   warsGmtUsd,
      feesBase: warsFeesBaseUsd,
      feesExcess: warsExcessFeeUsd,
      excessBtc, leagueRatio,
      netBtc: warsNetBtc,
      netUsd: warsNetUsd,
      retention: warsRetention,
    },
  };
}

function render(out) {
  $("#results-empty").style.display = "none";
  $("#results-content").style.display = "block";

  const m = out.mining, w = out.wars, p = out.p;
  $("#mining-net").textContent = fmtUsd(m.netUsd);
  $("#mining-net").className   = "mode-net " + (m.netUsd >= 0 ? "green" : "red");
  $("#mining-sub").textContent = fmtBtc(m.netBtc) + " BTC / week";
  $("#mining-gross").textContent   = fmtUsd(m.gross);
  $("#mining-maint").textContent   = "-" + fmtUsd(m.maint);
  $("#mining-btc").textContent     = fmtBtc(m.netBtc);
  $("#mining-ceiling").textContent = fmtBtc(m.ceilingBtc) + " BTC";

  $("#wars-net").textContent = fmtUsd(w.netUsd);
  $("#wars-net").className   = "mode-net " + (w.netUsd >= 0 ? "green" : "red");
  $("#wars-sub").textContent = fmtBtc(w.netBtc) + " BTC equivalent / week";
  $("#wars-gross").textContent      = fmtUsd(w.gross);
  $("#wars-gmt").textContent        = w.gmt > 0 ? "+" + fmtUsd(w.gmt) : "—";
  $("#wars-fees-base").textContent  = "-" + fmtUsd(w.feesBase);
  $("#wars-fees-excess").textContent= "-" + fmtUsd(w.feesExcess);
  $("#wars-retention").textContent  = w.retention.toFixed(1) + "%";

  // verdict + winner ribbon
  const diff = w.netUsd - m.netUsd;
  $("#card-mining").classList.toggle("winner", m.netUsd >= w.netUsd);
  $("#card-wars").classList.toggle("winner", w.netUsd > m.netUsd);
  const tagMining = $("#card-mining").querySelector(".winner-tag");
  const tagWars   = $("#card-wars").querySelector(".winner-tag");
  if (tagMining) tagMining.remove();
  if (tagWars) tagWars.remove();
  const winnerCard = m.netUsd >= w.netUsd ? "card-mining" : "card-wars";
  const tag = document.createElement("div");
  tag.className = "winner-tag";
  tag.textContent = "WINNER";
  $("#" + winnerCard).appendChild(tag);

  const v = $("#verdict");
  v.classList.remove("mining","wars");
  if (m.netUsd >= w.netUsd) {
    v.classList.add("mining");
    $("#verdict-title").textContent = `Mining mode wins by ${fmtUsd(Math.abs(diff))}/week`;
    $("#verdict-text").textContent  = w.feesExcess > 0
      ? `The league's avg ${p.leagueWth} W/TH excess-fee tax (${fmtUsd(w.feesExcess)}) eats more than your clan-share advantage. Stay solo.`
      : "Your expected clan share doesn't beat your predictable solo earnings. Stay solo.";
  } else {
    v.classList.add("wars");
    $("#verdict-title").textContent = `Miner Wars wins by ${fmtUsd(Math.abs(diff))}/week`;
    $("#verdict-text").textContent  = `Your expected clan share is high enough to beat solo even after the league fee markup. Worth playing — but confirm your gross estimate is realistic.`;
  }

  // detail table
  $("#detail-table").innerHTML = `
    <tr><td class="lbl">Your hashrate</td><td>${p.th.toLocaleString()} TH/s</td></tr>
    <tr><td class="lbl">Your W/TH</td><td>${p.eff} (vs league avg ${p.leagueWth})</td></tr>
    <tr><td class="lbl">League fee multiplier on excess</td><td>${(w.leagueRatio).toFixed(3)}× (×${((w.leagueRatio-1)*100).toFixed(1)}% markup)</td></tr>
    <tr><td class="lbl">Mining-mode discount stack</td><td>${((p.discService+p.discMining+p.discVip+p.discToken)*100).toFixed(2)}%</td></tr>
    <tr><td class="lbl">Miner-Wars discount stack</td><td>${((p.discService+p.discVip+p.discToken)*100).toFixed(2)}% <span style="color:var(--text-mute)">(no Mining-mode bonus)</span></td></tr>
    <tr><td class="lbl">Excess BTC above solo ceiling</td><td>${fmtBtc(w.excessBtc)} BTC (${fmtUsd(w.excessBtc*p.btcUsd)})</td></tr>
    <tr><td class="lbl">Excess-fee tax on overage</td><td class="red">-${fmtUsd(w.feesExcess)}</td></tr>
    <tr class="total"><td>Net difference</td><td class="${diff >= 0 ? 'green' : 'red'}">${fmtUsd(diff)}/week (${diff>=0?"+":""}${(diff*52).toLocaleString(undefined,{maximumFractionDigits:0})} /year)</td></tr>
  `;

  // variance + break-even
  renderVariance(out);
  renderBreakeven(out);
}

/* ============ Boost ROI break-even (Tools tab) ============ */
function updateRoiMax() {
  const prize = +$("#in-prize-usd").value || 0;
  const lift  = +$("#in-prob-lift").value || 0;
  // Expected gain at spend S = prize * lift * S - S = S * (prize*lift - 1)
  // Positive ROI requires prize*lift > 1. Max useful S = where p(S) caps at ~1
  // (i.e. additional spend gives no extra probability). Heuristic:
  // max useful spend = 1 / lift  (after which p≈100%)
  const breakEven = lift > 0 ? 1 / lift : 0;
  // But you also shouldn't spend more than the prize itself for break-even at p=1.
  const maxSensible = Math.min(prize, breakEven);
  const out = $("#out-roi-max");
  const sub = $("#out-roi-sub");
  if (!out) return;
  if (lift <= 0 || prize <= 0) {
    out.textContent = "—";
    sub.textContent = "Set both inputs above";
    return;
  }
  out.textContent = fmtUsd(maxSensible);
  if (prize * lift < 1) {
    sub.textContent = `⚠ Lift × prize = ${(prize*lift).toFixed(2)} < 1 → boosting is unprofitable in expectation`;
  } else {
    sub.textContent = `Each $1 lifts win prob by ${(lift*100).toFixed(1)}%. Don't exceed ${fmtUsd(maxSensible)} on this block.`;
  }
}

/* ============ Maintenance discount estimator (Tools tab) ============ */
function updateDiscount() {
  const days = +$("#in-prepaid-days").value || 0;
  let pct;
  if (days < 18)         pct = 0;
  else if (days >= 360)  pct = 20;
  else                   pct = Math.round((days - 18) / (360 - 18) * 20);
  const out = $("#out-discount");
  const sub = $("#out-discount-sub");
  if (!out) return;
  out.textContent = pct + "%";
  if (days < 18)         sub.textContent = "Prepaid <18 days → no discount yet. Lock more GMT.";
  else if (days >= 360)  sub.textContent = "Maxed at 20% discount cap.";
  else                   sub.textContent = `+${pct}% off your maintenance fees this period.`;
}

/* ---------- Bonus tools (live) ---------- */
function updateBoost() {
  const pps = +$("#in-pps").value || 0;
  $("#out-boost").textContent = "+" + (pps * 100).toLocaleString() + " score";
}
function updateRoyalty() {
  const gmt = +$("#in-clan-gmt").value || 0;
  const cut = gmt * 0.05;
  const gmtUsd = +$("#in-gmt").value || 0;
  $("#out-royalty").textContent = cut.toLocaleString(undefined,{maximumFractionDigits:1}) + " GMT / week";
  $("#out-royalty-sub").textContent = "≈ " + fmtUsd(cut * gmtUsd) + " / week at current GMT price";
}

/* ---------- Wire up ---------- */
// league preset clicks — drives BOTH the comparison math and the spell-bot tiers
function selectLeague(btn) {
  document.querySelectorAll(".league-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const id      = btn.dataset.league;
  const wth     = +btn.dataset.wth;
  const density = +btn.dataset.density;
  const maxMult = +btn.dataset.maxMult;
  const entry   = btn.dataset.entry || "—";
  currentLeague = id;
  // populate league fields
  $("#in-league-wth").value = wth;
  const p = read();
  const usdGross = density * p.th;
  const btcGross = p.btcUsd > 0 ? usdGross / p.btcUsd : 0;
  $("#in-war-gross").value = btcGross.toFixed(6);
  // info card
  const name = btn.querySelector(".name").textContent.replace(/×\d+ max/i, "").trim();
  $("#li-name").textContent  = name;
  $("#li-mult").textContent  = "×" + maxMult;
  $("#li-entry").textContent = entry;
  updateFairShare();
  // rebuild spell-bot table to reflect this league's multiplier cap
  rebuildBotForLeague(maxMult);
}
document.querySelectorAll(".league-btn").forEach(btn =>
  btn.addEventListener("click", () => selectLeague(btn)));

function updateFairShare() {
  const th        = +$("#in-th").value || 0;
  const leagueSize= +$("#in-league-size").value || 0;
  const density   = +(document.querySelector(".league-btn.active")?.dataset.density) || 0;
  if (!th || !leagueSize) {
    $("#li-fair").textContent = "—";
    return;
  }
  const fairPct  = (th / leagueSize) * 100;
  const fairUsd  = th * density;
  $("#li-fair").textContent = `${fairPct.toFixed(3)}% of league · ≈ ${fmtUsd(fairUsd)} (before luck/boost variance)`;
}
$("#in-th").addEventListener("input", updateFairShare);
$("#in-league-size").addEventListener("input", updateFairShare);

$("#btn-run").addEventListener("click", () => render(simulate()));

$("#in-pps").addEventListener("input", updateBoost);
$("#in-clan-gmt").addEventListener("input", updateRoyalty);
$("#in-gmt").addEventListener("input", updateRoyalty);

// Spell Bot wiring
$("#bot-export").addEventListener("click", exportBotConfig);
$("#bot-preset-conserv").addEventListener("click", () => preset("conservative"));
$("#bot-preset-aggro").addEventListener("click",   () => preset("aggressive"));
$("#bot-preset-clear").addEventListener("click",   () => preset("clear"));
$("#bot-edge-rate").addEventListener("input", renderBot);
$("#bot-blocks-per-tier").addEventListener("input", renderBot);
$("#in-gmt").addEventListener("input", renderBot);    // GMT price affects USD math

// ---- sidebar tabs ----
function switchTab(name) {
  document.querySelectorAll(".mw-nav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".mw-tab").forEach(s =>
    s.classList.toggle("active", s.dataset.tab === name));
  window.scrollTo(0, 0);
}
document.querySelectorAll(".mw-nav-item").forEach(btn =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

// dashboard "jump to tab" buttons
document.querySelectorAll("[data-jump]").forEach(btn =>
  btn.addEventListener("click", () => switchTab(btn.dataset.jump)));

// ---- live dashboard wiring: any input change updates KPIs ----
const DASH_INPUTS = [
  "#in-th","#in-eff","#in-btc","#in-net","#in-block","#in-elec",
  "#in-disc-service","#in-disc-mining","#in-disc-vip","#in-disc-token",
  "#in-league-wth","#in-war-gross","#in-war-gmt","#in-gmt",
  "#bot-edge-rate","#bot-blocks-per-tier",
];
DASH_INPUTS.forEach(sel => {
  const el = document.querySelector(sel);
  if (el) el.addEventListener("input", updateDashboard);
});
// league click also refreshes dashboard
document.querySelectorAll(".league-btn").forEach(btn =>
  btn.addEventListener("click", () => setTimeout(updateDashboard, 0)));

// ---- Tools tab: ROI + discount calculators ----
$("#in-prize-usd")?.addEventListener("input", updateRoiMax);
$("#in-prob-lift")?.addEventListener("input", updateRoiMax);
$("#in-prepaid-days")?.addEventListener("input", updateDiscount);

// initial paint
updateBoost();
updateRoyalty();
renderFreqRow();
renderBot();
updateRoiMax();
updateDiscount();
updateDashboard();
