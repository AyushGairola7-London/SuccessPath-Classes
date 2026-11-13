# SuccessPath Classes: data entry app (version 1)

A web page your dad opens on his phone or laptop to record enquiries, admissions, fees, complaints
and teachers joining or leaving. Every entry goes into a database, is copied into a Google Sheet
within 5 minutes, and is backed up to Google Drive every night. It runs on free plans.

```
 Dad's phone or laptop                 (keeps entries if the internet drops, sends them later)
        │
        ▼
 Cloudflare: the web page + server ───► D1 database: the master copy
                                           • entries can never be deleted (wrong ones are "Cancelled")
                                           • every change is kept in a history table
                                           • can be rewound to any minute in the last 7 days
                       every 5 minutes │                        │ every night, about 2 AM India time
                                       ▼                        ▼
                    Google Sheet, one tab per form     Google Drive "SuccessPath Backups"
                    (repairs itself every night)       (.json database copy + .xlsx copy)
```

---

## Is it really free?

Yes. Cloudflare's Workers Free plan is a permanent free plan, not a trial, and Cloudflare says it
will always include the D1 database. It has daily limits instead of a time limit:

| Free plan limit (per day) | What this app uses |
|---|---|
| Opening the web page | Free and unlimited (it is a set of static files) |
| 100,000 requests to the server | 1 per saved entry, plus 288 a day for the Google Sheet check |
| D1 database: 5 million rows read, 100,000 rows written, 5 GB storage | A few rows per entry; the nightly backup reads every entry once |
| Time Travel (rewind the database) | Any minute in the last 7 days |

Even 200 entries a day uses well under 1% of these limits. If a limit were ever reached, saving would
pause until the next day (phones keep the entries and send them later). Nothing is ever charged
unless you choose to move to the paid plan yourself.

Google Sheets, Google Drive and Apps Script (the script inside the sheet) are free with any Google
account. The script uses a few minutes of Google's 90-minutes-a-day allowance for scheduled scripts.

---

## One-time setup (about 30 minutes, on your laptop)

You need: [Node.js](https://nodejs.org) (the LTS version), a free Cloudflare account
(sign up at dash.cloudflare.com, or during step 2), and a Google account.

### 1. Get the code ready

Unzip this folder, open a terminal in it, and run:

```
npm install
```

### 2. Log in to Cloudflare

```
npx wrangler login
```

A browser window opens. Log in (or sign up) and click Allow.

### 3. Create the database

```
npx wrangler d1 create successpath-db
```

It prints a `database_id` (a long code like `a1b2c3d4-...`). Open `wrangler.jsonc` and paste it in
place of `PASTE-YOUR-DATABASE-ID-HERE`. If Wrangler offers to update the config file for you, say no
and paste it yourself, so there is only one database entry in the file.

### 4. Create the tables

```
npm run db:setup
```

Type `y` when it asks to apply the migration.

### 5. Put the app online

```
npm run deploy
```

The first time, Cloudflare may ask you to choose a `workers.dev` subdomain. Pick something like
`successpath-dehradun`. When it finishes, it prints the app's link, for example:

```
https://successpath.successpath-dehradun.workers.dev
```

Open it. You should see the home screen with seven buttons.

### 6. Set the sync key

The sync key is a password that only the Google Sheet knows, so nobody else can read the data.

```
npm run make-key
npx wrangler secret put SYNC_KEY
```

Copy the key printed by the first command, and paste it when the second one asks. Save the key in
your password manager; you need it again in step 7.

### 7. Connect the Google Sheet

1. Go to [sheets.new](https://sheets.new) and name the spreadsheet, for example *SuccessPath Classes records*.
2. Click **Extensions > Apps Script**. Delete the code you see, paste everything from
   `google-sheet/Code.gs`, and click **Save**.
3. Go back to the spreadsheet tab and reload the page. A **SuccessPath** menu appears next to Help
   (it can take a few seconds).
4. Click **SuccessPath > Connect to the app**. Google asks for permission:
   **Continue** > choose your account > *"Google hasn't verified this app"* > **Advanced** >
   **Go to … (unsafe)** > **Allow**. This warning appears because the script is your own and not
   published in Google's store; it only runs in your account.
5. Click **SuccessPath > Connect to the app** again. Paste the app link from step 5, then the sync key
   from step 6.

The tabs (Fees, Enquiries, Students, Students Left, Teachers, Teachers Left, Complaints) and an
**About** tab appear. From now on the script runs by itself.

### 8. Test it

1. On your phone, open the link and save a test enquiry. You get a stamp like **ENQ-0001 Saved**.
2. In the sheet, click **SuccessPath > Sync now**. The enquiry is in the Enquiries tab.
3. On the phone, tap the entry under *Saved on this device* > **Mark as cancelled** > reason "test".
4. **Sync now** again. The row is now greyed out and marked Cancelled.

Test entries stay in the records as Cancelled; that is how every correction works.

---

## Sharing it with your dad

Yes, it is a normal web link (the one from step 5). Send it to him on WhatsApp.

- **Android phone (Chrome):** open the link, tap the **⋮** menu, choose **Add to Home screen** or
  **Install app**. An app icon appears on his phone.
- **iPhone (Safari):** open the link, tap **Share**, choose **Add to Home Screen**.
- **Laptop (Chrome or Edge):** open the link and click the install icon in the address bar, or just
  bookmark it.

When you update the app, he gets the new version automatically the next time he opens it. Nothing
to reinstall.

A message you can send him:

> Papa, this is the SuccessPath app for our entries: *(link)*
> Open it in Chrome, tap the three dots ⋮ and choose "Add to Home screen".
> Then tap a button (Fee received, New enquiry, and so on), fill it in and press Save.
> If there is no internet, it keeps the entry and sends it by itself later.

If he wants to see the records too, share the Google Sheet with him as a **Viewer**
(Share button, top right of the sheet).

### Daily use, in short

- Tap a button, fill in the form, press **Save**. The stamp shows the entry number, for example
  **FEE-0012**. For fees, that can go on the paper receipt.
- Fields with a red * must be filled in. Anything else can be left empty.
- If he leaves a form half-filled (a phone call, say), it is still there when he comes back.
- **No internet?** The entry is kept on the phone and the top of the screen says "1 waiting". It is
  sent by itself when the internet is back.
- **Made a mistake?** On the home screen, under *Saved on this device*, tap the entry >
  **Mark as cancelled** > write why > **Enter it again correctly**. The form opens with the old
  details filled in, so only the wrong part needs fixing.

---

## Where the data is, and how to download it

| Copy | How to get it |
|---|---|
| Google Sheet | Open it; **File > Download > Microsoft Excel (.xlsx)** at any time |
| Nightly backups | Google Drive folder **SuccessPath Backups**: a `.json` copy of the database and a `.xlsx` copy of the sheet. Daily copies are kept for 60 days; the copy from the 1st of every month is kept for good |
| Full database, including the history | `npm run backup` saves an `.sql` file in the `backups` folder |
| Live database | Cloudflare dashboard > **Storage & Databases > D1** > successpath-db > **Console**, where you can run SQL |

The code is yours too: it is this folder. Keep a copy in a private GitHub repository so you never
lose it.

---

## If data is deleted or changed by mistake

| What happened | What to do |
|---|---|
| Rows deleted or typed over in the Google Sheet | Nothing. The sheet repairs itself every night. To repair it now: **SuccessPath > Rebuild all tabs from the database** |
| A tab or the whole spreadsheet deleted | A deleted tab comes back at the next sync (within 5 minutes). For a deleted spreadsheet, restore it from the Google Drive bin, or make a new one and do step 7 again: it fills itself from the database |
| A wrong entry was saved | **Mark as cancelled** on the device that saved it. From your laptop, see "Cancelling an entry yourself" below |
| A bad command was run on the database | Deletes are refused by the database itself, and every change is kept in `entry_history`. To rewind the whole database to a moment in the last 7 days: `npx wrangler d1 time-travel restore successpath-db --timestamp=2026-11-13T18:00:00+05:30` (it prints how to undo the rewind) |
| The database is lost | Make a new one (steps 3 and 4, then `npm run deploy`), download the latest `SuccessPath database … .json` from Drive, and run `npm run restore -- "SuccessPath database 2026-11-13 0200.json" --run`. It only adds missing entries, so it is safe to run twice. Entries saved after that backup are still in the Google Sheet |

### Cancelling an entry yourself

A device can only cancel the entries it saved. To cancel any entry, open the D1 **Console** in the
Cloudflare dashboard (see above) and run, with the right entry number and reason:

```sql
UPDATE entries
SET status = 'Cancelled', cancel_reason = 'Wrong amount',
    cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE code = 'FEE-0012';
```

The change is recorded in the history and reaches the sheet at the next sync.

---

## Updating the app

**Change or add a form field:** open `public/forms.js` (the instructions are at the top), edit it,
then run:

```
npm run deploy
```

The check before deploying stops with a clear message if something in the file is wrong. The
database needs no change, and the Google Sheet adds the new column by itself within 5 minutes
(it rebuilds the tabs when the forms change).

**Try a change on your laptop first:**

```
npm run try
```

Then open http://localhost:8787. This uses a test database file in this folder (`local-test.sqlite`),
so nothing real is touched and no Cloudflare login is needed. (`npm run db:setup:local` and then
`npm run dev` does the same with Cloudflare's own local runtime.)

**Run the tests:** `npm test`

**Undo a bad update:** `npx wrangler rollback` puts the previous version back.

**Change the Google Sheet script:** paste the new `Code.gs` into Apps Script and click Save. It is
used from the next run; nothing else to do. Settings such as how often it checks
(`SYNC_EVERY_MINUTES`) are at the top of that file.

---

## About having no login

- The page can only **add** entries. It never shows stored data, so nobody can read your records
  through the link. Reading needs the Google Sheet (your Google login) or Cloudflare (your login).
- Anyone who has the link could add entries. The page is hidden from Google search; just keep the
  link in the family. A spam trap on the page stops robots.
- When you want a login (for staff, say), Cloudflare Access can be switched on without code changes:
  Cloudflare dashboard > Workers & Pages > successpath > Settings > Domains & Routes >
  **Enable Cloudflare Access**. Cloudflare's Zero Trust free plan covers small teams. Add a bypass
  for `/api/sync` and `/api/export`, which the Google Sheet uses with its own key.

---

## What is in this folder

```
public/                 the web page your dad uses
  forms.js              all the forms and their fields: edit this to change what is asked
  app.js                how the page works (saving, offline queue, cancelling)
  styles.css            how the page looks
  index.html, sw.js, manifest.webmanifest, icons/   app shell, offline support, home-screen icon
src/worker.js           the server: checks and saves entries, gives the sheet its feed
migrations/             the database tables, delete protection and history
google-sheet/Code.gs    the script you paste into the Google Sheet
scripts/                helpers: make-key, backup, restore, check-forms
test/                   tests, and the local test server behind `npm run try`
wrangler.jsonc          Cloudflare settings (put the database_id here)
```

---

## When something does not work

| You see | What to do |
|---|---|
| "The database is not set up yet" | Run `npm run db:setup` |
| The sheet says "The sync key is wrong" | Run `npx wrangler secret put SYNC_KEY` again, then **SuccessPath > Connect to the app** with the same key |
| No SuccessPath menu in the sheet | Reload the spreadsheet. Still missing: in Apps Script, choose `onOpen` and click Run |
| New entries do not reach the sheet | **SuccessPath > Show status** shows the last problem. In Apps Script, **Executions** (left side) lists every run and its errors |
| The phone keeps saying "waiting" while online | Open `https://your-link/api/health` in a browser. It should say `"ok":true` |
| Dad sees an old version | Close the app fully and open it again while online |

Server logs: Cloudflare dashboard > Workers & Pages > successpath > **Logs**.

---

## Ideas for version 2

WhatsApp receipts, a login for staff, a student list with fees due, editing entries, and simple
reports (fees per month, enquiries that became admissions). The structure is ready for these:
the history table already records every change, and `forms.js` drives the page, the checks and the
sheet together.
