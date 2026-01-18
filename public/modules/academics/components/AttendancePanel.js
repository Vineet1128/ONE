// /modules/academics/components/AttendancePanel.js

import { auth, db, doc, getDoc, setDoc } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";

/* ------------ tiny utils ------------ */
const $ = (sel, root=document)=> root.querySelector(sel);
const norm = (s)=> String(s ?? "").trim();
const keyOf = (d)=>{ d=new Date(d); d.setHours(0,0,0,0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const todayKey = ()=> keyOf(new Date());

function looksLikeTimeLabel(v){
  return /^\s*\d{1,2}[:.]\d{2}(:\d{2})?(\s*(?:-|to)\s*\d{1,2}[:.]\d{2}(:\d{2})?)?\s*(am|pm)?\s*$/i.test(norm(v));
}
function parseDateLoose(raw){
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/\s+\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\s*$/i,"");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s+"T00:00:00");
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (m){ let[,dd,mm,yy]=m; dd=dd.padStart(2,"0"); mm=mm.padStart(2,"0");
    const yyyy = yy? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))$/);
  if (m){ let[,mm,dd,yy]=m; dd=dd.padStart(2,"0"); mm=mm.padStart(2,"0");
    const yyyy = yy? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.toISOString().slice(0,10)+"T00:00:00");
}

/* -------- robust entry parser (used ONLY for JUNIORS) --------
   Supports:
   - "SUBJ (E)", "SUBJ (E,F&G)", "SUBJ Sec E&F", "SUBJ common"
   - Strips teacher/venue tails
   Returns [{ subj, sect:"E"|"F"|"G"|"" }]
*/
function extractEntriesForJuniors(cell){
  const out = [];
  if (!cell) return out;

  let text = String(cell);

  // Remove teacher tags at end (with or without dash)
  text = text.replace(/\s*[–—-]\s*(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i, "");
  // IMPORTANT: require at least one space before title token to avoid stripping "MST"
  text = text.replace(/\s+(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i, "");

  // Strip trailing room/venue at end (handles "(LCR01)", "（LCR01）", "( LCR01 )", "- LCR01")
  text = text.replace(/\s*(?:[（(]?\s*(?:LCR|MCR)\s*0*\d+\s*[）)]?|-\s*(?:LCR|MCR)\s*0*\d+)\s*$/ig, "");

  // Drop extra parentheses that are NOT section tags
  text = text.replace(/\((?!\s*[EFG](?:\s*[,&/]\s*[EFG])*\s*\))[^()]*\)/gi, (m) => {
    return /[EFG]/i.test(m) && /[,&/]/.test(m) ? m : "";
  });

  const parts = text.split(/\s*[,/;]\s*|\n+/).filter(Boolean);
  for (const pRaw of parts){
    const p = norm(pRaw);
    if (!p || p === "-" || p === "—") continue;

    // Pattern 1: "SUBJ (E)" | "SUBJ (E&F&G)" | "SUBJ (E,F)" | "SUBJ (E/F)"
    // (allow one optional extra () after the section list, e.g. "(LCR01)")
    let m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s*\(([EFG](?:\s*[,&/]\s*[EFG])*)\)(?:\s*\([^)]*\))?\s*$/i);
    if (m){
      const subj = norm(m[1]);
      const sects = String(m[2]||"").replace(/\s+/g,"").split(/[,&/]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (sects.length){ for (const s of sects) out.push({ subj, sect: s }); } else out.push({ subj, sect: "" });
      continue;
    }

    // Pattern 2: "SUBJ Sec E" | "SUBJ Section E&F"
    m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s+(?:sec|section)\s*([EFG](?:\s*[,&/]\s*[EFG])*)\b/i);
    if (m){
      const subj = norm(m[1]);
      const sects = String(m[2]||"").replace(/\s+/g,"").split(/[,&/]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (sects.length){ for (const s of sects) out.push({ subj, sect: s }); } else out.push({ subj, sect: "" });
      continue;
    }

    // Pattern 3: "SUBJ common"
    m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s+common\b/i);
    if (m){ out.push({ subj: norm(m[1]), sect: "" }); continue; }

    // Fallback token (no parentheses allowed here)
    const tok = p
      .replace(/\s*\(?\b(?:LCR|MCR)\s*0?\d+\)?\s*$/i, "")
      .replace(/\s+prof(?:essor)?\..*$/i,"")
      .replace(/\s+dr\..*$/i,"")
      .trim();

    if (/^[A-Za-z0-9\-\/& .]{2,60}$/.test(tok)) out.push({ subj: tok, sect: "" });
  }
  return out;
}

/**
 * Count scheduled sessions per subject between two dates (inclusive).
 * Cohort-aware:
 *  - Seniors: date in B (index 1), time headers C..J (2..9), threshold ≥3  (ORIGINAL logic + Guest Session + combined sections)
 *  - Juniors: date in A (index 0), time headers C..G (2..6), threshold ≥2  (robust multi-section parsing)
 */
function countScheduledPerSubject(csvText, { section, cohort, subjectsSet, startKey, endKey }){
  const rows = csvText.split(/\r?\n/).map(l => l.split(","));
  if (!rows.length) return { per:{}, today:{} };

  // ----- cohort-specific scan window & thresholds -----
  const isJunior = (cohort === "junior");
  const dateCol = isJunior ? 0 : 1;         // A for juniors, B for seniors
  const colStart = 2;                        // C
  const colEnd   = isJunior ? 6 : 9;         // G for juniors, J for seniors
  const timeHitsThreshold = isJunior ? 2 : 3;

  // find header row by time labels
  let headerRow = -1;
  for (let r=0; r<Math.min(10, rows.length); r++){
    const row = rows[r]||[]; let hits=0;
    for (let c=colStart; c<=colEnd && c<row.length; c++) if (looksLikeTimeLabel(row[c])) hits++;
    if (hits>=timeHitsThreshold){ headerRow=r; break; }
  }
  if (headerRow === -1) return { per:{}, today:{} };

  // collect time slots (within the cohort-specific column range)
  const hdr = rows[headerRow] || [];
  const slots=[];
  for (let c=colStart; c<=colEnd && c<hdr.length; c++){
    const lab=norm(hdr[c]);
    if (looksLikeTimeLabel(lab)) slots.push({ col:c, label: lab });
  }

  const wantSect = String(section||"").toUpperCase();
  const per = {};                      // cumulative (start..end)
  const today = {};                    // breakdown for endKey specifically
  let current=null, carry={}, seen={};

  const add = (subj, isToday)=>{
    per[subj] = (per[subj]||0)+1;
    if (isToday) today[subj] = (today[subj]||0)+1;
  };

  for (let r=headerRow+1; r<rows.length; r++){
    const row = rows[r] || [];
    const rawDate = norm(row[dateCol]||"");
    if (rawDate){
      const d = parseDateLoose(rawDate); if (!d){ current=null; carry={}; seen={}; continue; }
      current = keyOf(d); carry={}; seen={};
    } else if (!current){ continue; }

    if (current < startKey || current > endKey) continue;

    for (const {col,label} of slots){
      let cell = norm(row[col]||"");
      if (!cell && carry[col]) cell = carry[col];
      if (!cell) continue;
      carry[col] = cell;

      if (isJunior){
        // ----------- JUNIORS: robust multi-section parsing -----------
        const entries = extractEntriesForJuniors(cell);
        for (const { subj, sect } of entries){
          if (sect && sect !== wantSect) continue;            // section must match for tagged entries
          const uniq = `${current}|${label}|${subj}|${sect||""}`;
          if (seen[uniq]) continue; seen[uniq]=true;
          add(subj, current===endKey);
        }
      } else {
        // ----------- SENIORS: ORIGINAL MINIMAL PARSER (enhanced) -----------
        // unwrap whole-cell parens
        let txt = cell.replace(/^\((.*)\)$/, "$1");
        // strip teacher / venue tails
        txt = txt
          .replace(/\s*[–—-]\s*(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i,"")
          // IMPORTANT: require at least one space before title token to avoid stripping "MST"
          .replace(/\s+(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i,"")
          .replace(/\s*\(?\b(?:LCR|MCR)\s*0?\d+\)?\s*$/i,"")
          .trim();

        const parts = txt.split(/\s*[,/;]\s*|\n+/).filter(Boolean);

        for (const raw of parts){
          let p = norm(raw); if (!p || p==='-' || p==='—') continue;

          // pull combined sections like (E&F) / (E,F&G)
          let sects = [];
          const sm = p.match(/\(([EFG](?:\s*[,&/]\s*[EFG])*)\)/i);
          if (sm){
            sects = sm[1].replace(/\s+/g,"").split(/[,&/]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
            p = p.replace(sm[0], "").trim();
          }

          // normalize guest session into base subject
          let subj = p;
          if (/guest\s*session/i.test(p)){
            const base = p.replace(/\bguest\s*session\b/i, "").trim().replace(/[–—-]\s*$/,"").trim();
            subj = base || "Guest Session";
          }

          // Also support "SUBJ (E)" style (single section) when no combined captured above
          let m = subj.match(/^([A-Za-z0-9\-\/& ]+?)\s*\(([EFG])\)\s*$/i);
          if (m){ subj = m[1].trim(); sects = sects.length ? sects : [ (m[2]||"").toUpperCase() ]; }

          // support "SUBJ sec E"
          if (!m){
            m = subj.match(/^([A-Za-z0-9\-\/& ]+?)\s+(?:sec|section)\s*([EFG])\b/i);
            if (m){ subj = m[1].trim(); sects = sects.length ? sects : [ (m[2]||"").toUpperCase() ]; }
          }

          // support "SUBJ common"
          if (/^([A-Za-z0-9\-\/& ]+?)\s+common\b/i.test(subj)){
            subj = subj.replace(/\s+common\b/i,"").trim();
            sects = []; // common => all
          }

          if (!subj) continue;

          // Section filter (if any tags were present)
          if (sects.length && !sects.includes(wantSect)) continue;

          // Seniors: subject filter — keep strict (guest already mapped to base if present)
          if (subjectsSet.size && !subjectsSet.has(subj)) continue;

          const uniq = `${current}|${label}|${subj}|${sects.join(",")||""}`;
          if (seen[uniq]) continue; seen[uniq]=true;

          add(subj, current===endKey);
        }
      }
    }
  }
  return { per, today };
}

/* ------------ UI (SCOPED) ------------ */
function css(){ /* one-time */
  const oldTag = document.getElementById("attnViewCSS");
  if (oldTag) oldTag.remove();
  const s = document.createElement("style");
  s.id="attnViewCSS";
  s.textContent = `
    /* #attnView scoped */
    #attnView .attn-card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-top:12px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
    #attnView .attn-headbar{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }
    #attnView .attn-actions{ display:flex; gap:8px; flex-wrap:wrap; }
    #attnView .attn-sub{ color:var(--muted); font-size:12px; margin:6px 0 0; }

    #attnView .attn-summary{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    #attnView .attn-chip{ display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:6px 10px; border-radius:999px; background:rgba(148,163,184,.14); color:var(--ink); border:1px solid var(--line); }
    .app-dark #attnView .attn-chip{ background:rgba(255,255,255,.08); color:#e5e7eb; border:1px solid var(--line); }
    #attnView .attn-chip .num{ font-weight:600; }

    #attnView .attn-grid{ display:grid; grid-template-columns:1.2fr .9fr .9fr .9fr .6fr; gap:0; margin-top:8px; }
    #attnView .attn-grid > div{ padding:10px 12px; border-bottom:1px dashed (var(--line)); }
    #attnView .attn-head{ font-weight:600; background:rgba(148,163,184,.12); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1; }
    .app-dark #attnView .attn-head{ background:rgba(255,255,255,.06); }
    #attnView .attn-right{ text-align:right; }

    #attnView input[type="number"]{ width:90px; }

    @media (max-width:540px){
      #attnView .attn-grid{ grid-template-columns:1fr .7fr .7fr .7fr .5fr; }
      #attnView .attn-headbar h3{ font-size:16px; }
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

function renderBaselineModal({ subjects, onSave }){
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
  for (const s of subjects){
    const row = document.createElement("div");
    row.className="attn-row";
    row.style.margin="6px 0";
    row.innerHTML = `<div style="min-width:140px">${s}</div><input type="number" min="0" step="1" value="0" data-subj="${s}">`;
    list.appendChild(row);
  }
  back.querySelector("#mCancel").onclick = ()=> back.remove();
  back.querySelector("#mSave").onclick = ()=>{
    const vals = {};
    list.querySelectorAll('input[type="number"]').forEach(inp=>{
      const k = inp.getAttribute("data-subj");
      const v = Math.max(0, Math.floor(Number(inp.value||"0")));
      vals[k]=v;
    });
    back.remove();
    onSave(vals);
  };
  document.body.appendChild(back);
}

export class AttendancePanel {
  async init(hostId="attnView"){
    css();
    const mount = document.getElementById(hostId);
    if (!mount) return;

    onAuthStateChanged(auth, async (u)=>{
      const email = (u?.email||"").toLowerCase();
      const uid = u?.uid || "";
      if (!uid || !email) return;

      // profile
      const profile = await ProfileService.get(email);
      const cohort = profile?.cohort || (email.startsWith("b24") ? "senior" : (email.startsWith("b25") ? "junior" : ""));
      const section = profile?.section || "";
      const subjects = Array.isArray(profile?.subjects) ? profile.subjects : [];
      const subjectsSet = new Set(subjects);
      if (!section) { mount.innerHTML = `<div class="attn-card">Set your <b>Section</b> first.</div>`; return; }

      // routine
      const settings = await RoutineService.getSettings();
      const url = cohort==="senior" ? (settings.seniorRoutineUrl || settings.seniorUrl || "")
                 : cohort==="junior" ? (settings.juniorRoutineUrl || settings.juniorUrl || "") : "";
      if (!url){ mount.innerHTML = `<div class="attn-card">Routine link is not configured.</div>`; return; }
      const csv = await RoutineService.fetchCsv(url);
      if (!csv){ mount.innerHTML = `<div class="attn-card">Couldn’t read routine CSV. Check sharing.</div>`; return; }

      // term number in the title, per cohort
      const term =
        (cohort === "senior")
          ? Number(settings?.seniorTerm || settings?.termSenior || 0) || 5
          : Number(settings?.juniorTerm || settings?.termJunior || 0) || 2;

      const baselineRef = doc(db, "attendance", uid, "baseline", `T${term}`);
      const baselineSnap = await getDoc(baselineRef);

      // baseline popup if missing
      let baselineMissed = baselineSnap.exists() ? (baselineSnap.data()?.missed || {}) : null;
      const baselineAsOfKey = baselineSnap.exists()
        ? (baselineSnap.data()?.asOf || null)
        : null;

      if (!baselineMissed){
        renderBaselineModal({
          subjects,
          onSave: async (vals)=>{
            const yday = keyOf(new Date(new Date().setDate(new Date().getDate()-1))); // yesterday
            await setDoc(baselineRef, {
              term,
              asOf: yday, // yesterday
              missed: vals,
              subjects, section,
              createdAt: (await import("/shared/firebase.js")).serverTimestamp?.() || null,
              updatedAt: (await import("/shared/firebase.js")).serverTimestamp?.() || null
            }, { merge:true });
            baselineMissed = vals;
            this.renderTable({
              mount, csv, section, cohort, subjects, subjectsSet,
              baselineMissed,
              baselineAsOfKey: yday
            });
          }
        });
      }

      // render table
      this.renderTable({ mount, csv, section, cohort, subjects, subjectsSet, baselineMissed, baselineAsOfKey });
    });
  }

  async renderTable({ mount, csv, section, cohort, subjects, subjectsSet, baselineMissed, baselineAsOfKey }){
    const endKey = todayKey();

    // Prefer a cohort-specific term start from settings, then baseline.asOf, then month start
    const settingsForStart = await RoutineService.getSettings();
    const termStartDefault =
      (cohort === "senior")
        ? (settingsForStart?.termSeniorStart || settingsForStart?.seniorTermStart || null)
        : (settingsForStart?.termJuniorStart || settingsForStart?.juniorTermStart || null);

    const startKey = (termStartDefault || baselineAsOfKey) || endKey.replace(/-\d{2}$/, "-01");

    const { per: scheduledToDate, today: scheduledToday } =
      countScheduledPerSubject(csv, { section, cohort, subjectsSet, startKey, endKey });

    // read today's attended selections (if any)
    const { getDoc, doc } = await import("/shared/firebase.js");
    const { auth } = await import("/shared/firebase.js");
    const u = auth.currentUser;
    let attendedToday = {};
    if (u?.uid){
      const snap = await getDoc(doc(db, "attendance", u.uid, "days", endKey));
      const sels = snap.exists() ? (snap.data()?.selections||[]) : [];
      for (const s of sels){
        const subj = s?.subject; if (!subj) continue;
        attendedToday[subj] = (attendedToday[subj]||0)+1;
      }
    }

    // build rows
    const rows = [];
    for (const subj of subjects){
      const sched = scheduledToDate[subj] || 0;
      const todaySched = scheduledToday[subj] || 0;
      const todayAttn = attendedToday[subj] || 0;
      const missedBase = baselineMissed ? (baselineMissed[subj]||0) : 0;
      const missedToday = Math.max(0, todaySched - todayAttn);
      const missedTotal = missedBase + missedToday;
      const attendedTotal = Math.max(0, sched - missedTotal);
      const pct = sched ? Math.round((attendedTotal / sched) * 100) : 0;
      rows.push({ subj, sched, missed: missedTotal, attended: attendedTotal, pct });
    }

    // summary (UI only)
    const totals = rows.reduce((acc, r) => {
      acc.sched += r.sched || 0;
      acc.att   += r.attended || 0;
      acc.miss  += r.missed || 0;
      return acc;
    }, { sched:0, att:0, miss:0 });
    const avgPct = rows.length ? Math.round(rows.reduce((s,r)=>s + (r.pct||0), 0) / rows.length) : 0;

    // rows HTML
    let rowsHtml = "";
    for (const r of rows){
      rowsHtml += `
        <div>${r.subj}</div>
        <div class="attn-right">${r.sched}</div>
        <div class="attn-right">${r.missed}</div>
        <div class="attn-right">${r.attended}</div>
        <div class="attn-right">${r.pct}</div>
      `;
    }

    // Term number in title per cohort
    const settings = await RoutineService.getSettings();
    const termNumber =
      (cohort === "senior")
        ? norm(settings?.seniorTerm || settings?.termSenior || "5")
        : norm(settings?.juniorTerm || settings?.termJunior || "2");

    // render
    mount.innerHTML = `
      <div class="attn-card">
        <div class="attn-headbar">
          <h3 style="margin:0">Attendance (Term ${termNumber})</h3>
          <div class="attn-actions">
            <a class="btn light" href="/home.html?attn=1" title="Open attendance banner on Home">Mark today</a>
            <button id="editBaseline" class="btn light">Edit baseline</button>
          </div>
        </div>
        <div class="attn-sub">Up to today (${endKey}). Baseline adds missed classes till yesterday.</div>

        <div class="attn-summary">
          <span class="attn-chip"><span>Total</span><span class="num">${totals.sched}</span></span>
          <span class="attn-chip"><span>Attended</span><span class="num">${totals.att}</span></span>
          <span class="attn-chip"><span>Missed</span><span class="num">${totals.miss}</span></span>
          <span class="attn-chip"><span>Avg%</span><span class="num">${avgPct}%</span></span>
        </div>

        <div class="attn-grid">
          <div class="attn-head">Subject</div>
          <div class="attn-head attn-right">Scheduled</div>
          <div class="attn-head attn-right">Missed</div>
          <div class="attn-head attn-right">Attended</div>
          <div class="attn-head attn-right">%</div>
          ${rowsHtml}
        </div>
      </div>
    `;

    // edit baseline button
    $("#editBaseline", mount)?.addEventListener("click", ()=>{
      renderBaselineModal({
        subjects,
        onSave: async (vals)=>{
          const u = auth.currentUser;
          if (!u?.uid) return;
          const asOfNow = todayKey();

          // write under the same term key used above
          const s2 = await RoutineService.getSettings();
          const termVal =
            (cohort === "senior")
              ? Number(s2?.seniorTerm || s2?.termSenior || 5)
              : Number(s2?.juniorTerm || s2?.termJunior || 2);

          await setDoc(doc(db, "attendance", u.uid, "baseline", `T${termVal}`), {
            term: termVal,
            asOf: asOfNow,
            missed: vals,
            subjects, section,
            updatedAt: (await import("/shared/firebase.js")).serverTimestamp?.() || null
          }, { merge:true });
          this.renderTable({
            mount, csv, section, cohort, subjects, subjectsSet,
            baselineMissed: vals,
            baselineAsOfKey: asOfNow
          });
        }
      });
    });
  }
}