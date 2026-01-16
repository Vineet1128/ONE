// /shared/services/ScheduleService.js
// Read today's schedule (and more) for a user profile, without touching AcademicsController.
// Reuses the exact senior parsing semantics you signed off earlier.

import { RoutineService } from "/shared/services/RoutineService.js";

/* ---------- tiny helpers (kept in-sync with AcademicsController) ---------- */
const norm  = (s) => String(s ?? "").trim();
const keyOf = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today0 = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

function parseDateLoose(raw){
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/\s+\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\s*$/i,"");

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s+"T00:00:00");

  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (m){
    let [ , dd, mm, yy ] = m;
    dd = dd.padStart(2,"0"); mm = mm.padStart(2,"0");
    const yyyy = yy ? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))$/);
  if (m){
    let [ , mm, dd, yy ] = m;
    dd = dd.padStart(2,"0"); mm = mm.padStart(2,"0");
    const yyyy = yy ? (yy.length===2 ? (Number(yy)>50 ? "19"+yy : "20"+yy) : yy) : String(new Date().getFullYear());
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }

  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const looksLikeTimeLabel =
  (v) => /^\s*\d{1,2}[:.]\d{2}(:\d{2})?(\s*(?:-|to)\s*\d{1,2}[:.]\d{2}(:\d{2})?)?\s*(am|pm)?\s*$/i.test(norm(v));

function classifyType(text){
  const t = norm(text).toLowerCase();
  if (/(exam|mid\s*term|end\s*sem|final|quiz|test|viva|assessment|presentation)/i.test(t)) return "exam";
  return "class";
}

function extractEntries(cell){
  const out = [];
  const parts = String(cell||"").split(/\s*[,/;]\s*|\n+/).filter(Boolean);
  for (const pRaw of parts){
    const p = norm(pRaw);
    if (!p || p === "-" || p === "—") continue;

    let m = p.match(/^([A-Za-z0-9\-\/& ]+?)\s*\(([EFG])\)\s*$/i);
    if (m){ out.push({ subj: norm(m[1]), sect: (m[2]||"").toUpperCase() }); continue; }

    m = p.match(/^([A-Za-z0-9\-\/& ]+?)\s+(?:sec|section)\s*([EFG])\b/i);
    if (m){ out.push({ subj: norm(m[1]), sect: (m[2]||"").toUpperCase() }); continue; }

    m = p.match(/^([A-Za-z0-9\-\/& ]+?)\s+common\b/i);
    if (m){ out.push({ subj: norm(m[1]), sect: "" }); continue; }

    const tok = p.replace(/\s+prof\..*$/i,"").trim();
    if (/^[A-Za-z0-9\-\/& ]{2,40}$/.test(tok)) out.push({ subj: tok, sect: "" });
  }
  return out;
}

/* ---------- SENIOR GRID PARSER (Row 2..end | Col B..J) with vertical-carry ---------- */
function parseSeniorGrid(rows, { section, subjects }){
  const byDate = {};
  if (!rows?.length) return byDate;

  // find header row (C..J contain ≥3 time labels)
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++){
    const row = rows[r] || [];
    let hits = 0;
    for (let c = 2; c <= 9 && c < row.length; c++){
      if (looksLikeTimeLabel(row[c])) hits++;
    }
    if (hits >= 3){ headerRow = r; break; }
  }
  if (headerRow === -1) return byDate;

  // slot columns from header C..J
  const slots = [];
  const hdr = rows[headerRow] || [];
  for (let c = 2; c <= 9 && c < hdr.length; c++){
    const label = norm(hdr[c]);
    if (looksLikeTimeLabel(label)) slots.push({ col:c, label });
  }
  if (!slots.length) return byDate;

  const wantSect = String(section||"").toUpperCase();
  const picked   = new Set(Array.isArray(subjects)?subjects:[]);

  let currentDateKey = null;
  let vCarry = {};          // col -> last non-empty text for this date block
  let seenPerSlot = {};     // label -> Set("SUBJ|SECT") to dedupe within date+slot

  const resetDateBlock = (dateKey)=>{
    currentDateKey = dateKey;
    vCarry = {};
    seenPerSlot = {};
  };

  for (let r = headerRow + 1; r < rows.length; r++){
    const row = rows[r] || [];

    // column B = date (merged-down => blanks until next date)
    const rawDate = norm(row[1] || "");
    if (rawDate){
      const d = parseDateLoose(rawDate);
      if (!d){ currentDateKey = null; vCarry = {}; seenPerSlot = {}; continue; }
      const k = keyOf(d);
      if (k !== currentDateKey) resetDateBlock(k);
    } else if (!currentDateKey){
      continue;
    }

    for (const { col, label } of slots){
      let cell = norm(row[col] || "");
      if (!cell && vCarry[col]) cell = vCarry[col];
      if (!cell) continue;

      vCarry[col] = cell;

      const entries = extractEntries(cell);
      for (const { subj, sect } of entries){
        if (sect && sect !== wantSect) continue;
        if (picked.size && !picked.has(subj)) continue;

        const k = `${subj}|${sect||""}`;
        const bucket = (seenPerSlot[label] ||= new Set());
        if (bucket.has(k)) continue;
        bucket.add(k);

        const item = { time: label, subject: subj, room: "", day: "", type: classifyType(subj) };
        (byDate[currentDateKey] ||= []).push(item);
      }
    }
  }

  return byDate;
}

/* ---------- GENERIC MATRIX (junior fallback) ---------- */
function parseMatrix(rows, { section, subjects }){
  const byDate = {};
  if (!rows?.length) return byDate;

  const isDateTimeHeader = (v) => {
    const x = norm(v).toLowerCase().replace(/\s+/g, " ");
    return x === "date/time" || x === "date / time" || x === "date & time" || x === "date";
  };

  const headerRowIdx = rows.findIndex(r => {
    if (!r) return false;
    const lo = r.map(c => norm(c).toLowerCase());
    const hasDay  = lo.some(x => x === "day");
    const hasDate = lo.some(x => isDateTimeHeader(x));
    return hasDay && hasDate;
  });
  if (headerRowIdx === -1) return byDate;

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
      if (looksLikeTimeLabel(val)) timeCols.push({ col:c, label:norm(val) });
    }
    if (timeCols.length) break;
  }
  if (dateCol < 0 || !timeCols.length) return byDate;

  const wantSect = String(section||"").toUpperCase();
  const picked   = new Set(Array.isArray(subjects)?subjects:[]);

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
        if (sect && sect !== wantSect) continue;
        if (picked.size && !picked.has(subj)) continue;

        const item = { time: label, subject: subj, room: "", day: norm(row[dayCol]||""), type: classifyType(subj) };
        (byDate[k] ||= []).push(item);
      }
    }
  }

  return byDate;
}

/* ---------- Public API ---------- */
export const ScheduleService = {
  /**
   * Read the sheet configured in /settings/routine, parse everything,
   * and return { byDate } keyed by YYYY-MM-DD.
   * profile: { cohort: 'senior'|'junior', section: 'E'|'F'|'G', subjects: [...] }
   */
  async readAll(profile){
    const settings = await RoutineService.getSettings();
    const url = profile?.cohort === "senior"
      ? (settings.seniorRoutineUrl || settings.seniorUrl || "")
      : (profile?.cohort === "junior"
          ? (settings.juniorRoutineUrl || settings.juniorUrl || "")
          : "");
    if (!url) return { byDate:{} };

    let csv = "";
    try { csv = await RoutineService.fetchCsv(url) || ""; } catch {}
    if (!csv) return { byDate:{} };

    const rows = csv.split(/\r?\n/).map(line => line.split(","));
    if (!rows.length) return { byDate:{} };

    const byDate = (profile?.cohort === "senior")
      ? parseSeniorGrid(rows, profile||{})
      : parseMatrix(rows, profile||{});

    return { byDate };
  },

  todayKey(){ return keyOf(today0()); }
};