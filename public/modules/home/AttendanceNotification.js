// /modules/home/AttendanceNotification.js
// Renders a daily sticky card (with a live clock) on Home that lists today's classes,
// lets users tick which they'll attend (blank allowed), and saves to attendance/{uid}/days/{YYYY-MM-DD}.

import { ScheduleService } from "/shared/services/ScheduleService.js";
import { AttendanceService } from "/shared/services/AttendanceService.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";

const norm  = (s) => String(s ?? "").trim();
const keyOf = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today0 = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

function parseHHMMLocal(s) {
  // "09:00" -> minutes since midnight
  const m = String(s||"").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  return hh*60 + mm;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours()*60 + d.getMinutes();
}

export class AttendanceNotification {
  constructor({ user }) {
    this.user = user;
    this.mountId = "dailyAttendanceNote";
    this.timer = null;
  }

  async init() {
    try{
      if (!this.user?.email) return;

      // ensure mount
      this.#ensureMount();

      // profile
      const prof = (await ProfileService.get(this.user.email)) || {};
      const cohort = prof.cohort || (this.user.email.startsWith("b24") ? "senior" : this.user.email.startsWith("b25") ? "junior" : "");
      const section = prof.section || "";
      const subjects = Array.isArray(prof.subjects) ? prof.subjects : [];

      // read schedule
      const { byDate } = await ScheduleService.readAll({ cohort, section, subjects });
      const todayIso = keyOf(today0());
      const todays = (byDate[todayIso] || []).slice();

      // Edge case #1: no classes -> show nothing
      if (!todays.length) { this.#clear(); return; }

      // reminder window from settings
      const settings = await RoutineService.getSettings();
      const reminderStr = settings?.reminderTime || "09:00";
      const startMin = parseHHMMLocal(reminderStr);
      const nowMin = nowMinutes();

      // Show only between reminderTime and midnight local
      if (startMin != null && nowMin < startMin) { this.#renderTeaser(reminderStr); return; }

      // Build UI
      this.#renderCard({ todays, reminderStr });

      // live clock
      this.#startClock(reminderStr);
    } catch(e){
      console.warn("AttendanceNotification init failed", e);
      this.#clear();
    }
  }

  destroy(){
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /* ----------------------- internal ----------------------- */
  #ensureMount(){
    if (!document.getElementById(this.mountId)){
      const host = document.createElement("div");
      host.id = this.mountId;
      // place right under the Notifications stub (or at end of .home-wrap)
      const stub = document.querySelector(".note-stub");
      if (stub?.parentNode) stub.parentNode.insertBefore(host, stub.nextSibling);
      else document.querySelector(".home-wrap")?.appendChild(host);
    }
  }

  #clear(){ const n = document.getElementById(this.mountId); if (n) n.innerHTML=""; }

  #renderTeaser(reminderStr){
    const n = document.getElementById(this.mountId); if (!n) return;
    n.innerHTML = `
      <div class="cta-card" style="margin-top:12px">
        <h3>Attendance</h3>
        <p>The daily check opens at <b>${reminderStr}</b>.</p>
        <div class="small" id="attClock" style="margin-top:6px;opacity:.7"></div>
      </div>`;
    this.#startClock(reminderStr);
  }

  #startClock(reminderStr){
    const el = document.getElementById("attClock");
    if (!el) return;
    const tick = ()=>{
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,"0");
      const mm = String(now.getMinutes()).padStart(2,"0");
      const ss = String(now.getSeconds()).padStart(2,"0");
      el.textContent = `Local time: ${hh}:${mm}:${ss} — reminder starts ${reminderStr}`;
    };
    tick();
    this.timer = setInterval(tick, 1000);
  }

  #renderCard({ todays, reminderStr }){
    const n = document.getElementById(this.mountId); if (!n) return;
    const iso = keyOf(today0());

    const items = todays.map((x, i)=>`
      <label class="row" style="align-items:center;gap:8px;margin:6px 0">
        <input type="checkbox" data-idx="${i}">
        <span class="small" style="opacity:.8;width:120px">${x.time||""}</span>
        <b>${x.subject}</b>
        ${x.type==="exam" ? `<span class="chip exam" style="margin-left:6px">Exam</span>` : `<span class="chip class" style="margin-left:6px">Class</span>`}
      </label>`).join("");

    n.innerHTML = `
      <div class="cta-card" style="margin-top:12px">
        <h3>Today’s attendance</h3>
        <div class="small" style="margin:4px 0 8px;color:#64748b">Pick the classes you plan to attend (blank is okay).</div>
        <div id="attClock" class="small" style="margin-bottom:8px;opacity:.7"></div>
        ${items || `<div class="small hint">No classes today.</div>`}
        <div class="row" style="margin-top:12px;gap:8px;justify-content:flex-end">
          <button id="btnSkipAtt" class="btn light">Submit blank</button>
          <button id="btnSaveAtt" class="btn">Submit</button>
        </div>
        <div id="attMsg" class="small" style="margin-top:8px"></div>
      </div>`;

    this.#wireActions({ iso, todays });
  }

  #wireActions({ iso, todays }){
    const $ = (id)=> document.getElementById(id);
    const btnSave = $("btnSaveAtt");
    const btnSkip = $("btnSkipAtt");
    const msg = $("attMsg");

    const collect = ()=>{
      const boxes = Array.from(document.querySelectorAll(`#${this.mountId} input[type="checkbox"][data-idx]`));
      const pickedIdx = boxes.filter(b=>b.checked).map(b=> +b.getAttribute("data-idx"));
      const sessions = pickedIdx.map(i => todays[i]);
      return sessions;
    };

    const finish = (ok, text)=>{
      if (msg){ msg.style.color = ok ? "#065f46" : "#991b1b"; msg.textContent = text; }
      if (ok){
        // keep the card, but mark done
        const saver = $("btnSaveAtt"); const skipper = $("btnSkipAtt");
        if (saver) saver.disabled = true;
        if (skipper) skipper.disabled = true;
      }
    };

    const doSubmit = async (sessions)=>{
      try{
        await AttendanceService.submitToday({
          uid: this.user?.uid || "",
          email: this.user?.email || "",
          sessions,                 // <-- optional array (add-only)
          notes: ""                 // keep compatible field
        });
        finish(true, "Submitted. You can change profile later (upon approval) if needed.");
      } catch(e){
        console.warn(e);
        finish(false, "Couldn’t save right now. Please try again.");
      }
    };

    if (btnSave) btnSave.onclick = async ()=> {
      const sessions = collect();
      await doSubmit(sessions);
    };
    if (btnSkip) btnSkip.onclick = async ()=> {
      await doSubmit([]); // blank allowed
    };
  }
}