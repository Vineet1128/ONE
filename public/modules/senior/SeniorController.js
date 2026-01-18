import { db, collection, getDocs, query, where } from "/shared/firebase.js";
import { esc } from "/shared/ui.js";
const $=(id)=>document.getElementById(id);

async function refresh(){
  const dval = $("filterDomain").value;
  const sflt = $("filterSenior").value.trim().toLowerCase();
  const jflt = $("filterJunior").value.trim().toLowerCase();

  // slots
  let slots = (await getDocs(collection(db,"slots"))).docs.map(d=>d.data());
  if(dval!=="All") slots = slots.filter(s=>s.domain===dval);
  if(sflt) slots = slots.filter(s=>(s.ownerEmail||"").toLowerCase().includes(sflt));
  // bookings
  let bookings = (await getDocs(collection(db,"bookings"))).docs.map(d=>d.data());
  if(dval!=="All") bookings = bookings.filter(b=>b.domain===dval);
  if(jflt) bookings = bookings.filter(b=>(b.juniorEmail||"").toLowerCase().includes(jflt));
  if(sflt) bookings = bookings.filter(b=>(b.ownerEmail||"").toLowerCase().includes(sflt));
  // demands
  let demands = (await getDocs(collection(db,"demands"))).docs.map(d=>d.data());
  if(dval!=="All") demands = demands.filter(x=>x.domain===dval);
  if(jflt) demands = demands.filter(x=>(x.juniorEmail||"").toLowerCase().includes(jflt));

  // metrics
  $("mSlotsRel").textContent      = slots.length;
  $("mSlotsBooked").textContent   = bookings.filter(b=>b.status==="booked"||b.status==="completed").length;
  $("mDemands").textContent       = demands.length;
  $("mDemandsFulfilled").textContent = demands.filter(d=>["approved","scheduled","closed"].includes(d.status)).length;

  // avg feedback by junior & domain (we store feedback on booking when senior completes)
  const fbByKey = {};
  bookings.forEach(b=>{
    const f=b.feedback; if(!f) return;
    const key=(b.juniorEmail||"")+ "|" + (b.domain||"");
    if(!fbByKey[key]) fbByKey[key]={c:0,comm:0,topic:0,punct:0, j:b.juniorEmail, d:b.domain};
    fbByKey[key].c++; fbByKey[key].comm+=f.comm; fbByKey[key].topic+=f.topic; fbByKey[key].punct+=f.punctual;
  });
  $("avgTBody").innerHTML = Object.values(fbByKey).map(x=>`
    <tr>
      <td>${esc(x.j||"")}</td>
      <td>${esc(x.d||"")}</td>
      <td>${(x.comm/x.c).toFixed(2)}</td>
      <td>${(x.topic/x.c).toFixed(2)}</td>
      <td>${(x.punct/x.c).toFixed(2)}</td>
      <td>${x.c}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="small">No feedback yet.</td></tr>`;

  // slots released by senior & domain
  const relByKey={};
  slots.forEach(s=>{
    const key=(s.ownerEmail||"")+ "|" + (s.domain||"");
    if(!relByKey[key]) relByKey[key]={c:0, se:s.ownerEmail, d:s.domain};
    relByKey[key].c++;
  });
  $("relTBody").innerHTML = Object.values(relByKey).map(x=>`
    <tr><td>${esc(x.se||"")}</td><td>${esc(x.d||"")}</td><td>${x.c}</td></tr>
  `).join("") || `<tr><td colspan="3" class="small">No data.</td></tr>`;

  // slots booked by junior & domain
  const bookByKey={};
  bookings.filter(b=>b.status==="booked"||b.status==="completed").forEach(b=>{
    const key=(b.juniorEmail||"")+ "|" + (b.domain||"");
    if(!bookByKey[key]) bookByKey[key]={c:0, ju:b.juniorEmail, d:b.domain};
    bookByKey[key].c++;
  });
  $("bookTBody").innerHTML = Object.values(bookByKey).map(x=>`
    <tr><td>${esc(x.ju||"")}</td><td>${esc(x.d||"")}</td><td>${x.c}</td></tr>
  `).join("") || `<tr><td colspan="3" class="small">No data.</td></tr>`;

  // demands raised vs fulfilled by junior & domain
  const demByKey={};
  demands.forEach(d=>{
    const key=(d.juniorEmail||"")+ "|" + (d.domain||"");
    if(!demByKey[key]) demByKey[key]={r:0,f:0, ju:d.juniorEmail, d:d.domain};
    demByKey[key].r++;
    if(["approved","scheduled","closed"].includes(d.status)) demByKey[key].f++;
  });
  $("demTBody").innerHTML = Object.values(demByKey).map(x=>`
    <tr><td>${esc(x.ju||"")}</td><td>${esc(x.d||"")}</td><td>${x.r}</td><td>${x.f}</td></tr>
  `).join("") || `<tr><td colspan="4" class="small">No data.</td></tr>`;
}

$("btnRefresh").onclick = refresh;