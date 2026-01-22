// /modules/plan/PlanController.js
//
// Plan (Calendar) — built from scratch
// - No existing functionality is changed (new page/module).
// - Uses existing services/parsers:
//   ProfileService, RoutineService, RoutineParsers
// - View-only: no new Firestore writes.
// - Unified calendar: classes + exams + events + submissions.
// - Minimal UI; internal scroll only (day panel).

import { auth } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";
import { RoutineParsers } from "/shared/parsers/RoutineParsers.js";

/* ---------- helpers ---------- */
const norm = (s) => String(s ?? "").trim();

const inCollege = (e) => /@astra\.xlri\.ac\.in$/i.test(e || "");
const isSeniorEmail = (e) => /^b24/i.test(e || "") && inCollege(e);
const isJuniorEmail = (e) => /^b25/i.test(e || "") && inCollege(e);

const keyOf = (d) => {
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const today0 = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function parseIsoKey(iso) {
  // iso: YYYY-MM-DD
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return isNaN(d) ? null : d;
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* Monday-first calendar grid:
   returns array of 42 Date objects (6 weeks), including prev/next month filler */
function monthGridDates(monthStart) {
  const first = startOfMonth(monthStart);
  // JS getDay(): Sun=0..Sat=6. We want Mon=0..Sun=6
  const monIndex = (first.getDay() + 6) % 7; // Mon=0
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - monIndex);
  gridStart.setHours(0, 0, 0, 0);

  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    out.push(d);
  }
  return out;
}

/* Low-cost type classifier used only for fallback edge cases.
   Shared parsers often provide type already in AcademicsController flow,
   but parseSeniorGrid/parseJuniorGrid here returns consistent items
   (subject, time, type, room). We'll keep a safe fallback. */
function classifyType(text) {
  const t = norm(text).toLowerCase();

  // submissions / deadlines
  if (/(submission|submit|deadline|due\b|deliverable|assignment|case\s+submission|project\s+submission)/i.test(t)) {
    return "sub";
  }
  // exams / assessments / events
  if (/(exam|mid[-\s]*term|end[-\s]*sem|final|quiz|test|viva|assessment|presentation|event)/i.test(t)) {
    return "exam";
  }
  return "class";
}

function typeKeyToDot(t) {
  if (t === "sub") return "s";
  if (t === "exam") return "x";
  if (t === "event") return "e"; // reserved
  return "c";
}

function typeLabel(t) {
  if (t === "sub") return "Submissions";
  if (t === "exam") return "Exam";
  if (t === "event") return "Event";
  return "Class";
}

/* ---------- controller ---------- */
export class PlanController {
  constructor() {
    this.state = {
      email: "",
      cohort: "",
      section: "",
      subjects: [],
      settings: {},
      routineUrl: ""
    };

    // byDate: { "YYYY-MM-DD": [ { time, subject, room, type } ] }
    this.byDate = {};

    this.currentMonth = startOfMonth(today0());
    this.activeDayKey = keyOf(today0());
  }

  async init() {
    // DOM references
    this.$grid = document.getElementById("calGrid");
    this.$monthTitle = document.getElementById("monthTitle");
    this.$monthMini = document.getElementById("monthMini");
    this.$syncPill = document.getElementById("syncPill");

    this.$cohortPill = document.getElementById("planCohortPill");
    this.$sectionPill = document.getElementById("planSectionPill");

    this.$btnPrev = document.getElementById("btnPrevMonth");
    this.$btnNext = document.getElementById("btnNextMonth");
    this.$btnToday = document.getElementById("btnToday");

    this.$dayTitle = document.getElementById("dayTitle");
    this.$dayMeta = document.getElementById("dayMeta");
    this.$dayPanelBody = document.getElementById("dayPanelBody");

    this.bindNav();

    onAuthStateChanged(auth, async (u) => {
      const email = (u?.email || "").toLowerCase();
      this.state.email = email;
      this.state.cohort = isSeniorEmail(email) ? "senior" : isJuniorEmail(email) ? "junior" : "";

      await this.loadSettings();
      await this.loadProfile();
      this.resolveRoutineUrl();

      // Render pills
      if (this.$cohortPill) this.$cohortPill.textContent = `Role: ${this.state.cohort ? (this.state.cohort[0].toUpperCase() + this.state.cohort.slice(1)) : "—"}`;
      if (this.$sectionPill) this.$sectionPill.textContent = `Section: ${this.state.section || "—"}`;

      // Load routine → build byDate once (view-only)
      await this.loadRoutineToCalendar();

      // initial render
      this.renderMonth();
      this.setActiveDay(this.activeDayKey, { silentMonthJump: false });
    });
  }

  bindNav() {
    this.$btnPrev?.addEventListener("click", () => {
      this.currentMonth = addMonths(this.currentMonth, -1);
      this.renderMonth();
    });
    this.$btnNext?.addEventListener("click", () => {
      this.currentMonth = addMonths(this.currentMonth, 1);
      this.renderMonth();
    });
    this.$btnToday?.addEventListener("click", () => {
      const t = today0();
      this.currentMonth = startOfMonth(t);
      this.renderMonth();
      this.setActiveDay(keyOf(t), { silentMonthJump: true });
    });
  }

  async loadSettings() {
    this.state.settings = await RoutineService.getSettings();
  }

  async loadProfile() {
    const p = await ProfileService.get(this.state.email);
    if (p) {
      this.state.section = p.section || "";
      this.state.subjects = Array.isArray(p.subjects) ? p.subjects : [];
    }
  }

  resolveRoutineUrl() {
    const s = this.state.settings || {};
    const url =
      this.state.cohort === "senior"
        ? (s.seniorRoutineUrl || s.seniorUrl || "")
        : this.state.cohort === "junior"
        ? (s.juniorRoutineUrl || s.juniorUrl || "")
        : "";
    this.state.routineUrl = url;
  }

  async loadRoutineToCalendar() {
    // Basic guardrails
    if (!this.state.routineUrl) {
      this.byDate = {};
      if (this.$syncPill) this.$syncPill.textContent = "Routine: Not configured";
      if (this.$monthMini) this.$monthMini.textContent = "Routine link not configured. Contact Acadcom.";
      return;
    }
    if (!this.state.section) {
      this.byDate = {};
      if (this.$syncPill) this.$syncPill.textContent = "Routine: Waiting for Section";
      if (this.$monthMini) this.$monthMini.textContent = "Set your Section in Academics → My Profile.";
      return;
    }

    if (this.$syncPill) this.$syncPill.textContent = "Routine: Loading…";

    let csv = "";
    try {
      csv = await RoutineService.fetchCsv(this.state.routineUrl);
    } catch (e) {
      console.warn("Plan: CSV fetch failed", e);
    }
    if (!csv) {
      this.byDate = {};
      if (this.$syncPill) this.$syncPill.textContent = "Routine: Unreadable";
      if (this.$monthMini) this.$monthMini.textContent = "Couldn’t read routine CSV. Check sharing settings.";
      return;
    }

    const rows = csv.split(/\r?\n/).map((l) => l.split(","));

    // Shared parsers
    let map = {};
    if (this.state.cohort === "senior") {
      map = RoutineParsers.parseSeniorGrid(rows, {
        section: this.state.section,
        subjects: this.state.subjects
      }) || {};
    } else if (this.state.cohort === "junior") {
      map = RoutineParsers.parseJuniorGrid(rows, {
        section: this.state.section
      }) || {};
    } else {
      map = {};
    }

    // Normalize + ensure type present (fallback)
    const out = {};
    for (const [iso, arr] of Object.entries(map || {})) {
      const list = Array.isArray(arr) ? arr : [];
      out[iso] = list
        .filter(Boolean)
        .map((x) => ({
          time: x.time || "",
          subject: x.subject || "",
          room: x.room || "",
          type: x.type || classifyType(x.subject || "")
        }));
    }
    this.byDate = out;

    if (this.$syncPill) this.$syncPill.textContent = "Routine: Synced";
  }

  renderMonth() {
    if (!this.$grid || !this.$monthTitle) return;

    const m = this.currentMonth;
    const monthName = m.toLocaleString(undefined, { month: "long" });
    const year = m.getFullYear();
    this.$monthTitle.textContent = `${monthName} ${year}`;

    // build 6-week grid
    const dates = monthGridDates(m);

    const activeKey = this.activeDayKey;
    const mIdx = m.getMonth();

    // Render day cells
    this.$grid.innerHTML = dates
      .map((d) => {
        const iso = keyOf(d);
        const isMuted = d.getMonth() !== mIdx;
        const isActive = iso === activeKey;

        const items = (this.byDate && this.byDate[iso]) ? this.byDate[iso] : [];
        const count = items.length;

        // Dots: up to 4 by type for quick scan
        const dots = this.buildDots(items);

        return `
          <div class="day ${isMuted ? "mutedDay" : ""} ${isActive ? "active" : ""}" data-iso="${iso}" role="button" tabindex="0" aria-label="Open ${iso}">
            <div class="dayTop">
              <div class="dateNum">${d.getDate()}</div>
              <div class="badgeCount">${count ? `${count} items` : "—"}</div>
            </div>
            <div class="dots">${dots}</div>
          </div>
        `;
      })
      .join("");

    // click + keyboard
    this.$grid.querySelectorAll(".day").forEach((el) => {
      el.addEventListener("click", () => {
        const iso = el.getAttribute("data-iso");
        if (iso) this.setActiveDay(iso, { silentMonthJump: false });
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const iso = el.getAttribute("data-iso");
          if (iso) this.setActiveDay(iso, { silentMonthJump: false });
        }
      });
    });
  }

  buildDots(items) {
    if (!Array.isArray(items) || !items.length) {
      // keep stable height
      return `<span class="dot" style="opacity:.25"></span><span class="dot" style="opacity:.18"></span><span class="dot" style="opacity:.12"></span>`;
    }

    // Count by type
    const counts = { class: 0, exam: 0, event: 0, sub: 0 };
    for (const it of items) {
      const t = (it?.type || "class");
      if (t === "sub") counts.sub++;
      else if (t === "event") counts.event++;
      else if (t === "exam") counts.exam++;
      else counts.class++;
    }

    // show up to 4 dots prioritizing "sub/exam/class/event" (scan importance)
    const dots = [];
    const pushDots = (cls, n) => {
      for (let i = 0; i < n; i++) dots.push(`<span class="dot ${cls}"></span>`);
    };

    // cap each group; keep total <= 6
    pushDots("s", Math.min(2, counts.sub));
    pushDots("x", Math.min(2, counts.exam));
    pushDots("c", Math.min(2, counts.class));
    pushDots("e", Math.min(1, counts.event));

    return dots.slice(0, 6).join("") || `<span class="dot" style="opacity:.25"></span>`;
  }

  setActiveDay(iso, { silentMonthJump }) {
    const d = parseIsoKey(iso);
    if (!d) return;

    // If clicking a muted day, jump month unless asked not to
    if (!silentMonthJump) {
      const m = this.currentMonth;
      if (d.getMonth() !== m.getMonth() || d.getFullYear() !== m.getFullYear()) {
        this.currentMonth = startOfMonth(d);
        this.activeDayKey = iso;
        this.renderMonth();
        this.renderDayPanel(iso);
        return;
      }
    }

    this.activeDayKey = iso;
    this.renderMonth(); // updates active highlight
    this.renderDayPanel(iso);
  }

  renderDayPanel(iso) {
    if (!this.$dayTitle || !this.$dayMeta || !this.$dayPanelBody) return;

    const items = (this.byDate && this.byDate[iso]) ? (this.byDate[iso] || []).slice() : [];

    // sort by time
    const toMin = (t) => {
      const m = String(t || "").match(/(\d{1,2})[:.](\d{2})/);
      return m ? (+m[1] * 60 + +m[2]) : 9999;
    };
    items.sort((a, b) => toMin(a.time) - toMin(b.time));

    // header
    this.$dayTitle.textContent = `Day view: ${iso}`;
    const tKey = keyOf(today0());
    if (iso === tKey) {
      this.$dayMeta.textContent = "Today. If you don’t mark attendance, you will be absent.";
    } else {
      // show relative hint (Tomorrow etc.)
      const dd = parseIsoKey(iso);
      const td = today0();
      const diffDays = Math.round((dd - td) / (24 * 60 * 60 * 1000));
      if (diffDays === 1) this.$dayMeta.textContent = "Tomorrow. Use this view to stay ahead.";
      else if (diffDays === -1) this.$dayMeta.textContent = "Yesterday. This is a view-only record of what was scheduled.";
      else this.$dayMeta.textContent = "Click items to scan what’s scheduled (view-only).";
    }

    // body
    if (!items.length) {
      this.$dayPanelBody.innerHTML = `
        <div class="muted" style="font-size:12px">
          No classes, exams, events, or submissions found for <b>${iso}</b>.
        </div>

        <div class="plan-card disabled" style="margin-top:10px">
          <div style="color:var(--p-white);font-weight:700;font-size:13px">Optimization (Coming soon)</div>
          <div class="muted" style="font-size:12px;margin-top:6px">
            We’ll add low-key planning suggestions later. For now, calendar is for awareness and better preparation.
          </div>
        </div>
      `;
      return;
    }

    const itemHtml = items
      .map((x) => {
        const t = x.type || "class";
        const tag = typeLabel(t);
        const dotCls = typeKeyToDot(t);

        return `
          <div class="item">
            <div class="itemTop">
              <div class="itemTitle">${x.subject || "—"}</div>
              <div class="tagRow">
                <span class="tag"><span class="dot ${dotCls}" style="width:8px;height:8px"></span>${tag}</span>
                ${x.time ? `<span class="tag">⏱ ${x.time}</span>` : ""}
                ${x.room ? `<span class="tag">📍 ${x.room}</span>` : ""}
              </div>
            </div>
            <div class="itemSub">
              Note: This is a unified view. Detailed routine remains in Academics.
            </div>
          </div>
        `;
      })
      .join("");

    this.$dayPanelBody.innerHTML = `
      ${itemHtml}

      <div class="plan-card disabled" style="margin-top:12px">
        <div style="color:var(--p-white);font-weight:700;font-size:13px">Attendance risk (Coming soon)</div>
        <div class="muted" style="font-size:12px;margin-top:6px">
          Future: show low-key warnings only when nearing limits. No alarm styling.
        </div>
      </div>
    `;
  }
}