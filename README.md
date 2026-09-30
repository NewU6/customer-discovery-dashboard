# Customer Discovery Dashboard

A small, local-first web app for running customer discovery with home-service businesses (HVAC, plumbing, roofing). It tracks prospects, outreach status, follow-up dates, interview notes, and the pain points that keep coming up.

**Version 1 stores everything in your browser (localStorage).** Nothing is sent to a server, and the app never sends email. You send outreach yourself from your own mail client and record the result here.

## What's new in 0.2

- **Today's actions:** follow-ups due and upcoming interviews in one list, with one-click **Intro sent**, **Follow-up sent**, **Snooze 2 days**, and **Close (no reply)**. Every quick change has **Undo**.
- **Follow-up dates fill themselves in** when the status changes:
  - *Contacted* sets last contact to today and the one follow-up 5 business days later.
  - *Followed up* sets a 5-business-day "close if no reply" check.
  - Replies, interviews, opt-outs, and closes clear the follow-up.
  - You can still edit any date.
- **Interview date** field, and an "Interviews booked" count.
- **Interview insights:** pain points shown as "*n* of *total* interviews." Click a pain point to see who said it and their notes. It also flags interviews with no notes.
- **Next step** and **Last contact** columns, plus sortable column headers.
- **Possible duplicates** now include similar company names (ignoring punctuation and words like "LLC" or "Inc") as a warning, alongside the hard duplicate-email block.
- Search now covers phone numbers. There's a pain-point filter, and funnel bars filter the table when clicked.
- **Compatible with 0.1:**
  - Same storage key (`cdd.prospects.v1`), and existing records load unchanged.
  - A 0.1 "interview scheduled" record's date is copied into the new interview date.
  - 0.1 CSV exports import fine.
  - New CSV columns are appended at the end.

## Features

- **Summary counts:** prospects, contacted, replied, reply rate, interviews done, follow-ups due, and duplicate emails.
- **Outreach funnel** by status (queued, contacted, followed up, replied, interview scheduled, interviewed, not interested, opted out, bounced, closed).
- **Recurring pain points:** a ranked count across all prospects, or interviewed prospects only.
- **Search and filters** by text, status, trade, follow-up due or upcoming, and duplicates only.
- **Add/edit form** with required company, email validation, duplicate-email blocking, a "+5 business days" follow-up helper, pain-point checkboxes plus free-text pain points, and interview notes.
- **Duplicate detection:** emails are compared case-insensitively. Duplicates are flagged in the table and blocked on save and on import.
- **CSV import/export.** Import skips rows whose email already exists and reports invalid rows. Export guards against spreadsheet formula injection.
- **Synthetic sample data**, clearly labeled. Every sample company starts with "Sample" and uses reserved `example.com`/`example.org` addresses, and it can be removed in one click.
- **Responsive layout.** The table becomes cards on phones, and dark mode follows your system setting.

## Run it

Requires [Node.js](https://nodejs.org/) 18 or newer. There are no dependencies to install.

```bash
npm start      # serves the app at http://localhost:5173
npm test       # runs the unit tests
```

Open http://localhost:5173. The first time, the app loads the synthetic sample data. Use **More → Remove sample data** before importing your own list.

Any static file server works too, for example `python -m http.server 5173`. Opening `index.html` directly from disk won't work, because browsers block ES modules loaded from `file://`.

## CSV format

Export produces these columns:

```
id,company,contactName,email,phone,trade,city,source,status,lastContactDate,followUpDate,painPoints,interviewNotes,isSample
```

Import is forgiving:
- Only a `company` or `email` column is required.
- Common header names are recognized (for example `Company`, `Email`, `Notes`, `Follow-up date`).
- Dates may be `YYYY-MM-DD` or `M/D/YYYY`.
- Multiple pain points are separated with `;`.

Valid statuses: `queued`, `contacted`, `followed_up`, `replied`, `interview_scheduled`, `interviewed`, `not_interested`, `opted_out`, `bounced`, `closed`.

## Privacy and data handling

- **Do not commit real prospect data, exported CSVs, mailbox contents, or credentials to this repository.** `.gitignore` excludes `*.csv`, `data/`, `exports/`, and `.env*` as a safety net.
- Browser data lives only on the machine and browser you used. Clearing site data deletes it, so export a CSV backup regularly and keep it outside the repo.
- The app has no email-sending features by design.

## Project layout

```
index.html            App shell
src/app.js            UI and event handling
src/logic.js          Pure logic: validation, dedupe, filters, summaries, CSV
src/sample-data.js    Synthetic sample prospects
src/storage.js        localStorage persistence
src/styles.css        Styles (responsive, light/dark)
scripts/serve.js      Zero-dependency static server for local use
test/logic.test.js    Unit tests (node --test)
```

## Possible next steps

- A shared backend (for example SQLite or a hosted database) if more than one person needs the same data.
- Interview templates and tagging by question.
- Export of the validation summary as a one-page report.
