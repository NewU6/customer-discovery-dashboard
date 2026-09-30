import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatus, hasUpcomingInterview, importCsv, interviewInsights, isDue, nextStep, normalizeCompany,
  findSimilarCompanies, quickAction, sanitizeProspect, similarCompanyIds, sortProspects, summarize, toCsv,
  filterProspects,
} from '../src/logic.js';
import { buildSampleData } from '../src/sample-data.js';
import { loadProspects, STORAGE_KEY } from '../src/storage.js';

const TODAY = '2026-09-29'; // Tuesday
const p = (o) => sanitizeProspect(o);

test('logging an intro sets last contact and the single follow-up 5 business days out', () => {
  const x = quickAction(p({ company: 'A', status: 'queued' }), 'log_intro', TODAY);
  assert.equal(x.status, 'contacted');
  assert.equal(x.lastContactDate, TODAY);
  assert.equal(x.followUpDate, '2026-10-06');
});

test('an intro date typed before marking contacted is kept', () => {
  const x = applyStatus(p({ status: 'queued', lastContactDate: '2026-09-25' }), 'contacted', TODAY);
  assert.equal(x.lastContactDate, '2026-09-25');
  assert.equal(x.followUpDate, '2026-10-02');
});

test('logging the follow-up turns the date into a close-out check', () => {
  const x = quickAction(p({ status: 'contacted', lastContactDate: '2026-09-21', followUpDate: '2026-09-28' }), 'log_followup', TODAY);
  assert.equal(x.status, 'followed_up');
  assert.equal(x.lastContactDate, TODAY);
  assert.equal(x.followUpDate, '2026-10-06');
  assert.equal(nextStep(x, TODAY).text, 'Close if no reply by 2026-10-06');
  assert.deepEqual(nextStep(x, '2026-10-06').actions, ['close', 'snooze']);
});

test('snooze and close', () => {
  const due = p({ status: 'contacted', followUpDate: '2026-09-28' });
  assert.equal(quickAction(due, 'snooze', TODAY).followUpDate, '2026-10-01');
  const closed = quickAction(p({ status: 'followed_up', followUpDate: '2026-09-28' }), 'close', TODAY);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.followUpDate, '');
  assert.throws(() => quickAction(due, 'send_email', TODAY));
});

test('stopped statuses clear the follow-up and are never due', () => {
  const x = applyStatus(p({ status: 'contacted', followUpDate: '2026-09-28' }), 'replied', TODAY);
  assert.equal(x.followUpDate, '');
  assert.equal(isDue(x, TODAY), false);
});

test('next step for each stage', () => {
  assert.equal(nextStep(p({ status: 'queued' }), TODAY).text, 'Send intro');
  assert.equal(nextStep(p({ status: 'contacted', followUpDate: '2026-09-28' }), TODAY).text, 'Send the one follow-up');
  assert.equal(nextStep(p({ status: 'replied' }), TODAY).text, 'Schedule interview');
  assert.equal(nextStep(p({ status: 'interview_scheduled', interviewDate: '2026-10-01' }), TODAY).text, 'Interview 2026-10-01');
  assert.equal(nextStep(p({ status: 'interviewed' }), TODAY).text, 'Add interview notes');
});

test('v0.1 records: interview date is copied from the old follow-up date, nothing is removed', () => {
  const old = { id: 'p_old', company: 'Old Co', email: 'old@ex.com', status: 'interview_scheduled', followUpDate: '2026-10-01', painPoints: ['Price shoppers'], interviewNotes: 'keep me', isSample: false };
  const x = sanitizeProspect(old);
  assert.equal(x.interviewDate, '2026-10-01');
  assert.equal(x.followUpDate, '2026-10-01');
  assert.equal(x.id, 'p_old');
  assert.equal(x.interviewNotes, 'keep me');
  assert.ok(hasUpcomingInterview(x, TODAY));
});

test('v0.1 localStorage payload loads unchanged under the same key', () => {
  const v01 = [{ id: 'p_1', company: 'Keep', contactName: '', email: 'keep@ex.com', phone: '', trade: 'HVAC', city: 'Norfolk', source: '', status: 'contacted', lastContactDate: '2026-09-22', followUpDate: '2026-09-29', painPoints: ['CRM not used'], interviewNotes: 'n', isSample: false }];
  const mem = new Map([[STORAGE_KEY, JSON.stringify(v01)]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const [x] = loadProspects(storage);
  assert.equal(STORAGE_KEY, 'cdd.prospects.v1');
  for (const k of Object.keys(v01[0])) assert.deepEqual(x[k], v01[0][k], k);
  assert.equal(x.interviewDate, '');
});

test('v0.1 CSV exports (without interviewDate column) still import', () => {
  const csv = 'id,company,contactName,email,phone,trade,city,source,status,lastContactDate,followUpDate,painPoints,interviewNotes,isSample\r\np_9,Legacy,,legacy@ex.com,,Roofing,Suffolk,,replied,2026-09-20,,Price shoppers,,false\r\n';
  const { added, errors } = importCsv(csv, []);
  assert.equal(errors.length, 0);
  assert.equal(added[0].company, 'Legacy');
  assert.equal(added[0].interviewDate, '');
});

test('interviewDate round-trips through CSV', () => {
  const { added } = importCsv(toCsv([p({ company: 'I', email: 'i@ex.com', status: 'interview_scheduled', interviewDate: '2026-10-02' })]), []);
  assert.equal(added[0].interviewDate, '2026-10-02');
});

test('company-name duplicates ignore punctuation, case and words like LLC', () => {
  assert.equal(normalizeCompany('The Summit Heating & Air, LLC'), normalizeCompany('summit heating and air'));
  const list = [p({ company: 'Summit Heating & Air' }), p({ company: 'Summit Heating and Air LLC' }), p({ company: 'Summit Roofing' })];
  assert.equal(similarCompanyIds(list).size, 2);
  assert.equal(findSimilarCompanies(list, 'SUMMIT HEATING & AIR INC', null).length, 2);
  assert.equal(findSimilarCompanies(list, 'Summit Heating & Air', list[0].id).length, 1);
  assert.equal(findSimilarCompanies(list, 'Co', null).length, 0);
});

test('interview insights report share of interviews and the supporting notes', () => {
  const list = [
    p({ company: 'A', status: 'interviewed', painPoints: ['No follow-up process'], interviewNotes: 'forgets' }),
    p({ company: 'B', status: 'interviewed', painPoints: ['No follow-up process', 'Price shoppers'] }),
    p({ company: 'C', status: 'replied', painPoints: ['Price shoppers'] }),
  ];
  const ins = interviewInsights(list);
  assert.equal(ins.total, 2);
  assert.equal(ins.withNotes, 1);
  assert.equal(ins.missingNotes.length, 1);
  assert.equal(ins.themes[0].painPoint, 'No follow-up process');
  assert.equal(ins.themes[0].share, 1);
  assert.deepEqual(ins.themes[0].evidence.map((e) => e.company), ['A', 'B']);
  assert.equal(ins.themes[1].count, 1); // the non-interview reply is not counted
  assert.equal(interviewInsights([]).total, 0);
});

test('pain-point filter and phone search', () => {
  const list = [p({ company: 'A', painPoints: ['Price shoppers'], phone: '757-555-0100' }), p({ company: 'B', painPoints: ['price SHOPPERS'] }), p({ company: 'C' })];
  assert.equal(filterProspects(list, { painPoint: 'Price shoppers' }, TODAY).length, 2);
  assert.equal(filterProspects(list, { search: '555-0100' }, TODAY)[0].company, 'A');
});

test('sorting: default puts due items first; explicit keys sort both ways', () => {
  const list = [
    p({ company: 'Later', status: 'contacted', followUpDate: '2026-10-05', lastContactDate: '2026-09-28' }),
    p({ company: 'Due', status: 'contacted', followUpDate: '2026-09-28', lastContactDate: '2026-09-21' }),
    p({ company: 'Alpha', status: 'queued' }),
  ];
  assert.equal(sortProspects(list, '', 'asc', TODAY)[0].company, 'Due');
  assert.deepEqual(sortProspects(list, 'company', 'asc').map((x) => x.company), ['Alpha', 'Due', 'Later']);
  assert.deepEqual(sortProspects(list, 'company', 'desc').map((x) => x.company), ['Later', 'Due', 'Alpha']);
  assert.equal(sortProspects(list, 'lastContactDate', 'desc')[0].company, 'Later');
  assert.equal(sortProspects(list, 'status', 'asc')[0].company, 'Alpha');
});

test('summary counts upcoming interviews; sample data exercises every new feature', () => {
  const data = buildSampleData(TODAY);
  const s = summarize(data, TODAY);
  assert.equal(s.upcomingInterviews, 1);
  assert.ok(s.dueFollowUps >= 2);
  assert.ok(similarCompanyIds(data).size >= 2);
  assert.ok(data.some((x) => x.status === 'followed_up' && isDue(x, TODAY)));
  assert.ok(data.every((x) => x.isSample && /\.example\.(com|org)$/.test(x.email)));
});
