// /shared/ui.js
export const qs  = (s, r=document) => r.querySelector(s);
export const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s||"").replace(/[&<>\'"/]/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;", "\"":"&quot;","'":"&#39;" }[c]));
export const fmtHM = (s) => (s||"").padStart(5,"0");
export const toLocalDate     = (ts) => ts?.toDate?.()?.toLocaleDateString?.() || "";
export const toLocalDateTime = (ts) => ts?.toDate?.()?.toLocaleString?.()     || "";

/**
 * After you set: header.innerHTML = renderHeader(...)
 * call: initHeaderLogoFallback(document) (or pass the header node)
 *
 * This prevents "ONE logo not showing" if the preferred file name/path differs.
 * If callers don't call it, the primary src still works (no behavior change).
 */
export const initHeaderLogoFallback = (root = document) => {
  const img = root?.querySelector?.("#oneHeaderLogo");
  if (!img) return;

  const fallbacks = [
    "/assets/brand/one/one-lockup.png",
    "/assets/brand/one/one-logo-dark.png",
    "/assets/brand/one/one-mark-512.png",
    "/assets/brand/one/one-mark-192.png"
  ];

  // Ensure first src is set
  if (!img.getAttribute("src")) img.src = fallbacks[0];

  let idx = 0;
  img.onerror = () => {
    idx += 1;
    if (idx < fallbacks.length) img.src = fallbacks[idx];
  };
};

/**
 * Shared header renderer (used across pages).
 * - Keeps IDs used by auth.js: btnSignOut, btnAdminView, btnCrispView, btnAcadcomView
 * - Season bar (optional): can show Home icon + view pills
 * - Accepts legacy params (title/email) without breaking callers
 *
 * Assets expected (public/):
 *  - /assets/brand/xlri/xlri-mark.png
 *  - /assets/brand/one/one-lockup.png   (preferred)
 *  - /assets/brand/one/one-logo-dark.png
 *  - /assets/brand/one/one-mark-512.png
 *  - /assets/brand/one/one-mark-192.png
 */
export const renderHeader = (opts) => {
  const {
    // legacy, safe to accept (some pages pass these)
    title = "",
    email = "",

    showAdmin   = false,
    showCrisp   = false,
    showAcadcom = false,

    seasonText = "",          // e.g. "Season: SIP — Roles reversed"
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
      <div class="topbar__left">
        <a href="/home.html" class="brand" aria-label="ONE Home">
          <img src="/assets/brand/xlri/xlri-mark.png" alt="XLRI" loading="eager" decoding="async">
        </a>
      </div>

      <div class="topbar__center">
        <a href="/home.html" class="brand brand--center" aria-label="ONE Home">
          <img
            id="oneHeaderLogo"
            src="/assets/brand/one/one-lockup.png"
            alt="ONE — Built by XLRI Students"
            loading="eager"
            decoding="async"
          >
        </a>
      </div>

      <div class="topbar__right">
        <button class="btn" id="btnSignOut" type="button">Sign out</button>
      </div>
    </div>
    ${seasonBar}
  `;
};