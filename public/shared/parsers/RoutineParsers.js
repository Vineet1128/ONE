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

  function parseDateLoose(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    s = s.replace(/\s+\d{1,2}[:.]\d{2}(:\d{2})?\s*(am|pm)?\s*$/i, "");

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");

    let m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
    if (m) {
      let [, dd, mm, yy] = m;
      dd = dd.padStart(2, "0");
      mm = mm.padStart(2, "0");
      const yyyy = yy
        ? yy.length === 2
          ? Number(yy) > 50
            ? "19" + yy
            : "20" + yy
          : yy
        : String(new Date().getFullYear());
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    }

    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))$/);
    if (m) {
      let [, mm, dd, yy] = m;
      dd = dd.padStart(2, "0");
      mm = mm.padStart(2, "0");
      const yyyy = yy
        ? yy.length === 2
          ? Number(yy) > 50
            ? "19" + yy
            : "20" + yy
          : yy
        : String(new Date().getFullYear());
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    }

    const d = new Date(s);
    return isNaN(d) ? null : new Date(d.toISOString().slice(0, 10) + "T00:00:00");
  }

  /* Simple classifier for event type (class vs exam/assessment) */
  const classifyType = (text) => {
    const t = norm(text).toLowerCase();
    if (/(exam|mid[-\s]*term|end[-\s]*sem|final|quiz|test|viva|assessment|presentation)/i.test(t)) return "exam";
    return "class";
  };

  // ✅ Exam-safe normalization: DO NOT strip trailing tokens like IFM
  function normalizeExamString(s) {
    return norm(s)
      .replace(/[()]/g, " ")
      .replace(/[–—-]/g, " ")
      .replace(/[.,:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  // Senior picked-subject exam-friendly matcher
  function subjectMatchesPicked(subj, type, pickedSet) {
    if (!pickedSet || pickedSet.size === 0) return true;

    const subjExact = norm(subj);

    // For classes: keep existing behavior (normalized token match)
    const subjNormClass = normalizeSubjectToken(subjExact).toUpperCase();

    const matchesPickedClass = (picked) => {
      if (!picked) return false;
      const pExact = norm(picked);
      const pNorm = normalizeSubjectToken(pExact).toUpperCase();

      if (pExact === subjExact) return true;
      if (pNorm && pNorm === subjNormClass) return true;
      return false;
    };

    if (type !== "exam") {
      for (const p of pickedSet) if (matchesPickedClass(p)) return true;
      return false;
    }

    /* =========================================================
       ✅ EXAMS ONLY (enhanced)
       Do NOT normalize the whole exam string with normalizeSubjectToken,
       because it strips trailing 2-4 uppercase tokens like "IFM".
       Instead use normalizeExamString() for matching.
       ========================================================= */

    const S = normalizeExamString(subjExact);

    for (const p of pickedSet) {
      if (!p) continue;

      const P = normalizeSubjectToken(p).toUpperCase().trim();
      if (!P) continue;

      // Whole-word match anywhere (covers: "MID TERM IFM", "IFM QUIZ 1", "QUIZ 1 IFM")
      const esc = P.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      if (re.test(S)) return true;

      // Backward compatible checks (safe)
      if (S.startsWith(P + " ")) return true;
      if (S.endsWith(" " + P)) return true;
      if (S.includes(P + " MID") || S.includes(P + " END") || S.includes(P + " QUIZ") || S.includes(P + " TEST"))
        return true;
    }

    return false;
  }

  /* ---------- Enhanced extractEntries (used by both parsers) ---------- */
  function extractEntries(cell) {
    const out = [];
    if (!cell) return out;

    let text = String(cell);

    text = text.replace(/\s*[–—-]\s*(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i, "");
    text = text.replace(/\s+(Prof|Professor|Dr|Mr|Mrs|Ms)\.?[^,;)]*$/i, "");
    text = text.replace(/\s*(?:[(-]?\s*)?(?:LCR|MCR)\s*0*\d+\s*\)?\s*$/gi, "");

    text = text.replace(/\((?!\s*[EFG](?:\s*[,&/]\s*[EFG])*\s*\))([^()]*)\)/gi, (_, inner) => inner.trim());
    text = text.replace(/\s*(?:[(-]?\s*)?(?:LCR|MCR)\s*0*\d+\s*\)?\s*$/ig, "");

    const parts = text.split(/\s*[,/;]\s*|\n+/).filter(Boolean);
    for (const pRaw of parts) {
      let p = norm(pRaw);
      if (!p || p === "-" || p === "—") continue;

      let sects = [];
      const sectMatch = p.match(/\(([EFG](?:\s*[,&/]\s*[EFG])*)\)/i);
      if (sectMatch) {
        sects = sectMatch[1]
          .replace(/\s+/g, "")
          .split(/[,&/]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        p = p.replace(sectMatch[0], "").trim();
      }

      let m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s+(?:sec|section)\s*([EFG](?:\s*[,&/]\s*[EFG])*)\b/i);
      if (m) {
        const subjRaw = norm(m[1]);
        const wordsSects = String(m[2] || "")
          .replace(/\s+/g, "")
          .split(/[,&/]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        sects = sects.length ? sects : wordsSects;

        const subj = normalizeGuestSubject(normalizeSubjectToken(subjRaw));
        if (sects.length) for (const s of sects) out.push({ subj, sect: s });
        else out.push({ subj, sect: "" });
        continue;
      }

      m = p.match(/^([A-Za-z0-9\-\/& .]+?)\s+common\b/i);
      if (m) {
        const subj = normalizeGuestSubject(normalizeSubjectToken(norm(m[1])));
        out.push({ subj, sect: "" });
        continue;
      }

      const subj = normalizeGuestSubject(
        normalizeSubjectToken(
          p
            .replace(/\s*\(?\b(?:LCR|MCR)\s*0?\d+\)?\s*$/i, "")
            .replace(/\s+prof(?:essor)?\..*$/i, "")
            .replace(/\s+dr\..*$/i, "")
            .trim()
        )
      );

      if (/^[A-Za-z0-9\-\/& .]{2,60}$/.test(subj)) {
        if (sects.length) for (const s of sects) out.push({ subj, sect: s });
        else out.push({ subj, sect: "" });
      }
    }

    return out;
  }

  function extractJuniorEntries(cell) {
    const out = [];
    if (!cell) return out;

    const text = String(cell).trim();
    if (!text) return out;

    if (text.startsWith("Act")) {
      const match = text.match(/Act\s*\[\]\s*\[(\d+)\]\[([A-Z])\]\s*\[(.*)\]/);
      if (match) {
        const [, session, section, eventName] = match;
        out.push({
          subj: eventName.trim(),
          sect: section,
          type: "exam",
        });
      }
      return out;
    }

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

  function normalizeGuestSubject(token) {
    if (!token) return token;
    const t = String(token);
    if (/guest\s*session/i.test(t)) {
      const base = t.replace(/\bguest\s*session\b/i, "").trim().replace(/[–—-]\s*$/, "").trim();
      return base || "Guest Session";
    }
    return t;
  }

  function normalizeSubjectToken(token) {
    let t = norm(token);
    if (!t) return t;

    const isRoman = (s) => /^[IVXLCDM]+$/i.test(s || "");

    let m = t.match(/\s*\(([A-Z]{2,4})\)\s*$/);
    if (m && !isRoman(m[1])) {
      t = t.replace(/\s*\(([A-Z]{2,4})\)\s*$/, "").trim();
    }

    m = t.match(/\s+([A-Z]{2,4})$/);
    if (m && !isRoman(m[1])) {
      t = t.replace(/\s+([A-Z]{2,4})$/, "").trim();
    }

    if (/^PJM\s+\d+$/i.test(t)) t = "PJM";

    const roomMatch = t.match(/\b(LCR|MCR)\b/i);
    if (roomMatch && typeof roomMatch.index === "number") {
      const idx = roomMatch.index;
      if (idx > 0) {
        const base = t.slice(0, idx).trim();
        if (base.length >= 2) t = base;
      }
    }

    return t.trim();
  }

  function parseSeniorGrid(rows, { section = "", subjects = [] } = {}) {
    const byDate = {};
    try {
      if (!rows?.length) return byDate;

      let headerRow = -1;
      for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const row = rows[r] || [];
        let hits = 0;
        for (let c = 2; c <= 9 && c < row.length; c++) if (looksLikeTimeLabel(row[c])) hits++;
        if (hits >= 3) {
          headerRow = r;
          break;
        }
      }
      if (headerRow === -1) return byDate;

      const slots = [];
      const hdr = rows[headerRow] || [];
      for (let c = 2; c <= 9 && c < hdr.length; c++) {
        const label = norm(hdr[c]);
        if (looksLikeTimeLabel(label)) slots.push({ col: c, label });
      }
      if (!slots.length) return byDate;

      const wantSect = String(section || "").toUpperCase();
      const picked = new Set(Array.isArray(subjects) ? subjects : []);

      let currentDateKey = null;
      let vCarry = {};
      let seenPerSlot = {};

      const resetDateBlock = (dateKey) => {
        currentDateKey = dateKey;
        vCarry = {};
        seenPerSlot = {};
      };

      for (let r = headerRow + 1; r < rows.length; r++) {
        const row = rows[r] || [];

        const rawDate = norm(row[1] || "");
        if (rawDate) {
          const d = parseDateLoose(rawDate);
          if (!d) {
            currentDateKey = null;
            vCarry = {};
            seenPerSlot = {};
            continue;
          }
          const k = keyOf(d);
          if (k !== currentDateKey) resetDateBlock(k);
        } else if (!currentDateKey) continue;

        for (const { col, label } of slots) {
          let cell = norm(row[col] || "");
          if (!cell && vCarry[col]) cell = vCarry[col];
          if (!cell) continue;

          vCarry[col] = cell;

          const entries = extractEntries(cell);

          for (const { subj, sect } of entries) {
            if (sect) {
              const parts = String(sect).toUpperCase().replace(/\s+/g, "").split(/[,/&]+/).filter(Boolean);
              if (!parts.includes(wantSect)) continue;
            }

            const type = classifyType(subj);
            if (!subjectMatchesPicked(subj, type, picked)) continue;

            const key = `${subj}|${sect || ""}`;
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

  function parseJuniorGrid(rows, { section = "" } = {}) {
    const byDate = {};
    try {
      if (!rows?.length) return byDate;

      let headerRow = -1;
      for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const row = rows[r] || [];
        let hits = 0;
        for (let c = 2; c <= 6 && c < row.length; c++) if (looksLikeTimeLabel(row[c])) hits++;
        if (hits >= 2) {
          headerRow = r;
          break;
        }
      }
      if (headerRow === -1) return byDate;

      const slots = [];
      const hdr = rows[headerRow] || [];
      for (let c = 2; c <= 6 && c < hdr.length; c++) {
        const label = norm(hdr[c]);
        if (looksLikeTimeLabel(label)) slots.push({ col: c, label });
      }
      if (!slots.length) return byDate;

      const wantSect = String(section || "").toUpperCase();

      let currentDateKey = null;
      let vCarry = {};
      let seenPerSlot = {};

      const resetDateBlock = (dateKey) => {
        currentDateKey = dateKey;
        vCarry = {};
        seenPerSlot = {};
      };

      for (let r = headerRow + 1; r < rows.length; r++) {
        const row = rows[r] || [];

        const rawDate = norm(row[0] || "");
        if (rawDate) {
          const d = parseDateLoose(rawDate);
          if (!d) {
            currentDateKey = null;
            vCarry = {};
            seenPerSlot = {};
            continue;
          }
          const k = keyOf(d);
          if (k !== currentDateKey) resetDateBlock(k);
        } else if (!currentDateKey) continue;

        for (const { col, label } of slots) {
          let cell = norm(row[col] || "");
          if (!cell && vCarry[col]) cell = vCarry[col];
          if (!cell) continue;

          vCarry[col] = cell;

          const entries = extractJuniorEntries(cell);

          for (const { subj, sect, room, type } of entries) {
            if (sect) {
              const parts = String(sect).toUpperCase().replace(/\s+/g, "").split(/[,/&]+/).filter(Boolean);
              if (!parts.includes(wantSect)) continue;
            }

            const kSig = `${subj}|${sect || ""}`;
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