// =============================================================
//  FIREBASE CONFIG — fill these in (see SETUP.md, step 1)
// =============================================================
//
//  After you create a Firebase project at https://console.firebase.google.com
//  and add a "Web app", Firebase shows you a config object that looks like
//  the one below. Copy each value into the matching field here.
//
export const firebaseConfig = {
  apiKey:            "AIzaSyDrahjXgbfpsFoVKnBFc4IWaJbTkAI6G3M",
  authDomain:        "gomining-sim.firebaseapp.com",
  projectId:         "gomining-sim",
  storageBucket:     "gomining-sim.firebasestorage.app",
  messagingSenderId: "721928880096",
  appId:             "1:721928880096:web:3b7122a5d88ef4010bf585",
  measurementId:     "G-3DLB64E98W",
};

// =============================================================
//  ADMIN ACCESS — Google accounts that can open admin.html
// =============================================================
//
//  Add the *exact* Gmail address you (and your partner) sign in with.
//  Anyone NOT on this list will be blocked from /admin.html, even if
//  they manage to navigate there.
//
export const ADMIN_EMAILS = [
  "varunvatnani@gmail.com",
  "jeremie.gauvin22@gmail.com",
];

// =============================================================
//  GOOGLE ADSENSE — your publisher ID (see SETUP.md, step 4)
// =============================================================
//
//  Once AdSense approves your site you'll get a "ca-pub-XXXXXXXXXXXXXXXX"
//  publisher ID. Paste it here. Until then, leave the placeholder — the
//  ad slots will simply render blank.
//
export const ADSENSE_PUBLISHER_ID = "ca-pub-XXXXXXXXXXXXXXXX";

// Optional individual ad-slot IDs (you create these in AdSense → Ads → By ad unit)
export const ADSENSE_SLOTS = {
  dashboardBanner: "0000000000",
  sidebarRail:     "0000000000",
};
