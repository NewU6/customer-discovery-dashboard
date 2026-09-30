import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THRESHOLDS, importCsv, normalizeSignal, sanitizeProspect, sanitizeThresholds, scorecardMarkdown,
  toCsv, validationScorecard,
} from '../src/logic.js';
import { buildSampleData } from '../src/sample-data.js';
import { loadProspects, loadSettings, saveSettings, SETTINGS_KEY, STORAGE_KEY } from '../src/storage.js';

const p = (o) => sanitizeProspect(o);
const interviews = (n, extra = {}) => Array.from({ length: n }, (_, i) => p({ company: `Co ${i}`, email: `c${i}@ex.com`, status: 'interviewed', ...extra(i) }));
const T = { minInterviews: 4, painShare: 0.5, listShares: 2, pilotYes: 1 };

test('signals normalize common spellings and default to not asked', () => {
  assert.equal(normalizeSignal('Y'), 'yes');
  assert.equal(normalizeSignal('Maybe'), 'maybe');
  assert.equal(normalizeSignal('false'), 'no');
  assert.equal(normalizeSignal('whatever'), '');
  assert.equal(p({ company: 'X' }).sharesList, '');
});

test('thresholds are sanitized', () => {
  assert.deepEqual(sanitizeThresholds({}), DEFAULT_THRESHOLDS);
  assert.deepEqual(sanitizeThresholds({ minInterviews: '6.6', painShare: 3, listShares: -1, pilotYes: 'x' }), { ...DEFAULT_THRESHOLDS, minInterviews: 7, painShare: 1 });
});

test('verdict: not enough interviews', () => {
  assert.equal(validationScorecard(interviews(3, () => ({})), T).verdict, 'not_enough');
});

test('verdict: continue when pain is shared and owners commit', () => {
  const list = interviews(4, (i) => ({ painPoints: ['No follow-up process'], sharesList: i < 2 ? 'yes' : 'no', pilotInterest: i === 0 ? 'yes' : '' }));
  const card = validationScorecard(list, T);
  assert.equal(card.verdict, 'continue');
  assert.ok(card.checks.every((c) => c.met));
  assert.equal(card.metrics.topPainShare, 1);
});

test('verdict: pivot when pain is shared but nobody commits', () => {
  const list = interviews(4, () => ({ painPoints: ['Slow response to new leads'], sharesList: 'no', pilotInterest: 'maybe' }));
  assert.equal(validationScorecard(list, T).verdict, 'pivot');
});

test('verdict: stop when no shared pain and no commitments', () => {
  const pains = ['A', 'B', 'C', 'D'];
  const list = interviews(4, (i) => ({ painPoints: [pains[i]], sharesList: 'no', pilotInterest: 'no' }));
  assert.equal(validationScorecard(list, T).verdict, 'stop');
});

test('commitments from replies (not just interviews) count toward lists and pilots', () => {
  const list = [...interviews(4, () => ({ painPoints: ['X'] })), p({ company: 'R1', email: 'r1@ex.com', status: 'replied', sharesList: 'yes', pilotInterest: 'yes' }), p({ company: 'R2', email: 'r2@ex.com', status: 'replied', sharesList: 'yes' })];
  const card = validationScorecard(list, T);
  assert.equal(card.metrics.listYes, 2);
  assert.equal(card.verdict, 'continue');
});

test('markdown report includes verdict, checks and quotes', () => {
  const list = interviews(4, (i) => ({ painPoints: ['No follow-up process'], interviewNotes: i === 0 ? 'We  never\ncall back.' : '', sharesList: 'yes', pilotInterest: 'yes' }));
  const md = scorecardMarkdown(validationScorecard(list, T), '2026-09-29');
  assert.match(md, /^# Customer discovery scorecard \(2026-09-29\)/);
  assert.match(md, /\*\*Verdict: Continue\.\*\*/);
  assert.match(md, /- \[x\] At least 4 interviews: 4/);
  assert.match(md, /Co 0 \(HVAC\): We never call back\./);
  assert.match(md, /3 interview\(s\) have no notes recorded/);
});

test('new fields round-trip through CSV and older CSVs still import', () => {
  const { added } = importCsv(toCsv([p({ company: 'S', email: 's@ex.com', sharesList: 'yes', pilotInterest: 'maybe' })]), []);
  assert.equal(added[0].sharesList, 'yes');
  assert.equal(added[0].pilotInterest, 'maybe');
  const old = importCsv('company,email,status\nOld,old@ex.com,replied\n', []);
  assert.equal(old.added[0].sharesList, '');
});

test('settings are stored under their own key and never touch prospect data', () => {
  const mem = new Map([[STORAGE_KEY, JSON.stringify([{ id: 'p1', company: 'Keep', email: 'k@ex.com' }])]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadSettings(storage), {});
  saveSettings({ thresholds: T }, storage);
  assert.deepEqual(loadSettings(storage).thresholds, T);
  assert.equal(loadProspects(storage)[0].company, 'Keep');
  assert.notEqual(SETTINGS_KEY, STORAGE_KEY);
  mem.set(SETTINGS_KEY, '{bad');
  assert.deepEqual(loadSettings(storage), {});
});

test('sample data gives an honest "keep interviewing" verdict', () => {
  const card = validationScorecard(buildSampleData('2026-09-29'));
  assert.equal(card.verdict, 'not_enough');
  assert.equal(card.metrics.interviews, 3);
  assert.equal(card.metrics.listYes, 2);
});
