// shared/auth.js
// Centralizes sign-in/out and routing + role-based view buttons.

import {
  auth, gg, signInWithPopup, signOut, onAuthStateChanged, db,
  doc, getDoc
} from "./firebase.js";

/* ---------- role helpers ---------- */
const SUPER_ADMINS = new Set(["b24408@astra.xlri.ac.in"]); // permanent super-admin(s)
const inCollege     = (e) => /@astra\.xlri\.ac\.in$/i.test(e || "");
const isSeniorEmail = (e) => /^b24/i.test(e || "") && inCollege(e);
const isJuniorEmail = (e) => /^b25/i.test(e || "") && inCollege(e);

// Firestore roles live in roles/{email}. Canonical: admin (bool).
// Back-compat: also accept isAdmin (legacy).
async function fetchExtraRoles(email) {
  try {
    const snap = await getDoc(doc(db, "roles", email.toLowerCase()));
    if (!snap.exists()) return { isAdmin: false, isCrisp: false, isOther: false };
    const d = snap.data() || {};
    const adminFlag = (typeof d.admin === "boolean") ? d.admin : !!d.isAdmin; // legacy tolerant
    return {
      isAdmin: adminFlag,
      isCrisp: !!d.isCrisp,
      isOther: !!d.isOther
    };
  } catch {
    return { isAdmin: false, isCrisp: false, isOther: false };
  }
}

/* ---------- public API ---------- */
export function attachAuthHandlers() {
  const btnLogin  = document.getElementById("btnGoogle");
  const btnLogout = document.getElementById("btnSignOut");

  if (btnLogin)  btnLogin.onclick  = async () => { try { await signInWithPopup(auth, gg); } catch(e){ alert(e.message||e); } };
  if (btnLogout) btnLogout.onclick = () => signOut(auth);

  onAuthStateChanged(auth, async (u) => {
    const path = (location.pathname || "").toLowerCase();

    // Not signed-in → always send to index (except index itself)
    if (!u) {
      if (!path.endsWith("/index.html") && path !== "/" && path !== "") {
        location.href = "/index.html";
      }
      return;
    }

    // Signed-in
    const email = (u.email || "").toLowerCase();
    const pill  = document.getElementById("authState");
    if (pill) pill.textContent = email;

    // Fetch dynamic roles (admin, crisp)
    const roles   = await fetchExtraRoles(email);
    const isAdmin = SUPER_ADMINS.has(email) || roles.isAdmin === true;
    const isCrisp = roles.isCrisp === true;

    // Index routing
    if (path.endsWith("/index.html") || path === "/" || path === "") {
      if (isSeniorEmail(email) || isAdmin) {
        location.href = "/senior.html";
      } else if (isJuniorEmail(email)) {
        location.href = "/junior.html";
      } else {
        alert("Please use your college email (@astra.xlri.ac.in)");
        await signOut(auth);
      }
      return;
    }

    // Role buttons (if present)
    const adminBtn = document.getElementById("btnAdminView");
    const crispBtn = document.getElementById("btnCrispView");

    if (adminBtn) {
      adminBtn.style.display = isAdmin ? "inline-block" : "none";
      if (isAdmin) adminBtn.onclick = () => { location.href = "/admin.html"; };
    }
    if (crispBtn) {
      crispBtn.style.display = isCrisp ? "inline-block" : "none";
      if (isCrisp) crispBtn.onclick = () => { location.href = "/crisp.html"; };
    }

    // Page guards
    if (path.endsWith("/senior.html")) {
      if (!(isSeniorEmail(email) || isAdmin)) location.href = "/index.html";
    }
    if (path.endsWith("/junior.html")) {
      if (!isJuniorEmail(email)) location.href = "/index.html";
    }
    if (path.endsWith("/admin.html")) {
      // Only admins (super-admin OR roles.admin/legacy isAdmin)
      if (!isAdmin) location.href = "/index.html";
    }
    if (path.endsWith("/crisp.html")) {
      // CRISP members; allow admins too if you want them to access CRISP view
      if (!(isCrisp || isAdmin)) location.href = "/index.html";
    }
  });
}