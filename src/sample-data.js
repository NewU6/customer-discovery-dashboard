// SYNTHETIC SAMPLE DATA — every company, person and address below is made up.
// Emails use the reserved example.com / example.org domains so they can never reach anyone.
// Dates are relative to today so the follow-up views always have something to show.

import { addBusinessDays, sanitizeProspect, todayIso } from './logic.js';

function shift(days, from = todayIso()) {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function buildSampleData(today = todayIso()) {
  const rows = [
    { company: 'Sample Summit Heating & Air', contactName: 'Pat Sample', email: 'owner@summit-hvac.example.com', trade: 'HVAC', city: 'Norfolk', status: 'interviewed', lastContactDate: shift(-12, today), painPoints: ['No follow-up process', 'No time / no office staff'], interviewNotes: 'SAMPLE: About 30 estimates/month, maybe a third never book. Owner follows up only if he remembers. Would try a simple reminder list.' },
    { company: 'Sample Tidewater Plumbing Co.', contactName: 'Jordan Demo', email: 'office@tidewater-plumbing.example.com', trade: 'Plumbing', city: 'Virginia Beach', status: 'interviewed', lastContactDate: shift(-10, today), painPoints: ['Leads lost in texts/voicemail', 'No follow-up process'], interviewNotes: 'SAMPLE: Estimates live in the owner\'s phone. Office manager part-time. Says price shoppers are most of the no-books.' },
    { company: 'Sample Harbor Roofing', contactName: 'Casey Placeholder', email: 'estimates@harbor-roofing.example.com', trade: 'Roofing', city: 'Chesapeake', status: 'interview_scheduled', lastContactDate: shift(-6, today), followUpDate: shift(2, today), painPoints: ['Price shoppers'], interviewNotes: 'SAMPLE: Call booked. Ask about storm-season volume.' },
    { company: 'Sample Coastal Comfort HVAC', contactName: '', email: 'info@coastal-comfort.example.com', trade: 'HVAC', city: 'Hampton', status: 'contacted', lastContactDate: addBusinessDays(shift(-9, today), 0), followUpDate: shift(-2, today), painPoints: [], interviewNotes: '' },
    { company: 'Sample Bayside Drain & Pipe', contactName: 'Morgan Example', email: 'service@bayside-drain.example.com', trade: 'Plumbing', city: 'Portsmouth', status: 'contacted', lastContactDate: shift(-5, today), followUpDate: today, painPoints: [], interviewNotes: '' },
    { company: 'Sample Peninsula Roof Pros', contactName: '', email: 'hello@peninsula-roof.example.com', trade: 'Roofing', city: 'Newport News', status: 'followed_up', lastContactDate: shift(-14, today), painPoints: [], interviewNotes: 'SAMPLE: One follow-up sent. Close if no reply.' },
    { company: 'Sample Lighthouse Mechanical', contactName: 'Riley Test', email: 'riley@lighthouse-mech.example.com', trade: 'Multi-trade', city: 'Suffolk', status: 'replied', lastContactDate: shift(-4, today), followUpDate: shift(3, today), painPoints: ['Hard to track estimates', 'CRM not used'], interviewNotes: 'SAMPLE: Replied by email: "we use a CRM but nobody updates it." Offered a call.' },
    { company: 'Sample Oceanview Heating', contactName: '', email: 'contact@oceanview-heat.example.com', trade: 'HVAC', city: 'Norfolk', status: 'not_interested', lastContactDate: shift(-8, today), painPoints: ['Seasonal swings'], interviewNotes: 'SAMPLE: Said follow-up is handled by their office. Not interested.' },
    { company: 'Sample Colonial Plumbing Services', contactName: '', email: 'bounce@colonial-plumb.example.org', trade: 'Plumbing', city: 'Williamsburg', status: 'bounced', lastContactDate: shift(-7, today), painPoints: [], interviewNotes: '' },
    { company: 'Sample Seaside Exteriors', contactName: '', email: 'info@seaside-ext.example.com', trade: 'Roofing', city: 'Virginia Beach', status: 'queued', painPoints: [], interviewNotes: '' },
    { company: 'Sample Anchor Air Services', contactName: '', email: 'team@anchor-air.example.com', trade: 'HVAC', city: 'Chesapeake', status: 'queued', painPoints: [], interviewNotes: '' },
    { company: 'Sample Anchor Air (duplicate listing)', contactName: '', email: 'TEAM@anchor-air.example.com', trade: 'HVAC', city: 'Chesapeake', status: 'queued', painPoints: [], interviewNotes: 'SAMPLE: Deliberate duplicate email to demonstrate duplicate detection.' },
    { company: 'Sample Riverfront Plumbing', contactName: 'Avery Sample', email: 'avery@riverfront-plumb.example.com', trade: 'Plumbing', city: 'Hampton', status: 'interviewed', lastContactDate: shift(-15, today), painPoints: ['No follow-up process', 'Slow response to new leads'], interviewNotes: 'SAMPLE: Loses jobs by calling back a day late. Interested in same-day reminders more than old-estimate follow-up.' },
  ];
  return rows.map((r) => sanitizeProspect({ ...r, source: 'Synthetic sample data', isSample: true }));
}
