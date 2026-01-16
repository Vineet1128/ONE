export const qs = (s, r=document) => r.querySelector(s);
export const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s||"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
export const fmtHM = (s) => (s||"").padStart(5,"0");
export const toLocalDate = (ts) => ts?.toDate?.()?.toLocaleDateString?.() || "";
export const toLocalDateTime = (ts) => ts?.toDate?.()?.toLocaleString?.() || "";

export const renderHeader = (opts) => {
  const { title, showAdmin=false, showCrisp=false, email="" } = opts;
  return `
  <div class="topbar">
    <div class="brand">
      <img src="/assets/logo.png" alt="Prometheus">
      <span>${esc(title)}</span>
    </div>
    <div class="spread"></div>
    <span class="pill" id="authState">${esc(email||"Not signed in")}</span>
    <button class="btn light" id="btnCrispView" style="display:${showCrisp?'inline-block':'none'}">CRISP view</button>
    <button class="btn light" id="btnAdminView" style="display:${showAdmin?'inline-block':'none'}">Admin</button>
    <button class="btn" id="btnSignOut">Sign out</button>
  </div>`;
};