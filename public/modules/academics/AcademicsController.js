// /modules/academics/AcademicsController.js
import { auth } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";

// ADDED (read-only Firestore helpers for the remaining-counter)
import {
  db, doc, getDoc, collection, getDocs, query, where
} from "/shared/firebase.js";

// NEW: use shared single-source parsers
import { RoutineParsers } from "/shared/parsers/RoutineParsers.js";

const inCollege     = (e) => /@astra\.xlri\.ac\.in$/i.test(e || "");
const isSeniorEmail = (e) => /^b24/i.test(e || "") && inCollege(e);
const isJuniorEmail = (e) => /^b25/i.test(e || "") && inCollege(e);

/* ---------- tiny helpers ---------- */
const norm  = (s) => String(s ?? "").trim();

// NEW — all-local, timezone-safe
const keyOf = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const today0 = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);   // local midnight
  return d;
};

/* Robust date parser for formats we see in the sheets */
function parseDateLoose(raw){
  if (!raw) return null;
  let s = String(raw).trim();
  // Drop trailing time if it sits in the date cell
  s = s.replace(/\s+\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\s*$/i,"");

  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s+"T00:00:00");

  // dd/mm(/yy|yyyy) or dd-mm(-yy|yyyy)
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (m){
    let [ , dd, mm, yy ] = m;
    dd = dd.padStart(2,"0"); mm = mm.padStart(2,"0");
    const yyyy = yy ? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }

  // mm/dd(/yy|yyyy)
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))$/);
  if (m){
    let [ , mm, dd, yy ] = m;
    dd = dd.padStart(2,"0"); mm = mm.padStart(2,"0");
    const yyyy = yy ? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }

  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.toISOString().slice(0,10)+"T00:00:00");
}

/* Recognize time-slot headers like "08:00", "08:30 To 10:00 AM", etc. */
const looksLikeTimeLabel = (v) =>
  /^\s*\d{1,2}[:.]\d{2}(:\d{2})?(\s*(?:-|to)\s*\d{1,2}[:.]\d{2}(:\d{2})?)?\s*(am|pm)?\s*$/i.test(norm(v));

/* Looser match for Date/Time header cell variants (fallback path) */
const isDateTimeHeader = (v) => {
  const x = norm(v).toLowerCase().replace(/\s+/g, " ");
  return x === "date/time" || x === "date / time" || x === "date & time" || x === "date";
};

/* Simple classifier for event type (class vs exam/assessment)
   (kept here for fallback parsers; shared parsers have identical logic) */
function classifyType(text){
  const t = norm(text).toLowerCase();
  if (/(exam|mid[-\s]*term|end[-\s]*sem|final|quiz|test|viva|assessment|presentation)/i.test(t)) return "exam";
  return "class";
}

/* Senior exam-friendly subject match (fallback paths only) */
function subjectMatchesPicked(subj, type, pickedSet){
  if (!pickedSet || pickedSet.size === 0) return true;
  if (type !== "exam") return pickedSet.has(subj);

  const S = norm(subj).toUpperCase();
  for (const p of pickedSet){
    const P = String(p || "").toUpperCase().trim();
    if (!P) continue;
    if (S === P) return true;
    if (S.startsWith(P + " ")) return true;
    if (S.includes(P + " MID") || S.includes(P + " END") || S.includes(P + " QUIZ") || S.includes(P + " TEST"))
      return true;
  }
  return false;
}

/* Extract entries (fallback paths only) – same shape as shared */
function extractEntries(cell){
  // Delegate to shared to keep exact behavior
  return RoutineParsers.extractEntries(cell);
}

/* =========================================================
   Change-request quota helpers (unchanged)
   ========================================================= */
async function getResetVersion(email, term){
  try{
    const snap = await getDoc(doc(db, "profiles", (email||"").toLowerCase()));
    const d = snap.exists() ? (snap.data()||{}) : {};
    const rvMap = d.changeReset || {};
    return Number(rvMap[`T${Number(term)}`] || 0);
  } catch {
    return 0;
  }
}
async function countUsedRequests(email, term, rv){
  const q1 = query(
    collection(db, "profileChangeRequests"),
    where("email", "==", (email||"").toLowerCase()),
    where("term", "==", Number(term)),
    where("rv", "==", Number(rv))
  );
  const snap = await getDocs(q1);
  return snap.size || 0;
}
async function refreshRemainingUI({ email, term, labelEl }){
  try{
    const rv   = await getResetVersion(email, term);
    const used = await countUsedRequests(email, term, rv);
    const remaining = Math.max(0, 2 - used);
    if (labelEl) {
      labelEl.textContent = remaining > 0
        ? `Changes remaining this term: ${remaining}/2`
        : `No changes remaining. Contact Acadcom.`;
    }
    return remaining;
  } catch {
    if (labelEl) labelEl.textContent = "";
    return 0;
  }
}

export class AcademicsController {
  constructor() {
    this.state = { email:"", cohort:"", section:"", subjects:[], settings:{} };
    this.byDate = {}; // map: YYYY-MM-DD -> [{time, subject, room, day, type}]
  }

  async init() {
    onAuthStateChanged(auth, async (u) => {
      this.state.email = (u?.email || "").toLowerCase();
      this.state.cohort = isSeniorEmail(this.state.email) ? "senior"
                        : isJuniorEmail(this.state.email) ? "junior" : "";

      await this.loadSettings();
      await this.loadProfile();
      this.renderRoutineMeta();
      this.renderProfile();
      this.tryRenderSchedules();     // fills Yesterday/Today/Tomorrow and builds byDate
      this.bindSelectedDate();       // selected date picker
      this.bindTestReminder();
    });
  }

  async loadSettings(){ this.state.settings = await RoutineService.getSettings(); }
  async loadProfile(){
    const p = await ProfileService.get(this.state.email);
    if (p){ this.state.section = p.section || ""; this.state.subjects = Array.isArray(p.subjects)?p.subjects:[]; }
  }

  renderRoutineMeta(){
    const d = this.state.settings||{};
    const desc = document.getElementById("routineDesc");
    const btn  = document.getElementById("openRoutine");
    const url = this.state.cohort==="senior" ? (d.seniorRoutineUrl || d.seniorUrl || "")
            : this.state.cohort==="junior" ? (d.juniorRoutineUrl || d.juniorUrl || "") : "";

    if (url){ if(btn){btn.href=url;btn.style.display="inline-block";} if(desc){desc.textContent=`${this.state.cohort==="senior"?"Senior":"Junior"} routine configured.`;} }
    else { if(btn) btn.style.display="none"; if(desc) desc.textContent="Routine not available yet."; }
  }

  renderProfile(){
    const s = this.state.settings||{};
    const cohort = this.state.cohort;

    const role = document.getElementById("profileRole");
    const term = document.getElementById("profileTerm");
    const sel  = document.getElementById("profileSection");
    const wrap = document.getElementById("subjectChecklist");
    const help = document.getElementById("profileHelp");
    const msg  = document.getElementById("profileMsg");
    const save = document.getElementById("btnSaveProfile");

    if (role) role.textContent = cohort ? (cohort[0].toUpperCase()+cohort.slice(1)) : "Unknown";
    const termVal = cohort==="senior" ? (s.seniorTerm||s.termSenior||"") : cohort==="junior" ? (s.juniorTerm||s.termJunior||"") : "";
    if (term) term.textContent = termVal || "-";

    // Sections
    if (sel){
      const desired = cohort==="junior" ? ["E","F","G"] : ["E","F"];
      sel.innerHTML = `<option value="">Select…</option>` + desired.map(v=>`<option value="${v}">${v}</option>`).join("");
      sel.value = this.state.section || "";
    }

    // Subjects
    const catalog = cohort==="senior" ? (Array.isArray(s.seniorSubjects)?s.seniorSubjects:[])
                  : cohort==="junior" ? (Array.isArray(s.juniorSubjects)?s.juniorSubjects:[]) : [];
    const picked = new Set(this.state.subjects||[]);

    if (wrap){
      if (cohort==="junior"){
        wrap.innerHTML = `
          <div class="small hint" style="margin-bottom:6px">Your subjects are common for Term ${termVal||""}.</div>
          <div class="row" style="flex-wrap:wrap;gap:8px">${(catalog||[]).map(n=>`<span class="badge">${n}</span>`).join("")}</div>`;
      } else {
        wrap.innerHTML = `
          <div class="small hint" style="margin-bottom:6px">Choose your subjects for Term ${termVal||""}:</div>
          <div class="row" style="flex-wrap:wrap;gap:14px">
            ${(catalog||[]).map(n=>`
              <label style="display:inline-flex;align-items:center;gap:8px">
                <input type="checkbox" class="sbx" value="${n.replace(/"/g,"&quot;")}" ${picked.has(n)?"checked":""}>
                ${n}
              </label>`).join("")}
          </div>`;
      }
    }

    if (help){
      if (cohort==="senior" && (this.state.subjects||[]).length){
        help.innerHTML = `<div class="small">Registered subjects:</div>
          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px">
            ${this.state.subjects.map(x=>`<span class="badge">${x}</span>`).join("")}
          </div>`;
      } else if (cohort==="senior"){
        help.textContent = "Pick your subjects and Save.";
      } else {
        help.textContent = "Select and save your Section above to see your classes.";
      }
    }

    if (save){
      save.onclick = async ()=>{
        try{
          const section = sel ? (sel.value||"") : "";
          let subjects = this.state.subjects||[];
          if (cohort==="senior"){
            const boxes = Array.from((wrap||document).querySelectorAll(".sbx"));
            subjects = boxes.filter(b=>b.checked).map(b=>b.value);
          } else {
            subjects = Array.isArray(catalog)?catalog.slice():[];
          }
          await ProfileService.save(this.state.email, { cohort, section, subjects, term: termVal });
          this.state.section = section; this.state.subjects = subjects;
          if (msg){ msg.className="msg ok"; msg.textContent="Profile saved."; }
          this.renderProfile();
          this.tryRenderSchedules();
        } catch(e){
          console.error(e);
          if (msg){ msg.className="msg err"; msg.textContent = e?.message || "Save failed"; }
        }
      };
    }

    // ======== CHANGE: show remaining label for BOTH cohorts (Senior + Junior) ========
    const remainLabel = document.getElementById("changeRemain");
    if (remainLabel) {
      const t = (cohort === "senior") ? (s.seniorTerm||s.termSenior||"")
              : (cohort === "junior") ? (s.juniorTerm||s.termJunior||"")
              : "";
      if (t) refreshRemainingUI({ email: this.state.email, term: t, labelEl: remainLabel });
      else   remainLabel.textContent = "";
    }
  }

  bindTestReminder(){
    const testBtn = document.getElementById("btnTestReminder");
    const toast  = document.getElementById("attnToast");
    if (!testBtn || !toast) return;
    testBtn.onclick = ()=> { toast.style.display="block"; };
    toast.querySelector(".markDone")?.addEventListener("click", ()=> { toast.style.display="none"; });
    toast.querySelector(".remindLater")?.addEventListener("click", ()=> { toast.style.display="none"; });
  }

  /* ======================= Selected-date picker ======================= */
  bindSelectedDate(){
    const input = document.getElementById("pickDate");
    const btn   = document.getElementById("btnGoDate");
    const cal   = document.getElementById("btnPickDate");
    if (!input || !btn) return;

    if (cal){
      cal.onclick = () => {
        if (typeof input.showPicker === "function") input.showPicker();
        else input.focus();
      };
    }

    input.value = keyOf(today0());
    btn.onclick = () => {
      const iso = norm(input.value);
      if (!iso) return this.renderSelectedDate(null, "Pick a valid date.");
      if (!this.byDate || !Object.keys(this.byDate).length) {
        this.tryRenderSchedules().then(()=> this.renderSelectedDate(iso));
      } else {
        this.renderSelectedDate(iso);
      }
    };
  }

  renderSelectedDate(iso, msgIfEmpty){
    const host = document.getElementById("selectedWrap");
    if (!host) return;
    if (!iso){ host.innerHTML = msgIfEmpty ? `<div class="small hint">${msgIfEmpty}</div>` : ""; return; }
    const list = (this.byDate && this.byDate[iso]) ? this.byDate[iso].slice() : [];
    const toMin = (t)=>{ const m=String(t||"").match(/(\d{1,2})[:.](\d{2})/i); return m ? (+m[1]*60 + +m[2]) : 9999; };
    list.sort((a,b)=> toMin(a.time) - toMin(b.time));

    const legendHtml = `
      <div class="small" style="color:#64748b; display:flex; gap:8px; align-items:center; margin:4px 0 6px">
        <span class="chip class">Class</span>
        <span class="chip exam">Exam/Event</span>
      </div>`;

    const renderItem = (x)=> {
      const chip = x.type === "exam" ? `<span class="chip exam">Exam/Event</span>` : `<span class="chip class">Class</span>`;
      return `<li style="margin:6px 0">
        ${x.time?`<span class="small" style="opacity:.8">${x.time}</span> — `:""}<b>${x.subject}</b>${x.room?` (${x.room})`:""} ${chip}
      </li>`;
    };
    host.innerHTML = `
      <div class="card">
        <strong>Selected date: ${iso}</strong>
        ${legendHtml}
        ${list.length ? `<ul style="margin:8px 0 0 16px;padding:0">${list.map(renderItem).join("")}</ul>`
                      : `<div class="small hint" style="margin-top:6px">No classes or events.</div>`}
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*                    S C H E D U L E   R E N D E R                    */
  /* ------------------------------------------------------------------ */
  async tryRenderSchedules(){
    const wrap = document.getElementById("scheduleWrap");
    if (!wrap) return;
    this.byDate = {}; // reset

    const s = this.state.settings||{};
    const url = this.state.cohort==="senior" ? (s.seniorRoutineUrl || s.seniorUrl || "")
            : this.state.cohort==="junior" ? (s.juniorRoutineUrl || s.juniorUrl || "") : "";
    if (!url){
      wrap.innerHTML = `<div class="hint">Routine not available yet.</div>`;
      this.renderAllExams(); // clear Exams block (no data)
      return;
    }
    if (!this.state.section){
      wrap.innerHTML = `<div class="hint">Select and save your Section above to see your classes.</div>`;
      this.renderAllExams(); // clear Exams block (no data)
      return;
    }

    // Fetch CSV
    let csv = "";
    try { csv = await RoutineService.fetchCsv(url); }
    catch (e) { console.warn("CSV fetch failed", e); }
    if (!csv){
      wrap.innerHTML = `<div class="hint">Couldn’t read the routine automatically. You can still use <a href="${url}" target="_blank" rel="noopener">Open Routine</a>.</div>`;
      this.renderAllExams(); // clear Exams block (no data)
      return;
    }

    const rows = csv.split(/\\r?\\n/).map(line => line.split(","));
    if (!rows.length){
      wrap.innerHTML = `<div class="hint">Routine was empty.</div>`;
      this.renderAllExams(); // clear Exams block (no data)
      return;
    }

    const today = today0();
    const yday  = new Date(today); yday.setDate(today.getDate()-1);
    const tmw   = new Date(today); tmw.setDate(today.getDate()+1);
    const buckets = { [keyOf(yday)]:[], [keyOf(today)]:[], [keyOf(tmw)]:[] };

    const legendHtml = `
      <div class="small" style="color:#64748b; display:flex; gap:8px; align-items:center; margin:4px 0 6px">
        <span class="chip class">Class</span>
        <span class="chip exam">Exam/Event</span>
      </div>`;

    /* ---------- SHARED SENIOR PARSER ---------- */
    let didSeniorParse = false;
    if (this.state.cohort === "senior") {
      const map = RoutineParsers.parseSeniorGrid(rows, {
        section: this.state.section,
        subjects: this.state.subjects
      });
      if (map && Object.keys(map).length) {
        this.byDate = map;
        didSeniorParse = true;
      }
    }

    if (didSeniorParse) {
      for (const [k, arr] of Object.entries(this.byDate)) {
        if (buckets[k]) buckets[k].push(...arr);
      }
      const renderDay = (d,label)=>{
        const list = (buckets[keyOf(d)] || []).slice();
        if (!list.length) return `<div class="card"><strong>${label}</strong>${legendHtml}<div class="small hint">No classes found.</div></div>`;
        const toMin = (t)=>{ const m=String(t||"").match(/(\d{1,2})[:.](\d{2})/); return m? (+m[1]*60 + +m[2]) : 9999; };
        list.sort((a,b)=> toMin(a.time) - toMin(b.time));
        return `<div class="card"><strong>${label}</strong>
          ${legendHtml}
          <ul style="margin:8px 0 0 16px;padding:0">
            ${list.map(x=>`<li style="margin:6px 0">${x.time?x.time+" — ":""}<b>${x.subject}</b>${x.room?` (${x.room})`:""} ${x.type==="exam"?'<span class="chip exam">Exam/Event</span>':'<span class="chip class">Class</span>'}</li>`).join("")}
          </ul></div>`;
      };
      wrap.innerHTML = renderDay(yday,"Yesterday") + renderDay(today,"Today") + renderDay(tmw,"Tomorrow");
      const input = document.getElementById("pickDate");
      if (input?.value) this.renderSelectedDate(input.value);
      this.renderAllExams();
      return;
    }

    /* ---------- SHARED JUNIOR PARSER (A..G only) ---------- */
    let didJuniorParse = false;
    if (this.state.cohort === "junior") {
      const map = RoutineParsers.parseJuniorGrid(rows, {
        section: this.state.section
      });
      if (map && Object.keys(map).length) {
        this.byDate = map;
        didJuniorParse = true;
      }
    }

    if (didJuniorParse) {
      // DYNAMICALLY EXTRACT JUNIOR SUBJECTS
      const allSubjects = new Set();
      for (const date in this.byDate) {
        for (const entry of this.byDate[date]) {
          allSubjects.add(entry.subject);
        }
      }
      this.state.settings.juniorSubjects = [...allSubjects].sort();
      this.renderProfile(); // Re-render the profile to show the updated subjects

      for (const [k, arr] of Object.entries(this.byDate)) {
        if (buckets[k]) buckets[k].push(...arr);
      }
      const renderDay = (d,label)=>{
        const list = (buckets[keyOf(d)] || []).slice();
        if (!list.length) return `<div class="card"><strong>${label}</strong>${legendHtml}<div class="small hint">No classes found.</div></div>`;
        const toMin = (t)=>{ const m=String(t||"").match(/(\d{1,2})[:.](\d{2})/); return m? (+m[1]*60 + +m[2]) : 9999; };
        list.sort((a,b)=> toMin(a.time) - toMin(b.time));
        return `<div class="card"><strong>${label}</strong>
          ${legendHtml}
          <ul style="margin:8px 0 0 16px;padding:0">
            ${list.map(x=>`<li style="margin:6px 0">${x.time?x.time+" — ":""}<b>${x.subject}</b>${x.room?` (${x.room})`:""} ${x.type==="exam"?'<span class="chip exam">Exam/Event</span>':'<span class="chip class">Class</span>'}</li>`).join("")}
          </ul></div>`;
      };
      wrap.innerHTML = renderDay(yday,"Yesterday") + renderDay(today,"Today") + renderDay(tmw,"Tomorrow");
      const input = document.getElementById("pickDate");
      if (input?.value) this.renderSelectedDate(input.value);
      this.renderAllExams();
      return;
    }

    /* ---------- EXISTING FALLBACKS (unchanged) ---------- */

    // PATH A: flat table
    const headerFlat = rows[0].map(h=>norm(h).toLowerCase());
    const flatIdx = {
      date: headerFlat.findIndex(h => /(date|day\/?date|dt)/i.test(h)),
      time: headerFlat.findIndex(h => /(time|slot|timing|start time)/i.test(h)),
      sect: headerFlat.findIndex(h => /(section|sec)/i.test(h)),
      subj: headerFlat.findIndex(h => /(subject|course|paper|topic)/i.test(h)),
      room: headerFlat.findIndex(h => /(room|venue|class ?room)/i.test(h)),
      day:  headerFlat.findIndex(h => /^day$/i.test(h))
    };
    const canFlat = flatIdx.date>=0 && flatIdx.time>=0 && flatIdx.sect>=0 && flatIdx.subj>=0;

    if (canFlat){
      const isSenior = this.state.cohort==="senior";
      const picked = new Set(this.state.subjects||[]);
      const wantSection = String(this.state.section||"").toUpperCase();

      for(let i=1;i<rows.length;i++){
        const r = rows[i]||[];
        const rawDate = norm(r[flatIdx.date]);
        if (!rawDate) continue;

        const d = parseDateLoose(rawDate);
        if (!d) continue;
        const k = keyOf(d);

        // ENHANCED: allow multi-section strings (E&F / E,F / E/F)
        const sectRaw = String(r[flatIdx.sect]||"").toUpperCase().replace(/\s+/g,"");
        if (sectRaw){
          const sectParts = sectRaw.split(/[,/&]+/).map(x=>x.trim()).filter(Boolean);
          if (!sectParts.includes(wantSection)) continue;
        }

        const subj = norm(r[flatIdx.subj]);
        if (!subj) continue;

        // NEW: senior picked-subject filter with exam support
        if (isSenior){
          const type = classifyType(subj);
          if (!subjectMatchesPicked(subj, type, picked)) continue;
        }

        const item = {
          time: r[flatIdx.time]||"",
          subject: subj,
          room: flatIdx.room>=0 ? (r[flatIdx.room]||"") : "",
          day:  flatIdx.day>=0  ? (r[flatIdx.day] ||"") : ""
        };
        item.type = classifyType(item.subject);

        if (buckets[k]) buckets[k].push(item);
        (this.byDate[k] ||= []).push(item);
      }

      const renderDay = (d,label)=>{
        const list = buckets[keyOf(d)] || [];
        if (!list.length) return `<div class="card"><strong>${label}</strong>${legendHtml}<div class="small hint">No classes found.</div></div>`;
        const toMin = (t)=>{ const m=String(t).match(/(\d{1,2})[:.](\d{2})/); return m? (+m[1]*60 + +m[2]) : 9999; };
        list.sort((a,b)=> toMin(a.time) - toMin(b.time));
        return `<div class="card"><strong>${label}</strong>
          ${legendHtml}
          <ul style="margin:8px 0 0 16px;padding:0">
            ${list.map(x=>`<li style="margin:6px 0">${x.time?x.time+" — ":""}<b>${x.subject}</b>${x.room?` (${x.room})`:""} ${x.type==="exam"?'<span class="chip exam">Exam/Event</span>':'<span class="chip class">Class</span>'}</li>`).join("")}
          </ul></div>`;
      };

      wrap.innerHTML = renderDay(yday,"Yesterday") + renderDay(today,"Today") + renderDay(tmw,"Tomorrow");
      const input = document.getElementById("pickDate");
      if (input?.value) this.renderSelectedDate(input.value);
      this.renderAllExams();
      return;
    }

    // PATH B: matrix (generic)
    const headerRowIdx = rows.findIndex(r => {
      if (!r) return false;
      const lo = r.map(c => norm(c).toLowerCase());
      const hasDay = lo.some(x => x === "day");
      const hasDate = lo.some(x => isDateTimeHeader(x));
      return hasDay && hasDate;
    });

    if (headerRowIdx === -1){
      wrap.innerHTML = `<div class="hint">Routine format not recognized (no DAY / Date or Date/Time header).</div>`;
      this.renderAllExams();
      return;
    }

    const hdrRow  = rows[headerRowIdx] || [];
    const hdrNorm = hdrRow.map(c => norm(c).toLowerCase());
    const dayCol  = hdrNorm.findIndex(h => h === "day");
    const dateCol = hdrNorm.findIndex(isDateTimeHeader);

    const timeCols = [];
    const probeRows = [headerRowIdx, headerRowIdx + 1];
    for (const rr of probeRows){
      const row = rows[rr] || [];
      for (let c = (dateCol >= 0 ? dateCol + 1 : 2); c < row.length; c++){
        const val = row[c];
        if (looksLikeTimeLabel(val)) {
          timeCols.push({ col:c, label:norm(val) });
        }
      }
      if (timeCols.length) break;
    }
    if (dateCol < 0 || !timeCols.length){
      wrap.innerHTML = `<div class="hint">Routine matrix found, but date/time columns were not detected.</div>`;
      this.renderAllExams();
      return;
    }

    const wantSect = String(this.state.section||"").toUpperCase();
    const isSenior = this.state.cohort==="senior";
    const picked   = new Set(this.state.subjects||[]);

    const startRow = Math.max(headerRowIdx + 1, 2);

    for (let r = startRow; r < rows.length; r++){
      const row = rows[r]; if (!row) continue;

      const rawDate = norm(row[dateCol]);
      if (!rawDate) continue;

      const d = parseDateLoose(rawDate);
      if (!d) continue;
      const k = keyOf(d);

      for (const {col,label} of timeCols){
        const cell = norm(row[col]);
        if (!cell) continue;

        const entries = extractEntries(cell);
        for (const {subj, sect} of entries){
          if (sect){
            const parts = String(sect).toUpperCase().replace(/\s+/g,"").split(/[,/&]+/).filter(Boolean);
            if (!parts.includes(wantSect)) continue;
          }
          if (isSenior){
            const type = classifyType(subj);
            if (!subjectMatchesPicked(subj, type, picked)) continue;
          }

          const item = { time: label, subject: subj, room: "", day: norm(row[dayCol]||"") };
          item.type = classifyType(item.subject);

          (this.byDate[k] ||= []).push(item);
        }
      }
    }

    for (const [k, arr] of Object.entries(this.byDate)) {
      if (buckets[k]) buckets[k].push(...arr);
    }

    const renderMatrixDay = (d,label)=>{
      const list = (buckets[keyOf(d)] || []).slice();
      if (!list.length) return `<div class="card"><strong>${label}</strong>${legendHtml}<div class="small hint">No classes found.</div></div>`;
      const toMin = (t)=>{ const m=String(t||"").match(/(\d{1,2})[:.](\d{2})/i); return m? (+m[1]*60 + +m[2]) : 9999; };
      list.sort((a,b)=> toMin(a.time) - toMin(b.time));
      return `<div class="card"><strong>${label}</strong>
        ${legendHtml}
        <ul style="margin:8px 0 0 16px;padding:0">
          ${list.map(x=>`<li style="margin:6px 0"><span class="small" style="opacity:.8">${x.time}</span> — <b>${x.subject}</b> ${x.type==="exam"?'<span class="chip exam">Exam/Event</span>':'<span class="chip class">Class</span>'}</li>`).join("")}
        </ul></div>`;
    };

    wrap.innerHTML = renderMatrixDay(yday,"Yesterday") + renderMatrixDay(today,"Today") + renderMatrixDay(tmw,"Tomorrow");
    const input = document.getElementById("pickDate");
    if (input?.value) this.renderSelectedDate(input.value);

    this.renderAllExams();
  }

  /* ======================= Consolidated Exams block ======================= */
  renderAllExams(){
    const host = document.getElementById("allExamsWrap");
    if (!host) return;

    const exams = [];
    for (const [iso, arr] of Object.entries(this.byDate || {})){
      for (const x of (arr || [])){
        if (x && x.type === "exam"){
          exams.push({ date: iso, time: x.time || "", subject: x.subject || "", room: x.room || "" });
        }
      }
    }

    const toMin = (t)=>{ const m=String(t||"").match(/(\d{1,2})[:.](\d{2})/i); return m ? (+m[1]*60 + +m[2]) : 9999; };
    exams.sort((a,b)=> a.date === b.date ? (toMin(a.time) - toMin(b.time)) : a.date.localeCompare(b.date));

    const byD = {};
    for (const e of exams){ (byD[e.date] ||= []).push(e); }

    if (!exams.length){
      host.innerHTML = `
        <div class="card">
          <h3 style="margin:0 0 6px">Exams and Events</h3>
          <div class="small hint">No exams or events found.</div>
        </div>`;
      return;
    }

    const renderDateBlock = (iso, list) => {
      const rows = list.map(x=> `
        <li style="margin:6px 0">
          ${x.time ? `<span class="small" style="opacity:.8">${x.time}</span> — ` : ""}
          <b>${x.subject}</b>${x.room ? ` (${x.room})` : ""} <span class="chip exam">Exam/Event</span>
        </li>`).join("");
      return `
        <div class="date-group" style="margin-top:8px">
          <div class="small" style="font-weight:600;color:#475569">${iso}</div>
          <ul style="margin:6px 0 0 16px;padding:0">${rows}</ul>
        </div>`;
    };

    const blocks = Object.keys(byD).map(d => renderDateBlock(d, byD[d])).join("");
    host.innerHTML = `
      <div class="card">
        <h3 style="margin:0 0 6px">Exams and Events</h3>
        ${blocks}
      </div>`;
  }
}

