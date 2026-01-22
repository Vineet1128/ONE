// /modules/academics/components/ScheduleRenderer.js
// Small, UI-only renderer for schedule cards (mobile-friendly)
//
// IMPORTANT:
// - Do NOT change data requirements or exported API.
// - Keep existing behavior working for any module that still uses this renderer.
// - Enhancement: support "sub" (submissions) type + better time sorting (AM first) without breaking.
// - Submissions legend is present here only if slots include submissions or a slot.type === "sub".

function inferType(slot) {
  // Prefer explicit type; otherwise infer from subject fields.
  const t = String(
    (slot && slot.type) ||
    slot?.subjectName ||
    slot?.subjectCode ||
    ""
  ).toLowerCase();

  // Submissions / deadlines (safe, broad)
  if (/(submission|submit|deadline|due\b|deliverable|assignment|case\s+submission|project\s+submission)/i.test(t)) {
    return "sub";
  }

  // Broad exam/assessment keywords (covers “Mid term”, “Quiz 1”, etc.)
  return /(exam|mid\s*term|end\s*(?:sem|term)|final|quiz|test|viva|assessment|presentation|event)/i.test(t)
    ? "exam"
    : "class";
}

function chipHtml(type) {
  if (type === "sub")  return `<span class="chip sub">Submissions</span>`;
  if (type === "exam") return `<span class="chip exam">Exam</span>`;
  return `<span class="chip class">Class</span>`;
}

// Parse a "time-ish" string into minutes for reliable ascending sort.
// Supports:
//  - "08:30"
//  - "08:30 To 10:00 AM"
//  - "8:00 AM"
//  - "02:45 to 4:15 PM"
// If it can't parse, it returns a large number so it falls to the bottom.
function toMinutes(timeText) {
  const s = String(timeText || "").trim().toLowerCase();
  if (!s) return 9999;

  // Grab the first hh:mm occurrence
  const m = s.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return 9999;

  let hh = Number(m[1] || 0);
  const mm = Number(m[2] || 0);

  // Determine AM/PM based on nearby tokens
  // If the string includes "pm" anywhere, treat as PM; else if includes "am", treat as AM.
  const hasPM = /\bpm\b/.test(s);
  const hasAM = /\bam\b/.test(s);

  // Convert 12-hour to 24-hour only if AM/PM explicitly present
  if (hasAM || hasPM) {
    if (hh === 12) hh = 0;
    if (hasPM) hh += 12;
  }

  return hh * 60 + mm;
}

export function renderScheduleCards(rootEl, window3) {
  if (!rootEl) return;

  const makeCard = (title, obj) => {
    const slots = (obj?.slots || []).slice();

    if (!slots.length) {
      return `
        <div class="card">
          <h3>${title} — ${obj?.date || ""}</h3>
          <div class="small" style="color:var(--muted,#64748b)">No classes found.</div>
        </div>`;
    }

    // Sort by time (AM first) without changing slot objects
    slots.sort((a, b) => toMinutes(a?.start || a?.time || "") - toMinutes(b?.start || b?.time || ""));

    // Determine if any submission exists to show legend chip (non-breaking)
    const hasSub = slots.some((s) => inferType(s) === "sub");

    // Build table rows; keep the same columns as before.
    // Append the chip next to the Subject (2nd column) to avoid layout changes.
    const rows = slots.map((s) => {
      const type = inferType(s);

      // Keep original time formatting behavior as much as possible
      const time =
        (s.start || "").replace(":00", "") +
        (s.end ? "–" + String(s.end).replace(":00", "") : "");

      const subjMain = s.subjectCode || s.subjectName || "-";
      const sectBadge = s.section ? ` <span class="badge">${s.section}</span>` : "";
      const typeChip = ` ${chipHtml(type)}`;

      return `
        <tr>
          <td>${time}</td>
          <td><b>${subjMain}</b>${sectBadge}${typeChip}</td>
          <td>${s.subjectName || ""}</td>
          <td>${s.faculty || ""}</td>
        </tr>
      `;
    }).join("");

    // Legend under title (always shows Class + Exam; adds Submissions only if present)
    const legend = `
      <div class="small" style="color:var(--muted,#64748b); display:flex; gap:8px; align-items:center; margin:4px 0 6px; flex-wrap:wrap">
        <span class="chip class">Class</span>
        <span class="chip exam">Exam</span>
        ${hasSub ? `<span class="chip sub">Submissions</span>` : ""}
      </div>`;

    return `
      <div class="card">
        <h3>${title} — ${obj.date || ""}</h3>
        ${legend}
        <div class="small" style="color:var(--muted,#64748b); margin-bottom:6px">
          ${slots.length} item${slots.length > 1 ? "s" : ""}
        </div>
        <div class="table-wrap" style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Subject</th>
                <th>Course</th>
                <th>Faculty</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  };

  rootEl.innerHTML = [
    makeCard("Yesterday", window3.yesterday || { date: "", slots: [] }),
    makeCard("Today",     window3.today     || { date: "", slots: [] }),
    makeCard("Tomorrow",  window3.tomorrow  || { date: "", slots: [] }),
  ].join("");
}