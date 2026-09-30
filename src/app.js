import {
  PAIN_POINTS, STATUSES, TRADES, addBusinessDays, emptyProspect, filterProspects, findByEmail,
  findDuplicateEmails, followUpState, importCsv, isValidEmail, normalizeEmail, painPointSummary,
  parsePainPoints, sanitizeProspect, summarize, toCsv, todayIso,
} from './logic.js';
import { buildSampleData } from './sample-data.js';
import { clearProspects, loadProspects, saveProspects } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const statusLabel = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

let prospects = loadProspects() ?? buildSampleData();
let editingId = null;

function persist() {
  if (!saveProspects(prospects)) toast('Could not save to this browser (storage full or blocked).');
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function fillSelect(select, options, anyLabel) {
  select.replaceChildren(
    ...(anyLabel ? [el('option', { value: '' }, anyLabel)] : []),
    ...options.map((o) => el('option', { value: o.id ?? o }, o.label ?? o)),
  );
}

// ---------- rendering ----------

function renderStats(s) {
  const pct = s.replyRate === null ? '—' : `${Math.round(s.replyRate * 100)}%`;
  const cards = [
    ['Prospects', s.total],
    ['Contacted', s.contacted],
    ['Replied', s.replied],
    ['Reply rate', pct],
    ['Interviews done', s.interviews],
    ['Follow-ups due', s.dueFollowUps, s.dueFollowUps ? 'warn' : ''],
    ['Duplicate emails', s.duplicateEmails, s.duplicateEmails ? 'warn' : ''],
  ];
  $('#stats').replaceChildren(...cards.map(([label, value, cls]) => el('div', { class: `stat ${cls || ''}` }, el('div', { class: 'stat-value' }, value), el('div', { class: 'stat-label' }, label))));
}

function renderFunnel(s) {
  const max = Math.max(1, ...Object.values(s.byStatus));
  $('#funnel').replaceChildren(...STATUSES.map(({ id, label }) => {
    const n = s.byStatus[id];
    return el('div', { class: 'bar-row' },
      el('span', { class: 'bar-label' }, label),
      el('span', { class: 'bar-track' }, el('span', { class: `bar-fill st-${id}`, style: `width:${(n / max) * 100}%` })),
      el('span', { class: 'bar-num' }, n));
  }));
}

function renderPainPoints() {
  const list = painPointSummary(prospects, { interviewedOnly: $('#pp-interviewed').checked });
  if (!list.length) {
    $('#painpoints').replaceChildren(el('p', { class: 'muted' }, 'No pain points recorded yet. Add them when editing a prospect.'));
    return;
  }
  const max = list[0].count;
  $('#painpoints').replaceChildren(...list.slice(0, 8).map(({ painPoint, count }) => el('div', { class: 'bar-row' },
    el('span', { class: 'bar-label' }, painPoint),
    el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill pp', style: `width:${(count / max) * 100}%` })),
    el('span', { class: 'bar-num' }, count))));
}

function currentFilters() {
  return { search: $('#f-search').value, status: $('#f-status').value, trade: $('#f-trade').value, followUp: $('#f-followup').value };
}

function renderTable() {
  const today = todayIso();
  const dupes = findDuplicateEmails(prospects);
  const dupeIds = new Set([...dupes.values()].flat());
  let list = filterProspects(prospects, currentFilters(), today);
  if ($('#f-dupes').checked) list = list.filter((p) => dupeIds.has(p.id));
  list = [...list].sort((a, b) => (a.followUpDate || '9999') .localeCompare(b.followUpDate || '9999') || a.company.localeCompare(b.company));
  $('#count').textContent = `(${list.length} of ${prospects.length})`;
  $('#empty').hidden = list.length > 0;
  $('#rows').replaceChildren(...list.map((p) => {
    const fu = followUpState(p, today);
    return el('tr', { 'data-id': p.id },
      el('td', { 'data-label': 'Company' }, p.company, p.isSample ? el('span', { class: 'tag sample' }, 'sample') : null),
      el('td', { 'data-label': 'Email', class: 'email' }, p.email || el('span', { class: 'muted' }, '—'), dupeIds.has(p.id) ? el('span', { class: 'tag dupe', title: 'Another prospect uses this email' }, 'duplicate') : null),
      el('td', { 'data-label': 'Trade' }, p.trade),
      el('td', { 'data-label': 'City' }, p.city),
      el('td', { 'data-label': 'Status' }, el('span', { class: `pill st-${p.status}` }, statusLabel[p.status])),
      el('td', { 'data-label': 'Follow-up' }, p.followUpDate ? el('span', { class: `fu fu-${fu}` }, p.followUpDate, fu === 'overdue' ? ' (overdue)' : fu === 'today' ? ' (today)' : '') : el('span', { class: 'muted' }, '—')),
      el('td', { 'data-label': 'Pain points' }, p.painPoints.length ? p.painPoints.join(', ') : el('span', { class: 'muted' }, '—')),
      el('td', {}, el('button', { class: 'small', onclick: () => openForm(p.id) }, 'Edit')));
  }));
}

function render() {
  const s = summarize(prospects);
  renderStats(s);
  renderFunnel(s);
  renderPainPoints();
  renderTable();
  $('#sample-banner').hidden = !prospects.some((p) => p.isSample);
}

// ---------- form ----------

const form = $('#form');

function openForm(id = null) {
  editingId = id;
  const p = id ? prospects.find((x) => x.id === id) : emptyProspect();
  $('#dlg-title').textContent = id ? 'Edit prospect' : 'Add prospect';
  $('#btn-delete').hidden = !id;
  $('#form-error').hidden = true;
  for (const name of ['company', 'contactName', 'email', 'phone', 'trade', 'city', 'source', 'status', 'lastContactDate', 'followUpDate', 'interviewNotes']) {
    form.elements[name].value = p[name] ?? '';
  }
  const known = new Set(PAIN_POINTS.map((x) => x.toLowerCase()));
  $('#pp-options').replaceChildren(...PAIN_POINTS.map((pp) => el('label', { class: 'chip' },
    el('input', { type: 'checkbox', value: pp, checked: p.painPoints.some((x) => x.toLowerCase() === pp.toLowerCase()) }), pp)));
  form.elements.customPain.value = p.painPoints.filter((x) => !known.has(x.toLowerCase())).join('; ');
  checkEmail();
  $('#dlg').showModal();
  form.elements.company.focus();
}

function checkEmail() {
  const email = form.elements.email.value;
  const msg = $('#email-msg');
  msg.className = 'field-msg';
  if (!isValidEmail(email)) { msg.textContent = 'This does not look like a valid email.'; msg.classList.add('bad'); return false; }
  const dup = findByEmail(prospects, email, editingId);
  if (dup) { msg.textContent = `Already used by “${dup.company}”.`; msg.classList.add('bad'); return false; }
  msg.textContent = '';
  return true;
}

form.elements.email.addEventListener('input', checkEmail);

$('#btn-suggest').addEventListener('click', () => {
  const base = form.elements.lastContactDate.value || todayIso();
  form.elements.followUpDate.value = addBusinessDays(base, 5);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#form-error');
  const company = form.elements.company.value.trim();
  if (!company) { err.textContent = 'Company is required.'; err.hidden = false; return; }
  if (!checkEmail()) { err.textContent = 'Fix the email before saving. Duplicate emails are not allowed.'; err.hidden = false; return; }
  const checked = [...$('#pp-options').querySelectorAll('input:checked')].map((i) => i.value);
  const existing = editingId ? prospects.find((x) => x.id === editingId) : null;
  const data = sanitizeProspect({
    ...(existing ?? {}),
    id: editingId ?? '',
    company,
    contactName: form.elements.contactName.value,
    email: form.elements.email.value,
    phone: form.elements.phone.value,
    trade: form.elements.trade.value,
    city: form.elements.city.value,
    source: form.elements.source.value,
    status: form.elements.status.value,
    lastContactDate: form.elements.lastContactDate.value,
    followUpDate: form.elements.followUpDate.value,
    painPoints: [...checked, ...parsePainPoints(form.elements.customPain.value)],
    interviewNotes: form.elements.interviewNotes.value,
    isSample: existing?.isSample ?? false,
  });
  if (editingId) prospects = prospects.map((x) => (x.id === editingId ? data : x));
  else prospects = [data, ...prospects];
  persist();
  $('#dlg').close();
  render();
  toast(editingId ? 'Prospect updated.' : 'Prospect added.');
});

$('#btn-cancel').addEventListener('click', () => $('#dlg').close());
$('#btn-delete').addEventListener('click', () => {
  const p = prospects.find((x) => x.id === editingId);
  if (!p || !confirm(`Delete “${p.company}”? This cannot be undone.`)) return;
  prospects = prospects.filter((x) => x.id !== editingId);
  persist();
  $('#dlg').close();
  render();
  toast('Prospect deleted.');
});

// ---------- toolbar ----------

$('#btn-add').addEventListener('click', () => openForm());

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([toCsv(prospects)], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `prospects-${todayIso()}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const { added, skipped, errors } = importCsv(await file.text(), prospects);
  prospects = [...added, ...prospects];
  persist();
  render();
  const parts = [`Imported ${added.length}.`];
  if (skipped.length) parts.push(`Skipped ${skipped.length} duplicate email${skipped.length > 1 ? 's' : ''}.`);
  if (errors.length) parts.push(`${errors.length} row${errors.length > 1 ? 's' : ''} had problems: ${errors.slice(0, 2).join(' ')}`);
  toast(parts.join(' '));
});

$('#btn-load-sample').addEventListener('click', () => {
  const { added } = importCsv(toCsv(buildSampleData()), prospects);
  prospects = [...prospects, ...added];
  persist(); render(); toast(`Added ${added.length} sample prospects.`);
  $('.more').open = false;
});
$('#btn-remove-sample').addEventListener('click', () => {
  const before = prospects.length;
  prospects = prospects.filter((p) => !p.isSample);
  persist(); render(); toast(`Removed ${before - prospects.length} sample prospects.`);
  $('.more').open = false;
});
$('#btn-clear').addEventListener('click', () => {
  if (!confirm('Delete ALL prospects saved in this browser? Export a CSV first if you need a copy.')) return;
  prospects = [];
  clearProspects(); persist(); render(); toast('All data deleted.');
  $('.more').open = false;
});

for (const id of ['#f-search', '#f-status', '#f-trade', '#f-followup', '#f-dupes']) $(id).addEventListener('input', renderTable);
$('#pp-interviewed').addEventListener('change', renderPainPoints);

// ---------- init ----------
fillSelect($('#f-status'), STATUSES, 'Any status');
fillSelect($('#f-trade'), TRADES, 'Any trade');
fillSelect(form.elements.status, STATUSES);
fillSelect(form.elements.trade, TRADES);
persist();
render();

// Exposed for smoke tests only.
window.__cdd = { get prospects() { return prospects; }, normalizeEmail };
