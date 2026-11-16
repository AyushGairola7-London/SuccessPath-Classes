# SuccessPath Classes: data entry app (version 3.1)

A web page your dad opens on his phone or laptop to record enquiries, admissions, fees, marks,
exam dates, complaints, teacher and other payments, and teachers joining or leaving, with a Tasks
board for what to do next. Every entry goes into a database, is copied into a Google Sheet within
5 minutes, and is backed up to Google Drive every night. It runs on free plans.

## New in version 3.1: leave requests, notifications and two-way messages

- **Teachers ask for leave in their portal.** The teacher portal has a new **Leave** tab: *Request
  leave* (first day, last day, reason, a note for the office), their requests with what the office
  answered, their approved leave, the holidays, and the **leave calendar**: how many teachers are
  free each day, with their own leave marked *You* and the days they asked for outlined until the
  office answers. Other teachers' reasons and notes stay private; only the office sees them. A
  teacher can withdraw a request that is still waiting. Requests are numbered LRQ-0001 and so on,
  are never deleted, and a request for days already asked for or already booked is refused.
- **The office approves or declines.** A new request shows straight away in the **bell** at the top
  of the office app, with **Approve** and **Decline**, at the top of the **Teachers** page (with a
  count on the Teachers tab) and on the teacher's page. Approving saves ordinary Teacher leave (it
  shows on the calendar, in the teacher's history and in the *Teacher Leave* tab of the sheet, with
  the request's number). Declining asks for an optional note, and needs a second tap in the bell.
  The teacher sees the answer in their bell and on their Leave tab. Leave the office books itself
  works as before.
- **A bell at the top of all three apps** shows what is new: in the office, leave requests waiting,
  messages from students and exam dates students added; for a teacher, messages from students, the
  answers to their leave requests, tasks given to them and exam dates; for a student, replies from
  teachers, new marks and exam dates. A number on the bell says how many are new since it was last
  opened, and it checks again every minute while the app is open.
- **Messages are conversations now.** The teacher and student portals each have a **Messages** tab:
  one line per student (or teacher) with the last message and how many are unread, and inside it
  every message sent and received, oldest first, with what each was about (*Complaint*, *Help with a
  topic* and so on). Teachers can reply, and can start a conversation with any current student.
  The old *Enquiries* tab is gone: exam dates coming up are at the top of the teacher's Students
  tab, and the teacher's Me tab now only has their details (leave moved to the Leave tab).
- In the office app, each student's and teacher's page shows **Portal messages** in both directions
  ("Rahul Sharma to Anita Negi", "Anita Negi to Rahul Sharma"). The *Portal Messages* tab of the
  Google Sheet gets a **Sent by** column (empty for messages sent before 3.1, which all came from
  students).

### Moving your live app to version 3.1

In the successpath-app folder, in this order:
```
npm run db:setup
npm run deploy
```
`db:setup` applies `migrations/0007_leave_and_messages.sql` (the leave requests and what each
person has read). There are no new secrets and nothing to change in Google Sheets. Phones pick up
the new version the next time the app is opened online; if one still looks old, close the app fully
and open it again.

## New in version 3.0: logins, and portals for teachers and students

- **Office login.** Once you set an office password (see below), the app asks for it once on each
  phone or laptop and then remembers it for a year. Until it is set, everything works as before and
  the portals stay closed, so nothing can be seen by accident. **Log out of this phone** is at the
  bottom of Home. Entries waiting on a phone are kept, and sent after logging in.
- **Teacher portal**, at `https://<your app link>/teacher`:
  - **Students**: *My students* (the classes written in the teacher's *Classes or batches*, such as
    "Class 9, 10" or "IX-X") or *All* current students. Tap one to see their marks, exam dates and
    the messages they sent this teacher.
  - **Enquiries**: what students sent this teacher (complaints, topics they need help with, notes,
    special requirements), and exam dates for the next six months.
  - **Tasks**: the same Tasks board as the office. Each task shows who changed it last.
  - **Me**: their own details, leave and holidays.
- **Student portal**, at `https://<your app link>/student`: their details, subjects, marks, exam
  dates (their own and their class's) and their teachers. They can **send a teacher a message**
  (Complaint, Help with a topic, Notes for the teacher, Special requirement or Other; typed text
  only), which only that teacher and the office see, and **add an exam date** for their teachers.
- **Usernames** are the name and the year they joined, in small letters without spaces: Rahul Sharma,
  admitted in 2026, is `rahulsharma2026`. Two people with the same name and year get `-2` added.
  The **password is `1234`** for everyone. Each student's and teacher's page in the office app shows
  their username and password, with **Send login details** and **WhatsApp** buttons. Only current
  students and teachers can log in; enquiries, demo students and anyone who left cannot.
- **The portals never show** phone numbers, addresses, fees, salaries or payments, or the Analytics
  page. A teacher sees only the messages sent to them.
- **One shared password is easy to guess.** Anyone who knows a student's name and joining year could
  open that student's portal page (marks and exam dates). To use your own shared password instead
  of 1234: `npx wrangler secret put PORTAL_PASSWORD`.
- **Tasks** now have a start date, an end date (what was *Due on*), a budget (₹) and an owner. The
  Tasks tab of the Google Sheet gets these columns and *Last changed by*.
- Messages from students are kept like every entry (MSG-0001 and so on, never deleted). They show on
  the student's page (*Messages to teachers*), on the teacher's page (*Messages from students*) and
  in a new **Portal Messages** tab of the Google Sheet. Exam dates a student adds say *Added by the
  student*.

### Moving your live app to version 3.0

1. Choose the office password. Papa types it once per phone, so make it easy for him to type, and at
   least 8 characters. In the successpath-app folder:
   ```
   npx wrangler secret put ADMIN_PASSWORD
   ```
   and type it when asked.
2. Then, in this order:
   ```
   npm run db:setup
   npm run deploy
   ```
   `db:setup` applies `migrations/0006_portals.sql` (and `0005`, if you skipped version 2.6).
3. Paste the new `google-sheet/Code.gs` into Apps Script and click **Save**, if you have not since
   version 2.5.1.
4. Open the app: it asks for the office password once. Then send each teacher their login from
   their page (**Send login details** or **WhatsApp**).

To change the office password, run the same `secret put` command again: every phone, teacher and
student then logs in again. To switch logins and the portals off: `npx wrangler secret delete ADMIN_PASSWORD`.

## New in version 2.6

- **Students now go Enquiry → Demo → Full admission, on one record.**
  - **New enquiry** adds the student to Students as an **Enquiry**. They are not counted as active
    students and no fee is due from them. The Students list has **Enquiry** and **Demo** next to
    Active, Left and All.
  - On an enquiry's page, **Move to demo** records their demo classes: from which date, the
    subjects or batch, and with which teacher. They move to **Demo**.
  - After the demo, **Full admission** opens *New admission* already filled in with what is known.
    Saving it makes them an active student, with the same STU number.
  - **Did not join** (on an enquiry's or demo student's page) marks them as left, with the reason
    *Did not join*. **Edit details** can also move someone between Enquiry, Demo and Student.
- **One record per full name.** A typed name that is already in Students (or Teachers) always goes
  onto that record, whatever the class or phone number; capital letters and extra spaces do not
  matter. Two different students with the same full name need something extra in one of the names,
  such as a surname or an initial. **Edit details** refuses a name someone else already has.
- **One admission per student.** A second *New admission* for a student who is already admitted is
  refused, with a message pointing to Edit details. Rejoining after leaving still works, and so does
  the admission form for a student first added by a fee. *New teacher* works the same way.
- Enquiries saved before this version are added to Students as enquiries, or linked to the student
  who has that name. On the Analytics page, "X of Y enquiries joined" counts each enquirer once and
  says how many are in demo classes now. The Google Sheet gets a **Demo Classes** tab.

### Moving your live app to version 2.6

This version changes the database again, so run both, in this order:

```
npm run db:setup
npm run deploy
```

`db:setup` applies `migrations/0005_demo_and_one_name.sql`: it lets students be in Demo (the same
safe copy-and-swap of the people table as version 2.5), and if two records ever had the same full
name, the later one gets its ID added to its name, for example "Rahul Sharma (STU-0012)", so nothing
is lost and you can rename it. (Your list has no doubles today, so nothing is renamed.) Paste the new
`google-sheet/Code.gs` into Apps Script too, if you have not since version 2.5.1.

## New in version 2.5

- **Teacher enquiries.** The new *Teacher enquiry* tile (under Teachers) records someone who asked
  about teaching or came for an interview: phone, subjects, classes, qualification, experience,
  salary asked for, how they heard, outcome (Not hired, Maybe later, Interview planned) and notes.
  They are kept in the Teachers list as an **enquiry**, not as a teacher: they are not counted on the
  Analytics page and are not on the leave calendar. Tap **Enquiries** above the Teachers list to see
  them all.
- **Hire** on an enquiry's page opens the New teacher form already filled in (name, phone, subjects,
  classes, qualification, and the salary they asked for). Saving it makes them a teacher with the
  same TR number, keeping what was noted at the enquiry.
- Someone added as a teacher who was never hired can be moved: **Edit details > In the teacher list
  as > Enquiry, not hired** (and back the same way).
- **Money returned.** When a student leaves and part of the fee is given back, record it with
  **Money returned** on the student's page, the *Money returned* tile, or the **Record money
  returned** button that appears after saving *Student left*. Type the amount given back (6000). A
  fee typed with a minus sign (-6000 in *Fee received*) is saved as money returned too.
- Money returned counts as **money paid out**, like teachers' pay. It is never taken off the fees
  collected. The student's page shows, for example, "₹17,000 paid in 1 payment. ₹6,000 returned.",
  with the returned amount in red in the list. On the Analytics page it is part of *Paid out* and has
  its own colour in the chart, and the nightly email lists it with the payments made.
- The Google Sheet gets **Refunds** and **Teacher Enquiries** tabs, a *Money returned* column on the
  Students tab, and *Experience* and *Salary asked for* on the Teachers tab.
- The bottom of every page now scrolls clear of the tab bar, so the last buttons (such as Book leave
  and Add holiday under the calendar) are no longer hidden behind it.

### Moving your live app to version 2.5

This version changes the database (to allow the new *Enquiry* status), so run both, in this order:

```
npm run db:setup
npm run deploy
```

`db:setup` applies only the new step, `migrations/0004_teacher_enquiries.sql`. It rebuilds the
people table with every student and teacher, their numbers and their history unchanged. (If a
teacher enquiry is saved before this step, the phone keeps it as *waiting* and sends it once the
database is updated.) Then paste the new `google-sheet/Code.gs` into Apps Script and click **Save**.

Already moved to 2.5.0? Version 2.5.1 counts money returned as paid out instead of taking it off the
fees collected. Run `npm run deploy` and paste `Code.gs` again; the database needs nothing.

## New in version 2.4

- **Edit details** on every student's and teacher's page: name, enrollment number, class, phone
  numbers, father or guardian, school, subjects, fee agreed and fee plan (students), subjects,
  classes, salary and qualification (teachers), admission or joining date, the date they left, and
  the address. Empty a box to remove that detail. Tap **Undo** in the message after saving to put the
  old details back.
- Changes go straight into the register, so this page needs the internet. The database keeps every
  earlier version in its history (`people_history`), and the Students and Teachers tabs of the Google
  Sheet update at the next sync. Entries already saved (fees, marks and so on) keep the name they
  were saved with.
- If two people change the same student at the same time, the second save is stopped with a message
  instead of quietly overwriting the first.
- Analytics: **Money in and out** now shows the whole session from April (and at least the last 6
  months), so April and May fees are on the chart.

To update: `npm run deploy`. Nothing else is needed.

## New in version 2.3

- **Add student** and **Add teacher** buttons at the top of the Students and Teachers pages.
- **Mark as left** on a student's or teacher's page opens the Student left (or Teacher left) form,
  already filled in. Someone who has left gets a **Rejoined** button instead.
- **Teacher leave:** **Book leave** on a teacher's page, or the *Teacher leave* tile: from, to (empty
  for one day), reason and notes. The teacher's page lists their leave, shows the next one, and counts
  the days of leave since 1 April.
- **Holidays:** the *Holiday* tile (under Other) marks days the institute is closed, such as a Diwali
  break.
- **Leave calendar** at the bottom of the Teachers page. A day with leave shows how many teachers are
  free (for example 3/4); a holiday shows *Closed*. Tap a day to see who is on leave and why, and who
  is free. Teachers on leave today have an *On leave* badge in the list.
- **Enrollment number** on the admission form (the number in the paper register). It shows on the
  student's page, in the Students list and in the Students tab, and the list can be searched by it.
- A student whose **one-time or yearly fee** is paid no longer shows as *Due* every month.
- The nightly email's *Coming up this week* also lists holidays and teachers on leave.
- Google Sheet: new **Teacher Leave** and **Holidays** tabs, and an **Enrollment no.** column on the
  Students tab.

### Moving your live app to version 2.3

```
npm run deploy
```

There is no database change this time (if you skipped version 2.2, run `npm run db:setup` first).
Then paste the new `google-sheet/Code.gs` into Apps Script and click **Save**.

### Teachers and their leave

The office books leave. Since version 3.1, teachers can also ask for leave in the teacher portal
(*Leave*), and the office approves or declines it; they see their own leave, the holidays and how many
teachers are free each day there, without the fees, salaries or Analytics of the office app.

## New in version 2.2

- **Nothing is mandatory.** Every form saves with whatever is filled in. Only a completely empty
  form is refused, and a cancellation no longer needs a reason.
- **Other payment** form (under *Payments made*): rent, electricity, stationery, advertising and
  anything else that is not a teacher's pay. It has its own **Other Payments** tab, and the
  Analytics page shows money in and out with three series: fees, teachers and other payments.
- **Exam dates** form: the dates of a school exam (half-yearly, annual, unit test and so on) for one
  student, or for a whole class by leaving the student empty and choosing the class and school.
  A student's page lists their own exam dates and the ones saved for their class (same class, and
  the same school or no school given), with an **Exam dates** button.
- **Add marks** now has an **Exam** choice, so half-yearly results are labelled.
- **Tasks board** (the new **Tasks** tab at the bottom): write what needs doing next, such as
  "Hire a maths teacher" or "Market the crash course", with an optional due date, who is doing it,
  and notes. Tasks move from **To do** to **Doing** to **Done** with one tap (Start, Mark done), and
  a done task gets a Done stamp. Tap a task to edit it, move it back, or remove it from the board.
  On a laptop the three columns sit side by side and cards can be dragged between them. Late tasks
  are marked in red. Above the board, **Exams in the next 45 days** lists the coming exam dates.
- Tasks are never deleted: "Remove from board" only hides them. The Google Sheet has a **Tasks** tab
  with every task, removed ones included, and they are in the nightly backup.
- The nightly email has a **Coming up this week** list: late tasks, tasks due in the next 7 days, and
  exams starting in the next 7 days.

### Moving your live app to version 2.2 (about 5 minutes)

In this folder, in the terminal:

```
npm run db:setup
npm run deploy
```

The first command adds the Tasks table to the database (type `y` when it asks). Run it **before**
`npm run deploy`. Then, in the Google Sheet: **Extensions > Apps Script**, select everything in
`Code.gs`, paste the new `google-sheet/Code.gs` over it, and click **Save**. The new tabs (Exam Dates,
Other Payments, Tasks) appear within 5 minutes, or straight away with **SuccessPath > Rebuild all tabs
from the database**. No new permissions are needed.

## New in version 2

- **One record per student and per teacher.** When a fee is saved, the app checks whether the
  student is already in the register. If not, it adds them (STU-0001, STU-0002, …); if they are,
  the fee goes onto their record. Admissions, "Student left", marks and notes go onto the same
  record, so nobody is stored twice. Teachers work the same way (TR-0001, …) with their payments.
- **Name suggestions.** As you type a name on a form, the app suggests people already in the
  register. Tap one to save onto that record.
- **Students and Teachers pages:** search and filter the list, then open anyone to see their
  details, fee or payment history, marks and notes, with buttons to add a fee, marks or a note.
- **Analytics page:** fees collected and paid out per month, who has not paid this month (with a
  call button), students by class, where enquiries come from and how many joined, marks that
  dropped, why students left, and complaints.
- **Teacher payment** form, **Add marks** form, and notes on any student or teacher.
- **Google Sheet:** new **Students** and **Teachers** tabs (one row per person with their totals),
  and a Student ID or Teacher ID column on the entry tabs. The tab that listed admissions is now
  called **Admissions**, and the one for new teachers is **Teachers Joined**.
- **Nightly email** to gairolaayush99@gmail.com with the day's new entries, cancellations and the
  month's totals so far. (Change `EMAIL_TO` at the top of `google-sheet/Code.gs`.)

### Moving your live app to version 2 (about 5 minutes)

In this folder, in the terminal:

```
npm run db:setup
npm run deploy
```

The first command adds the student and teacher registers to the database and builds them from the
entries you have already saved. Type `y` when it asks. Run it **before** `npm run deploy`.

Then update the Google Sheet:

1. **Extensions > Apps Script**, select everything in `Code.gs`, paste the new
   `google-sheet/Code.gs` over it, and click **Save**.
2. Back in the sheet, reload the page, then click **SuccessPath > Email today's entries now**.
   Google asks for permission again, because the script now sends email: allow it the same way as
   before (Advanced > Go to … > Allow), then click the menu item once more. The email should arrive
   within a minute, and the scheduled runs (sync, backup and email) keep working from then on.
3. The tabs rebuild themselves within 5 minutes. To do it straight away: **SuccessPath > Rebuild all
   tabs from the database**.

### Adding the records you already have

`Existing data template.xlsx` (in the SuccessPath Application folder, outside this code folder so
student details never go to GitHub) has a tab each for students, fees paid, teachers, teacher
payments and marks. Fill in what you have; only names matter, everything else is optional. Every
row is checked first and you see a summary before anything is added. The rows are then saved
through the app like normal entries, so students are matched by the rules below and nobody is
added twice, and running the same file again adds nothing new.

### How the app decides it is the same student

- A student **picked from the suggestions** is always used.
- A **typed** name is the student who has that full name (capital letters and extra spaces are
  ignored), whatever their class or phone number. Only a name nobody has makes a new record. The
  database itself refuses a second record with the same full name (since version 2.6).
- Two different students who share a full name: write something extra in one of the names, such as
  a surname, an initial or the father's name.
- If a fee is cancelled and it was the only thing that added a mistyped name, that name is hidden from
  the register again. If the same entry is entered again correctly, it goes back onto the same record.

### Who can see the records

Until the office password is set, anyone with the app link can see the student list, fees, marks and
analytics, so keep the link in the family. Once it is set (version 3, see "Logins" below), every
office page asks for it, and teachers and students only see their own portals.

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

A tab for each form (Fees, Enquiries, Admissions, Marks, Students Left, Teacher Payments,
Teachers Joined, Teachers Left, Complaints, Notes), the **Students** and **Teachers** registers, and an
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
- Nothing is mandatory: fill in what you know and leave the rest empty. Only a completely empty
  form is refused. (To make a field mandatory, add `required: true` to it in `public/forms.js`.)
- **Tasks:** type the next job in *Add a task* and press **Add**. **Start** moves it to Doing,
  **Mark done** stamps it Done, and **Undo** at the bottom puts it back if tapped by mistake.
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

## Logins

- **Before an office password is set** (versions 2 and 2.x), the Students, Teachers and Analytics
  pages show stored data to anyone who has the link, and the portals are closed.
- **With the office password set** (`npx wrangler secret put ADMIN_PASSWORD`, version 3), every
  office page needs the office login, and teachers and students can use their portals. Logins are
  kept by the browser (180 days for the portals, a year for the office) in a cookie the page itself
  cannot read. After 10 wrong office passwords (30 for the portals) from one place, logging in
  stops for 15 minutes.
- The Google Sheet keeps using its own sync key; logins do not affect it.
- The page is hidden from Google search, and a spam trap on the forms stops robots.

---

## What is in this folder

```
public/                 the web page your dad uses
  forms.js              all the forms and their fields: edit this to change what is asked
  app.js                picks the screen to show
  entry.js              home screen, forms, name suggestions, saving, offline queue, cancelling
  people.js             Students and Teachers screens
  tasks.js              Tasks board and the exams coming up
  calendar.js           leave and holiday calendar (Teachers page, and the teacher portal's Leave tab)
  leave.js              approving and declining leave requests in the office app
  edit.js               Edit details page for a student or teacher
  analytics.js          Analytics screen
  login.js              the login screen (office, teachers, students)
  portal.js             the teacher and student portals; teacher/ and student/ are their pages
  lib.js                small helpers shared by the screens
  styles.css            how the page looks
  index.html, sw.js, manifest.webmanifest, icons/   app shell, offline support, home-screen icon
src/worker.js           the server: checks and saves entries, gives the sheet its feed
migrations/             the database tables, delete protection, history, registers, Tasks board,
                        teacher enquiries, student demo classes, one record per name, portals,
                        leave requests and read markers
google-sheet/Code.gs    the script you paste into the Google Sheet
scripts/                helpers: make-key, backup, restore, check-forms
test/                   tests, and the local test server behind `npm run try`
wrangler.jsonc          Cloudflare settings (put the database_id here)
```

---

## When something does not work

| You see | What to do |
|---|---|
| A teacher enquiry stays *waiting*, or the server logs say "The database is not up to date yet" | Run `npm run db:setup` |
| The sheet says "The sync key is wrong" | Run `npx wrangler secret put SYNC_KEY` again, then **SuccessPath > Connect to the app** with the same key |
| No SuccessPath menu in the sheet | Reload the spreadsheet. Still missing: in Apps Script, choose `onOpen` and click Run |
| New entries do not reach the sheet | **SuccessPath > Show status** shows the last problem. In Apps Script, **Executions** (left side) lists every run and its errors |
| The phone keeps saying "waiting" while online | Open `https://your-link/api/health` in a browser. It should say `"ok":true` |
| A portal says it is not open yet | Set the office password: `npx wrangler secret put ADMIN_PASSWORD` (it works straight away) |
| The bell, Messages or Leave tab says "The database is not up to date yet" | Run `npm run db:setup` (version 3.1 needs migration 0007) |
| A teacher or student cannot log in | Check the username on their page in the office app. Only current (Active) students and teachers can log in |
| Papa forgot the office password | Set a new one with `npx wrangler secret put ADMIN_PASSWORD` |
| Dad sees an old version | Close the app fully and open it again while online |

Server logs: Cloudflare dashboard > Workers & Pages > successpath > **Logs**.

---

## Ideas for the next version

WhatsApp receipts and fee reminders (the Analytics page already lists who has not paid), teachers
entering marks in their portal, photos of notes (Cloudflare R2 has a free 10 GB), personal
passwords, phone notifications when the app is closed, and entering a whole class's test marks at
once.
The structure is ready for these: the history tables record every change, and `forms.js` drives the
page, the checks and the sheet together.
