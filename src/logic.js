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

export const CSV_FIELDS = [
  'id', 'company', 'contactName', 'email', 'phone', 'trade', 'city', 'source',
  'status', 'lastContactDate', 'followUpDate', 'painPoints', 'interviewNotes', 'isSample',
];

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
    interviewNotes: '', isSample: false,
  };
}

/** Coerce any partial/untrusted object into a clean prospect record. */
export function sanitizeProspect(input) {
  const base = emptyProspect();
  const p = { ...base };
  for (const key of Object.keys(base)) {
    if (input && input[key] !== undefined && input[key] !== null) p[key] = input[key];
  }
  for (const key of ['id', 'company', 'contactName', 'email', 'phone', 'trade', 'city', 'source', 'status', 'lastContactDate', 'followUpDate', 'interviewNotes']) {
    p[key] = String(p[key]).trim();
  }
  p.email = normalizeEmail(p.email);
  if (!STATUS_IDS.includes(p.status)) p.status = 'queued';
  if (!TRADES.includes(p.trade)) p.trade = p.trade ? 'Other' : 'HVAC';
  p.lastContactDate = toIsoDate(p.lastContactDate);
  p.followUpDate = toIsoDate(p.followUpDate);
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

export function summarize(prospects, today = todayIso()) {
  const byStatus = Object.fromEntries(STATUS_IDS.map((s) => [s, 0]));
  let dueFollowUps = 0;
  for (const p of prospects) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    const f = followUpState(p, today);
    if (f === 'overdue' || f === 'today') dueFollowUps += 1;
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

export function filterProspects(prospects, { search = '', status = '', trade = '', followUp = '' } = {}, today = todayIso()) {
  const q = search.trim().toLowerCase();
  return prospects.filter((p) => {
    if (status && p.status !== status) return false;
    if (trade && p.trade !== trade) return false;
    if (followUp) {
      const f = followUpState(p, today);
      if (followUp === 'due' && !(f === 'overdue' || f === 'today')) return false;
      if (followUp === 'upcoming' && f !== 'upcoming') return false;
    }
    if (!q) return true;
    const hay = [p.company, p.contactName, p.email, p.city, p.source, p.interviewNotes, p.painPoints.join(' ')].join(' ').toLowerCase();
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
