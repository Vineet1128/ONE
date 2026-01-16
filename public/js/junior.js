// public/app/junior.js
// Junior dashboard: browse & book slots, view bookings, raise demands.

import {
  auth, db,
  collection, doc, query, where, onSnapshot, getDoc, addDoc, updateDoc,
  serverTimestamp, Timestamp, increment
} from "../shared/firebase.js";
import { attachAuthHandlers } from "../shared/auth.js";

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const fmtHM = (s) => (s || "").padStart(5, "0");

let me = null;
let lastBookings = [];
let lastDemands  = [];

/* ---------- auth & boot ---------- */
attachAuthHandlers();
auth.onAuthStateChanged((u) => {
  me = u || null;
  if (!me) return;

  const pill = $("authState");
  if (pill) pill.textContent = me.email || "";

  liveNotifications();
  wireOpenSlots();
  wireMyBookings();
  wireRaiseDemand();
  wireMyDemands();
});

/* ---------- notifications ---------- */
function liveNotifications() {
  const box = $("jrNotice");
  if (!box) return;
  onSnapshot(
    query(
      collection(db, "notifications"),
      where("email", "==", me.email),
      where("read", "==", false)
    ),
    async (snap) => {
      if (snap.empty) {
        box.style.display = "none";
        box.innerHTML = "";
        return;
      }
      const notes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      box.style.display = "block";
      box.className = "card sticky";
      box.innerHTML = notes
        .map((n) => `<div style="margin:6px 0">🔔 ${esc(n.body || n.title || "")}</div>`)
        .join("");
      for (const n of notes) {
        try {
          await updateDoc(doc(db, "notifications", n.id), {
            read: true,
            readAt: serverTimestamp(),
          });
        } catch {}
      }
    }
  );
}

/* ---------- browse & book open slots ---------- */
function wireOpenSlots() {
  const tbody = $("openSlotsTBody");
  const sel = $("slotFilter");
  const btn = $("btnSlotsRefresh");
  if (!tbody || !sel || !btn) return;

  let unsub = null;
  const listen = () => {
    if (unsub) unsub();
    const dom = sel.value;
    const base = [where("status", "==", "open")];
    if (dom && dom !== "All") base.push(where("domain", "==", dom));

    unsub = onSnapshot(query(collection(db, "slots"), ...base), (snap) => {
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const safeBooked = (s) =>
        Number.isFinite(s.bookedCount) ? s.bookedCount : (Array.isArray(s.attendees) ? s.attendees.length : 0);
      const safeCap = (s) => Number.isFinite(s.capacity)&&s.capacity>0 ? s.capacity : 1;

      rows = rows.filter((s) => safeBooked(s) < safeCap(s));
      rows.sort((a, b) => (a.startAt?.toMillis?.() || 0) - (b.startAt?.toMillis?.() || 0));

      tbody.innerHTML =
        rows.map((s) => `
          <tr>
            <td>${esc(s.date || "")}</td>
            <td>${esc(s.start && s.end ? `${s.start}–${s.end}` : "")}</td>
            <td>${esc(s.domain || "")}</td>
            <td>${esc(s.topic || "")}</td>
            <td>${esc(s.ownerName || s.ownerEmail || "")}</td>
            <td>${(Number.isFinite(s.bookedCount)?s.bookedCount:(s.attendees?.length||0))}/${(Number.isFinite(s.capacity)&&s.capacity>0?s.capacity:1)}</td>
            <td><button class="btn green" data-act="book" data-id="${s.id}">Book</button></td>
          </tr>`
        ).join("") || `<tr><td colspan="7" class="small">No slots to show.</td></tr>`;
    });
  };

  listen();
  sel.onchange = listen;
  btn.onclick = listen;

  tbody.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.act !== "book") return;
    const id = b.dataset.id;

    try {
      // re-read latest slot state
      const ref = doc(db, "slots", id);
      const s = await getDoc(ref);
      if (!s.exists()) return alert("Slot no longer exists.");
      const slot = s.data();

      const booked = Number.isFinite(slot.bookedCount)
        ? slot.bookedCount
        : (Array.isArray(slot.attendees) ? slot.attendees.length : 0);
      const cap = Number.isFinite(slot.capacity) && slot.capacity > 0 ? slot.capacity : 1;

      if (slot.status !== "open") return alert("Slot not open.");
      if (booked >= cap) return alert("No seats left.");
      if (Array.isArray(slot.attendees) && slot.attendees.find(a => a.email === me.email))
        return alert("You already booked this slot.");

      const attendee = {
        uid: me.uid,
        email: me.email,
        name: me.displayName || me.email,
        bookedAt: Timestamp.now(),
      };

      // Rules enforce +1 invariants; this keeps UI responsive.
      await updateDoc(ref, {
        attendees: [...(slot.attendees || []), attendee],
        bookedCount: increment(1),
      });

      // Include slotId + owner fields so seniors can manage bookings
      await addDoc(collection(db, "bookings"), {
        slotId: id,
        ownerUid: slot.ownerUid,
        ownerEmail: slot.ownerEmail,
        ownerName: slot.ownerName || slot.ownerEmail,

        juniorUid: me.uid,
        juniorEmail: me.email,
        juniorName: me.displayName || me.email,

        date: slot.date, start: slot.start, end: slot.end,
        domain: slot.domain, topic: slot.topic,

        status: "booked",
        createdAt: serverTimestamp(),
      });

      alert("Booked!");
    } catch (err) {
      alert(err.message || err);
    }
  };
}

/* ---------- my bookings ---------- */
function renderMyBookings(all) {
  const domVal = $("bkDomain")?.value || "All";
  const stVal = $("bkStatus")?.value || "All";

  let rows = Array.isArray(all) ? [...all] : [];
  if (domVal !== "All") rows = rows.filter((r) => r.domain === domVal);
  if (stVal !== "All") rows = rows.filter((r) => (r.status || "booked") === stVal);

  rows.sort((a, b) => {
    const as = (a.date || "") + " " + (a.start || "00:00");
    const bs = (b.date || "") + " " + (b.start || "00:00");
    return as < bs ? -1 : as > bs ? 1 : 0;
  });

  const tbody = $("myBookingsTBody");
  if (!tbody) return;
  tbody.innerHTML =
    rows.map((b) => `
      <tr>
        <td>${esc(b.date || "")}</td>
        <td>${esc(b.start && b.end ? `${b.start}–${b.end}` : "")}</td>
        <td>${esc(b.domain || "")}</td>
        <td>${esc(b.topic || "")}</td>
        <td>${esc(b.ownerName || b.ownerEmail || "")}</td>
        <td>${esc(b.status || "booked")}</td>
      </tr>`
    ).join("") || `<tr><td colspan="6" class="small">No bookings yet.</td></tr>`;
}

function wireMyBookings() {
  const btn = $("btnBkRefresh");
  onSnapshot(
    query(collection(db, "bookings"), where("juniorUid", "==", auth.currentUser.uid)),
    (snap) => {
      lastBookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMyBookings(lastBookings);
    }
  );
  if (btn) btn.onclick = () => renderMyBookings(lastBookings);
}

/* ---------- raise a demand ---------- */
function wireRaiseDemand() {
  const f = $("demandForm");
  const msg = $("demMsg");
  if (!f) return;

  f.onsubmit = async (e) => {
    e.preventDefault();
    msg.textContent = "";
    const domain = $("demDomain").value;
    if (!domain) {
      msg.textContent = "Pick a domain";
      msg.className = "msg err";
      return;
    }
    const topic = $("demTopic").value.trim();
    const notes = $("demNotes").value.trim();
    try {
      await addDoc(collection(db, "demands"), {
        domain, topic, notes,
        juniorUid: auth.currentUser.uid,
        juniorEmail: auth.currentUser.email,
        juniorName: auth.currentUser.displayName || auth.currentUser.email,
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      f.reset();
      msg.textContent = "✅ Demand submitted.";
      msg.className = "msg ok";
    } catch (err) {
      msg.textContent = "❌ " + (err.message || err);
      msg.className = "msg err";
    }
  };
}

/* ---------- my demands ---------- */
async function renderMyDemands(all) {
  const domVal = $("dmDomain")?.value || "All";
  const stVal = $("dmStatus")?.value || "All";

  let rows = Array.isArray(all) ? [...all] : [];
  if (domVal !== "All") rows = rows.filter((r) => r.domain === domVal);
  if (stVal !== "All") rows = rows.filter((r) => (r.status || "") === stVal);

  // newest first by updatedAt
  rows.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));

  const tbody = $("myDemandsTBody");
  if (!tbody) return;

  const html = await Promise.all(rows.map(async (d) => {
    let seniorName = "—";
    let slotInfo = "—";

    if (d.scheduledSlotId) {
      try {
        const sSnap = await getDoc(doc(db, "slots", d.scheduledSlotId));
        if (sSnap.exists()) {
          const s = sSnap.data();
          seniorName = s.ownerName || s.ownerEmail || "Senior";
          const date = s.date || "";
          const start = s.start || "";
          const end = s.end || "";
          slotInfo = `${date} ${start && end ? `${start}–${end}` : ""}`.trim();
        }
      } catch {}
    }

    return `
      <tr>
        <td>${esc(d.domain || "")}</td>
        <td>${esc(d.topic || "")}</td>
        <td>${esc(d.status || "")}</td>
        <td>${esc(seniorName)}</td>
        <td>${esc(slotInfo)}</td>
      </tr>`;
  }));

  tbody.innerHTML = html.join("") || `<tr><td colspan="5" class="small">No demands yet.</td></tr>`;
}

function wireMyDemands() {
  const btn = $("btnDmRefresh");
  onSnapshot(
    query(collection(db, "demands"), where("juniorUid", "==", auth.currentUser.uid)),
    (snap) => {
      lastDemands = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // async call is fine; we don't need to await here
      renderMyDemands(lastDemands);
    }
  );
  if (btn) btn.onclick = () => renderMyDemands(lastDemands);
}