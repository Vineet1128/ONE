// /shared/services/ScheduleService.js
// Single-source schedule reader for Home/Plan/Anywhere.
// ✅ Uses RoutineParsers (same as Academics + AttendancePanel + Plan)
// ✅ Eliminates duplicated parsing logic permanently.

import { RoutineService } from "/shared/services/RoutineService.js";
import { RoutineParsers } from "/shared/parsers/RoutineParsers.js";

/* ---------- tiny helpers (stable) ---------- */
const keyOf = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today0 = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const ScheduleService = {
  /**
   * Read the sheet configured in /settings/routine, parse everything,
   * and return { byDate } keyed by YYYY-MM-DD.
   *
   * profile: { cohort: 'senior'|'junior', section: 'E'|'F'|'G', subjects: [...] }
   */
  async readAll(profile) {
    const settings = await RoutineService.getSettings();

    const cohort = profile?.cohort || "";
    const section = profile?.section || "";
    const subjects = Array.isArray(profile?.subjects) ? profile.subjects : [];

    const url =
      cohort === "senior"
        ? (settings.seniorRoutineUrl || settings.seniorUrl || "")
        : cohort === "junior"
        ? (settings.juniorRoutineUrl || settings.juniorUrl || "")
        : "";

    if (!url) return { byDate: {} };

    let csv = "";
    try {
      csv = (await RoutineService.fetchCsv(url)) || "";
    } catch {
      csv = "";
    }
    if (!csv) return { byDate: {} };

    const rows = csv.split(/\r?\n/).map((line) => line.split(","));
    if (!rows.length) return { byDate: {} };

    // ✅ Parse using the same logic everywhere (single source of truth)
    let map = {};
    if (cohort === "senior") {
      map =
        RoutineParsers.parseSeniorGrid(rows, {
          section,
          subjects
        }) || {};
    } else if (cohort === "junior") {
      map =
        RoutineParsers.parseJuniorGrid(rows, {
          section
        }) || {};
    } else {
      map = {};
    }

    // Normalize output shape (ensures stable fields exist)
    const out = {};
    for (const [iso, arr] of Object.entries(map || {})) {
      const list = Array.isArray(arr) ? arr : [];
      out[iso] = list
        .filter(Boolean)
        .map((x) => ({
          time: x.time || "",
          subject: x.subject || "",
          room: x.room || "",
          day: x.day || "",
          type: x.type || "class"
        }));
    }

    return { byDate: out };
  },

  todayKey() {
    return keyOf(today0());
  }
};