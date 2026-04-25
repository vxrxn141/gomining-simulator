// =============================================================
//  FIREBASE CONFIG — fill these in (see SETUP.md, step 1)
// =============================================================
//
//  After you create a Firebase project at https://console.firebase.google.com
//  and add a "Web app", Firebase shows you a config object that looks like
//  the one below. Copy each value into the matching field here.
//
export const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
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
  // "your-partner@gmail.com",
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
