// =============================================================
//  tracking.js — page views, session length, feature usage
// =============================================================
//
//  Records (per signed-in user):
//    users/{uid}.totalPageViews     (number)
//    users/{uid}.totalSessionMs     (number, ms across all sessions)
//    users/{uid}.sessionCount       (number)
//    users/{uid}.featureUsage.{tab} (number, per section opened)
//    users/{uid}/sessions/{sid}     (one doc per browser session)
//
//  All writes are gated on a signed-in user — anonymous visitors
//  are not tracked.  We rely on the legacy app's existing global
//  switchTab(name) function and monkey-patch it to log feature use.
//
import { auth, db, onUserReady } from "./auth.js";
import {
  doc, setDoc, updateDoc, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FLUSH_EVERY_MS = 30_000;   // periodic session-doc heartbeat
let   sessionId      = null;
let   sessionStart   = 0;
let   pageViews      = 0;
let   pendingFeatures = {};      // batched until next flush
let   dirty          = false;
// running totals so we can apply *deltas* to user-doc aggregates and
// stay accurate even if the tab is closed without an explicit sign-out
let   flushedPageViews     = 0;
let   flushedDurationMs    = 0;
let   sessionCounted       = false;

function uid() { return auth.currentUser?.uid || null; }

// ---------- session lifecycle ----------
async function startSession() {
  if (!uid()) return;
  sessionId        = (crypto.randomUUID && crypto.randomUUID()) ||
                     Date.now() + "-" + Math.random().toString(36).slice(2);
  sessionStart        = Date.now();
  pageViews           = 1;
  pendingFeatures     = {};
  dirty               = true;
  flushedPageViews    = 0;
  flushedDurationMs   = 0;
  sessionCounted      = false;
  try {
    await setDoc(doc(db, "users", uid(), "sessions", sessionId), {
      startedAt:  serverTimestamp(),
      userAgent:  navigator.userAgent,
      referrer:   document.referrer || null,
      pageViews:  1,
      features:   {},
    });
  } catch (e) { console.warn("startSession failed:", e); }
}

async function endSession() {
  if (!uid() || !sessionId) return;
  try {
    await flush();   // flush also stamps endedAt + final durationMs
    await updateDoc(doc(db, "users", uid(), "sessions", sessionId), {
      endedAt: serverTimestamp(),
    });
  } catch (e) { console.warn("endSession failed:", e); }
  sessionId = null;
}

async function flush() {
  if (!uid() || !sessionId) return;
  const nowMs       = Date.now();
  const durationMs  = nowMs - sessionStart;
  const pvDelta     = pageViews    - flushedPageViews;
  const durDelta    = durationMs   - flushedDurationMs;
  // session-doc snapshot (always safe to write — just overwrites scalars)
  const sessionUpd  = {
    pageViews,
    durationMs,
    lastHeartbeatAt: serverTimestamp(),
  };
  for (const [k, v] of Object.entries(pendingFeatures)) {
    sessionUpd[`features.${k}`] = increment(v);
  }
  // user-doc aggregate deltas
  const userUpd = {};
  if (pvDelta  > 0) userUpd.totalPageViews = increment(pvDelta);
  if (durDelta > 0) userUpd.totalSessionMs = increment(durDelta);
  if (!sessionCounted) userUpd.sessionCount = increment(1);
  for (const [k, v] of Object.entries(pendingFeatures)) {
    userUpd[`featureUsage.${k}`] = increment(v);
  }
  try {
    await updateDoc(doc(db, "users", uid(), "sessions", sessionId), sessionUpd);
    if (Object.keys(userUpd).length) {
      await updateDoc(doc(db, "users", uid()), userUpd);
    }
    pendingFeatures   = {};
    flushedPageViews  = pageViews;
    flushedDurationMs = durationMs;
    sessionCounted    = true;
    dirty             = false;
  } catch (e) { console.warn("flush failed:", e); }
}

// ---------- public API ----------
export function trackFeature(name) {
  if (!uid() || !sessionId) return;
  pendingFeatures[name] = (pendingFeatures[name] || 0) + 1;
  pageViews += 1;
  dirty = true;
}

// ---------- patch the legacy switchTab so every nav click logs ----------
function patchSwitchTab() {
  const orig = window.switchTab;
  if (typeof orig !== "function" || orig.__patched) return false;
  const wrapped = function (name) {
    try { trackFeature(String(name || "unknown")); } catch {}
    return orig.apply(this, arguments);
  };
  wrapped.__patched = true;
  window.switchTab = wrapped;
  return true;
}
// switchTab is defined inside an inline <script> block, so it may not
// exist immediately. Retry a few times before giving up.
function tryPatch(retries = 20) {
  if (patchSwitchTab()) return;
  if (retries > 0) setTimeout(() => tryPatch(retries - 1), 250);
}

// ---------- wiring ----------
window.addEventListener("auth-changed", async (e) => {
  if (e.detail.user) await startSession();
  else if (sessionId) await endSession();
});

// flush periodically while idle
setInterval(() => { flush().catch(() => {}); }, FLUSH_EVERY_MS);

// best-effort flush on tab close
window.addEventListener("beforeunload", () => { flush().catch(() => {}); });
window.addEventListener("pagehide",     () => { flush().catch(() => {}); });

// kick off
window.addEventListener("load", () => tryPatch());
onUserReady(() => { /* startSession runs via auth-changed */ });
