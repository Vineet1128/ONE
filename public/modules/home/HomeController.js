// public/modules/home/HomeController.js
// Adds Season features on top of the working baseline:
// - Shows season banner (seasonName / reverseRoles) from ConfigService (/settings/app)
// - Swaps Preparation destination if reverseRoles is ON

import { ConfigService } from "/shared/services/ConfigService.js";
import { on as busOn } from "/shared/bus.js";

export class HomeController {
  constructor({ email }) {
    this.email = (email || "").toLowerCase();
    this.$ = (id) => document.getElementById(id);

    this.reverseRoles = false;
    this.seasonName = "";
    this.config = new ConfigService();
    this.unsubConfig = null;
    this.unsubBus = null;

    this.isSeniorEmail = (e) => /^b24.*@astra\.xlri\.ac\.in$/i.test(e||"");
    this.isJuniorEmail = (e) => /^b25.*@astra\.xlri\.ac\.in$/i.test(e||"");
  }

  init() {
    // Wire view buttons (visibility already handled by auth.js)
    const go = (p) => ()=> location.href = p;
    const admin = this.$("btnAdminView");
    const crisp = this.$("btnCrispView");
    const acad  = this.$("btnAcadcomView");
    if (admin) admin.onclick = go("/admin.html");
    if (crisp) crisp.onclick = go("/crisp.html");
    if (acad)  acad.onclick  = go("/acadcom.html");

    // Subscribe to season config and reflect immediately
    this.unsubConfig = this.config.subscribe();
    this.unsubBus = busOn("config:updated", (state) => {
      this.reverseRoles = !!state.reverseRoles;
      this.seasonName   = state.seasonName || "";
      this.#reflectSeasonBanner();
      this.#maybeSwapPrepLink();
    });

    const s = this.config.state || {};
    this.reverseRoles = !!s.reverseRoles;
    this.seasonName   = s.seasonName || "";
    this.#reflectSeasonBanner();
    this.#maybeSwapPrepLink();
  }

  destroy() {
    try { if (typeof this.unsubConfig === "function") this.unsubConfig(); } catch {}
    try { if (typeof this.unsubBus === "function") this.unsubBus(); } catch {}
  }

  #maybeSwapPrepLink() {
    if (!this.reverseRoles) return; // baseline already set normal link
    const btn  = this.$("btnPreparation");
    const hint = this.$("prepHint");
    if (!btn) return;

    const senior = this.isSeniorEmail(this.email);
    const junior = this.isJuniorEmail(this.email);

    let href = senior ? "/junior.html" : (junior ? "/senior.html" : "#");
    let msg  = senior
      ? "Roles reversed: Senior accessing Junior prep."
      : (junior ? "Roles reversed: Junior providing Senior-style prep."
                : "Your cohort could not be inferred from email.");

    if (href === "#") btn.removeAttribute("href"); else btn.href = href;
    if (hint) hint.textContent = msg;
  }

  #reflectSeasonBanner() {
    const banner = this.$("seasonBanner");
    if (!banner) return;
    if (!this.reverseRoles && !this.seasonName) {
      banner.style.display = "none";
      banner.textContent = "";
      return;
    }
    const parts = [];
    if (this.seasonName) parts.push(`Season: ${this.seasonName}`);
    if (this.reverseRoles) parts.push("Roles reversed");
    banner.textContent = parts.join(" — ");
    banner.style.display = "block";
  }
}