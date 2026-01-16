// /modules/academics/SeniorProfileLock.js
import { auth } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";

function getSelectedSection() {
  const el = document.getElementById("profileSection");
  return el ? String(el.value || "").trim() : "";
}

function getSelectedSubjects() {
  // Expect checkboxes inside #subjectChecklist with value attr = subject code/text
  const root = document.getElementById("subjectChecklist");
  if (!root) return [];
  const out = [];
  root.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
    if (cb.checked) out.push(cb.value || cb.getAttribute("data-subject") || "");
  });
  return out.filter(Boolean);
}

function setButtonToRequest(btn, remainingText = "") {
  if (!btn) return;
  btn.textContent = "Request change";
  btn.classList.remove("green", "red");
  if (remainingText) btn.title = remainingText;
}

function setButtonToSave(btn) {
  if (!btn) return;
  btn.textContent = "Save settings";
  btn.classList.remove("green", "red");
}

function showMsg(text, ok=true) {
  const msg = document.getElementById("profileMsg");
  if (!msg) return;
  msg.textContent = text;
  msg.classList.toggle("ok", !!ok);
  msg.classList.toggle("err", !ok);
}

function showHelp(text) {
  const el = document.getElementById("profileHelp");
  if (el) el.textContent = text;
}

export async function wireSeniorProfileLock(){
  const settings = await RoutineService.getSettings();
  const term = Number(settings?.seniorTerm || settings?.termSenior || 0) || 5;

  onAuthStateChanged(auth, async (u)=>{
    const email = u?.email || "";
    if (!email) return;

    const btn = document.getElementById("btnSaveProfile");
    if (!btn) return;

    // Load profile to detect cohort + lock state
    let profile = await ProfileService.get(email);
    const cohort = profile?.cohort || (email.toLowerCase().startsWith("b24") ? "senior" :
                     (email.toLowerCase().startsWith("b25") ? "junior" : ""));
    const isSenior = cohort === "senior";

    // Seniors only → enforce lock
    if (!isSenior) {
      setButtonToSave(btn);
      return; // juniors behave as before
    }

    const locked = ProfileService.isLockedForTerm(profile, term);
    if (locked) {
      setButtonToRequest(btn, "Profile is locked for this term. You can request a change (max 2).");
      showHelp("Profile is locked for this term. To propose changes, adjust values and click “Request change”.");
    } else {
      setButtonToSave(btn);
      showHelp("Select Section/Subjects and Save to lock your profile for this term.");
    }

    // Replace click handling with new logic for seniors
    btn.onclick = async () => {
      try {
        // Read what user currently sees in UI
        const section = getSelectedSection();
        const subjects = getSelectedSubjects();

        if (!section) { showMsg("Please select your Section.", false); return; }
        if (!subjects.length) { showMsg("Please choose at least one subject.", false); return; }

        // Reload to ensure latest profile/lock state
        profile = await ProfileService.get(email);
        const isLockedNow = ProfileService.isLockedForTerm(profile, term);

        if (!isLockedNow) {
          // First-time save → persist + lock immediately
          await ProfileService.save(email, { cohort: "senior", section, subjects, term });
          await ProfileService.lockForTerm(email, term);

          setButtonToRequest(btn, "Profile locked. You can request a change (max 2).");
          showHelp("Profile locked for this term. To propose changes, adjust values and click “Request change”.");
          showMsg("Profile saved and locked for this term.", true);
          return;
        }

        // Already locked → submit change request (max 2 per term)
        const from = { section: profile?.section || "", subjects: Array.isArray(profile?.subjects) ? profile.subjects : [] };
        const to = { section, subjects };

        // No change?
        if (from.section === to.section &&
            JSON.stringify([...(from.subjects||[])].sort()) === JSON.stringify([...(to.subjects||[])].sort())) {
          showMsg("No changes detected to request.", false);
          return;
        }

        const res = await ProfileService.submitChangeRequest(email, { from, to, cohort: "senior", term });
        setButtonToRequest(btn, `Change request sent. Remaining this term: ${res.remaining}`);
        showMsg(`Request sent to Acadcom. Remaining this term: ${res.remaining}`, true);
      } catch (e) {
        if (e?.code === "limit-reached") {
          showMsg("Change request limit (2 per term) reached.", false);
        } else {
          showMsg(e?.message || "Failed to process action.", false);
        }
      }
    };
  });
}
