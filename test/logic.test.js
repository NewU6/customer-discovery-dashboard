import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addBusinessDays, filterProspects, findByEmail, findDuplicateEmails, followUpState, importCsv,
  isValidEmail, normalizeEmail, painPointSummary, parseCsv, sanitizeProspect, summarize, toCsv, toIsoDate,
} from '../src/logic.js';
import { buildSampleData } from '../src/sample-data.js';
import { STORAGE_KEY, loadProspects, saveProspects } from '../src/storage.js';

const TODAY = '2026-09-29';
const p = (o) => sanitizeProspect(o);

test('normalizes and validates emails', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM '), 'owner@example.com');
  assert.ok(isValidEmail('a@b.co'));
  assert.ok(isValidEmail(''));
  assert.ok(!isValidEmail('not-an-email'));
});

test('parses dates in ISO and US formats and rejects impossible dates', () => {
  assert.equal(toIsoDate('2026-9-4'), '2026-09-04');
  assert.equal(toIsoDate('9/29/2026'), '2026-09-29');
  assert.equal(toIsoDate('2026-02-30'), '');
  assert.equal(toIsoDate('soon'), '');
});

test('adds business days, skipping weekends', () => {
  assert.equal(addBusinessDays('2026-09-25', 1), '2026-09-28'); // Fri -> Mon
  assert.equal(addBusinessDays('2026-09-29', 5), '2026-10-06'); // Tue -> next Tue
});

test('sanitizes unknown status and trade values', () => {
  const x = p({ company: 'X', status: 'weird', trade: 'Electric', painPoints: 'A; b; a' });
  assert.equal(x.status, 'queued');
  assert.equal(x.trade, 'Other');
  assert.deepEqual(x.painPoints, ['A', 'b']);
  assert.ok(x.id);
});

test('detects duplicate emails case-insensitively', () => {
  const list = [p({ company: 'A', email: 'x@ex.com' }), p({ company: 'B', email: 'X@EX.com ' }), p({ company: 'C', email: 'y@ex.com' }), p({ company: 'D', email: '' })];
  const d = findDuplicateEmails(list);
  assert.equal(d.size, 1);
  assert.equal(d.get('x@ex.com').length, 2);
  assert.equal(findByEmail(list, 'X@ex.com', list[0].id).company, 'B');
  assert.equal(findByEmail(list, 'none@ex.com'), null);
});

test('follow-up state ignores stopped statuses', () => {
  assert.equal(followUpState(p({ status: 'contacted', followUpDate: '2026-09-28' }), TODAY), 'overdue');
  assert.equal(followUpState(p({ status: 'contacted', followUpDate: TODAY }), TODAY), 'today');
  assert.equal(followUpState(p({ status: 'contacted', followUpDate: '2026-10-01' }), TODAY), 'upcoming');
  assert.equal(followUpState(p({ status: 'replied', followUpDate: '2026-09-01' }), TODAY), 'none');
});

test('summary counts contacted, replies, interviews and due follow-ups', () => {
  const list = [
    p({ status: 'queued' }),
    p({ status: 'contacted', followUpDate: '2026-09-20' }),
    p({ status: 'replied' }),
    p({ status: 'interviewed' }),
    p({ status: 'bounced' }),
  ];
  const s = summarize(list, TODAY);
  assert.equal(s.total, 5);
  assert.equal(s.contacted, 3); // bounced does not count as a real contact
  assert.equal(s.replied, 2);
  assert.equal(s.interviews, 1);
  assert.equal(s.dueFollowUps, 1);
  assert.equal(s.replyRate, 2 / 3);
  assert.equal(summarize([], TODAY).replyRate, null);
});

test('pain point summary groups case-insensitively and can filter to interviews', () => {
  const list = [
    p({ status: 'interviewed', painPoints: ['No follow-up process', 'Price shoppers'] }),
    p({ status: 'interviewed', painPoints: ['no follow-up process'] }),
    p({ status: 'replied', painPoints: ['Price shoppers'] }),
  ];
  assert.deepEqual(painPointSummary(list), [
    { painPoint: 'No follow-up process', count: 2 },
    { painPoint: 'Price shoppers', count: 2 },
  ]);
  assert.deepEqual(painPointSummary(list, { interviewedOnly: true })[0], { painPoint: 'No follow-up process', count: 2 });
});

test('filters by search text, status, trade and follow-up', () => {
  const list = [
    p({ company: 'Alpha HVAC', trade: 'HVAC', status: 'contacted', followUpDate: '2026-09-28', interviewNotes: 'loses estimates' }),
    p({ company: 'Beta Roofing', trade: 'Roofing', status: 'queued' }),
  ];
  assert.equal(filterProspects(list, { search: 'estimates' }, TODAY).length, 1);
  assert.equal(filterProspects(list, { trade: 'Roofing' }, TODAY)[0].company, 'Beta Roofing');
  assert.equal(filterProspects(list, { status: 'contacted' }, TODAY).length, 1);
  assert.equal(filterProspects(list, { followUp: 'due' }, TODAY)[0].company, 'Alpha HVAC');
});

test('CSV parser handles quotes, commas, newlines and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"\nthere']]);
});

test('CSV export round-trips through import', () => {
  const original = [p({ company: 'Comma, Inc', email: 'a@ex.com', painPoints: ['One', 'Two'], interviewNotes: 'Line1\nLine "2"' })];
  const { added, skipped, errors } = importCsv(toCsv(original), []);
  assert.equal(errors.length, 0);
  assert.equal(skipped.length, 0);
  assert.equal(added[0].company, 'Comma, Inc');
  assert.deepEqual(added[0].painPoints, ['One', 'Two']);
  assert.equal(added[0].interviewNotes, 'Line1\nLine "2"');
});

test('CSV export neutralizes spreadsheet formulas', () => {
  const csv = toCsv([p({ company: '=HYPERLINK("x")' })]);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});

test('CSV import skips duplicates against existing data and within the file', () => {
  const existing = [p({ company: 'Old', email: 'dup@ex.com' })];
  const csv = 'Company,Email,Status\nNew,DUP@ex.com,contacted\nFresh,new@ex.com,contacted\nAgain,new@ex.com,queued\nBad,nope,queued\n';
  const { added, skipped, errors } = importCsv(csv, existing);
  assert.deepEqual(added.map((x) => x.company), ['Fresh']);
  assert.equal(skipped.length, 2);
  assert.equal(errors.length, 1);
});

test('CSV import reports missing columns', () => {
  assert.match(importCsv('foo,bar\n1,2\n').errors[0], /company|email/);
});

test('sample data is clearly synthetic and demonstrates a duplicate', () => {
  const data = buildSampleData(TODAY);
  assert.ok(data.length >= 10);
  assert.ok(data.every((x) => x.isSample && x.company.startsWith('Sample ')));
  assert.ok(data.every((x) => /@[a-z0-9.-]+\.example\.(com|org)$/.test(x.email)));
  assert.equal(findDuplicateEmails(data).size, 1);
});

test('storage saves and loads through a Storage-like object', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(loadProspects(storage), null);
  assert.ok(saveProspects([p({ company: 'Saved', email: 's@ex.com' })], storage));
  assert.equal(loadProspects(storage)[0].company, 'Saved');
  mem.set(STORAGE_KEY, 'not json');
  assert.equal(loadProspects(storage), null);
});
