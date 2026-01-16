// public/js/admin.js
// Admin, CRISP, Acadcom management + Season editor with live feedback.

import {
  auth, db,
  doc, setDoc, getDoc, onSnapshot, collection, query, where,
  serverTimestamp
} from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ------------------- helpers ------------------- */
const $  = (id) => document.getElementById(id);
const isCollege = (e)=>/@astra\.xlri\.ac\.in$/i.test(e||"");
const trim = (s)=>String(s||"").trim();
const fmt = (ts)=> ts?.toDate?.()?.toLocaleString?.() || "";

/* Write to BOTH role doc IDs to defeat case-mismatch issues:
   - exact email (trimmed) -> matches rules' roles/{request.auth.token.email}
   - lowercased email      -> back-compat with older codepaths
*/
async function writeRoleDocs(emailRaw, payload){
  const exact = trim(emailRaw);
  const lower = exact.toLowerCase();

  const refExact = doc(db, "roles", exact);
  const refLower = doc(db, "roles", lower);

  // Always merge; keep timestamps in payload provided by caller
  await Promise.all([
    setDoc(refExact, payload, { merge: true }),
    setDoc(refLower, payload, { merge: true })
  ]);
}

/* ------------------- Season card ------------------- */
(function seasonCard(){
  const chk = $("chkReverseRoles");
  const name= $("seasonName");
  const btn = $("btnSaveSeason");
  const msg = $("seasonMsg");
  const meta= $("seasonMeta");
  if (!chk || !name || !btn) return;

  const ref = doc(db,"settings","app");

  onSnapshot(ref, (snap)=>{
    const d = snap.exists() ? (snap.data()||{}) : {};
    chk.checked = !!d.reverseRoles;
    name.value  = String(d.seasonName || "");
    meta.textContent =
      `Current: ${d.seasonName || "—"} • Reverse roles: ${d.reverseRoles ? "ON":"OFF"}`
      + (d.lastChanged ? ` • Updated ${fmt(d.lastChanged)}` : "")
      + (d.changedBy ? ` by ${d.changedBy}` : "");
  }, (err)=>{
    if (msg){ msg.textContent = err?.message || String(err); msg.className="msg err"; }
  });

  onAuthStateChanged(auth, (u)=>{
    btn.onclick = async ()=>{
      if (msg){ msg.textContent=""; msg.className="msg"; }
      try {
        await setDoc(ref, {
          reverseRoles: !!chk.checked,
          seasonName: String(name.value||""),
          lastChanged: serverTimestamp(),
          changedBy: trim(u?.email || "")
        }, { merge:true });
        if (msg){ msg.textContent="Season settings saved."; msg.className="msg ok"; }
      } catch (e) {
        if (msg){ msg.textContent=(e?.message || String(e)); msg.className="msg err"; }
        console.error("Season save failed:", e);
      }
    };
  });
})();

/* ------------------- Acadcom ------------------- */
(function acadcom(){
  const body   = $("acadTBody");
  const addBtn = $("btnAddAcad");
  const remBtn = $("btnRemoveAcad");
  const emailI = $("acadEmail");
  const msg    = $("acadMsg");
  if (!body) return;

  const q = query(collection(db,"roles"), where("acadcom","==",true));
  onSnapshot(q, (snap)=>{
    const rows = snap.docs.map(d=>({ email:d.id, ...d.data() }));
    body.innerHTML = rows.length
      ? rows.map(r=>`<tr><td>${r.email}</td><td>${fmt(r.updatedAt)}</td></tr>`).join("")
      : `<tr><td class="small" colspan="2">No Acadcom members yet.</td></tr>`;
  }, (err)=>{ if (msg){ msg.textContent = err?.message || String(err); msg.className="msg err"; } });

  const apply = async (flag)=>{
    const emailRaw = trim(emailI.value);
    msg.textContent=""; msg.className="msg";
    if (!isCollege(emailRaw)) { msg.textContent="Enter a valid @astra.xlri.ac.in email."; msg.className="msg err"; return; }
    try {
      // ✅ Independent role: toggle ONLY acadcom; do not touch admin/isAdmin
      const payload = { acadcom: !!flag, updatedAt: serverTimestamp() };

      await writeRoleDocs(emailRaw, payload);

      msg.textContent = flag ? "Acadcom added." : "Acadcom removed.";
      msg.className="msg ok"; emailI.value="";
    } catch (e) {
      msg.textContent = e?.message || String(e); msg.className="msg err";
    }
  };
  if (addBtn) addBtn.onclick = ()=> apply(true);
  if (remBtn) remBtn.onclick = ()=> apply(false);
})();

/* ------------------- Admins ------------------- */
(function admins(){
  const body   = $("adminTBody");
  const addBtn = $("btnAddAdmin");
  const remBtn = $("btnRemoveAdmin");
  const emailI = $("adminEmail");
  const msg    = $("adminMsg");
  if (!body) return;

  const q = query(collection(db,"roles"), where("admin","==",true));
  onSnapshot(q, (snap)=>{
    const rows = snap.docs.map(d=>({ email:d.id, ...d.data() }));
    body.innerHTML = rows.length
      ? rows.map(r=>`<tr><td>${r.email}</td><td>${fmt(r.updatedAt)}</td></tr>`).join("")
      : `<tr><td class="small" colspan="2">No admins yet.</td></tr>`;
  }, (err)=>{ if (msg){ msg.textContent = err?.message || String(err); msg.className="msg err"; } });

  const apply = async (flag)=>{
    const emailRaw = trim(emailI.value);
    msg.textContent=""; msg.className="msg";
    if (!isCollege(emailRaw)) { msg.textContent="Enter a valid @astra.xlri.ac.in email."; msg.className="msg err"; return; }

    // Guard in UI (rules already protect founder)
    const FOUNDER = "b24408@astra.xlri.ac.in";
    if (!flag && emailRaw.toLowerCase() === FOUNDER) {
      msg.textContent = "The founder admin cannot be removed."; msg.className="msg err";
      return;
    }

    try {
      const base = { updatedAt: serverTimestamp() };
      let payload;
      if (flag) {
        // ✅ Independent role: set admin flags; DO NOT touch acadcom
        payload = { ...base, admin: true,  isAdmin: true };
      } else {
        // Remove Admin ⇒ keep any other roles as-is
        payload = { ...base, admin: false, isAdmin: false };
      }

      await writeRoleDocs(emailRaw, payload);

      msg.textContent = flag ? "Admin added." : "Admin removed.";
      msg.className="msg ok"; emailI.value="";
    } catch (e) {
      msg.textContent = e?.message || String(e); msg.className="msg err";
    }
  };
  if (addBtn) addBtn.onclick = ()=> apply(true);
  if (remBtn) remBtn.onclick = ()=> apply(false);
})();

/* ------------------- CRISP ------------------- */
(function crisp(){
  const body   = $("crispTBody");
  const addBtn = $("btnAddCrisp");
  const remBtn = $("btnRemoveCrisp");
  const emailI = $("crispEmail");
  const msg    = $("crispMsg");
  if (!body) return;

  const q = query(collection(db,"roles"), where("isCrisp","==",true));
  onSnapshot(q, (snap)=>{
    const rows = snap.docs.map(d=>({ email:d.id, ...d.data() }));
    body.innerHTML = rows.length
      ? rows.map(r=>`<tr><td>${r.email}</td><td>${fmt(r.updatedAt)}</td></tr>`).join("")
      : `<tr><td class="small" colspan="2">No CRISP members yet.</td></tr>`;
  }, (err)=>{ if (msg){ msg.textContent = err?.message || String(err); msg.className="msg err"; } });

  const apply = async (flag)=>{
    const emailRaw = trim(emailI.value);
    msg.textContent=""; msg.className="msg";
    if (!isCollege(emailRaw)) { msg.textContent="Enter a valid @astra.xlri.ac.in email."; msg.className="msg err"; return; }
    try {
      // Independent role: just toggle CRISP
      await writeRoleDocs(emailRaw, { isCrisp: !!flag, updatedAt: serverTimestamp() });
      msg.textContent = flag ? "CRISP added." : "CRISP removed.";
      msg.className="msg ok"; emailI.value="";
    } catch (e) {
      msg.textContent = e?.message || String(e); msg.className="msg err";
    }
  };
  if (addBtn) addBtn.onclick = ()=> apply(true);
  if (remBtn) remBtn.onclick = ()=> apply(false);
})();

/* ------------------- Alcom (NEW, additive only) ------------------- */
(function alcom(){
  const body   = $("alcomTBody");
  const addBtn = $("btnAddAlcom");
  const remBtn = $("btnRemoveAlcom");
  const emailI = $("alcomEmail");
  const msg    = $("alcomMsg");
  if (!body) return;

  const q = query(collection(db,"roles"), where("alcom","==",true));
  onSnapshot(q, (snap)=>{
    const rows = snap.docs.map(d=>({ email:d.id, ...d.data() }));
    body.innerHTML = rows.length
      ? rows.map(r=>`<tr><td>${r.email}</td><td>${fmt(r.updatedAt)}</td></tr>`).join("")
      : `<tr><td class="small" colspan="2">No Alcom members yet.</td></tr>`;
  }, (err)=>{ if (msg){ msg.textContent = err?.message || String(err); msg.className="msg err"; } });

  const apply = async (flag)=>{
    const emailRaw = trim(emailI.value);
    msg.textContent=""; msg.className="msg";
    if (!isCollege(emailRaw)) { msg.textContent="Enter a valid @astra.xlri.ac.in email."; msg.className="msg err"; return; }
    try {
      // ✅ Independent role: just toggle Alcom
      await writeRoleDocs(emailRaw, { alcom: !!flag, updatedAt: serverTimestamp() });
      msg.textContent = flag ? "Alcom added." : "Alcom removed.";
      msg.className="msg ok"; emailI.value="";
    } catch (e) {
      msg.textContent = e?.message || String(e); msg.className="msg err";
    }
  };
  if (addBtn) addBtn.onclick = ()=> apply(true);
  if (remBtn) remBtn.onclick = ()=> apply(false);
})();