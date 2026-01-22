// /shared/services/AttendanceService.js
// Attendance writes (safe, minimal). Works with local-time day keys.
//
// ✅ Single source of truth for writes:
// - Canonical field: `selections`
// - Backward compatible: `sessions` also written when provided (optional)

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

/**
 * Normalize user selections payload to a safe structure.
 * AttendancePanel expects { subject } (time optional).
 */
function normalizeSelections(input) {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((x) => ({
      subject: String(x?.subject || "").trim(),
      time: String(x?.time || "").trim()
    }))
    .filter((x) => !!x.subject);
}

export const AttendanceService = {
  /**
   * Legacy-friendly helper: save "today" with optional notes and sessions.
   *
   * ✅ Now also writes `selections` (canonical) to prevent split-brain.
   *
   * - `sessions` is optional array of { time, subject, type } entries
   * - `selections` will be derived from sessions (subject/time)
   * - Sets submitted: true so the banner won’t repeat the same day
   */
  async submitToday({ uid = "", email = "", notes = "", sessions = [] } = {}) {
    try {
      if (!uid || !email) return; // graceful no-op
      const iso = todayIsoLocal();
      const ref = doc(db, "attendance", uid, "days", iso);

      const safeSessions = Array.isArray(sessions) ? sessions : [];
      const derivedSelections = normalizeSelections(
        safeSessions.map((s) => ({
          subject: s?.subject,
          time: s?.time
        }))
      );

      await setDoc(
        ref,
        {
          uid,
          email: (email || "").toLowerCase(),
          day: iso,
          notes: (notes || "").trim(),

          // ✅ Canonical field
          selections: derivedSelections,

          // Optional legacy/debug payload (safe for readers to ignore)
          sessions: safeSessions,

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
   * Save selections for an explicit day key (YYYY-MM-DD).
   * - `selections` may be an empty array (blank submit is allowed).
   * - Canonical field: `selections`
   */
  async saveDaySelections({ uid = "", email = "", day = "", selections = [] } = {}) {
    try {
      if (!uid || !email || !day) return; // graceful no-op
      const ref = doc(db, "attendance", uid, "days", day);

      const safeSelections = normalizeSelections(selections);

      await setDoc(
        ref,
        {
          uid,
          email: (email || "").toLowerCase(),
          day,

          // ✅ Canonical
          selections: safeSelections,

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