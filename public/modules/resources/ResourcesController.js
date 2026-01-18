// /modules/resources/ResourcesController.js
import { RoutineService } from "/shared/services/RoutineService.js";

const inCollege     = (e) => /@astra\.xlri\.ac\.in$/i.test(e || "");
const isSeniorEmail = (e) => /^b24/i.test(e || "") && inCollege(e);
const isJuniorEmail = (e) => /^b25/i.test(e || "") && inCollege(e);

const norm = (s) => String(s ?? "").trim();

export class ResourcesController {
  constructor({ email }) {
    this.email = (email || "").toLowerCase();
    this.cohort = isSeniorEmail(this.email) ? "senior"
                : isJuniorEmail(this.email) ? "junior" : "";
    this.settings = {};
  }

  async init() {
    this.cacheEls();
    await this.loadSettings();
    this.renderIntro();
    this.buildTermOptions();
    this.bind();
    this.renderLink();
  }

  cacheEls() {
    this.e = {
      intro:  document.getElementById("resIntro"),
      select: document.getElementById("termSelect"),
      wrap:   document.getElementById("linkWrap"),
    };
  }

  async loadSettings() {
    this.settings = await RoutineService.getSettings(); // contains termNResourcesUrl + current terms
  }

  renderIntro() {
    const term = this.cohort === "senior"
      ? (this.settings.seniorTerm || this.settings.termSenior || "—")
      : (this.settings.juniorTerm || this.settings.termJunior || "—");
    const cohortLabel = this.cohort ? (this.cohort[0].toUpperCase()+this.cohort.slice(1)) : "Unknown";
    if (this.e.intro) {
      this.e.intro.textContent =
        `${cohortLabel} resources. Current term: ${term || "—"}. Choose a term to open its link.`;
    }
  }

  buildTermOptions() {
    if (!this.e.select) return;
    const maxTerm = this.cohort === "senior" ? 6 : 3;
    const current = this.cohort === "senior"
      ? Number(this.settings.seniorTerm || this.settings.termSenior || 1)
      : Number(this.settings.juniorTerm || this.settings.termJunior || 1);

    const opts = [];
    for (let t = 1; t <= maxTerm; t++) {
      opts.push(`<option value="${t}" ${t===current ? "selected" : ""}>${t}</option>`);
    }
    this.e.select.innerHTML = opts.join("");
  }

  bind() {
    if (this.e.select) {
      this.e.select.onchange = () => this.renderLink();
    }
  }

  getUrlForTerm(t) {
    const key = `term${t}ResourcesUrl`;
    return norm(this.settings[key] || "");
  }

  renderLink() {
    if (!this.e.wrap) return;
    const term = Number(this.e.select?.value || 1);
    const url = this.getUrlForTerm(term);

    if (!url) {
      this.e.wrap.innerHTML = `<div class="empty">No link saved for Term ${term}.</div>`;
      return;
    }

    this.e.wrap.innerHTML = `
      <div class="card" style="margin:0">
        <div class="link-box">
          <div>
            <div class="small" style="color:var(--muted)">Showing resources for</div>
            <div style="font-weight:700">Term ${term}</div>
          </div>
          <a class="btn" href="${url}" target="_blank" rel="noopener">Open Term ${term} Resources</a>
        </div>
      </div>
    `;
  }
}