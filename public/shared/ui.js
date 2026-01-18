// /shared/ui.js
export const qs  = (s, r=document) => r.querySelector(s);
export const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s||"").replace(/[&<>\'"/]/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
export const fmtHM = (s) => (s||"").padStart(5,"0");
export const toLocalDate     = (ts) => ts?.toDate?.()?.toLocaleDateString?.() || "";
export const toLocalDateTime = (ts) => ts?.toDate?.()?.toLocaleString?.()     || "";

/**
 * OPAXI header renderer (shared across pages).
 * - Keeps IDs used by auth.js: btnSignOut, btnAdminView, btnCrispView, btnAcadcomView
 * - No email chip (matches Home).
 * - When `seasonText` is passed, renders a second row where we place:
 *   [left] season text, [right] Home icon + view pills.
 */
export const renderHeader = (opts) => {
  const {
    showAdmin   = false,
    showCrisp   = false,
    showAcadcom = false,

    seasonText = "",          // e.g. "Season: SIP"
    showHomeInSeason = false, // show Home icon in the season bar
  } = opts || {};

  const pillsHtml = `
    <button class="btn light" id="btnCrispView"   style="display:${showCrisp   ?'inline-flex':'none'}">CRISP</button>
    <button class="btn light" id="btnAdminView"   style="display:${showAdmin   ?'inline-flex':'none'}">Admin</button>
    <button class="btn light" id="btnAcadcomView" style="display:${showAcadcom ?'inline-flex':'none'}">Acadcom</button>
  `;

  const seasonBar = seasonText ? `
    <div class="seasonbar">
      <div class="seasonbar__left">${esc(seasonText)}</div>
      <div class="seasonbar__right">
        ${showHomeInSeason ? `<a href="/home.html" class="iconbtn" aria-label="Go to Home" title="Home">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z"/></svg>
        </a>` : ""}
        ${pillsHtml}
      </div>
    </div>
  ` : "";

  return `
    <div class="topbar">
      <!-- Left: Prometheus logo (link to Home) -->
      <div class="topbar__left">
        <a href="/home.html" class="brand" aria-label="OPAXI Home">
          <img src="/assets/logo.png" alt="Prometheus">
        </a>
      </div>

      <!-- Center: ONE logo -->
      <div class="topbar__center">
        <img src="/assets/one_logo.jpeg" alt="ONE Logo" style="height: 28px; border-radius: 6px;">
      </div>

      <!-- Right: Sign out -->
      <div class="topbar__right">
        <button class="btn" id="btnSignOut">Sign out</button>
      </div>
    </div>
    ${seasonBar}
  `;
};