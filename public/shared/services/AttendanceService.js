// /shared/services/AttendanceService.js
// Attendance writes (safe, minimal). Works with local-time day keys.

import { db, doc, setDoc, serverTimestamp } from "/shared/firebase.js";

/** Build YYYY-MM-DD in local time (prevents UTC off-by-one). */
function todayIsoLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const AttendanceService = {
  /**
   * Legacy-friendly helper: save "today" with optional notes and sessions.
   * - `sessions` is optional array of { time, subject, type } entries
   * - Sets submitted: true so the banner won’t repeat the same day
   */
  async submitToday({ uid = "", email = "", notes = "", sessions = [] } = {}) {
    try {
      if (!uid || !email) return; // graceful no-op
      const iso = todayIsoLocal();
      const ref = doc(db, "attendance", uid, "days", iso);

      await setDoc(
        ref,
        {
          uid,
          email: (email || "").toLowerCase(),
          day: iso,
          notes: (notes || "").trim(),
          // Optional payload; safe for readers to ignore
          sessions: Array.isArray(sessions) ? sessions : [],
          submitted: true,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("Attendance submitToday failed:", err);
      throw err;
    }
  },

  /**
   * New helper: save selections for an explicit day key (YYYY-MM-DD).
   * - `selections` may be an empty array (blank submit is allowed).
   */
  async saveDaySelections({ uid = "", email = "", day = "", selections = [] } = {}) {
    try {
      if (!uid || !email || !day) return; // graceful no-op
      const ref = doc(db, "attendance", uid, "days", day);
      await setDoc(
        ref,
        {
          uid,
          email: (email || "").toLowerCase(),
          day,
          selections: Array.isArray(selections) ? selections : [],
          submitted: true,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("Attendance saveDaySelections failed:", err);
      throw err;
    }
  }
};