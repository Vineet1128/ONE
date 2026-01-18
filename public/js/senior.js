// public/app/senior.js  (Model 4.2.1 - demand↔slot linkage; "completed" fix)

import {
  auth, db,
  collection, doc, addDoc, setDoc, onSnapshot, getDocs, getDoc,
  query, where, serverTimestamp, Timestamp, increment
} from "/shared/firebase.js?v=1.6";
import { esc, fmtHM } from "/shared/ui.js";

const $ = (id) => document.getElementById(id);
const toTs = (d, t) => {
  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm] = fmtHM(t).split(":").map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, dd, hh, mm));
};

let me = null;
let justApprovedQueue = new Map();
let seniorResetAt = null;
let lastRows = [];

/* -------------------------------------------------- */
/* Create slot                                        */
/* -------------------------------------------------- */
function wireProvideSlot() {
  const form = $("slotForm"), msg = $("slotMsg");
  let creating = false;
  // holds the demand chosen via "Approve → Create now" until submit
  let pendingApprovedDemand = null;

  // set by wireDemands() when senior approves a demand
  window.__setPendingDemandForSlotCreation = (d) => { pendingApprovedDemand = d; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (creating) return;
    msg.textContent = "";

    const domain = $("slotDomain").value;
    const topic  = $("slotTopic").value.trim();
    const date   = $("slotDate").value;
    const start  = $("slotStart").value;
    const end    = $("slotEnd").value;
    const cap    = 1; // fixed per model
    const notes  = $("slotNotes").value.trim();

    if (!domain || !date || !start || !end) {
      msg.textContent = "Please fill all required fields.";
      msg.className = "msg err";
      return;
    }

    try {
      creating = true;

      // 1) Create the slot
      const slotRef = await addDoc(collection(db, "slots"), {
        ownerUid: me.uid,
        ownerEmail: me.email,
        ownerName: me.displayName || me.email,
        domain, topic, date, start, end,
        startAt: toTs(date, start),
        endAt:   toTs(date, end),
        capacity: cap,
        notes,
        status: "open",
        bookedCount: 0,
        attendees: [],
        createdAt: serverTimestamp()
      });

      // 2) If slot fulfills an approved demand, link & auto-book that junior
      if (pendingApprovedDemand) {
        const d = pendingApprovedDemand;

        // Link both ways
        await setDoc(slotRef, { originDemandId: d.id }, { merge: true });

        // Auto-book the requesting junior into this new slot
        const attendee = {
          uid: d.juniorUid || "",
          email: d.juniorEmail || "",
          name: d.juniorName || d.juniorEmail || "",
          bookedAt: Timestamp.now(),
        };
        await setDoc(slotRef, {
          attendees: [attendee],
          bookedCount: 1
        }, { merge: true });

        // Create booking row (so junior sees it in My Bookings)
        await addDoc(collection(db, "bookings"), {
          slotId: slotRef.id,
          ownerUid: me.uid,
          ownerEmail: me.email,
          ownerName: me.displayName || me.email,

          juniorUid: d.juniorUid || "",
          juniorEmail: d.juniorEmail || "",
          juniorName: d.juniorName || d.juniorEmail || "",

          date, start, end,
          domain, topic,

          status: "booked",
          createdAt: serverTimestamp(),
        });

        // Notify junior
        if (d.juniorEmail) {
          await addDoc(collection(db, "notifications"), {
            email: d.juniorEmail,
            title: "Mentorship slot scheduled",
            body: `Your request (${domain}${topic ? " - " + topic : ""}) is scheduled on ${date} ${start}–${end}.`,
            createdAt: serverTimestamp(),
            read: false
          });
        }

        // Mark demand scheduled + store linkage
        await setDoc(doc(db, "demands", d.id), {
          status: "scheduled",
          scheduledSlotId: slotRef.id,
          updatedAt: serverTimestamp()
        }, { merge: true });

        const note = $("approveNudge");
        if (note) {
          note.textContent = "Slot created and the junior has been auto-booked.";
          note.style.display = "block";
        }
        pendingApprovedDemand = null;
      }

      msg.textContent = "✅ Slot created.";
      msg.className = "msg ok";
      form.reset();
    } catch (err) {
      msg.textContent = "❌ " + (err.message || err);
      msg.className = "msg err";
    } finally {
      creating = false;
    }
  };
}

/* -------------------------------------------------- */
/* My slots (render + actions)                        */
/* -------------------------------------------------- */

// helper to display rating summary
const ratingSummary = (s) =>
  s?.ratings ? ` (C/T/P: ${s.ratings.comm}/${s.ratings.topic}/${s.ratings.punctual})` : "";

// SAFE counters for legacy docs
const safeBooked = (s) =>
  Number.isFinite(s.bookedCount) ? s.bookedCount :
  (Array.isArray(s.attendees) ? s.attendees.length : 0);

const safeCap = (s) =>
  Number.isFinite(s.capacity) && s.capacity > 0 ? s.capacity : 1;

function renderMySlots(rowsAll) {
  const rows = seniorResetAt
    ? rowsAll.filter(r => (r.createdAt?.toMillis?.() || 0) >= seniorResetAt)
    : rowsAll.slice();

  const tbody = $("mySlotsTBody");
  const bTotal = $("mySlotsTotal");
  const bUpcoming = $("mySlotsUpcoming");
  const now = Date.now();

  bTotal.textContent = rows.length;
  bUpcoming.textContent = rows.filter(r => (r.startAt?.toMillis?.() || 0) > now).length;

  const html = rows.map(s => {
    const bookedCount = safeBooked(s);
    const cap = safeCap(s);
    const names = (Array.isArray(s.attendees) && s.attendees.length)
      ? s.attendees.map(a => esc(a.name || a.email || "Junior")).join(", ")
      : "—";

    const statusText = esc(s.status || "open") + ratingSummary(s);

    // Buttons: Cancel for open; Complete only when open AND at least one booking
    const showCancel   = (s.status === "open");
    const showComplete = (s.status === "open" && bookedCount > 0);

    return `
      <tr>
        <td>${esc(s.date || "—")}</td>
        <td>${esc(s.start && s.end ? `${s.start}–${s.end}` : "—")}</td>
        <td>${esc(s.domain || "—")}</td>
        <td>${esc(s.topic || "—")}</td>
        <td>${bookedCount}/${cap}</td>
        <td>${statusText} — ${names}</td>
        <td class="actions">
          ${showCancel ? `<button class="btn red" data-act="cancel" data-id="${s.id}">Cancel</button>` : ""}
          ${showComplete ? `<button class="btn light" data-act="complete" data-id="${s.id}">Complete</button>` : ""}
          <div id="rate_${s.id}" class="ratingRow" style="display:none">
            <div class="row">
              <div><label>Communication</label><input id="r_comm_${s.id}" type="number" min="1" max="5" inputmode="numeric" placeholder="1-5"></div>
              <div><label>Topic Strength</label><input id="r_topic_${s.id}" type="number" min="1" max="5" inputmode="numeric" placeholder="1-5"></div>
              <div><label>Punctuality</label><input id="r_punct_${s.id}" type="number" min="1" max="5" inputmode="numeric" placeholder="1-5"></div>
            </div>
            <div class="row">
              <button class="btn green" data-act="rate-save" data-id="${s.id}">Save rating</button>
              <button class="btn light" data-act="rate-cancel" data-id="${s.id}">Cancel</button>
            </div>
            <div class="ratingHint">Scores are 1–5 and stored on this slot.</div>
          </div>
        </td>
      </tr>`;
  }).join("");

  tbody.innerHTML = html || `<tr><td colspan="7" class="small">No slots yet.</td></tr>`;
}

function wireMySlots() {
  const tbody = $("mySlotsTBody");

  onSnapshot(
    query(collection(db, "slots"), where("ownerUid", "==", me.uid)),
    (snap) => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.startAt?.toMillis?.() || 0) - (b.startAt?.toMillis?.() || 0));
      lastRows = rows;
      renderMySlots(rows);
    }
  );

  tbody.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;

    const id = b.dataset.id;
    const act = b.dataset.act;

    /* ---- Cancel ---- */
    if (act === "cancel") {
      if (!confirm("Cancel this slot? Booked juniors will be notified.")) return;
      try {
        const ref = doc(db, "slots", id);
        const s = await getDoc(ref); if (!s.exists()) return;
        const slot = s.data();

        // Update ONLY bookings that belong to this senior
        const bSnap = await getDocs(
          query(
            collection(db, "bookings"),
            where("slotId", "==", id),
            where("ownerUid", "==", me.uid)
          )
        );
        for (const bd of bSnap.docs) {
          await setDoc(bd.ref, { status: "cancelled", updatedAt: serverTimestamp() }, { merge: true });
        }

        // Notify attendees
        if (Array.isArray(slot.attendees)) {
          for (const a of slot.attendees) {
            await addDoc(collection(db, "notifications"), {
              email: a.email || "",
              title: "Slot cancelled",
              body: `Your slot (${slot.domain} - ${slot.topic}, ${slot.date} ${slot.start}–${slot.end}) was cancelled.`,
              createdAt: serverTimestamp(),
              read: false
            });
          }
        }

        // Cancel the slot
        await setDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp() }, { merge: true });

        // Update linked demand -> cancelled
        const originDemandId = slot.originDemandId;
        if (originDemandId) {
          await setDoc(doc(db, "demands", originDemandId), {
            status: "cancelled",
            updatedAt: serverTimestamp()
          }, { merge: true });
        } else {
          // fallback: find by scheduledSlotId
          const q = query(collection(db, "demands"), where("scheduledSlotId", "==", id));
          const snapD = await getDocs(q);
          for (const ddoc of snapD.docs) {
            await setDoc(ddoc.ref, { status: "cancelled", updatedAt: serverTimestamp() }, { merge: true });
          }
        }
      } catch (err) {
        alert(err.message || err);
      }
      return;
    }

    /* ---- Open rating panel ---- */
    if (act === "complete") {
      const panel = $("rate_" + id);
      if (panel) panel.style.display = "block";
      return;
    }

    /* ---- Hide rating panel ---- */
    if (act === "rate-cancel") {
      const panel = $("rate_" + id);
      if (panel) panel.style.display = "none";
      return;
    }

    /* ---- Save rating (Complete) ---- */
    if (act === "rate-save") {
      const panel = $("rate_" + id);
      if (!panel) return;
      const getInt = (sel) => {
        const el = panel.querySelector(sel);
        const n = parseInt((el?.value || "").trim(), 10);
        return Number.isInteger(n) ? n : NaN;
      };
      const comm  = getInt(`#r_comm_${id}`);
      const topic = getInt(`#r_topic_${id}`);
      const punct = getInt(`#r_punct_${id}`);
      const ok = (n) => Number.isInteger(n) && n >= 1 && n <= 5;
      if (!ok(comm) || !ok(topic) || !ok(punct)) {
        alert("Please give 1–5 on all three parameters.");
        return;
      }
      try {
        const slotRef = doc(db, "slots", id);

        // Update the slot first
        await setDoc(slotRef, {
          status: "completed",
          completedAt: serverTimestamp(),
          ratings: { comm, topic, punctual: punct }
        }, { merge: true });

        // Update ONLY this senior’s bookings
        const bSnap = await getDocs(
          query(
            collection(db, "bookings"),
            where("slotId", "==", id),
            where("ownerUid", "==", me.uid)
          )
        );
        for (const bd of bSnap.docs) {
          await setDoc(bd.ref, {
            status: "completed",
            updatedAt: serverTimestamp(),
            feedback: { comm, topic, punctual: punct }
          }, { merge: true });
        }

        // ✅ FIX: mark linked demand as "completed" (not "closed")
        const sSnap = await getDoc(slotRef);
        const originDemandId = sSnap.data()?.originDemandId;
        if (originDemandId) {
          await setDoc(doc(db, "demands", originDemandI), {
            status: "completed",
            updatedAt: serverTimestamp()
          }, { merge: true });
        } else {
          const q = query(collection(db, "demands"), where("scheduledSlotId", "==", id));
          const snapD = await getDocs(q);
          for (const ddoc of snapD.docs) {
            await setDoc(ddoc.ref, { status: "completed", updatedAt: serverTimestamp() }, { merge: true });
          }
        }

        panel.style.display = "none";
      } catch (err) {
        alert(err.message || err);
      }
      return;
    }
  };
}

/* -------------------------------------------------- */
/* Demands (senior view)                              */
/* -------------------------------------------------- */
function wireDemands() {
  const tbody = $("demandsTBody");
  const filter = $("demFilter");
  const btn = $("btnDemRefresh");
  let unsub = null;

  function listen() {
    if (unsub) unsub();
    const dom = filter.value;
    const base = [where("status", "==", "active")];
    if (dom && dom !== "All") base.push(where("domain", "==", dom));
    unsub = onSnapshot(query(collection(db, "demands"), ...base), (snap) => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      tbody.innerHTML =
        rows.map(d => `
          <tr>
            <td>${esc(d.juniorName || "Junior")}</td>
            <td>${esc(d.juniorEmail || "")}</td>
            <td>${esc(d.domain || "")}</td>
            <td>${esc(d.status || "")}</td>
            <td>${d.createdAt?.toDate?.().toLocaleDateString?.() || ""}</td>
            <td class="actions">
              <button class="btn green" data-act="approve" data-id="${d.id}">Approve → Create now</button>
              <button class="btn red" data-act="close" data-id="${d.id}">Close</button>
            </td>
          </tr>`).join("") || `<tr><td colspan="6" class="small">No active requests.</td></tr>`;
    });
  }
  listen();
  filter.onchange = listen;
  btn.onclick = listen;

  tbody.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;

    if (act === "close") {
      await setDoc(doc(db, "demands", id), { status: "closed", updatedAt: serverTimestamp() }, { merge: true });
      return;
    }
    if (act === "approve") {
      const snap = await getDoc(doc(db, "demands", id)); if (!snap.exists()) return;
      const d = { id: snap.id, ...snap.data() };
      await setDoc(doc(db, "demands", id), {
        status: "approved",
        approverUid: auth.currentUser.uid,
        approverEmail: auth.currentUser.email,
        decidedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      const list = justApprovedQueue.get(d.domain) || [];
      list.push({ id: d.id, juniorUid: d.juniorUid || null, juniorEmail: d.juniorEmail || null, juniorName: d.juniorName || null });
      justApprovedQueue.set(d.domain, list);

      $("slotDomain").value = d.domain || "";
      $("slotTopic").value  = d.topic  || "";
      const note = $("approveNudge");
      note.textContent = `Approved ${d.juniorName || d.juniorEmail}. Create a slot now — pick date/time, then submit.`;
      note.style.display = "block";
      $("provideCard").scrollIntoView({ behavior: "smooth" });
      $("slotDate").focus();

      // hand the.  demand info to the provider
      if (window.__setPendingDemandForSlotCreation) {
        window.__setPendingDemandForSlotCreation(d);
      }
    }
  };
}

/* -------------------------------------------------- */
/* Boot after auth                                    */
/* -------------------------------------------------- */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
onAuthStateChanged(auth, (u) => {
  if (!u) return;
  me = u;
  wireProvideSlot();
  wireMySlots();
  wireDemands();

  // live reset watcher (as before)
  onSnapshot(doc(db, "resets", `senior_${me.email}`), (snap) => {
    seniorResetAt = snap.exists() ? (snap.data().resetAt?.toMillis?.() || null) : null;
    if (lastRows.length) renderMySlots(lastRows);
  });
});