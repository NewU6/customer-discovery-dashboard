// Pure logic for the customer-discovery dashboard.
// No DOM access here, so everything can be unit-tested with `node --test`.

export const TRADES = ['HVAC', 'Plumbing', 'Roofing', 'Multi-trade', 'Other'];

export const STATUSES = [
  { id: 'queued', label: 'Queued' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'followed_up', label: 'Followed up' },
  { id: 'replied', label: 'Replied' },
  { id: 'interview_scheduled', label: 'Interview scheduled' },
  { id: 'interviewed', label: 'Interviewed' },
  { id: 'not_interested', label: 'Not interested' },
  { id: 'opted_out', label: 'Opted out' },
  { id: 'bounced', label: 'Bounced' },
  { id: 'closed', label: 'Closed' },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);

// Statuses where no further outreach should happen.
export const STOPPED = new Set(['replied', 'interview_scheduled', 'interviewed', 'not_interested', 'opted_out', 'bounced', 'closed']);

export const PAIN_POINTS = [
  'No follow-up process',
  'Leads lost in texts/voicemail',
  'No time / no office staff',
  'Price shoppers',
  'Slow response to new leads',
  'CRM not used',
  'Seasonal swings',
  'Hard to track estimates',
];

// New columns are appended at the end so v0.1 exports still import cleanly.
export const CSV_FIELDS = [
  'id', 'company', 'contactName', 'email', 'phone', 'trade', 'city', 'source',
  'status', 'lastContactDate', 'followUpDate', 'painPoints', 'interviewNotes', 'isSample',
  'interviewDate',
];

// Business days between first contact and the single follow-up, and between the follow-up and closing.
export const FOLLOW_UP_DAYS = 5;
export const SNOOZE_DAYS = 2;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

let counter = 0;
export function makeId() {
  counter += 1;
  return `p_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyProspect() {
  return {
    id: '', company: '', contactName: '', email: '', phone: '', trade: 'HVAC', city: '',
    source: '', status: 'queued', lastContactDate: '', followUpDate: '', painPoints: [],
    interviewNotes: '', isSample: false, interviewDate: '',
  };
}

/** Coerce any partial/untrusted object into a clean prospect record. */
export function sanitizeProspect(input) {
  const base = emptyProspect();
  const p = { ...base };
  for (const key of Object.keys(base)) {
    if (input && input[key] !== undefined && input[key] !== null) p[key] = input[key];
  }
  for (const key of ['id', 'company', 'contactName', 'email', 'phone', 'trade', 'city', 'source', 'status', 'lastContactDate', 'followUpDate', 'interviewNotes', 'interviewDate']) {
    p[key] = String(p[key]).trim();
  }
  p.email = normalizeEmail(p.email);
  if (!STATUS_IDS.includes(p.status)) p.status = 'queued';
  if (!TRADES.includes(p.trade)) p.trade = p.trade ? 'Other' : 'HVAC';
  p.lastContactDate = toIsoDate(p.lastContactDate);
  p.followUpDate = toIsoDate(p.followUpDate);
  p.interviewDate = toIsoDate(p.interviewDate);
  // v0.1 had no interview date, so scheduled interviews kept their date in followUpDate.
  // Copy it (never move it) so those records show up as upcoming interviews.
  if (p.status === 'interview_scheduled' && !p.interviewDate && p.followUpDate) p.interviewDate = p.followUpDate;
  p.painPoints = parsePainPoints(p.painPoints);
  p.isSample = p.isSample === true || String(p.isSample).toLowerCase() === 'true';
  if (!p.id) p.id = makeId();
  return p;
}

export function parsePainPoints(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[;|]/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const t = String(item).trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** Accepts YYYY-MM-DD or M/D/YYYY; returns YYYY-MM-DD or ''. */
export function toIsoDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return fmt(+m[3], +m[1], +m[2]);
  return '';
}

function fmt(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayIso(now = new Date()) {
  return fmt(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Adds business days (Mon–Fri) to an ISO date. */
export function addBusinessDays(iso, days) {
  const d = toIsoDate(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  let left = days;
  while (left > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return dt.toISOString().slice(0, 10);
}

/** Map of normalized email -> array of prospect ids, only for emails used more than once. */
export function findDuplicateEmails(prospects) {
  const map = new Map();
  for (const p of prospects) {
    const e = normalizeEmail(p.email);
    if (!e) continue;
    if (!map.has(e)) map.set(e, []);
    map.get(e).push(p.id);
  }
  const dupes = new Map();
  for (const [e, ids] of map) if (ids.length > 1) dupes.set(e, ids);
  return dupes;
}

/** Returns the existing prospect with this email, ignoring `exceptId`. */
export function findByEmail(prospects, email, exceptId = null) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return prospects.find((p) => p.id !== exceptId && normalizeEmail(p.email) === e) ?? null;
}

export function followUpState(p, today = todayIso()) {
  if (!p.followUpDate || STOPPED.has(p.status)) return 'none';
  if (p.followUpDate < today) return 'overdue';
  if (p.followUpDate === today) return 'today';
  return 'upcoming';
}

export function isDue(p, today = todayIso()) {
  const f = followUpState(p, today);
  return f === 'overdue' || f === 'today';
}

export function hasUpcomingInterview(p, today = todayIso()) {
  return p.status === 'interview_scheduled' && !!p.interviewDate && p.interviewDate >= today;
}

/**
 * Returns a copy of `p` moved to `status`, filling in dates the way the outreach process expects:
 * - contacted: last contact defaults to today, the single follow-up is due FOLLOW_UP_DAYS business days later
 * - followed_up: last contact is today, and the date becomes the "close if no reply" check
 * - any stopped status: the follow-up date is cleared
 * Dates the user already entered for the same status are kept.
 */
export function applyStatus(p, status, today = todayIso()) {
  const next = { ...p, status };
  if (status === p.status) return next;
  if (status === 'contacted') {
    next.lastContactDate = p.lastContactDate && p.status === 'queued' ? p.lastContactDate : today;
    next.followUpDate = addBusinessDays(next.lastContactDate, FOLLOW_UP_DAYS);
  } else if (status === 'followed_up') {
    next.lastContactDate = today;
    next.followUpDate = addBusinessDays(today, FOLLOW_UP_DAYS);
  } else if (STOPPED.has(status)) {
    next.followUpDate = '';
  } else if (status === 'queued') {
    next.followUpDate = '';
  }
  return next;
}

export const QUICK_ACTIONS = {
  log_intro: 'Intro sent',
  log_followup: 'Follow-up sent',
  snooze: `Snooze ${SNOOZE_DAYS} days`,
  close: 'Close (no reply)',
};

/** One-click actions from the action list. Returns the updated prospect. */
export function quickAction(p, action, today = todayIso()) {
  switch (action) {
    case 'log_intro': return applyStatus(p, 'contacted', today);
    case 'log_followup': return applyStatus(p, 'followed_up', today);
    case 'snooze': return { ...p, followUpDate: addBusinessDays(today, SNOOZE_DAYS) };
    case 'close': return applyStatus(p, 'closed', today);
    default: throw new Error(`Unknown action: ${action}`);
  }
}

/** What to do next for a prospect, plus which quick actions make sense. */
export function nextStep(p, today = todayIso()) {
  const due = isDue(p, today);
  switch (p.status) {
    case 'queued': return { text: 'Send intro', actions: ['log_intro'], due: false };
    case 'contacted': return due
      ? { text: 'Send the one follow-up', actions: ['log_followup', 'snooze'], due }
      : { text: p.followUpDate ? `Follow up ${p.followUpDate}` : 'Set a follow-up date', actions: [], due };
    case 'followed_up': return due
      ? { text: 'No reply? Close it', actions: ['close', 'snooze'], due }
      : { text: p.followUpDate ? `Close if no reply by ${p.followUpDate}` : 'Waiting for reply', actions: [], due };
    case 'replied': return { text: 'Schedule interview', actions: [], due: false };
    case 'interview_scheduled': return { text: p.interviewDate ? `Interview ${p.interviewDate}` : 'Add interview date', actions: [], due: false };
    case 'interviewed': return { text: p.interviewNotes ? 'Done' : 'Add interview notes', actions: [], due: false };
    default: return { text: '', actions: [], due: false };
  }
}

const COMPANY_NOISE = /\b(the|inc|llc|l\.l\.c|co|corp|corporation|company|ltd|services?|sample)\b/g;
export function normalizeCompany(name) {
  return String(name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(COMPANY_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Other prospects whose company name matches after removing punctuation and words like "LLC" or "Inc". */
export function findSimilarCompanies(prospects, company, exceptId = null) {
  const key = normalizeCompany(company);
  if (key.length < 3) return [];
  return prospects.filter((p) => p.id !== exceptId && normalizeCompany(p.company) === key);
}

/** Set of prospect ids that share a normalized company name with another prospect. */
export function similarCompanyIds(prospects) {
  const groups = new Map();
  for (const p of prospects) {
    const key = normalizeCompany(p.company);
    if (key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p.id);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}

export function summarize(prospects, today = todayIso()) {
  const byStatus = Object.fromEntries(STATUS_IDS.map((s) => [s, 0]));
  let dueFollowUps = 0;
  let upcomingInterviews = 0;
  for (const p of prospects) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    if (isDue(p, today)) dueFollowUps += 1;
    if (hasUpcomingInterview(p, today)) upcomingInterviews += 1;
  }
  const contactedStatuses = STATUS_IDS.filter((s) => s !== 'queued');
  const contacted = contactedStatuses.reduce((n, s) => n + byStatus[s], 0) - byStatus.bounced;
  const replied = byStatus.replied + byStatus.interview_scheduled + byStatus.interviewed + byStatus.not_interested;
  return {
    total: prospects.length,
    byStatus,
    contacted,
    replied,
    interviews: byStatus.interviewed,
    upcomingInterviews,
    dueFollowUps,
    duplicateEmails: findDuplicateEmails(prospects).size,
    replyRate: contacted > 0 ? replied / contacted : null,
  };
}

/** Counts pain points across prospects, most frequent first. */
export function painPointSummary(prospects, { interviewedOnly = false } = {}) {
  const counts = new Map();
  for (const p of prospects) {
    if (interviewedOnly && p.status !== 'interviewed') continue;
    for (const pp of p.painPoints) {
      const key = pp.trim();
      const found = [...counts.keys()].find((k) => k.toLowerCase() === key.toLowerCase());
      counts.set(found ?? key, (counts.get(found ?? key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([painPoint, count]) => ({ painPoint, count }))
    .sort((a, b) => b.count - a.count || a.painPoint.localeCompare(b.painPoint));
}

/**
 * Interview insights: for each pain point, how many interviewed prospects mentioned it and what share
 * of all interviews that is, plus the notes that back it up.
 */
export function interviewInsights(prospects) {
  const interviewed = prospects.filter((p) => p.status === 'interviewed');
  const total = interviewed.length;
  const themes = painPointSummary(interviewed).map(({ painPoint, count }) => ({
    painPoint,
    count,
    share: total ? count / total : 0,
    evidence: interviewed
      .filter((p) => p.painPoints.some((x) => x.toLowerCase() === painPoint.toLowerCase()))
      .map((p) => ({ id: p.id, company: p.company, trade: p.trade, note: p.interviewNotes })),
  }));
  return {
    total,
    withNotes: interviewed.filter((p) => p.interviewNotes.trim()).length,
    missingNotes: interviewed.filter((p) => !p.interviewNotes.trim()).map((p) => p.id),
    themes,
  };
}

export function hasPainPoint(p, painPoint) {
  const key = painPoint.toLowerCase();
  return p.painPoints.some((x) => x.toLowerCase() === key);
}

const SORTERS = {
  company: (p) => p.company.toLowerCase(),
  status: (p) => STATUS_IDS.indexOf(p.status),
  lastContactDate: (p) => p.lastContactDate || '',
  followUpDate: (p) => p.followUpDate || '9999-99-99',
  trade: (p) => p.trade,
  city: (p) => p.city.toLowerCase(),
};
export const SORT_KEYS = Object.keys(SORTERS);

/** Default order: due first, then by follow-up date, then company. */
export function sortProspects(list, key = '', dir = 'asc', today = todayIso()) {
  const sign = dir === 'desc' ? -1 : 1;
  const byCompany = (a, b) => a.company.localeCompare(b.company);
  if (!SORTERS[key]) {
    return [...list].sort((a, b) => (isDue(b, today) - isDue(a, today))
      || SORTERS.followUpDate(a).localeCompare(SORTERS.followUpDate(b))
      || byCompany(a, b));
  }
  const get = SORTERS[key];
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return c * sign || byCompany(a, b);
  });
}

export function filterProspects(prospects, { search = '', status = '', trade = '', followUp = '', painPoint = '' } = {}, today = todayIso()) {
  const q = search.trim().toLowerCase();
  return prospects.filter((p) => {
    if (status && p.status !== status) return false;
    if (trade && p.trade !== trade) return false;
    if (painPoint && !hasPainPoint(p, painPoint)) return false;
    if (followUp) {
      const f = followUpState(p, today);
      if (followUp === 'due' && !(f === 'overdue' || f === 'today')) return false;
      if (followUp === 'upcoming' && f !== 'upcoming') return false;
    }
    if (!q) return true;
    const hay = [p.company, p.contactName, p.email, p.phone, p.city, p.source, p.interviewNotes, p.painPoints.join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// ---------- CSV ----------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function csvCell(value) {
  let s = String(value ?? '');
  // Guard against spreadsheet formula injection when the CSV is opened in Excel.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(prospects) {
  const lines = [CSV_FIELDS.join(',')];
  for (const p of prospects) {
    lines.push(CSV_FIELDS.map((f) => csvCell(f === 'painPoints' ? p.painPoints.join('; ') : p[f])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

const HEADER_ALIASES = {
  company: ['company', 'business', 'name', 'company name'],
  contactName: ['contactname', 'contact', 'contact name', 'contact_name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'phone number'],
  trade: ['trade', 'industry'],
  city: ['city', 'location'],
  source: ['source'],
  status: ['status'],
  lastContactDate: ['lastcontactdate', 'last contact date', 'last_contact_date', 'initial_sent_at', 'sent'],
  followUpDate: ['followupdate', 'follow up date', 'follow-up date', 'followup_due'],
  painPoints: ['painpoints', 'pain points', 'pain_points'],
  interviewNotes: ['interviewnotes', 'interview notes', 'notes'],
  isSample: ['issample', 'is sample', 'sample'],
  interviewDate: ['interviewdate', 'interview date', 'interview_date'],
  id: ['id'],
};

/**
 * Parses CSV text and merges it into `existing`.
 * Rows whose email already exists (in existing data or earlier in the file) are skipped, never overwritten.
 */
export function importCsv(text, existing = []) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { added: [], skipped: [], errors: ['The file is empty.'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) index[field] = i;
  }
  if (index.company === undefined && index.email === undefined) {
    return { added: [], skipped: [], errors: ['Could not find a "company" or "email" column.'] };
  }
  const added = [];
  const skipped = [];
  const errors = [];
  const existingIds = new Set(existing.map((p) => p.id));
  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const raw = {};
    for (const [field, i] of Object.entries(index)) raw[field] = r[i] ?? '';
    if (!raw.company && !raw.email) { errors.push(`Row ${line}: no company or email.`); return; }
    if (raw.id && existingIds.has(raw.id)) raw.id = '';
    const p = sanitizeProspect(raw);
    if (!p.company) p.company = p.email;
    if (!isValidEmail(p.email)) { errors.push(`Row ${line}: invalid email "${raw.email}".`); return; }
    const dup = findByEmail([...existing, ...added], p.email);
    if (dup) { skipped.push({ line, email: p.email, existingCompany: dup.company }); return; }
    existingIds.add(p.id);
    added.push(p);
  });
  return { added, skipped, errors };
}
