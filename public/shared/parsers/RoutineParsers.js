// /shared/parsers/RoutineParsers.js
// Single source of truth for Senior + Junior CSV parsers (merged-cell friendly).
// - Junior: Date in A, time headers C..G (2..6), ignore columns after G.
// - Senior: Header-detect C..J, date in B; matches existing logic.
// - Handles combined sections (E&F&G), venue/teacher suffix stripping, exam classification.
// - Treats "Guest Session" variants; maps "OMCR Guest Session" -> subject "OMCR" (section-aware).
// - Returns a byDate map: { "YYYY-MM-DD": [{ time, subject, room:"", day:"", type }] }

const norm = (s) => String(s ?? "").trim();

export const RoutineParsers = (() => {
  /* ---------- tiny helpers (shared) ---------- */
  const keyOf = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const looksLikeTimeLabel = (v) =>
    /^\s*\d{1,2}[:.]\d{2}(:\d{2})?(\s*(?:-|to)\s*\d{1,2}[:.]\d{2}(:\d{2})?)?\s*(am|pm)?\s*$/i.test(norm(v));

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

  /* Simple classifier for event type (class vs exam/assessment) */
  const classifyType = (text) => {
    const t = norm(text).toLowerCase();
    // allow hyphen/space variants too
    if (/(exam|mid[-\s]*term|end[-\s]*sem|final|quiz|test|viva|assessment|presentation)/i.test(t)) return "exam";
    return "class";
  };

  // Senior picked-subject exam-friendly matcher
  function subjectMatchesPicked(subj, type, pickedSet){
    if (!pickedSet || pickedSet.size === 0) return true;   // nothing chosen → allow

    const subjExact = norm(subj);
    const subjNorm  = normalizeSubjectToken(subjExact).toUpperCase();

    const matchesPicked = (picked) => {
      if (!picked) return false;
      const pExact = norm(picked);
      const pNorm  = normalizeSubjectToken(pExact).toUpperCase();

      // 1) Preserve old exact behaviour
      if (pExact === subjExact) return true;

      // 2) New: base-code equivalence ("ERP (AG)" <-> "ERP", "PJM 3" <-> "PJM")
      if (pNorm && pNorm === subjNorm) return true;

      return false;
    };

    // For normal classes, require an exact or normalized match
    if (type !== "exam") {
      for (const p of pickedSet) {
        if (matchesPicked(p)) return true;
      }
      return false;
    }

    // For exams, keep the original flexible behaviour,
    // but use normalized bases so "PJM Quiz 1" etc still work.
    const S = subjNorm;
    for (const p of pickedSet){
      if (!p) continue;
      const P = normalizeSubjectToken(p).toUpperCase().trim();
      if (!P) continue;
      if (S === P) return true;
      if (S.startsWith(P + " ")) return true;              // "BDM QUIZ 1", "OMCR MID TERM"
      if (S.includes(P + " MID") || S.includes(P + " END") ||
          S.includes(P + " QUIZ") || S.includes(P + " TEST"))
        return true;
    }
    return false;
  }

  /* ---------- Enhanced extractEntries (used by both parsers) ----------
     - supports multi-sections (E,F&G) via any joiner ,/&
     - strips venue tails like (LCR01)/MCR 02/LCR03
     - strips teacher tails like - Prof. X / Dr. Y
     - unwraps non-section parentheses
     - GUEST SESSION: maps "OMCR Guest Session" → subject "OMCR"; if no base exists → subject "Guest Session"
  */
  function extractEntries(cell){
    const out = [];
    if (!cell) return out;

    let text = String(cell);

    // Remove teacher tags at end (with or without dash)
    text = text.replace(/\s*[–—-]\s*(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i, "");
    // IMPORTANT: require at least one space before title token to avoid stripping "MST"
    text = text.replace(/\s+(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i, "");

    // Strip any trailing venue tokens like "(LCR01)", "( MCR02 )", "LCR03", "- LCR01"
    text = text.replace(/\s*(?:[(-]?\s*)?(?:LCR|MCR)\s*0*\d+\s*\)?\s*$/ig, "");

    // Unwrap extra parens that are NOT just section tags like (E) or (E,F&G)
    // Example: "(OMCR Guest Session)" -> "OMCR Guest Session"
    text = text.replace(
      /\((?!\s*[EFG](?:\s*[,&/]\s*[EFG])*\s*\))([^()]*)\)/gi,
      (_, inner) => inner.trim()
    );

    // Re-strip venue again in case unwrapping exposed one (e.g., "(LCR01)" -> "LCR01")
    text = text.replace(/\s*(?:[(-]?\s*)?(?:LCR|MCR)\s*0*\d+\s*\)?\s*$/ig, "");

    const parts = text.split(/\s*[,/;]\s*|\n+/).filter(Boolean);
    for (const pRaw of parts){
      let p = norm(pRaw);
      if (!p || p === "-" || p === "—") continue;

      // Capture and remove inline combined section tag to reuse after subject normalization
      let sects = [];
      const sectMatch = p.match(/\(([EFG](?:\s*[,&/]\s*[EFG])*) slicing/i);
      if (sectMatch){
        sects = sectMatch[1].replace(/\s+/g,"").split(/[,&/]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
        p = p.replace(sectMatch[0], "").trim();
      }

      // Pattern: "SUBJ Sec E" | "SUBJ Section E&F" (sections written as words)
      let m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s+(?:sec|section)\s*([EFG](?:\s*[,&/]\s*[EFG])*)\b/i);
      if (m){
        const subjRaw = norm(m[1]);
        const wordsSects = String(m[2]||"").replace(/\s+/g,"").split(/[,&/]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
        sects = sects.length ? sects : wordsSects;
        // 🔹 Enhancement: normalize subject token here as well
        const subj = normalizeGuestSubject(normalizeSubjectToken(subjRaw));
        if (sects.length){ for (const s of sects) out.push({ subj, sect: s }); } else out.push({ subj, sect: "" });
        continue;
      }

      // Pattern: "SUBJ common"
      m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s+common\b/i);
      if (m){
        // 🔹 Enhancement: normalize subject token here as well
        const subj = normalizeGuestSubject(normalizeSubjectToken(norm(m[1])));
        out.push({ subj, sect: "" });
        continue;
      }

      // Fallback: treat remaining token as subject (after guest/venue/teacher cleanup)
      const subj = normalizeGuestSubject(
        normalizeSubjectToken(
          p
            .replace(/\s*\(?\b(?:LCR|MCR)\s*0?\d+\)?\s*$/i, "")
            .replace(/\s+prof(?:essor)?\..*$/i,"")
            .replace(/\s+dr\..*$/i,"")
            .trim()
        )
      );
      if (/^[A-Za-z0-9\-\/& .]{2,60}$/.test(subj)) {
        if (sects.length){ for (const s of sects) out.push({ subj, sect: s }); } else out.push({ subj, sect: "" });
      }
    }
    return out;
  }
  
    function extractJuniorEntries(cell) {
    const out = [];
    if (!cell) return out;

    const text = String(cell).trim();
    if (!text) return out;

    // Special Event Format: Act [] [Session][Section] [Event Name]
    if (text.startsWith("Act")) {
        const match = text.match(/Act\s*\[\]\s*\[(\d+)\]\[([A-Z])\]\s*\[(.*)\]/);
        if (match) {
            const [, session, section, eventName] = match;
            out.push({
                subj: eventName.trim(),
                sect: section,
                type: "exam", // Treat special events as exams
            });
        }
        return out;
    }

    // Standard Format: Subject [Room] [Professor] [Session][Section]
    const match = text.match(/(\w+)\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[(\d+)\]\[([A-Z])\]/);
    if (match) {
        const [, subject, room, professor, session, section] = match;
        out.push({
            subj: subject.trim(),
            room: room.trim(),
            prof: professor.trim(),
            sect: section,
            type: classifyType(subject),
        });
    }

    return out;
}


  // Normalize "Guest Session" tokens into the base subject when present
  function normalizeGuestSubject(token){
    if (!token) return token;
    const t = String(token);
    if (/guest\s*session/i.test(t)){
      const base = t.replace(/\bguest\s*session\b/i,"").trim().replace(/[–—-]\s*$/,"").trim();
      return base || "Guest Session";
    }
    return t;
  }

  // NEW: normalize subject tokens after base cleanup, without changing old behavior
  // except for very specific suffix patterns:
  //  - trailing professor initials: "ERP (AG)" / "MI4E (DB)" / "ERP AG" → "ERP"
  //  - PJM batch markers: "PJM 3" / "PJM 4" / "PJM 20" -> "PJM"
  //  - room + batch tails: "PJM LCR 01 1" / "MI4E (DB) LCR 01 1" -> base subject
  function normalizeSubjectToken(token){
    let t = norm(token);
    if (!t) return t;

    // If suffix looks like all-caps Roman numeral (II, IV, VI...), DO NOT strip.
    const isRoman = (s) => /^[IVXLCDM]+$/i.test(s || "");

    // 1) Strip trailing initials in parentheses: "ERP (AG)" / "MI4E (DB)" → base
    let m = t.match(/\s*\(([A-Z]{2,4})\)\s*$/);
    if (m && !isRoman(m[1])) {
      t = t.replace(/\s*\(([A-Z]{2,4})\)\s*$/,"");
      t = t.trim();
    }

    // 2) Strip trailing bare initials as last token: "ERP AG" / "MI4E DB" → base
    m = t.match(/\s+([A-Z]{2,4})$/);
    if (m && !isRoman(m[1])) {
      t = t.replace(/\s+([A-Z]{2,4})$/,"");
      t = t.trim();
    }

    // 3) Special-case PJM batches: "PJM 3" / "PJM 4" / "PJM 20" -> "PJM"
    if (/^PJM\s+\d+$/i.test(t)) {
      t = "PJM";
    }

    // 4) If there's a room code (LCR/MCR) anywhere, trim it and everything after.
    // This catches patterns like "PJM LCR 01 1", "MI4E (DB) LCR 01 1" etc.
    const roomMatch = t.match(/\b(LCR|MCR)\b/i);
    if (roomMatch && typeof roomMatch.index === "number") {
      const idx = roomMatch.index;
      if (idx > 0) {
        const base = t.slice(0, idx).trim();
        if (base.length >= 2) {
          t = base;
        }
      }
    }

    return t.trim();
  }

  /** Senior parser (Row 2..end, Col B..J) — merged-sheet friendly
   *  Returns { byDate }
   */
  function parseSeniorGrid(rows, { section = "", subjects = [] } = {}){
    const byDate = {};
    try{
      if (!rows?.length) return byDate;

      // 1) Locate header row by time-looking labels in C..J
      let headerRow = -1;
      for (let r = 0; r < Math.min(rows.length, 10); r++){
        const row = rows[r] || [];
        let hits = 0;
        for (let c = 2; c <= 9 && c < row.length; c++){
          if (looksLikeTimeLabel(row[c])) hits++;
        }
        if (hits >= 3) { headerRow = r; break; }
      }
      if (headerRow === -1) return byDate;

      // Build slots from header row (C..J)
      const slots = [];
      const hdr = rows[headerRow] || [];
      for (let c = 2; c <= 9 && c < hdr.length; c++){
        const label = norm(hdr[c]);
        if (looksLikeTimeLabel(label)) slots.push({ col:c, label });
      }
      if (!slots.length) return byDate;

      const wantSect = String(section||"").toUpperCase();
      const picked   = new Set(Array.isArray(subjects) ? subjects : []);

      // Per-date state
      let currentDateKey = null;
      let vCarry = {};                           // col -> last non-empty text (within current date block)
      let seenPerSlot = {};                      // label -> Set("SUBJ|SECT") for dedupe within date block

      const resetDateBlock = (dateKey)=>{
        currentDateKey = dateKey;
        vCarry = {};
        seenPerSlot = {};
      };

      for (let r = headerRow + 1; r < rows.length; r++){
        const row = rows[r] || [];

        // B = date (start / continuation of a date block)
        const rawDate = norm(row[1] || "");
        if (rawDate){
          const d = parseDateLoose(rawDate);
          if (!d){ currentDateKey = null; vCarry = {}; seenPerSlot = {}; continue; }
          const k = keyOf(d);
          if (k !== currentDateKey) resetDateBlock(k);
        } else if (!currentDateKey){
          continue;
        }

        // For each time slot column, apply vertical carry and collect entries
        for (const {col, label} of slots){
          let cell = norm(row[col] || "");
          if (!cell && vCarry[col]) cell = vCarry[col];
          if (!cell) continue;

          vCarry[col] = cell;

          const entries = extractEntries(cell);

          for (const {subj, sect} of entries){
            // Section filter: allow combined sections (E,F&G etc.)
            if (sect){
              const parts = String(sect).toUpperCase().replace(/\s+/g,"").split(/[,/&]+/).filter(Boolean);
              if (!parts.includes(wantSect)) continue;
            }
            // seniors: subject filter with exam support
            const type = classifyType(subj);
            if (!subjectMatchesPicked(subj, type, picked)) continue;

            // dedupe within (date,slot)
            const key = `${subj}|${sect||""}`;
            const bucket = (seenPerSlot[label] ||= new Set());
            if (bucket.has(key)) continue;
            bucket.add(key);

            const item = { time: label, subject: subj, room: "", day: "", type };
            (byDate[currentDateKey] ||= []).push(item);
          }
        }
      }

      return byDate;
    } catch {
      return byDate;
    }
  }

  /** Junior parser (STRICT to columns A..G)
   *  - Header times from C..G (2..6)
   *  - Date from A (0)
   *  - Ignore any columns after G
   *  - Merged rows handled via vertical carry per column within a date block
   *  Returns { byDate }
   */
  function parseJuniorGrid(rows, { section = "" } = {}){
    const byDate = {};
    try{
      if (!rows?.length) return byDate;

      // 1) Locate header row by time-looking labels in C..G
      let headerRow = -1;
      for (let r = 0; r < Math.min(rows.length, 10); r++){
        const row = rows[r] || [];
        let hits = 0;
        for (let c = 2; c <= 6 && c < row.length; c++){
          if (looksLikeTimeLabel(row[c])) hits++;
        }
        if (hits >= 2) { headerRow = r; break; }
      }
      if (headerRow === -1) return byDate;

      // Build slot definitions strictly from columns C..G
      const slots = [];
      const hdr = rows[headerRow] || [];
      for (let c = 2; c <= 6 && c < hdr.length; c++){
        const label = norm(hdr[c]);
        if (looksLikeTimeLabel(label)) slots.push({ col:c, label });
      }
      if (!slots.length) return byDate;

      const wantSect = String(section||"").toUpperCase();

      // Per-date state for merged rows (vertical carry + dedupe)
      let currentDateKey = null;
      let vCarry = {};         // col -> last non-empty text within current date block
      let seenPerSlot = {};    // label -> Set("SUBJ|SECT") per date block

      const resetDateBlock = (dateKey)=>{
        currentDateKey = dateKey;
        vCarry = {};
        seenPerSlot = {};
      };

      // Start scanning from the row after header
      for (let r = headerRow + 1; r < rows.length; r++){
        const row = rows[r] || [];

        // A = date (strict)
        const rawDate = norm(row[0] || "");
        if (rawDate){
          const d = parseDateLoose(rawDate);
          if (!d){ currentDateKey = null; vCarry = {}; seenPerSlot = {}; continue; }
          const k = keyOf(d);
          if (k !== currentDateKey) resetDateBlock(k);
        } else if (!currentDateKey){
          continue;
        }

        // Only look at columns C..G (2..6)
        for (const {col, label} of slots){
          let cell = norm(row[col] || "");
          if (!cell && vCarry[col]) cell = vCarry[col];
          if (!cell) continue;

          vCarry[col] = cell;

          const entries = extractJuniorEntries(cell);

          for (const {subj, sect, room, type} of entries){
            // Section filter: allow combined E/F/G in any joiner style
            if (sect){
              const parts = String(sect).toUpperCase().replace(/\s+/g,"").split(/[,/&]+/).filter(Boolean);
              if (!parts.includes(wantSect)) continue;
            }

            // dedupe inside (date, slot)
            const kSig = `${subj}|${sect||""}`;
            const bucket = (seenPerSlot[label] ||= new Set());
            if (bucket.has(kSig)) continue;
            bucket.add(kSig);

            const item = { time: label, subject: subj, room: room, day: "", type: type };
            (byDate[currentDateKey] ||= []).push(item);
          }
        }
      }

      return byDate;
    } catch {
      return byDate;
    }
  }

  return {
    looksLikeTimeLabel,
    parseDateLoose,
    extractEntries,
    classifyType,
    parseSeniorGrid,
    parseJuniorGrid,
  };
})();
