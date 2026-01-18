// shared/auth.js
// Centralizes sign-in/out, routing, role fetch, and guards.
// Season-aware page access using /settings/app.reverseRoles.

import {
  auth, gg, signInWithPopup, signOut, onAuthStateChanged, db,
  doc, getDoc, setDoc
} from "./firebase.js";

/* ---------- role helpers ---------- */
const SUPER_ADMINS = new Set(["b24408@astra.xlri.ac.in"]); // permanent super-admin(s)
const inCollege     = (e) => /@astra\.xlri\.ac\.in$/i.test(e || "");
const isSeniorEmail = (e) => /^b24/i.test(e || "") && inCollege(e);
const isJuniorEmail = (e) => /^b25/i.test(e || "") && inCollege(e);

/* ---------- fetch roles from Firestore (lowercased key for UI) ---------- */
async function fetchRolesLower(emailLower) {
  try {
    const ref = doc(db, "roles", (emailLower || "").toLowerCase());
    const snap = await getDoc(ref);
    if (!snap.exists()) return { admin: false, isAdmin: false, isCrisp: false, acadcom: false };
    const d = snap.data() || {};
    return {
      admin:  !!d.admin,
      isAdmin:!!d.isAdmin,        // legacy back-compat
      isCrisp:!!d.isCrisp,
      acadcom:!!d.acadcom
    };
  } catch {
    return { admin: false, isAdmin: false, isCrisp: false, acadcom: false };
  }
}

/* ---------- mirror roles to the exact-cased doc ID for rules ---------- */
async function ensureExactCaseRoleDoc(emailExact, rolesObj){
  // If we already have a doc with the exact email id, great; if not, write it.
  try {
    const exactRef = doc(db, "roles", emailExact);
    const snap = await getDoc(exactRef);
    if (snap.exists()) {
      // Optional: keep exact doc fresh if it diverges
      const d = snap.data() || {};
      const equal =
        !!d.admin   === !!rolesObj.admin   &&
        !!d.isAdmin === !!rolesObj.isAdmin &&
        !!d.isCrisp === !!rolesObj.isCrisp &&
        !!d.acadcom === !!rolesObj.acadcom;
      if (!equal) {
        await setDoc(exactRef, {
          admin: !!rolesObj.admin,
          isAdmin: !!rolesObj.isAdmin,
          isCrisp: !!rolesObj.isCrisp,
          acadcom: !!rolesObj.acadcom
        }, { merge: true });
      }
    } else {
      await setDoc(exactRef, {
        admin: !!rolesObj.admin,
        isAdmin: !!rolesObj.isAdmin,
        isCrisp: !!rolesObj.isCrisp,
        acadcom: !!rolesObj.acadcom
      }, { merge: true });
    }
  } catch {
    // fail-soft; UI can still render but rules might block until next successful mirror
  }
}

/* ---------- fetch season (reverse roles) ---------- */
async function fetchSeasonReverse() {
  try {
    const ref = doc(db, "settings", "app");
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    const d = snap.data() || {};
    return !!d.reverseRoles;
  } catch {
    return false; // safe default
  }
}

/* ---------- UI helpers ---------- */
function $(id)   { return document.getElementById(id); }
function show(el, on) { if (el) el.style.display = on ? "inline-block" : "none"; }
// get all elements with the same id (header pill + in-page button may coexist)
function $all(id) { return Array.from(document.querySelectorAll(`#${id}`)); }

/* ---------- public API: attach handlers ---------- */
export function attachAuthHandlers() {
  // Sign-in
  const btnGoogle = $("btnGoogle");
  if (btnGoogle) {
    btnGoogle.onclick = async () => {
      try { await signInWithPopup(auth, gg); }
      catch (e) { console.error(e); alert(e?.message || e); }
    };
  }

  // Sign-out
  const btnSignOut = $("btnSignOut");
  if (btnSignOut) {
    btnSignOut.onclick = async () => {
      try { await signOut(auth); }
      catch (e) { console.error(e); alert(e?.message || e); }
    };
  }

  // Central auth state handler
  onAuthStateChanged(auth, async (u) => {
    const path = (location.pathname || "").toLowerCase();

    // Not signed-in → send to index (except index itself)
    if (!u) {
      if (!path.endsWith("/index.html") && path !== "/" && path !== "") {
        location.href = "/index.html";
      }
      return;
    }

    // Signed-in
    const emailExact = String(u.email || "");
    const emailLower = emailExact.toLowerCase();

    const pill  = $("authState");
    if (pill) pill.textContent = emailLower;

    // College domain gating
    if (!inCollege(emailLower)) {
      alert("Please use your @astra.xlri.ac.in account.");
      await signOut(auth);
      return;
    }

    // Resolve roles (UI source of truth = lowercased key)
    const r = await fetchRolesLower(emailLower);

    // **Mirror** to exact-cased doc so RULES `isAdmin()` sees the same flags
    await ensureExactCaseRoleDoc(emailExact, r);

    const isAdmin = SUPER_ADMINS.has(emailLower) || r.admin || r.isAdmin; // canonical OR legacy OR super
    const isCrisp = !!r.isCrisp;
    const isAcad  = !!r.acadcom;

    // Season flag (reverse roles?)
    const isReverse = await fetchSeasonReverse();

    // Post-login redirect: index -> Home
    if (path.endsWith("/index.html") || path === "/" || path === "") {
      location.href = "/home.html";
      return;
    }

    // -------- View pills/buttons (header + in-page) ----------
    // Only show Acadcom to Acadcom (NOT to Admins).
    const targets = {
      admin:  $all("btnAdminView"),
      crisp:  $all("btnCrispView"),
      acad:   $all("btnAcadcomView")
    };

    targets.admin.forEach(el => { show(el, isAdmin); el.onclick = () => (location.href="/admin.html"); });
    targets.crisp.forEach(el => { show(el, isCrisp); el.onclick = () => (location.href="/crisp.html"); });
    targets.acad .forEach(el => { show(el, isAcad ); el.onclick = () => (location.href="/acadcom.html"); });

    // -------- Season-aware page guards --------
    const allowSeniorPage =
      (!isReverse && isSeniorEmail(emailLower)) ||
      ( isReverse && isJuniorEmail(emailLower)) ||
      isAdmin;

    const allowJuniorPage =
      (!isReverse && isJuniorEmail(emailLower)) ||
      ( isReverse && isSeniorEmail(emailLower)) ||
      isAdmin;

    if (path.endsWith("/senior.html") && !allowSeniorPage) {
      location.href = "/index.html";
      return;
    }
    if (path.endsWith("/junior.html") && !allowJuniorPage) {
      location.href = "/index.html";
      return;
    }

    if (path.endsWith("/admin.html") && !isAdmin) {
      location.href = "/index.html";
      return;
    }
    if (path.endsWith("/crisp.html") && !(isCrisp || isAdmin)) {
      location.href = "/index.html";
      return;
    }
    // Acadcom page: **Acadcom only** (Admins no longer see/enter it)
    if (path.endsWith("/acadcom.html") && !isAcad) {
      location.href = "/index.html";
      return;
    }
  });
}