// Patient and professional sections of the dev check page. They call the real secureShare.ts
// (served type-stripped at /web-lib/secureShare.js) exactly as the web app will.
import {
  decryptEntries, decryptPackage, encryptEntry, openPackage, protectEntries, withdrawAccess,
} from '/web-lib/secureShare.js';
import { api, log } from './dev.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = 24 * 60 * 60 * 1000;
const fmt = (iso) => new Date(iso).toLocaleString();
const failure = (err) => `${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`;

// Fake demo data only. No real health information.
const DEMO_ENTRIES = [
  { type: 'mood', daysAgo: 9, title: 'Mood', value: 3, notes: 'Busy week (fake)' },
  { type: 'symptom', daysAgo: 8, title: 'Lower back pain', value: 6, notes: 'After lifting boxes (fake)' },
  { type: 'habit', daysAgo: 6, title: 'Walk', value: '30 min' },
  { type: 'symptom', daysAgo: 5, title: 'Lower back pain', value: 5 },
  { type: 'mood', daysAgo: 4, title: 'Mood', value: 4 },
  { type: 'symptom', daysAgo: 3, title: 'Knee stiffness', value: 3, notes: 'Morning only (fake)' },
  { type: 'symptom', daysAgo: 1, title: 'Lower back pain', value: 3, notes: 'Stretches help (fake)' },
  { type: 'mood', daysAgo: 0, title: 'Mood', value: 4 },
];

// --- patient -------------------------------------------------------------------------------------

let journal = [];

async function loadJournal() {
  const rows = await api('/api/entries');
  if (rows.status !== 200) throw new Error(`GET /api/entries ${rows.status}`);
  journal = await decryptEntries(rows.body);
  const lastWeek = Date.now() - 7 * day;
  $('journal').innerHTML = journal.map((e) => `<tr>
      <td><input type="checkbox" data-entry="${esc(e.id)}" ${e.type === 'symptom' && Date.parse(e.loggedAt) >= lastWeek ? 'checked' : ''}></td>
      <td>${esc(e.type)}</td><td>${esc(fmt(e.loggedAt))}</td><td>${esc(e.title)}</td><td>${esc(e.value)}</td><td>${esc(e.notes)}</td></tr>`).join('')
    || '<tr><td colspan="6">No entries yet.</td></tr>';
  log(`decrypted ${journal.length} journal entries (the server only stores ciphertext)`);
}

async function logDemoEntries() {
  for (const d of DEMO_ENTRIES) {
    const upload = await encryptEntry({ type: d.type, loggedAt: new Date(Date.now() - d.daysAgo * day).toISOString(), title: d.title, value: d.value, notes: d.notes });
    const res = await api('/api/entries', { method: 'POST', body: upload });
    if (res.status !== 201) throw new Error(`POST /api/entries ${res.status} ${JSON.stringify(res.body)}`);
  }
  log(`logged ${DEMO_ENTRIES.length} fake entries, each encrypted in this browser`);
  await loadJournal();
}

async function loadProfessionals() {
  const res = await api('/api/professionals');
  $('recipient').innerHTML = (res.body ?? []).map((u) =>
    `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.profession)})${u.tideUserKey ? '' : ' - has not signed in yet'}</option>`).join('');
}

async function shareSelected() {
  const ids = [...document.querySelectorAll('[data-entry]:checked')].map((el) => el.dataset.entry);
  const entries = journal.filter((e) => ids.includes(e.id));
  const recipientId = $('recipient').value;
  const minutes = Number($('expiry-minutes').value);
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  log(`sharing ${entries.length} entries with ${recipientId} until ${expiresAt}: approve in the Tide pop-up...`);
  const pkg = await protectEntries(entries, recipientId, expiresAt);
  const lastWeek = new Date(Date.now() - 7 * day).toISOString();
  const res = await api('/api/shares', { method: 'POST', body: { recipientId, entryIds: ids, expiresAt, rangeFrom: lastWeek, rangeTo: new Date().toISOString(), package: pkg } });
  if (res.status !== 201) throw new Error(`POST /api/shares ${res.status} ${JSON.stringify(res.body)}`);
  log(`share ${res.body.id} created (package ${pkg.packageId})`);
  await Promise.all([loadMyShares(), loadAudit()]);
}

async function loadMyShares() {
  const res = await api('/api/shares');
  $('my-shares').innerHTML = (res.body ?? []).map((s) => `<tr>
      <td><code>${esc(s.id)}</code></td><td>${esc(s.recipientId)}</td><td>${s.entryIds.length}</td><td>${esc(fmt(s.expiresAt))}</td><td>${esc(s.status)}</td>
      <td>${s.status === 'active' ? `<button data-withdraw="${esc(s.id)}">Withdraw</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="6">No shares yet.</td></tr>';
}

async function loadAudit() {
  const res = await api('/api/audit');
  $('audit').innerHTML = (res.body ?? []).map((e) =>
    `<tr><td>${esc(fmt(e.at))}</td><td>${esc(e.action)}</td><td>${esc(e.actorId)}</td><td><code>${esc(e.shareId)}</code></td></tr>`).join('')
    || '<tr><td colspan="4">No events yet.</td></tr>';
}

function renderPatient() {
  $('patient').innerHTML = `
    <h2>Patient</h2>
    <div class="row"><button id="log-demo">Log fake demo entries</button><button id="reload-journal">Reload journal</button></div>
    <h3>Journal (decrypted in this browser)</h3>
    <table><thead><tr><th></th><th>Type</th><th>Logged</th><th>Title</th><th>Value</th><th>Notes</th></tr></thead><tbody id="journal"></tbody></table>
    <h3>Share the ticked entries</h3>
    <div class="row">
      <label>With <select id="recipient"></select></label>
      <label>Expires in <input id="expiry-minutes" type="number" min="1" value="10080" style="width:7em"> minutes</label>
      <button id="share">Share (opens the Tide approval pop-up)</button>
    </div>
    <h3>My shares</h3>
    <table><thead><tr><th>Share</th><th>Recipient</th><th>Entries</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody id="my-shares"></tbody></table>
    <h3>Audit trail</h3>
    <div class="row"><button id="reload-audit">Reload audit</button></div>
    <table><thead><tr><th>When</th><th>Action</th><th>By</th><th>Share</th></tr></thead><tbody id="audit"></tbody></table>`;
  const guard = (fn) => () => fn().catch((err) => log('failed:', failure(err)));
  $('log-demo').onclick = guard(logDemoEntries);
  $('reload-journal').onclick = guard(loadJournal);
  $('share').onclick = guard(shareSelected);
  $('reload-audit').onclick = guard(loadAudit);
  $('my-shares').onclick = (ev) => {
    const id = ev.target?.dataset?.withdraw;
    if (id) guard(async () => { await withdrawAccess(id); log(`withdrew ${id}`); await Promise.all([loadMyShares(), loadAudit()]); })();
  };
  $('patient').hidden = false;
  Promise.all([loadJournal(), loadProfessionals(), loadMyShares(), loadAudit()]).catch((err) => log('failed:', failure(err)));
}

// --- professional --------------------------------------------------------------------------------

const SAVED = 'dev-saved-packages';
const saved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) ?? '{}'); } catch { return {}; } };

function showEntries(title, entries) {
  $('opened').innerHTML = `<h3>${esc(title)}</h3><table><thead><tr><th>Type</th><th>Logged</th><th>Title</th><th>Value</th><th>Notes</th></tr></thead><tbody>` +
    entries.map((e) => `<tr><td>${esc(e.type)}</td><td>${esc(fmt(e.loggedAt))}</td><td>${esc(e.title)}</td><td>${esc(e.value)}</td><td>${esc(e.notes)}</td></tr>`).join('') +
    '</tbody></table>';
}

async function loadSharesToMe() {
  const res = await api('/api/shares');
  $('to-me').innerHTML = (res.body ?? []).map((s) => `<tr>
      <td><code>${esc(s.id)}</code></td><td>${esc(s.patientId)}</td><td>${s.entryIds.length}</td><td>${esc(fmt(s.expiresAt))}</td><td>${esc(s.status)}</td>
      <td><button data-open="${esc(s.id)}">Open</button> <button data-save="${esc(s.id)}">Keep a copy</button></td></tr>`).join('')
    || '<tr><td colspan="6">Nothing shared with you.</td></tr>';
}

async function openShare(id) {
  try {
    const entries = await openPackage(id);
    showEntries(`Share ${id}: ${entries.length} entries, decrypted in this browser`, entries);
    log(`opened ${id}: ${entries.length} entries`);
  } catch (err) {
    $('opened').innerHTML = `<p class="bad">Refused: ${esc(failure(err))}</p>`;
    log(`open ${id} refused:`, failure(err));
  }
}

async function keepCopy(id) {
  const res = await api(`/api/shares/${encodeURIComponent(id)}/package`);
  if (res.status !== 200) return log(`could not fetch ${id} to keep a copy: ${res.status}`);
  sessionStorage.setItem(SAVED, JSON.stringify({ ...saved(), [id]: res.body }));
  log(`kept a copy of the ciphertext and policy for ${id} (as a recipient could)`);
}

async function tryPackage(label, pkg) {
  try {
    const entries = await decryptPackage(pkg);
    showEntries(`${label}: the network DECRYPTED it (${entries.length} entries)`, entries);
    log(`${label}: decrypted`);
  } catch (err) {
    $('opened').innerHTML = `<p><strong>${esc(label)}:</strong> refused: ${esc(failure(err))}</p>`;
    log(`${label}: refused:`, failure(err));
  }
}

async function compromisedServer() {
  const list = await api('/api/dev/compromised/shares');
  const id = prompt(`Share id to try (a compromised server hands over any package):\n${(list.body ?? []).map((s) => `${s.id}  to ${s.recipientId}  ${s.status}`).join('\n')}`);
  if (!id) return;
  const res = await api(`/api/dev/compromised/package/${encodeURIComponent(id.trim())}`);
  if (res.status !== 200) return log(`compromised server has no package for ${id}: ${res.status}`);
  await tryPackage(`Package ${id} from a compromised server`, res.body);
}

async function retrySaved() {
  const copies = saved();
  if (!Object.keys(copies).length) return log('no saved copies: use "Keep a copy" first');
  for (const [id, pkg] of Object.entries(copies)) await tryPackage(`Saved copy of ${id}`, pkg);
}

function renderProfessional() {
  $('professional').innerHTML = `
    <h2>Professional</h2>
    <div class="row"><button id="reload-to-me">Reload</button></div>
    <h3>Shared with me</h3>
    <table><thead><tr><th>Share</th><th>Patient</th><th>Entries</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody id="to-me"></tbody></table>
    <h3>Crypto-level checks</h3>
    <div class="row">
      <button id="compromised">Try a package from a compromised server</button>
      <button id="retry-saved">Re-open my saved copies</button>
    </div>
    <div id="opened"></div>`;
  const guard = (fn) => () => fn().catch((err) => log('failed:', failure(err)));
  $('reload-to-me').onclick = guard(loadSharesToMe);
  $('compromised').onclick = guard(compromisedServer);
  $('retry-saved').onclick = guard(retrySaved);
  $('to-me').onclick = (ev) => {
    const { open, save } = ev.target?.dataset ?? {};
    if (open) guard(() => openShare(open))();
    if (save) guard(() => keepCopy(save))();
  };
  $('professional').hidden = false;
  loadSharesToMe().catch((err) => log('failed:', failure(err)));
}

window.addEventListener('dev-signed-in', (ev) => (ev.detail.role === 'patient' ? renderPatient() : renderProfessional()));
