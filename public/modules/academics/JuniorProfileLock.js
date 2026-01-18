// /modules/academics/JuniorProfileLock.js
// Mirrors SeniorProfileLock, but for JUNIORS:
// - First save locks the profile for the current junior term
// - Subsequent edits create a change request (max 2 per term, per reset version)
// - Subjects are fixed for juniors; only Section normally changes

import { auth } from "/shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ProfileService } from "/shared/services/ProfileService.js";
import { RoutineService } from "/shared/services/RoutineService.js";

function getSelectedSection() {
  const el = document.getElementById("profileSection");
  return el ? String(el.value || "").trim() : "";
}

function setButtonToRequest(btn, tip = "") {
  if (!btn) return;
  btn.textContent = "Request change";
  btn.classList.remove("green", "red");
  if (tip) btn.title = tip;
}
function setButtonToSave(btn) {
  if (!btn) return;
  btn.textContent = "Save settings";
  btn.classList.remove("green", "red");
}

function showMsg(text, ok = true) {
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

export async function wireJuniorProfileLock() {
  // Determine JUNIOR term once
  const settings = await RoutineService.getSettings();
  const term = Number(settings?.juniorTerm || settings?.termJunior || 0) || 2;

  onAuthStateChanged(auth, async (u) => {
    const email = (u?.email || "").toLowerCase();
    if (!email) return;

    const btn = document.getElementById("btnSaveProfile");
    if (!btn) return;

    // Load profile to detect cohort + lock state
    let profile = await ProfileService.get(email);
    const cohortGuess =
      profile?.cohort ||
      (email.startsWith("b24") ? "senior" : email.startsWith("b25") ? "junior" : "");
    const isJunior = cohortGuess === "junior";

    // Only JUNIORS handled here. Seniors keep their existing lock module.
    if (!isJunior) return;

    // Subjects for juniors are “fixed” by settings (what AcademicsController shows)
    // We will persist the same set on first save.
    const jrCatalog =
      Array.isArray(settings?.juniorSubjects) ? settings.juniorSubjects : [];

    const locked = ProfileService.isLockedForTerm(profile, term);
    if (locked) {
      setButtonToRequest(
        btn,
        "Profile is locked for this term. You can request a change (max 2)."
      );
      showHelp(
        "Profile is locked for this term. To propose a change, adjust Section and click “Request change”."
      );
    } else {
      setButtonToSave(btn);
      showHelp("Select Section and Save to lock your profile for this term.");
    }

    // Override click handling for JUNIORS
    btn.onclick = async () => {
      try {
        const section = getSelectedSection();
        if (!section) {
          showMsg("Please select your Section.", false);
          return;
        }

        // Re-fetch to ensure the latest state
        profile = await ProfileService.get(email);
        const isLockedNow = ProfileService.isLockedForTerm(profile, term);

        if (!isLockedNow) {
          // First-time save → lock immediately with fixed junior subjects
          await ProfileService.save(email, {
            cohort: "junior",
            section,
            subjects: jrCatalog.slice(),
            term
          });
          await ProfileService.lockForTerm(email, term);

          setButtonToRequest(btn, "Profile locked. You can request a change (max 2).");
          showHelp(
            "Profile locked for this term. To propose a change, adjust Section and click “Request change”."
          );
          showMsg("Profile saved and locked for this term.", true);
          return;
        }

        // Already locked → submit change request (max 2 per term)
        const from = {
          section: profile?.section || "",
          subjects: Array.isArray(profile?.subjects) ? profile.subjects : jrCatalog.slice()
        };
        const to = { section, subjects: from.subjects.slice() };

        // No change?
        if (from.section === to.section) {
          showMsg("No changes detected to request.", false);
          return;
        }

        const res = await ProfileService.submitChangeRequest(email, {
          from,
          to,
          cohort: "junior",
          term
        });
        setButtonToRequest(
          btn,
          `Change request sent. Remaining this term: ${res.remaining}`
        );
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