// /modules/academics/components/AttendancePanel.js
//
// NOTE:
// - No existing functionality is removed.
// - Only makes parsing consistent with Academics by using RoutineParsers as the single source of truth.
// - Attendance counts ONLY "class" sessions (exams/submissions are ignored by design).
// - Keeps existing Firestore paths + baseline logic intact.
// - Header/season behavior remains controlled by academics.html (no changes here).

import { auth, db, doc, getDoc, setDoc } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";

// ✅ Single source of truth (same as AcademicsController)
import { RoutineParsers } from "/shared/parsers/RoutineParsers.js";

/* ------------ tiny utils ------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const norm = (s) => String(s ?? "").trim();
const keyOf = (d) => {
  d = new Date(d);
  d.setHours(0, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayKey = () => keyOf(new Date());

/**
 * Attendance must remain "classes only".
 * We still need a stable mapping so senior "ERP (AG)" chosen in profile
 * can match routine parsed output that might normalize to "ERP".
 *
 * This mirrors the intent of RoutineParsers' normalization without changing it.
 */
function normalizeBaseSubject(token) {
  let t = norm(token);
  if (!t) return "";

  // normalize guest session -> base subject
  if (/guest\s*session/i.test(t)) {
    t = t.replace(/\bguest\s*session\b/i, "").trim().replace(/[–—-]\s*$/, "").trim();
    if (!t) t = "Guest Session";
  }

  // protect roman numerals (II, IV...) from being stripped as initials
  const isRoman = (s) => /^[IVXLCDM]+$/i.test(s || "");

  // Strip trailing initials in parentheses: "ERP (AG)" -> "ERP"
  let m = t.match(/\s*\(([A-Z]{2,4})\)\s*$/);
  if (m && !isRoman(m[1])) t = t.replace(/\s*\(([A-Z]{2,4})\)\s*$/, "").trim();

  // Strip trailing bare initials: "ERP AG" -> "ERP"
  m = t.match(/\s+([A-Z]{2,4})$/);
  if (m && !isRoman(m[1])) t = t.replace(/\s+([A-Z]{2,4})$/, "").trim();

  // PJM batches: "PJM 3" -> "PJM"
  if (/^PJM\s+\d+$/i.test(t)) t = "PJM";

  // Trim any room tokens and everything after: "... LCR 01 1" -> base
  const roomMatch = t.match(/\b(LCR|MCR)\b/i);
  if (roomMatch && typeof roomMatch.index === "number" && roomMatch.index > 0) {
    const base = t.slice(0, roomMatch.index).trim();
    if (base.length >= 2) t = base;
  }

  return t.trim().toUpperCase();
}

/**
 * Count scheduled CLASS sessions per subject between two dates (inclusive).
 * Uses RoutineParsers (single source of truth).
 *
 * Returns:
 *  { per: { subjLabel: count }, today: { subjLabel: count } }
 */
function countScheduledPerSubject(csvText, { section, cohort, subjectsList, startKey, endKey }) {
  const per = {};
  const today = {};
  if (!csvText) return { per, today };

  const rows = csvText.split(/\r?\n/).map((l) => l.split(","));
  if (!rows.length) return { per, today };

  const isJunior = cohort === "junior";
  const wantSect = String(section || "").toUpperCase();

  // Map base->picked label for seniors so attendance rows still align with profile subject labels.
  // For juniors, subjects are common and usually already base-like; mapping still harmless.
  const baseToLabel = {};
  const labels = Array.isArray(subjectsList) ? subjectsList.slice() : [];
  for (const label of labels) {
    const b = normalizeBaseSubject(label);
    if (b && !baseToLabel[b]) baseToLabel[b] = label;
  }

  // Parse using the same logic as Academics.
  let byDate = {};
  if (isJunior) {
    byDate = RoutineParsers.parseJuniorGrid(rows, { section: wantSect }) || {};
  } else {
    // For seniors, pass subjectsList so RoutineParsers can filter using its exam-friendly matcher.
    byDate = RoutineParsers.parseSeniorGrid(rows, { section: wantSect, subjects: labels }) || {};
  }

  // Iterate only inside the date window
  for (const [iso, arr] of Object.entries(byDate)) {
    if (iso < startKey || iso > endKey) continue;

    for (const item of arr || []) {
      if (!item) continue;

      // ✅ Attendance counts ONLY CLASSES
      if (item.type !== "class") continue;

      const parsedSubj = item.subject || "";
      if (!parsedSubj) continue;

      // resolve to the subject label used in the user's profile list
      const key = baseToLabel[normalizeBaseSubject(parsedSubj)] || parsedSubj;

      // If subjectsList exists, keep counts only for those subjects (prevents accidental extras)
      if (labels.length && !labels.includes(key)) continue;

      per[key] = (per[key] || 0) + 1;
      if (iso === endKey) today[key] = (today[key] || 0) + 1;
    }
  }

  return { per, today };
}

/* ------------ UI (SCOPED) ------------ */
function css() {
  const oldTag = document.getElementById("attnViewCSS");
  if (oldTag) oldTag.remove();
  const s = document.createElement("style");
  s.id = "attnViewCSS";
  s.textContent = `
    /* #attnView scoped */
    #attnView .attn-card{
      background:var(--card);
      border:1px solid var(--line);
      border-radius:16px;
      padding:16px;
      margin-top:12px;
      box-shadow:0 10px 28px rgba(0,0,0,.18);
    }
    #attnView .attn-headbar{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:8px; }
    #attnView .attn-actions{ display:flex; gap:8px; flex-wrap:wrap; }
    #attnView .attn-sub{ color:var(--muted); font-size:12px; margin:6px 0 0; }

    #attnView .attn-summary{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    #attnView .attn-chip{
      display:inline-flex;
      align-items:center;
      gap:8px;
      font-size:12px;
      padding:8px 12px;
      border-radius:999px;
      background:rgba(255,255,255,.06);
      color:var(--ink);
      border:1px solid rgba(255,255,255,.10);
      backdrop-filter: blur(6px);
    }
    #attnView .attn-chip .num{ font-weight:700; }

    /* ✅ horizontal scroll wrapper (mobile) */
    #attnView .attn-scroll{
      width:100%;
      overflow-x:auto;
      -webkit-overflow-scrolling:touch;
      border-radius:14px;
      margin-top:12px;
      position:relative;
    }
    #attnView .attn-scroll::-webkit-scrollbar{ height:8px; }
    #attnView .attn-scroll::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.16); border-radius:999px; }
    #attnView .attn-scroll::-webkit-scrollbar-track{ background:rgba(255,255,255,.06); border-radius:999px; }

    /* ✅ swipe hint */
    #attnView .attn-hint{
      text-align:right;
      font-size:12px;
      color:var(--muted);
      margin-top:8px;
      letter-spacing:.2px;
      user-select:none;
    }

    /* ✅ Make 3 columns visible by default on mobile:
       Subject + Scheduled + Missed fit before needing scroll.
       Attended + % remain accessible via horizontal scroll. */
    #attnView .attn-grid{
      display:grid;
      grid-template-columns: 160px 92px 92px 92px 64px;
      gap:0;
      min-width: 500px;
      background: rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      overflow:hidden;
    }
    #attnView .attn-grid > div{
      padding:11px 12px;
      border-bottom:1px dashed rgba(255,255,255,.10);
      font-size:13px;
      line-height:1.25;
    }

    /* ✅ Table header in ONE green */
    #attnView .attn-head{
      font-weight:800;
      background:rgba(176,208,48,.14);
      color: var(--one-green);
      border-bottom:1px solid rgba(176,208,48,.28);
      position:sticky;
      top:0;
      z-index:1;
    }

    #attnView .attn-right{ text-align:right; }
    #attnView input[type="number"]{ width:90px; }

    /* ✅ ONE-green actions (anchors + buttons) */
    #attnView .btn.one{
      background: var(--one-green);
      color:#0b1223;
      border:1px solid rgba(176,208,48,.55);
      box-shadow:0 10px 24px rgba(176,208,48,.10);
      text-decoration:none;
    }
    #attnView .btn.one:hover{ filter:brightness(1.03); }
    #attnView .btn.one:active{ transform:translateY(1px); }

    @media (max-width:540px){
      #attnView .attn-headbar{ align-items:flex-start; }
      #attnView .attn-headbar h3{ font-size:18px; }
      #attnView .attn-grid{
        grid-template-columns: 150px 86px 86px 86px 60px;
        min-width: 468px;
      }
    }

    /* namespaced modal (on <body>) */
    .attn-modal-back{ position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:60; display:flex; align-items:center; justify-content:center; }
    .attn-modal{ background:var(--card); border-radius:16px; max-width:560px; width:92%; padding:16px; border:1px solid var(--line); box-shadow:0 10px 24px rgba(0,0,0,.18); }
    .attn-modal h3{ margin:0 0 6px; }
    .attn-small{ font-size:12px; color:var(--muted); }
    .attn-row{ display:flex; gap:8px; align-items:center; }
    .attn-modal input[type="number"]{ width:90px; }
  `;
  document.head.appendChild(s);
}

function renderBaselineModal({ subjects, onSave }) {
  const back = document.createElement("div");
  back.className = "attn-modal-back";
  back.innerHTML = `
    <div class="attn-modal">
      <h3>Quick setup: missed classes till yesterday</h3>
      <p class="attn-small">Enter how many classes you already missed in the current term <b>up to yesterday</b>. You can edit later.</p>
      <div id="missInputs"></div>
      <div class="attn-row" style="justify-content:flex-end;margin-top:10px">
        <button id="mCancel" class="btn light">Cancel</button>
        <button id="mSave" class="btn">Save</button>
      </div>
    </div>`;
  const list = back.querySelector("#missInputs");
  for (const s of subjects) {
    const row = document.createElement("div");
    row.className = "attn-row";
    row.style.margin = "6px 0";
    row.innerHTML = `<div style="min-width:140px">${s}</div><input type="number" min="0" step="1" value="0" data-subj="${s}">`;
    list.appendChild(row);
  }
  back.querySelector("#mCancel").onclick = () => back.remove();
  back.querySelector("#mSave").onclick = () => {
    const vals = {};
    list.querySelectorAll('input[type="number"]').forEach((inp) => {
      const k = inp.getAttribute("data-subj");
      const v = Math.max(0, Math.floor(Number(inp.value || "0")));
      vals[k] = v;
    });
    back.remove();
    onSave(vals);
  };
  document.body.appendChild(back);
}

export class AttendancePanel {
  async init(hostId = "attnView") {
    css();
    const mount = document.getElementById(hostId);
    if (!mount) return;

    onAuthStateChanged(auth, async (u) => {
      const email = (u?.email || "").toLowerCase();
      const uid = u?.uid || "";
      if (!uid || !email) return;

      // profile
      const profile = await ProfileService.get(email);
      const cohort = profile?.cohort || (email.startsWith("b24") ? "senior" : email.startsWith("b25") ? "junior" : "");
      const section = profile?.section || "";
      const subjects = Array.isArray(profile?.subjects) ? profile.subjects : [];

      if (!section) {
        mount.innerHTML = `<div class="attn-card">Set your <b>Section</b> first.</div>`;
        return;
      }

      // routine
      const settings = await RoutineService.getSettings();
      const url =
        cohort === "senior"
          ? settings.seniorRoutineUrl || settings.seniorUrl || ""
          : cohort === "junior"
          ? settings.juniorRoutineUrl || settings.juniorUrl || ""
          : "";
      if (!url) {
        mount.innerHTML = `<div class="attn-card">Routine link is not configured.</div>`;
        return;
      }
      const csv = await RoutineService.fetchCsv(url);
      if (!csv) {
        mount.innerHTML = `<div class="attn-card">Couldn’t read routine CSV. Check sharing.</div>`;
        return;
      }

      const term =
        cohort === "senior"
          ? Number(settings?.seniorTerm || settings?.termSenior || 0) || 5
          : Number(settings?.juniorTerm || settings?.termJunior || 0) || 2;

      const baselineRef = doc(db, "attendance", uid, "baseline", `T${term}`);
      const baselineSnap = await getDoc(baselineRef);

      let baselineMissed = baselineSnap.exists() ? baselineSnap.data()?.missed || {} : null;
      const baselineAsOfKey = baselineSnap.exists() ? baselineSnap.data()?.asOf || null : null;

      if (!baselineMissed) {
        renderBaselineModal({
          subjects,
          onSave: async (vals) => {
            const yday = keyOf(new Date(new Date().setDate(new Date().getDate() - 1)));
            await setDoc(
              baselineRef,
              {
                term,
                asOf: yday,
                missed: vals,
                subjects,
                section,
                createdAt: (await import("/shared/firebase.js")).serverTimestamp?.() || null,
                updatedAt: (await import("/shared/firebase.js")).serverTimestamp?.() || null
              },
              { merge: true }
            );
            baselineMissed = vals;
            this.renderTable({
              mount,
              csv,
              section,
              cohort,
              subjects,
              baselineMissed,
              baselineAsOfKey: yday
            });
          }
        });
      }

      this.renderTable({ mount, csv, section, cohort, subjects, baselineMissed, baselineAsOfKey });
    });
  }

  async renderTable({ mount, csv, section, cohort, subjects, baselineMissed, baselineAsOfKey }) {
    const endKey = todayKey();

    const settingsForStart = await RoutineService.getSettings();
    const termStartDefault =
      cohort === "senior"
        ? settingsForStart?.termSeniorStart || settingsForStart?.seniorTermStart || null
        : settingsForStart?.termJuniorStart || settingsForStart?.juniorTermStart || null;

    const startKey = (termStartDefault || baselineAsOfKey) || endKey.replace(/-\d{2}$/, "-01");

    // ✅ Single-source scheduled counts (classes only)
    const { per: scheduledToDate, today: scheduledToday } = countScheduledPerSubject(csv, {
      section,
      cohort,
      subjectsList: subjects,
      startKey,
      endKey
    });

    // read today's attended selections (if any)
    const u = auth.currentUser;
    let attendedToday = {};
    if (u?.uid) {
      const snap = await getDoc(doc(db, "attendance", u.uid, "days", endKey));
      const sels = snap.exists() ? snap.data()?.selections || [] : [];
      for (const s of sels) {
        const subj = s?.subject;
        if (!subj) continue;
        attendedToday[subj] = (attendedToday[subj] || 0) + 1;
      }
    }

    // build rows
    const rows = [];
    for (const subj of subjects) {
      const sched = scheduledToDate[subj] || 0;
      const todaySched = scheduledToday[subj] || 0;
      const todayAttn = attendedToday[subj] || 0;
      const missedBase = baselineMissed ? baselineMissed[subj] || 0 : 0;
      const missedToday = Math.max(0, todaySched - todayAttn);
      const missedTotal = missedBase + missedToday;
      const attendedTotal = Math.max(0, sched - missedTotal);
      const pct = sched ? Math.round((attendedTotal / sched) * 100) : 0;
      rows.push({ subj, sched, missed: missedTotal, attended: attendedTotal, pct });
    }

    const totals = rows.reduce(
      (acc, r) => {
        acc.sched += r.sched || 0;
        acc.att += r.attended || 0;
        acc.miss += r.missed || 0;
        return acc;
      },
      { sched: 0, att: 0, miss: 0 }
    );
    const avgPct = rows.length ? Math.round(rows.reduce((s, r) => s + (r.pct || 0), 0) / rows.length) : 0;

    let rowsHtml = "";
    for (const r of rows) {
      rowsHtml += `
        <div>${r.subj}</div>
        <div class="attn-right">${r.sched}</div>
        <div class="attn-right">${r.missed}</div>
        <div class="attn-right">${r.attended}</div>
        <div class="attn-right">${r.pct}</div>
      `;
    }

    const settings = await RoutineService.getSettings();
    const termNumber =
      cohort === "senior" ? norm(settings?.seniorTerm || settings?.termSenior || "5") : norm(settings?.juniorTerm || settings?.termJunior || "2");

    mount.innerHTML = `
      <div class="attn-card">
        <div class="attn-headbar">
          <h3 style="margin:0">Attendance (Term ${termNumber})</h3>
          <div class="attn-actions">
            <a class="btn one" href="/home.html?attn=1" title="Open attendance banner on Home">Mark today</a>
            <button id="editBaseline" class="btn one">Edit baseline</button>
          </div>
        </div>
        <div class="attn-sub">Up to today (${endKey}). Baseline adds missed classes till yesterday.</div>

        <div class="attn-summary">
          <span class="attn-chip"><span>Total</span><span class="num">${totals.sched}</span></span>
          <span class="attn-chip"><span>Attended</span><span class="num">${totals.att}</span></span>
          <span class="attn-chip"><span>Missed</span><span class="num">${totals.miss}</span></span>
          <span class="attn-chip"><span>Avg%</span><span class="num">${avgPct}%</span></span>
        </div>

        <div class="attn-hint">Swipe → to see all columns</div>

        <div class="attn-scroll" aria-label="Attendance table (scroll horizontally)">
          <div class="attn-grid">
            <div class="attn-head">Subject</div>
            <div class="attn-head attn-right">Scheduled</div>
            <div class="attn-head attn-right">Missed</div>
            <div class="attn-head attn-right">Attended</div>
            <div class="attn-head attn-right">%</div>
            ${rowsHtml}
          </div>
        </div>
      </div>
    `;

    // edit baseline button (kept behavior)
    $("#editBaseline", mount)?.addEventListener("click", () => {
      renderBaselineModal({
        subjects,
        onSave: async (vals) => {
          const u2 = auth.currentUser;
          if (!u2?.uid) return;
          const asOfNow = todayKey();

          const s2 = await RoutineService.getSettings();
          const termVal = cohort === "senior" ? Number(s2?.seniorTerm || s2?.termSenior || 5) : Number(s2?.juniorTerm || s2?.termJunior || 2);

          await setDoc(
            doc(db, "attendance", u2.uid, "baseline", `T${termVal}`),
            {
              term: termVal,
              asOf: asOfNow,
              missed: vals,
              subjects,
              section,
              updatedAt: (await import("/shared/firebase.js")).serverTimestamp?.() || null
            },
            { merge: true }
          );

          this.renderTable({
            mount,
            csv,
            section,
            cohort,
            subjects,
            baselineMissed: vals,
            baselineAsOfKey: asOfNow
          });
        }
      });
    });
  }
}