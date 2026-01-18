// /shared/services/RoutineService.js
import { db, doc, getDoc } from "/shared/firebase.js";

/**
 * Reads the unified routine settings doc (set by Acadcom Admin):
 *   /settings/routine {
 *     juniorUrl, seniorUrl,
 *     juniorTerm, seniorTerm,
 *     juniorSubjects: [..], seniorSubjects: [..],
 *     reminderTime
 *   }
 */
export class RoutineService {
  static async getSettings() {
    const ref = doc(db, "settings", "routine");
    const snap = await getDoc(ref);
    if (!snap.exists()) return {};
    return snap.data() || {};
  }

  /**
   * Best-effort CSV fetcher for public Google Sheets.
   * - Accepts a full Google Sheets URL.
   * - Tries to convert to a CSV export URL and fetch it.
   * - Returns text; caller parses.
   * Fails silently (returns null) if CORS/permissions prevent direct reading.
   */
  static async fetchCsv(sheetUrl) {
    try {
      if (!sheetUrl) return null;

      // If URL already looks like a CSV export, use as-is.
      let csvUrl = sheetUrl;

      // If it's a standard Sheets URL, transform to CSV export:
      // https://docs.google.com/spreadsheets/d/<ID>/export?format=csv
      // If a gid is present, preserve it.
      const m = sheetUrl.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)/i);
      if (m) {
        const id = m[1];
        const gidMatch = sheetUrl.match(/[?&]gid=([0-9]+)/i);
        const gid = gidMatch ? `&gid=${gidMatch[1]}` : "";
        csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid}`;
      }

      const res = await fetch(csvUrl, { credentials: "omit" });
      if (!res.ok) return null;
      const text = await res.text();
      return text || null;
    } catch {
      return null;
    }
  }
}