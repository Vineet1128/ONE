// /modules/academics/components/ScheduleRenderer.js
// Small, UI-only renderer for Y/T/T cards (mobile-friendly)
// Enhancement: show Exam/Assessment alongside Class with a legend per card.
// No breaking changes to structure or data requirements.

function inferType(slot) {
  // Prefer provided type; otherwise infer from subject fields.
  const t = String(
    (slot && slot.type) ||
    slot?.subjectName ||
    slot?.subjectCode ||
    ""
  ).toLowerCase();

  // Broad but safe exam/assessment keywords (covers “Mid term”, “Quiz 1”, etc.)
  return /(exam|mid\s*term|end\s*(?:sem|term)|final|quiz|test|viva|assessment|presentation)/i.test(t)
    ? "exam"
    : "class";
}

function chipHtml(type) {
  return type === "exam"
    ? `<span class="chip exam">Exam</span>`
    : `<span class="chip class">Class</span>`;
}

export function renderScheduleCards(rootEl, window3) {
  if (!rootEl) return;

  const makeCard = (title, obj) => {
    const slots = obj?.slots || [];

    if (!slots.length) {
      return `
        <div class="card">
          <h3>${title} — ${obj?.date || ""}</h3>
          <div class="small" style="color:#64748b">No classes found.</div>
        </div>`;
    }

    // Build table rows; keep the same columns as before.
    // We only append the chip next to the Subject (2nd column) to avoid layout changes.
    const rows = slots.map((s) => {
      const type = inferType(s);
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

    // Show a tiny legend under the title (always; harmless even if no exams that day)
    const legend = `
      <div class="small" style="color:#64748b; display:flex; gap:8px; align-items:center; margin:4px 0 6px">
        <span class="chip class">Class</span>
        <span class="chip exam">Exam</span>
      </div>`;

    return `
      <div class="card">
        <h3>${title} — ${obj.date || ""}</h3>
        ${legend}
        <div class="small" style="color:#64748b; margin-bottom:6px">
          ${slots.length} class${slots.length > 1 ? "es" : ""}
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