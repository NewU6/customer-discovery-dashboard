import {
  PAIN_POINTS, QUICK_ACTIONS, STATUSES, TRADES, addBusinessDays, applyStatus, emptyProspect,
  filterProspects, findByEmail, findDuplicateEmails, findSimilarCompanies, hasUpcomingInterview, importCsv,
  interviewInsights, isDue, isValidEmail, nextStep, painPointSummary, parsePainPoints, quickAction,
  sanitizeProspect, similarCompanyIds, sortProspects, summarize, toCsv, todayIso, FOLLOW_UP_DAYS,
  DEFAULT_THRESHOLDS, SIGNALS, VERDICTS, sanitizeThresholds, scorecardMarkdown, validationScorecard,
} from './logic.js';
import { buildSampleData } from './sample-data.js';
import { clearProspects, loadProspects, loadSettings, saveProspects, saveSettings } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const statusLabel = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

let prospects = loadProspects() ?? buildSampleData();
let editingId = null;
let thresholds = sanitizeThresholds(loadSettings().thresholds);
let formStartStatus = null;
const view = { sortKey: '', sortDir: 'asc' };

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
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

let toastTimer;
function toast(msg, undo = null) {
  const t = $('#toast');
  t.replaceChildren(el('span', {}, msg), ...(undo ? [el('button', { class: 'small undo', onclick: () => { undo(); t.hidden = true; } }, 'Undo')] : []));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 7000 : 4000);
}

function fillSelect(select, options, anyLabel) {
  select.replaceChildren(
    ...(anyLabel ? [el('option', { value: '' }, anyLabel)] : []),
    ...options.map((o) => el('option', { value: o.id ?? o }, o.label ?? o)),
  );
}

function updateProspect(id, fn, message) {
  const before = prospects;
  prospects = prospects.map((p) => (p.id === id ? sanitizeProspect(fn(p)) : p));
  persist();
  render();
  if (message) toast(message, () => { prospects = before; persist(); render(); });
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
    ['Interviews booked', s.upcomingInterviews],
    ['Follow-ups due', s.dueFollowUps, s.dueFollowUps ? 'warn' : ''],
    ['Possible duplicates', s.possibleDuplicates, s.possibleDuplicates ? 'warn' : ''],
  ];
  $('#stats').replaceChildren(...cards.map(([label, value, cls]) => el('div', { class: `stat ${cls || ''}` }, el('div', { class: 'stat-value' }, value), el('div', { class: 'stat-label' }, label))));
}

function renderToday(today) {
  const items = sortProspects(prospects.filter((p) => isDue(p, today) || hasUpcomingInterview(p, today)), '', 'asc', today);
  $('#today-count').textContent = items.length ? `(${items.length})` : '';
  if (!items.length) {
    $('#today').replaceChildren(el('li', { class: 'muted' }, 'Nothing due. New intros you log will come back here after 5 business days.'));
    return;
  }
  $('#today').replaceChildren(...items.map((p) => {
    const step = nextStep(p, today);
    const overdue = p.followUpDate && p.followUpDate < today && step.due;
    return el('li', { class: 'action-item', 'data-id': p.id },
      el('div', { class: 'action-main' },
        el('button', { class: 'link company-link', onclick: () => openForm(p.id) }, p.company),
        el('span', { class: `pill st-${p.status}` }, statusLabel[p.status]),
        el('span', { class: overdue ? 'fu fu-overdue' : step.due ? 'fu fu-today' : 'muted' }, step.text, overdue ? ` (was due ${p.followUpDate})` : ''),
        p.email ? el('span', { class: 'muted email' }, p.email) : null),
      el('div', { class: 'action-buttons' },
        ...step.actions.map((a) => el('button', { class: `small ${a === 'snooze' ? '' : 'primary'}`, 'data-action': a, onclick: () => runQuick(p.id, a) }, QUICK_ACTIONS[a])),
        el('button', { class: 'small', onclick: () => openForm(p.id) }, 'Open')));
  }));
}

function runQuick(id, action) {
  const p = prospects.find((x) => x.id === id);
  if (!p) return;
  updateProspect(id, (x) => quickAction(x, action, todayIso()), `${p.company}: ${QUICK_ACTIONS[action].toLowerCase()}.`);
}

function renderFunnel(s) {
  const max = Math.max(1, ...Object.values(s.byStatus));
  $('#funnel').replaceChildren(...STATUSES.map(({ id, label }) => {
    const n = s.byStatus[id];
    return el('button', { class: 'bar-row as-button', title: `Show ${label.toLowerCase()} prospects`, onclick: () => { $('#f-status').value = id; renderTable(); $('#prospects').scrollIntoView({ behavior: 'smooth' }); } },
      el('span', { class: 'bar-label' }, label),
      el('span', { class: 'bar-track' }, el('span', { class: `bar-fill st-${id}`, style: `width:${(n / max) * 100}%` })),
      el('span', { class: 'bar-num' }, n));
  }));
}

function renderInsights() {
  const interviewedOnly = $('#pp-interviewed').checked;
  const ins = interviewInsights(prospects);
  const selected = $('#f-pain').value;
  let rows;
  if (interviewedOnly) {
    const missing = ins.missingNotes.length ? ` ${ins.missingNotes.length} interview${ins.missingNotes.length > 1 ? 's have' : ' has'} no notes yet.` : '';
    $('#insight-headline').textContent = ins.total
      ? `${ins.total} interview${ins.total > 1 ? 's' : ''} done.${ins.themes[0] ? ` Top theme: “${ins.themes[0].painPoint}” (${ins.themes[0].count} of ${ins.total}).` : ''}${missing}`
      : 'No interviews marked as done yet. Showing nothing until you record one.';
    rows = ins.themes.map((t) => ({ painPoint: t.painPoint, count: t.count, label: `${t.count} of ${ins.total}`, width: t.share }));
  } else {
    const all = painPointSummary(prospects);
    $('#insight-headline').textContent = 'Counting pain points from every prospect, including replies that were not interviews.';
    const max = all[0]?.count ?? 1;
    rows = all.map((t) => ({ painPoint: t.painPoint, count: t.count, label: String(t.count), width: t.count / max }));
  }
  if (!rows.length) {
    $('#painpoints').replaceChildren(el('p', { class: 'muted' }, 'No pain points recorded yet. Tick them when editing a prospect.'));
  } else {
    $('#painpoints').replaceChildren(...rows.slice(0, 10).map((r) => el('button', {
      class: `bar-row as-button ${selected === r.painPoint ? 'selected' : ''}`,
      'aria-pressed': selected === r.painPoint ? 'true' : 'false',
      onclick: () => selectPainPoint(selected === r.painPoint ? '' : r.painPoint),
    },
    el('span', { class: 'bar-label', title: r.painPoint }, r.painPoint),
    el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill pp', style: `width:${Math.max(4, r.width * 100)}%` })),
    el('span', { class: 'bar-num wide' }, r.label))));
  }
  renderEvidence(selected);
}

function renderEvidence(painPoint) {
  const panel = $('#evidence-panel');
  if (!painPoint) { panel.hidden = true; return; }
  const people = prospects.filter((p) => p.painPoints.some((x) => x.toLowerCase() === painPoint.toLowerCase()));
  panel.hidden = false;
  $('#evidence-title').textContent = `“${painPoint}” (${people.length})`;
  $('#evidence').replaceChildren(...people.map((p) => el('li', {},
    el('div', {}, el('button', { class: 'link company-link', onclick: () => openForm(p.id) }, p.company), ' ', el('span', { class: `pill st-${p.status}` }, statusLabel[p.status]), ' ', el('span', { class: 'muted' }, p.trade)),
    p.interviewNotes ? el('blockquote', {}, p.interviewNotes) : el('p', { class: 'muted' }, 'No notes recorded.'))));
}

function selectPainPoint(pp) {
  $('#f-pain').value = pp;
  renderInsights();
  renderTable();
}

function refreshPainFilterOptions() {
  const select = $('#f-pain');
  const current = select.value;
  const names = painPointSummary(prospects).map((x) => x.painPoint);
  for (const pp of PAIN_POINTS) if (!names.some((n) => n.toLowerCase() === pp.toLowerCase())) names.push(pp);
  fillSelect(select, names, 'Any pain point');
  select.value = names.includes(current) ? current : '';
}

function currentFilters() {
  return { search: $('#f-search').value, status: $('#f-status').value, trade: $('#f-trade').value, followUp: $('#f-followup').value, painPoint: $('#f-pain').value };
}

function renderTable() {
  const today = todayIso();
  const dupeEmailIds = new Set([...findDuplicateEmails(prospects).values()].flat());
  const similarIds = similarCompanyIds(prospects);
  let list = filterProspects(prospects, currentFilters(), today);
  if ($('#f-dupes').checked) list = list.filter((p) => dupeEmailIds.has(p.id) || similarIds.has(p.id));
  list = sortProspects(list, view.sortKey, view.sortDir, today);
  for (const b of document.querySelectorAll('button.sort')) {
    const active = b.dataset.sort === view.sortKey;
    b.dataset.dir = active ? view.sortDir : '';
    b.closest('th').setAttribute('aria-sort', active ? (view.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
  $('#count').textContent = `(${list.length} of ${prospects.length})`;
  $('#empty').hidden = list.length > 0;
  $('#rows').replaceChildren(...list.map((p) => {
    const step = nextStep(p, today);
    const overdue = step.due && p.followUpDate < today;
    return el('tr', { 'data-id': p.id, class: step.due ? 'row-due' : '' },
      el('td', { 'data-label': 'Company' }, p.company,
        p.isSample ? el('span', { class: 'tag sample' }, 'sample') : null,
        similarIds.has(p.id) ? el('span', { class: 'tag dupe', title: 'Another prospect has a very similar company name' }, 'similar name') : null),
      el('td', { 'data-label': 'Email', class: 'email' }, p.email || el('span', { class: 'muted' }, '—'), dupeEmailIds.has(p.id) ? el('span', { class: 'tag dupe', title: 'Another prospect uses this email' }, 'duplicate') : null),
      el('td', { 'data-label': 'Trade' }, p.trade),
      el('td', { 'data-label': 'City' }, p.city || el('span', { class: 'muted' }, '—')),
      el('td', { 'data-label': 'Status' }, el('span', { class: `pill st-${p.status}` }, statusLabel[p.status])),
      el('td', { 'data-label': 'Last contact', class: 'nowrap' }, p.lastContactDate || el('span', { class: 'muted' }, '—')),
      el('td', { 'data-label': 'Next step' }, step.text ? el('span', { class: overdue ? 'fu fu-overdue' : step.due ? 'fu fu-today' : '' }, step.text, overdue ? ' (overdue)' : '') : el('span', { class: 'muted' }, '—')),
      el('td', { 'data-label': 'Pain points' }, p.painPoints.length ? p.painPoints.join(', ') : el('span', { class: 'muted' }, '—')),
      el('td', { class: 'row-actions' },
        ...step.actions.filter((a) => a !== 'snooze').map((a) => el('button', { class: 'small primary', 'data-action': a, onclick: () => runQuick(p.id, a) }, QUICK_ACTIONS[a])),
        el('button', { class: 'small', onclick: () => openForm(p.id) }, 'Edit')));
  }));
}

function render() {
  const today = todayIso();
  const s = summarize(prospects, today);
  const similar = similarCompanyIds(prospects);
  const dupeEmail = new Set([...findDuplicateEmails(prospects).values()].flat());
  s.possibleDuplicates = new Set([...similar, ...dupeEmail]).size;
  refreshPainFilterOptions();
  renderStats(s);
  renderToday(today);
  renderFunnel(s);
  renderInsights();
  renderScorecard();
  renderTable();
  $('#sample-banner').hidden = !prospects.some((p) => p.isSample);
}

// ---------- validation scorecard ----------

function renderScorecard() {
  const card = validationScorecard(prospects, thresholds);
  const v = VERDICTS[card.verdict];
  $('#verdict').className = `verdict v-${card.verdict}`;
  $('#verdict').replaceChildren(el('strong', {}, v.label), el('span', {}, v.text));
  $('#checks').replaceChildren(...card.checks.map((c) => el('li', { class: c.met ? 'met' : 'unmet' },
    el('span', { class: 'check-mark', 'aria-hidden': 'true' }, c.met ? '✓' : '○'),
    el('span', {}, c.label),
    el('span', { class: 'muted' }, c.value))));
  const f = $('#targets-form');
  if (!f.contains(document.activeElement)) {
    f.elements.minInterviews.value = thresholds.minInterviews;
    f.elements.painSharePct.value = Math.round(thresholds.painShare * 100);
    f.elements.listShares.value = thresholds.listShares;
    f.elements.pilotYes.value = thresholds.pilotYes;
  }
}

function saveTargets(next) {
  thresholds = sanitizeThresholds(next);
  saveSettings({ ...loadSettings(), thresholds });
  renderScorecard();
}

$('#targets-form').addEventListener('input', () => {
  const f = $('#targets-form');
  saveTargets({
    minInterviews: f.elements.minInterviews.value,
    painShare: Number(f.elements.painSharePct.value) / 100,
    listShares: f.elements.listShares.value,
    pilotYes: f.elements.pilotYes.value,
  });
});
$('#btn-reset-targets').addEventListener('click', () => { saveTargets(DEFAULT_THRESHOLDS); document.activeElement?.blur(); renderScorecard(); });

function reportText() {
  return scorecardMarkdown(validationScorecard(prospects, thresholds), todayIso());
}
$('#btn-download-report').addEventListener('click', () => {
  const blob = new Blob([reportText()], { type: 'text/markdown;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `discovery-scorecard-${todayIso()}.md` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#btn-copy-report').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(reportText()); toast('Report copied.'); } catch { toast('Copy failed. Use Download instead.'); }
});

// ---------- form ----------

const form = $('#form');
const FIELDS = ['company', 'contactName', 'email', 'phone', 'trade', 'city', 'source', 'status', 'lastContactDate', 'followUpDate', 'interviewDate', 'sharesList', 'pilotInterest', 'interviewNotes'];

function openForm(id = null) {
  editingId = id;
  const p = id ? prospects.find((x) => x.id === id) : emptyProspect();
  formStartStatus = p.status;
  $('#dlg-title').textContent = id ? 'Edit prospect' : 'Add prospect';
  $('#btn-delete').hidden = !id;
  $('#form-error').hidden = true;
  $('#status-msg').textContent = '';
  for (const name of FIELDS) form.elements[name].value = p[name] ?? '';
  const known = new Set(PAIN_POINTS.map((x) => x.toLowerCase()));
  $('#pp-options').replaceChildren(...PAIN_POINTS.map((pp) => el('label', { class: 'chip' },
    el('input', { type: 'checkbox', value: pp, checked: p.painPoints.some((x) => x.toLowerCase() === pp.toLowerCase()) }), pp)));
  form.elements.customPain.value = p.painPoints.filter((x) => !known.has(x.toLowerCase())).join('; ');
  checkEmail();
  checkCompany();
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

// A similar company name is only a warning: two locations of one business can be legitimate.
function checkCompany() {
  const msg = $('#company-msg');
  const similar = findSimilarCompanies(prospects, form.elements.company.value, editingId);
  msg.className = 'field-msg warn';
  msg.textContent = similar.length ? `Possible duplicate of “${similar[0].company}”${similar[0].email ? ` (${similar[0].email})` : ''}.` : '';
}

form.elements.email.addEventListener('input', checkEmail);
form.elements.company.addEventListener('input', checkCompany);

// Changing status fills in the dates the outreach process expects, without overwriting dates typed for that status.
form.elements.status.addEventListener('change', () => {
  const current = {
    status: formStartStatus,
    lastContactDate: form.elements.lastContactDate.value,
    followUpDate: form.elements.followUpDate.value,
  };
  const next = applyStatus(current, form.elements.status.value, todayIso());
  const changed = [];
  if (next.lastContactDate !== current.lastContactDate) { form.elements.lastContactDate.value = next.lastContactDate; changed.push('last contact'); }
  if (next.followUpDate !== current.followUpDate) { form.elements.followUpDate.value = next.followUpDate; changed.push(next.followUpDate ? 'follow-up date' : 'follow-up cleared'); }
  $('#status-msg').textContent = changed.length ? `Updated ${changed.join(' and ')}. You can change them.` : '';
  if (form.elements.status.value === 'interview_scheduled' && !form.elements.interviewDate.value) form.elements.interviewDate.focus();
});

$('#btn-suggest').addEventListener('click', () => {
  const base = form.elements.lastContactDate.value || todayIso();
  form.elements.followUpDate.value = addBusinessDays(base, FOLLOW_UP_DAYS);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#form-error');
  const company = form.elements.company.value.trim();
  if (!company) { err.textContent = 'Company is required.'; err.hidden = false; return; }
  if (!checkEmail()) { err.textContent = 'Fix the email before saving. Duplicate emails are not allowed.'; err.hidden = false; return; }
  const checked = [...$('#pp-options').querySelectorAll('input:checked')].map((i) => i.value);
  const existing = editingId ? prospects.find((x) => x.id === editingId) : null;
  const values = Object.fromEntries(FIELDS.map((f) => [f, form.elements[f].value]));
  const data = sanitizeProspect({
    ...(existing ?? {}),
    ...values,
    id: editingId ?? '',
    company,
    painPoints: [...checked, ...parsePainPoints(form.elements.customPain.value)],
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
  if (!p || !confirm(`Delete “${p.company}”?`)) return;
  const before = prospects;
  prospects = prospects.filter((x) => x.id !== editingId);
  persist();
  $('#dlg').close();
  render();
  toast('Prospect deleted.', () => { prospects = before; persist(); render(); });
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
  const before = prospects;
  prospects = [...added, ...prospects];
  persist();
  render();
  const parts = [`Imported ${added.length}.`];
  if (skipped.length) parts.push(`Skipped ${skipped.length} duplicate email${skipped.length > 1 ? 's' : ''}.`);
  if (errors.length) parts.push(`${errors.length} row${errors.length > 1 ? 's' : ''} had problems: ${errors.slice(0, 2).join(' ')}`);
  toast(parts.join(' '), added.length ? () => { prospects = before; persist(); render(); } : null);
});

$('#btn-load-sample').addEventListener('click', () => {
  const { added } = importCsv(toCsv(buildSampleData()), prospects);
  prospects = [...prospects, ...added];
  persist(); render(); toast(`Added ${added.length} sample prospects.`);
  $('.more').open = false;
});
$('#btn-remove-sample').addEventListener('click', () => {
  const before = prospects;
  prospects = prospects.filter((p) => !p.isSample);
  persist(); render(); toast(`Removed ${before.length - prospects.length} sample prospects.`, () => { prospects = before; persist(); render(); });
  $('.more').open = false;
});
$('#btn-clear').addEventListener('click', () => {
  if (!confirm('Delete ALL prospects saved in this browser? Export a CSV first if you need a copy.')) return;
  prospects = [];
  clearProspects(); persist(); render(); toast('All data deleted.');
  $('.more').open = false;
});

for (const id of ['#f-search', '#f-status', '#f-trade', '#f-followup', '#f-dupes']) $(id).addEventListener('input', renderTable);
$('#f-pain').addEventListener('input', () => { renderInsights(); renderTable(); });
$('#pp-interviewed').addEventListener('change', renderInsights);
$('#btn-clear-pp').addEventListener('click', () => selectPainPoint(''));
for (const b of document.querySelectorAll('button.sort')) {
  b.addEventListener('click', () => {
    if (view.sortKey === b.dataset.sort) {
      if (view.sortDir === 'asc') view.sortDir = 'desc';
      else { view.sortKey = ''; view.sortDir = 'asc'; }
    } else { view.sortKey = b.dataset.sort; view.sortDir = 'asc'; }
    renderTable();
  });
}

// ---------- init ----------
fillSelect($('#f-status'), STATUSES, 'Any status');
fillSelect($('#f-trade'), TRADES, 'Any trade');
fillSelect(form.elements.status, STATUSES);
fillSelect(form.elements.trade, TRADES);
fillSelect(form.elements.sharesList, SIGNALS);
fillSelect(form.elements.pilotInterest, SIGNALS);
persist();
render();
