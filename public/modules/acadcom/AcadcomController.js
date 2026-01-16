// /modules/acadcom/AcadcomController.js
import {
  db, doc, getDoc, setDoc, serverTimestamp,
  collection, query, where, orderBy, limit, onSnapshot, updateDoc
} from "/shared/firebase.js";

export class AcadcomController {
  constructor({ email }) { this.email = (email||"").toLowerCase(); }

  async init() {
    this.cacheEls();
    await this.load();
    this.bind();
    this.listenChangeRequests(); // NEW: live requests section
  }

  cacheEls() {
    this.e = {
      // existing controls
      juniorUrl:  document.getElementById("juniorUrl"),
      seniorUrl:  document.getElementById("seniorUrl"),
      reminder:   document.getElementById("reminderTime"),
      meridiem:   document.getElementById("reminderMeridiem"),
      termSenior: document.getElementById("termSenior"),
      termJunior: document.getElementById("termJunior"),
      srSubj:     document.getElementById("seniorSubjects"),
      jrSubj:     document.getElementById("juniorSubjects"),

      btnJrUrl:   document.getElementById("btnSaveJuniorUrl"),
      btnSrUrl:   document.getElementById("btnSaveSeniorUrl"),
      btnRem:     document.getElementById("btnSaveReminder"),
      btnTermS:   document.getElementById("btnSaveTermSenior"),
      btnTermJ:   document.getElementById("btnSaveTermJunior"),
      btnSrSubj:  document.getElementById("btnSaveSeniorSubjects"),
      btnJrSubj:  document.getElementById("btnSaveJuniorSubjects"),

      openJunior: document.getElementById("openJunior"),
      openSenior: document.getElementById("openSenior"),
      meta:       document.getElementById("routineMeta"),
      msg:        document.getElementById("saveMsg"),

      // NEW: resources inputs (Terms 1–6) + save button
      res1: document.getElementById("term1ResourcesUrl"),
      res2: document.getElementById("term2ResourcesUrl"),
      res3: document.getElementById("term3ResourcesUrl"),
      res4: document.getElementById("term4ResourcesUrl"),
      res5: document.getElementById("term5ResourcesUrl"),
      res6: document.getElementById("term6ResourcesUrl"),
      btnRes: document.getElementById("btnSaveResources"),

      // NEW: change-requests area (add these ids in acadcom.html if not present)
      reqBox:  document.getElementById("reqBox"),
      reqList: document.getElementById("reqList"),
      reqHist: document.getElementById("reqHist"),
      reqMsg:  document.getElementById("reqMsg"),

      // Reset counter controls (NEW)
      resetEmail: document.getElementById("resetEmail"),
      resetTerm:  document.getElementById("resetTerm"),
      btnReset:   document.getElementById("btnResetCounter"),
      resetMsg:   document.getElementById("resetMsg"),
    };

    // Only auto-create if the page doesn't already provide ANY of the section.
    if (!this.e.reqList && !this.e.reqHist && !this.e.reqMsg) {
      const host = document.querySelector(".wrap .card")?.parentElement;
      if (host) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <h3>Change requests</h3>
          <p class="hint">Approve or decline senior profile change requests (max 2 per term per student). Older requests remain for audit.</p>
          <div id="reqMsg" class="small" style="margin:8px 0;color:#64748b">Loading…</div>
          <div id="reqList" style="margin-top:8px"></div>
          <hr style="margin:14px 0;border:none;border-top:1px solid #e5e7eb">
          <div class="small hint" style="margin-bottom:6px">Recent activity</div>
          <div id="reqHist"></div>
        `;
        host.appendChild(card);
        this.e.reqBox  = card;
        this.e.reqList = card.querySelector("#reqList");
        this.e.reqHist = card.querySelector("#reqHist");
        this.e.reqMsg  = card.querySelector("#reqMsg");
      }
    }
  }

  /* ---------- helpers (unchanged + time helpers) ---------- */
  setResetMsg(kind, text) {
    if (!this.e.resetMsg) return;
    this.e.resetMsg.className = `msg ${kind === "ok" ? "ok" : "err"}`;
    this.e.resetMsg.textContent = text;
  }

  to24h(hhmm, mer) {
    const m = String(hhmm||"").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    let h = +m[1], min = +m[2];
    if (h < 1 || h > 12 || min < 0 || min > 59) return "";
    const up = String(mer||"").toUpperCase();
    if (up === "PM" && h !== 12) h += 12;
    if (up === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`;
  }
  from24h(hhmm24) {
    const m = String(hhmm24||"").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { hhmm12:"", meridiem:"AM" };
    let h = +m[1], min = +m[2];
    let mer = "AM";
    if (h === 0) { h = 12; mer = "AM"; }
    else if (h === 12) { mer = "PM"; }
    else if (h > 12) { h -= 12; mer = "PM"; }
    return { hhmm12: `${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`, meridiem: mer };
  }

  async load() {
    const ref = doc(db, "settings", "routine");
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data()||{}) : {};

    if (this.e.juniorUrl)  this.e.juniorUrl.value = d.juniorUrl || d.juniorRoutineUrl || "";
    if (this.e.seniorUrl)  this.e.seniorUrl.value = d.seniorUrl || d.seniorRoutineUrl || "";

    const { hhmm12, meridiem } = this.from24h(d.reminderTime || "");
    if (this.e.reminder) this.e.reminder.value = hhmm12 || "";
    if (this.e.meridiem) this.e.meridiem.value = meridiem;

    if (this.e.termSenior) this.e.termSenior.value= d.seniorTerm || d.termSenior || "";
    if (this.e.termJunior) this.e.termJunior.value= d.juniorTerm || d.termJunior || "";
    if (this.e.srSubj)     this.e.srSubj.value    = (Array.isArray(d.seniorSubjects)?d.seniorSubjects:[]).join("\n");
    if (this.e.jrSubj)     this.e.jrSubj.value    = (Array.isArray(d.juniorSubjects)?d.juniorSubjects:[]).join("\n");

    if (this.e.openJunior) this.e.openJunior.href = this.e.juniorUrl.value || "#";
    if (this.e.openSenior) this.e.openSenior.href = this.e.seniorUrl.value || "#";

    // NEW: resources URLs
    if (this.e.res1) this.e.res1.value = d.term1ResourcesUrl || "";
    if (this.e.res2) this.e.res2.value = d.term2ResourcesUrl || "";
    if (this.e.res3) this.e.res3.value = d.term3ResourcesUrl || "";
    if (this.e.res4) this.e.res4.value = d.term4ResourcesUrl || "";
    if (this.e.res5) this.e.res5.value = d.term5ResourcesUrl || "";
    if (this.e.res6) this.e.res6.value = d.term6ResourcesUrl || "";

    if (this.e.meta) {
      const by = d.updatedBy ? ` · ${d.updatedBy}` : "";
      const at = d.updatedAt ? ` · ${new Date(d.updatedAt.seconds*1000).toLocaleString()}` : "";
      this.e.meta.textContent =
        `Junior: ${this.e.juniorUrl.value ? "set" : "—"}, ` +
        `Senior: ${this.e.seniorUrl.value ? "set" : "—"}, ` +
        `Reminder: ${d.reminderTime || "—"} (24h), ` +
        `Senior term: ${this.e.termSenior.value || "—"}, ` +
        `Junior term: ${this.e.termJunior.value || "—"}${by}${at}`;
    }

    // (Optional UX) If present, prefill resetTerm with current senior term
    if (this.e.resetTerm && this.e.termSenior?.value) {
      this.e.resetTerm.value = this.e.termSenior.value;
    }
  }

  bind() {
    const save = async (patch) => {
      try {
        await setDoc(doc(db,"settings","routine"), {
          ...patch, updatedBy: this.email, updatedAt: serverTimestamp()
        }, { merge:true });
        if (this.e.msg) { this.e.msg.className="msg ok"; this.e.msg.textContent="Saved."; }
        await this.load();
      } catch (e) {
        console.error(e);
        if (this.e.msg) { this.e.msg.className="msg err"; this.e.msg.textContent=e?.message||"Save failed"; }
      }
    };

    this.e.btnJrUrl && (this.e.btnJrUrl.onclick = ()=> save({ juniorUrl: (this.e.juniorUrl?.value||"").trim() }));
    this.e.btnSrUrl && (this.e.btnSrUrl.onclick = ()=> save({ seniorUrl: (this.e.seniorUrl?.value||"").trim() }));

    if (this.e.btnRem) {
      this.e.btnRem.onclick = ()=>{
        const raw = (this.e.reminder?.value||"").trim();
        const mer = (this.e.meridiem?.value||"AM").toUpperCase();
        const t24 = this.to24h(raw, mer);
        if (!t24) {
          if (this.e.msg) { this.e.msg.className="msg err"; this.e.msg.textContent="Enter a valid time like 07:30 + AM/PM."; }
          return;
        }
        return save({ reminderTime: t24 });
      };
    }

    this.e.btnTermS && (this.e.btnTermS.onclick = ()=> save({ seniorTerm: (this.e.termSenior?.value||"").trim() }));
    this.e.btnTermJ && (this.e.btnTermJ.onclick = ()=> save({ juniorTerm: (this.e.termJunior?.value||"").trim() }));
    this.e.btnSrSubj && (this.e.btnSrSubj.onclick = ()=> save({
      seniorSubjects: (this.e.srSubj?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
    }));
    this.e.btnJrSubj && (this.e.btnJrSubj.onclick = ()=> save({
      juniorSubjects: (this.e.jrSubj?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
    }));

    // NEW: save all resources fields together
    if (this.e.btnRes) {
      this.e.btnRes.onclick = () => save({
        term1ResourcesUrl: (this.e.res1?.value||"").trim(),
        term2ResourcesUrl: (this.e.res2?.value||"").trim(),
        term3ResourcesUrl: (this.e.res3?.value||"").trim(),
        term4ResourcesUrl: (this.e.res4?.value||"").trim(),
        term5ResourcesUrl: (this.e.res5?.value||"").trim(),
        term6ResourcesUrl: (this.e.res6?.value||"").trim(),
      });
    }

    // NEW: Reset counter binding (bump changeReset.T{term})
    if (this.e.btnReset) {
      this.e.btnReset.onclick = async () => {
        try {
          const email = (this.e.resetEmail?.value || "").trim().toLowerCase();
          const term  = Number((this.e.resetTerm?.value || "").trim());
          if (!email || !term) {
            this.setResetMsg("err", "Enter a valid email and term.");
            return;
          }
          const ref = doc(db, "profiles", email);
          const snap = await getDoc(ref);
          const d = snap.exists() ? (snap.data()||{}) : {};
          const map = d.changeReset || {};
          const key = `T${term}`;
          const next = Number(map[key] || 0) + 1;

          // Merge so we don't clobber other profile fields
          await setDoc(ref, { changeReset: { ...map, [key]: next }, updatedAt: serverTimestamp() }, { merge: true });

          this.setResetMsg("ok", `Counter reset for ${email}, term ${term}.`);
        } catch (e) {
          console.error(e);
          this.setResetMsg("err", e?.message || "Reset failed.");
        }
      };
    }
  }

  /* ============================================================
     CHANGE REQUESTS (NEW) — minimal, non-invasive
     ============================================================ */
  listenChangeRequests() {
    if (!this.e.reqList) return; // section not present → nothing to do
    if (this.e.reqMsg) this.e.reqMsg.textContent = "Loading…";

    const col = collection(db, "profileChangeRequests");

    // Query A: pending
    try {
      const qPending = query(col,
        where("status","==","pending"),
        orderBy("createdAt","desc")
      );
      this._unsubPending?.(); // cleanup if reinit
      this._unsubPending = onSnapshot(qPending, snap => {
        const items = [];
        snap.forEach(docSnap => items.push({ id: docSnap.id, ...docSnap.data() }));
        this.renderPending(items);
      }, (err) => {
        console.error(err);
        const link = this.extractIndexLink(err?.message || "");
        if (this.e.reqMsg) {
          this.e.reqMsg.innerHTML =
            link
              ? `This list needs a Firestore index. <a href="${link}" target="_blank" rel="noopener">Click to create</a>.`
              : `Failed to load requests. ${err?.message||""}`;
        }
      });
    } catch (e) {
      console.error(e);
      if (this.e.reqMsg) this.e.reqMsg.textContent = e?.message || "Failed to listen for requests.";
    }

    // Query B: recent activity (last 20)
    try {
      const qRecent = query(col, orderBy("createdAt","desc"), limit(20));
      this._unsubRecent?.();
      this._unsubRecent = onSnapshot(qRecent, snap => {
        const items = [];
        snap.forEach(docSnap => items.push({ id: docSnap.id, ...docSnap.data() }));
        this.renderRecent(items);
      });
    } catch (e) {
      console.error(e);
    }
  }

  extractIndexLink(msg) {
    const m = String(msg||"").match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/i);
    return m ? m[0] : "";
  }

  renderPending(list) {
    if (this.e.reqMsg) this.e.reqMsg.textContent = list.length ? "" : "No pending requests.";
    if (!this.e.reqList) return;

    const rows = list.map(r => {
      const fromSec = r?.from?.section || "–";
      const toSec   = r?.to?.section || "–";
      const fromSub = Array.isArray(r?.from?.subjects) ? r.from.subjects.join(", ") : "–";
      const toSub   = Array.isArray(r?.to?.subjects)   ? r.to.subjects.join(", ")   : "–";
      const when    = r?.createdAt?.toDate?.()?.toLocaleString?.() || "";

      return `
        <div class="card" style="padding:12px;margin:10px 0;border:1px solid #e5e7eb;border-radius:12px">
          <div class="row" style="align-items:flex-start">
            <div style="flex:1;min-width:260px">
              <div><b>${r.email || ""}</b> · Term ${r.term || ""}</div>
              <div class="small" style="color:#64748b">${when}</div>
            </div>
            <div style="flex:2;min-width:260px">
              <div class="small hint">From</div>
              <div>Section: <b>${fromSec}</b></div>
              <div>Subjects: ${fromSub}</div>
            </div>
            <div style="flex:2;min-width:260px">
              <div class="small hint">To</div>
              <div>Section: <b>${toSec}</b></div>
              <div>Subjects: ${toSub}</div>
            </div>
          </div>
          <div class="row" style="margin-top:10px">
            <button class="btn green" data-approve="${r.id}">Approve</button>
            <button class="btn red"   data-decline="${r.id}">Decline</button>
          </div>
        </div>
      `;
    }).join("");

    this.e.reqList.innerHTML = rows || "";

    // Bind actions
    this.e.reqList.querySelectorAll("[data-approve]").forEach(btn=>{
      btn.onclick = () => this.handleApprove(btn.getAttribute("data-approve"));
    });
    this.e.reqList.querySelectorAll("[data-decline]").forEach(btn=>{
      btn.onclick = () => this.handleDecline(btn.getAttribute("data-decline"));
    });
  }

  renderRecent(items) {
    if (!this.e.reqHist) return;
    const rows = items.map(r=>{
      const when = r?.updatedAt?.toDate?.()?.toLocaleString?.() ||
                   r?.createdAt?.toDate?.()?.toLocaleString?.() || "";
      return `<div class="small" style="margin:4px 0">
        <b>${r.email||""}</b> · Term ${r.term||""} — <i>${r.status||"pending"}</i> · ${when}
      </div>`;
    }).join("");
    this.e.reqHist.innerHTML = rows || `<div class="small hint">No recent activity.</div>`;
  }

  async handleApprove(id) {
    try {
      const ref = doc(db, "profileChangeRequests", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      const r = snap.data() || {};
      const email = (r.email || "").toLowerCase();
      const term  = Number(r.term || 0);

      // 1) apply profile changes (acadcom/admin allowed by rules)
      const profRef = doc(db, "profiles", email);
      const payload = {
        section:  r?.to?.section || "",
        subjects: Array.isArray(r?.to?.subjects) ? r.to.subjects : [],
        cohort: r.cohort || "senior",
        term: term,
        locked: true,
        lockTerm: term,
        updatedAt: serverTimestamp()
      };
      await setDoc(profRef, payload, { merge:true });

      // 2) mark request approved
      await updateDoc(ref, {
        status: "approved",
        approvedBy: this.email,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || "Approve failed");
    }
  }

  async handleDecline(id) {
    try {
      const ref = doc(db, "profileChangeRequests", id);
      await updateDoc(ref, {
        status: "declined",
        declinedBy: this.email,
        declinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || "Decline failed");
    }
  }
}