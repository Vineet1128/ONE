// shared/services/AcademicsService.js
import { db, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "/shared/firebase.js";

/**
 * /settings/academics {
 *   juniorRoutineUrl: string,
 *   seniorRoutineUrl: string,
 *   reminderTime: "21:00",
 *   updatedAt, updatedBy
 * }
 */
const SETTINGS_DOC = doc(db, "settings", "academics");

export const AcademicsService = {
  async getSettings() {
    const snap = await getDoc(SETTINGS_DOC);
    if (!snap.exists()) return { juniorRoutineUrl: "", seniorRoutineUrl: "", reminderTime: "21:00" };
    const d = snap.data() || {};
    const legacy = d.routineUrl || "";
    return {
      juniorRoutineUrl: d.juniorRoutineUrl || legacy || "",
      seniorRoutineUrl: d.seniorRoutineUrl || legacy || "",
      reminderTime: d.reminderTime || "21:00",
      updatedAt: d.updatedAt || null,
      updatedBy: d.updatedBy || ""
    };
  },

  // full save (still available)
  async saveSettings({ juniorRoutineUrl, seniorRoutineUrl, reminderTime, actorEmail }) {
    await setDoc(SETTINGS_DOC, {
      juniorRoutineUrl: juniorRoutineUrl ?? "",
      seniorRoutineUrl: seniorRoutineUrl ?? "",
      reminderTime: reminderTime ?? "21:00",
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail || ""
    }, { merge: true });
  },

  // --- NEW: single-field updates (for 3 independent save buttons) ---
  async saveJunior({ url, actorEmail }) {
    await setDoc(SETTINGS_DOC, {
      juniorRoutineUrl: url || "",
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail || ""
    }, { merge: true });
  },

  async saveSenior({ url, actorEmail }) {
    await setDoc(SETTINGS_DOC, {
      seniorRoutineUrl: url || "",
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail || ""
    }, { merge: true });
  },

  async saveReminderTime({ time, actorEmail }) {
    await setDoc(SETTINGS_DOC, {
      reminderTime: time || "21:00",
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail || ""
    }, { merge: true });
  },

  onSettingsChange(cb) {
    return onSnapshot(SETTINGS_DOC, (snap) => {
      if (!snap.exists()) return cb({ juniorRoutineUrl: "", seniorRoutineUrl: "", reminderTime: "21:00" });
      const d = snap.data() || {};
      const legacy = d.routineUrl || "";
      cb({
        juniorRoutineUrl: d.juniorRoutineUrl || legacy || "",
        seniorRoutineUrl: d.seniorRoutineUrl || legacy || "",
        reminderTime: d.reminderTime || "21:00",
        updatedAt: d.updatedAt || null,
        updatedBy: d.updatedBy || ""
      });
    });
  }
};