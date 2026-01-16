// /modules/home/AttendanceWidget.js
// Home-page only; loaded via dynamic import in home.html

import { auth } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, doc, getDoc } from "/shared/firebase.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";
import { AttendanceService } from "/shared/services/AttendanceService.js";
import { RoutineParsers } from "/shared/parsers/RoutineParsers.js"; // <-- NEW: single source of truth

/* ---------------- small utils ---------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const norm = (s) => String(s ?? "").trim();

const keyOf = (d) => {
  d = new Date(d); d.setHours(0,0,0,0);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const todayIso = () => keyOf(new Date());

const parseHHMM = (s) => {
  const m = String(s||"").match(/^\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, +m[1]));
  const mm = Math.max(0, Math.min(59, +m[2]));
  return hh*60 + mm;
};
const nowMinutesLocal = () => {
  const d = new Date();
  return d.getHours()*60 + d.getMinutes();
};

/* ---- legacy helpers kept (used by wrapper only) ---- */
function looksLikeTimeLabel(v){
  return /^\s*\d{1,2}[:.]\d{2}(:\d{2})?(\s*(?:-|to)\s*\d{1,2}[:.]\d{2}(:\d{2})?)?\s*(am|pm)?\s*$/i.test(norm(v));
}
function parseDateLoose(raw){
  if (!raw) return null;
  let s = String(raw).trim();
  // remove any trailing time junk in date cells
  s = s.replace(/\s+\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\s*$/i,"");

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s+"T00:00:00");

  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (m){
    let [ , dd, mm, yy ] = m; dd=dd.padStart(2,"0"); mm=mm.padStart(2,"0");
    const yyyy = yy ? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))$/);
  if (m){
    let [ , mm, dd, yy ] = m; dd=dd.padStart(2,"0"); mm=mm.padStart(2,"0");
    const yyyy = yy ? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.toISOString().slice(0,10)+"T00:00:00");
}

/**
 * NEW: unified wrapper over RoutineParsers so juniors use A..G (date in A), seniors use B..J (date in B)
 * Returns: [{ time, subject }]
 */
function parseScheduleForDay(csvText, { cohort, section, subjects, dayKey }){
  // Convert CSV to grid
  const rows = csvText.split(/\r?\n/).map(l => l.split(","));
  if (!rows.length) return [];

  let byDate = {};
  if (cohort === "senior") {
    byDate = RoutineParsers.parseSeniorGrid(rows, { section, subjects }) || {};
  } else if (cohort === "junior") {
    byDate = RoutineParsers.parseJuniorGrid(rows, { section }) || {};
  } else {
    return [];
  }

  const list = byDate[dayKey] || [];
  // Only return the minimal fields the banner uses
  return list.map(x => ({ time: x.time || "", subject: x.subject || "" }));
}

/* -------------------- UI -------------------- */

function renderBanner(items){
  let host = document.getElementById("attnBanner");
  if (!host){
    host = document.createElement("div");
    host.id = "attnBanner";
    host.style.cssText = `
      position: fixed; left: 20px; bottom: 20px; z-index: 50;
      background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px;
      box-shadow: 0 10px 24px rgba(0,0,0,.12); padding: 14px 16px; max-width: 520px;
      color:#0f172a;                           /* ensure dark ink on white (iOS) */
    `;
    document.body.appendChild(host);
  }
  const listHtml = items.map((x,i)=>`
    <label style="display:flex;gap:10px;align-items:center;margin:6px 0;min-width:0">
      <input type="checkbox" data-i="${i}">
      <span class="small" style="opacity:.8;min-width:140px">${x.time}</span>
      <b>${x.subject}</b>
    </label>`).join("");

  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
      <div class="small"><strong>Attendance</strong> — Which classes are you attending today?</div>
      <button id="attnClose" class="btn light">Remind me later</button>
    </div>
    ${items.length ? `<div>${listHtml}</div>` : `<div class="small" style="color:#64748b">No classes today.</div>`}
    <div class="row" style="justify-content:flex-end;margin-top:10px">
      <button id="attnSubmit" class="btn">Submit</button>
    </div>`;
  return host;
}

/* ----------------- main widget ----------------- */

export class AttendanceWidget {
  init(){
    onAuthStateChanged(auth, async (u)=>{
      const uid = u?.uid || "";
      const email = (u?.email || "").toLowerCase();
      if (!uid || !email) return;

      // Debug overrides via query params (safe; no behavior change unless used)
      const qs = new URLSearchParams(location.search);
      const FORCE = qs.has("attn");                       // ?attn to force showing
      const OVERRIDE_DAY = qs.get("attnDate");            // ?attnDate=YYYY-MM-DD

      // 1) read routine settings (reminder time + URLs)
      const settings = await RoutineService.getSettings();
      const reminder = parseHHMM(settings?.reminderTime || "09:00"); // default 09:00
      if (reminder == null) return;

      // 2) respect time gate (unless FORCE)
      if (!FORCE && nowMinutesLocal() < reminder) return;

      // 3) skip if already submitted today (unless FORCE)
      try{
        const dayKey = OVERRIDE_DAY && /^\d{4}-\d{2}-\d{2}$/.test(OVERRIDE_DAY) ? OVERRIDE_DAY : todayIso();
        const ref = doc(db, "attendance", uid, "days", dayKey);
        const snap = await getDoc(ref);
        if (!FORCE && snap.exists() && (snap.data()?.submitted === true)) return;
      }catch{/* read failure -> still allow showing banner */}

      // 4) pull profile
      const profile = await ProfileService.get(email);
      const cohort = profile?.cohort || (email.startsWith("b24") ? "senior" : (email.startsWith("b25") ? "junior" : ""));
      const section = profile?.section || "";
      const subjects= Array.isArray(profile?.subjects) ? profile.subjects : [];
      if (!section) return; // profile not set; no banner

      // 5) fetch routine CSV and compute classes for day
      const url = cohort==="senior" ? (settings.seniorRoutineUrl || settings.seniorUrl || "")
                 : cohort==="junior" ? (settings.juniorRoutineUrl || settings.juniorUrl || "") : "";
      if (!url) return;
      const csv = await RoutineService.fetchCsv(url);
      if (!csv) return;

      const dayKey = (OVERRIDE_DAY && /^\d{4}-\d{2}-\d{2}$/.test(OVERRIDE_DAY)) ? OVERRIDE_DAY : todayIso();
      const items = parseScheduleForDay(csv, { cohort, section, subjects, dayKey });
      if (!items.length) return; // edge case 1: no classes -> no notification

      // 6) show banner and wire actions
      const host = renderBanner(items);

      $("#attnClose", host)?.addEventListener("click", ()=> { host.remove(); });

      $("#attnSubmit", host)?.addEventListener("click", async ()=>{
        try{
          const picks = Array.from(host.querySelectorAll('input[type="checkbox"]'))
            .filter(x=>x.checked)
            .map(x=> items[+x.getAttribute("data-i")]);

          // Allow blank submit (edge case 2)
          if (typeof AttendanceService.saveDaySelections === "function") {
            await AttendanceService.saveDaySelections({ uid, email, day: dayKey, selections: picks });
          } else {
            // backwards-compat: serialize into notes
            const notes = JSON.stringify({ selections: picks });
            await AttendanceService.submitToday({ uid, email, notes });
          }
          host.remove();
        } catch(e){
          console.warn("Attendance save failed", e);
          host.remove(); // fail soft
        }
      });

      console.info("[ATTN] banner shown", { dayKey, cohort, section, subjects, count: items.length });
    });
  }
}