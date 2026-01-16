// /shared/services/ProfileService.js
import {
  db, doc, getDoc, setDoc, serverTimestamp,
  collection, addDoc, getDocs, query, where
} from "/shared/firebase.js";

export class ProfileService {
  static docRef(email) {
    return doc(db, "profiles", (email || "").toLowerCase());
  }

  static async get(email) {
    if (!email) return null;
    const snap = await getDoc(this.docRef(email));
    return snap.exists() ? snap.data() : null;
  }

  static async save(email, data) {
    if (!email) throw new Error("Email required");
    const ref = this.docRef(email);
    const payload = {
      email: (email || "").toLowerCase(),
      ...data,
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload, { merge: true });
    return payload;
  }

  // -------- Lock helpers (senior, per term) --------
  static async lockForTerm(email, term) {
    if (!email) throw new Error("Email required");
    return setDoc(this.docRef(email), {
      locked: true,
      lockTerm: Number(term),
      lockAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  static isLockedForTerm(profile, term) {
    return !!(profile?.locked && Number(profile?.lockTerm) === Number(term));
  }

  // -------- internal: read current reset version for (email, term) --------
  static async _getResetVersion(email, term) {
    const lower = (email || "").toLowerCase();
    const snap = await getDoc(this.docRef(lower));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const map = d.changeReset || {};
    const key = `T${Number(term)}`;
    return Number(map[key] || 0);
  }

  /**
   * Create a senior profile change request.
   * Limit: 2 per (email, term, resetVersion). If exhausted, throws with a message: "Contact Acadcom."
   */
  static async submitChangeRequest(email, { from, to, cohort, term }) {
    const lower = (email || "").toLowerCase();
    const t = Number(term);

    // 1) fetch reset version
    const rv = await this._getResetVersion(lower, t);

    // 2) count existing requests for this (email, term, rv)
    const reqsCol = collection(db, "profileChangeRequests");
    const q1 = query(
      reqsCol,
      where("email", "==", lower),
      where("term", "==", t),
      where("rv", "==", rv)
    );
    const existing = await getDocs(q1);
    const count = existing.size;
    if (count >= 2) {
      const err = new Error("You’ve used both changes for this term. Contact Acadcom.");
      err.code = "limit-reached";
      throw err;
    }

    // 3) create new request tagged with reset version
    const payload = {
      email: lower,
      cohort: cohort || "senior",
      term: t,
      rv,                      // reset version (used for counting)
      from,                    // { section, subjects[] }
      to,                      // { section, subjects[] }
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(reqsCol, payload);
    return { id: docRef.id, ...payload, remaining: 2 - (count + 1) };
  }
}
