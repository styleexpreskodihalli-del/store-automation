#!/usr/bin/env bash
set -e

cp index.html index.html.phase3-backup

python3 - <<'PY'
from pathlib import Path

p = Path("index.html")
s = p.read_text(encoding="utf-8")

if "Use STall Partners Admin Demo" not in s:
    s = s.replace(
        '<button class="demo" onclick="flowDemo()">Use Flow Salon Demo</button>',
        '<button class="demo" onclick="flowDemo()">Use Flow Salon Demo</button>'
        '<button class="demo" onclick="adminDemo()">Use STall Partners Admin Demo</button>'
    )

if 'id="admin"' not in s:
    admin = r'''
<section id="admin" class="screen">
<div class="hero">
<div class="badge">STALL PARTNERS ADMIN</div>
<h1>Salon Management</h1>
<div class="muted">Create and manage salons on STore Automation.</div>
</div>

<div class="card">
<h2>Add Salon</h2>
<div class="muted">Create Salon #002 without changing application code.</div>

<label>Salon name
<input id="newSalonName" placeholder="Salon name">
</label>

<label>Owner name
<input id="newOwnerName" placeholder="Owner name">
</label>

<label>Owner email
<input id="newOwnerEmail" type="email" placeholder="owner@example.com">
</label>

<label>Phone / WhatsApp
<input id="newSalonPhone" placeholder="+91">
</label>

<label>Location
<input id="newSalonLocation" placeholder="Area, City, State">
</label>

<label>Website
<input id="newSalonWebsite" placeholder="https://">
</label>

<label>Google Business Profile URL
<input id="newSalonGoogle" placeholder="https://maps.google.com/...">
</label>

<label>Instagram
<input id="newSalonInstagram" placeholder="https://instagram.com/...">
</label>

<label>WhatsApp number
<input id="newSalonWhatsapp" placeholder="+91">
</label>

<label>Services
<textarea id="newSalonServices" rows="3" placeholder="Haircut, facial, hair spa, nails..."></textarea>
</label>

<label>Current offers
<textarea id="newSalonOffers" rows="3" placeholder="Welcome offer; weekend offer..."></textarea>
</label>

<div class="actions">
<button onclick="createSalon()">Create Salon</button>
<button class="secondary" onclick="clearSalonForm()">Clear</button>
</div>

<div id="createSalonMsg" class="muted" style="margin-top:10px"></div>
</div>

<div class="card">
<div class="row">
<div>
<h2>Salon Portfolio</h2>
<div class="muted">Pilot salon database</div>
</div>
<span class="badge" id="salonCount">1 SALON</span>
</div>
<div id="salonList"></div>
</div>
</section>
'''

    s = s.replace(
        '<section id="more" class="screen">',
        admin + '<section id="more" class="screen">'
    )

if 'id="adminNav"' not in s:
    s = s.replace(
        '<button class="active" onclick="show(\'home\',this)">',
        '<button id="adminNav" style="display:none" onclick="show(\'admin\',this)">◆<br>Admin</button>'
        '<button class="active" onclick="show(\'home\',this)">'
    )

if "function adminDemo()" not in s:
    js = r'''
function adminDemo(){
  localStorage.setItem('storeLoggedIn','true');
  localStorage.setItem('storeUser','STall Partners Admin');
  localStorage.setItem('storeRole','admin');
  document.getElementById('loginOverlay').style.display='none';
  enableAdmin();
  show('admin',document.getElementById('adminNav'));
}

function enableAdmin(){
  const n=document.getElementById('adminNav');
  if(n)n.style.display='block';
  renderSalons();
}

function createSalon(){
  const name=document.getElementById('newSalonName').value.trim();
  const owner=document.getElementById('newOwnerName').value.trim();
  const email=document.getElementById('newOwnerEmail').value.trim();

  if(!name || !owner || !email){
    document.getElementById('createSalonMsg').innerText =
      'Salon name, owner name and email are required.';
    return;
  }

  const salons=JSON.parse(
    localStorage.getItem('storeSalons') || '[]'
  );

  const id='SALON-' +
    String(salons.length+2).padStart(3,'0');

  salons.push({
    id:id,
    name:name,
    owner:owner,
    email:email,
    phone:document.getElementById('newSalonPhone').value.trim(),
    location:document.getElementById('newSalonLocation').value.trim(),
    website:document.getElementById('newSalonWebsite').value.trim(),
    google:document.getElementById('newSalonGoogle').value.trim(),
    instagram:document.getElementById('newSalonInstagram').value.trim(),
    whatsapp:document.getElementById('newSalonWhatsapp').value.trim(),
    services:document.getElementById('newSalonServices').value.trim(),
    offers:document.getElementById('newSalonOffers').value.trim(),
    status:'Active',
    automation:'On'
  });

  localStorage.setItem(
    'storeSalons',
    JSON.stringify(salons)
  );

  document.getElementById('createSalonMsg').innerText =
    id + ' created successfully.';

  clearSalonForm();
  renderSalons();
}

function clearSalonForm(){
  [
    'newSalonName',
    'newOwnerName',
    'newOwnerEmail',
    'newSalonPhone',
    'newSalonLocation',
    'newSalonWebsite',
    'newSalonGoogle',
    'newSalonInstagram',
    'newSalonWhatsapp',
    'newSalonServices',
    'newSalonOffers'
  ].forEach(function(id){
    const e=document.getElementById(id);
    if(e)e.value='';
  });
}

function renderSalons(){
  const base={
    id:'SALON-001',
    name:'Flow Salon',
    owner:'Flow Salon Owner',
    email:'owner@flowsalon.com',
    location:'Thubarahalli, Whitefield, Bengaluru',
    status:'Active',
    automation:'On'
  };

  const extra=JSON.parse(
    localStorage.getItem('storeSalons') || '[]'
  );

  const salons=[base].concat(extra);

  const list=document.getElementById('salonList');
  const count=document.getElementById('salonCount');

  if(count){
    count.innerText =
      salons.length + ' SALON' +
      (salons.length===1 ? '' : 'S');
  }

  if(list){
    list.innerHTML=salons.map(function(x){
      return '<div class="item">' +
        '<b>' + x.id + ' — ' + x.name + '</b>' +
        '<div class="muted">' +
        x.owner + ' • ' +
        (x.location || 'Location not set') +
        '</div>' +
        '<div class="actions">' +
        '<span class="badge">' + x.status + '</span>' +
        '<span class="badge">' + x.automation + ' Automation</span>' +
        '<button class="secondary" onclick="toast(\'Opening workspace\')">Open Workspace</button>' +
        '</div></div>';
    }).join('');
  }
}
'''

    pos = s.find("function ")
    s = s[:pos] + js + "\n" + s[pos:]

if "storeRole" not in s:
    s = s.replace(
        "if(localStorage.getItem('storeLoggedIn')==='true'){",
        "if(localStorage.getItem('storeRole')==='admin') enableAdmin();\n"
        "if(localStorage.getItem('storeLoggedIn')==='true'){"
    )

p.write_text(s, encoding="utf-8")
print("Phase 4 added successfully.")
PY

git add index.html
git commit -m "Add STall Partners admin and salon onboarding" || true
git push origin main
vercel --prod
