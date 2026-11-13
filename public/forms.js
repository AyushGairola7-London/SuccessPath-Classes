// SuccessPath Classes: the forms in the app.
//
// This one file decides what the app asks for:
//   * the web page draws its forms from it,
//   * the server checks every entry against it before saving,
//   * the Google Sheet takes its tabs and columns from it.
//
// To add a field: add a line to a form's `fields`, then run `npm run deploy`.
// To add a form:  copy a whole form block and give it a new type, prefix, tab and color.
//
// Rules (`npm run deploy` stops with a clear message if one is broken):
//   * Never change a form's `type` or `prefix`, or a field's `key`, once entries exist.
//     Change the `label` instead. The key is how old entries find their column.
//   * Field kinds: name, text, phone, email, date, money, number, select, choice, months, textarea,
//     and student, teacher, person (a name box that suggests people already in the register).
//     `select` suits long lists (dropdown). `choice` suits up to 6 options (big buttons).
//   * `column` copies a value into a fixed database column, so it can be searched later:
//     entry_date, name, phone or amount (one field each per form).
//   * `person` links the entry to a student or teacher in the register (see PERSON LINKS below).
//   * No field is mandatory: fill in what you know. To make one mandatory, add `required: true` to it.
//     (A completely empty form is never saved.)

export const APP_NAME = 'SuccessPath Classes';
export const APP_VERSION = '2.2.0';

// The order of the sections on the home screen.
export const GROUPS = ['Students', 'Payments made', 'Teachers', 'Other'];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EXAMS = ['Half-yearly', 'Annual', 'Unit test', 'Pre-board', 'Board exam', 'Other'];

const CLASSES = [
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6',
  'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12',
  'College', 'Competitive exam', 'Other',
];

// The registers: one record per student and per teacher. Entries point to these records,
// so a student's fees, marks and notes all hang off one record and nobody is stored twice.
export const PEOPLE = {
  student: {
    kind: 'student', prefix: 'STU', title: 'Students', one: 'student', tab: 'Students', color: '#17784E',
    paymentType: 'fee', monthsField: 'fee_for',
  },
  teacher: {
    kind: 'teacher', prefix: 'TR', title: 'Teachers', one: 'teacher', tab: 'Teachers', color: '#0D7373',
    paymentType: 'teacher_payment', monthsField: 'paid_for',
  },
};

// PERSON LINKS
//   person: {
//     kind:    'student' | 'teacher' | 'any'
//     field:   the field holding the person's name
//     classField, phoneField: help tell two people with the same name apart
//     add:     true  = add them to the register if they are not there yet
//              false = they must already be in the register
//     optional: true = the entry can be saved without a person
//     status:  'Active' or 'Left': what this entry does to the person's status (dateField gives the date)
//     update:  register columns to overwrite with this entry's value, e.g. { class: 'class' }
//     fill:    register columns to fill only while they are empty, e.g. { phone: 'phone' }
//     details: fields copied into the person's details (parent name, school and so on)
//   }

export const FORMS = [
  {
    type: 'fee',
    title: 'Fee received',
    noun: 'fee',
    button: 'Save fee',
    prefix: 'FEE',
    tab: 'Fees',
    group: 'Students',
    color: '#B86E00',
    summary: ['student_name', 'amount', 'mode'],
    person: { kind: 'student', field: 'student_name', classField: 'class', phoneField: 'phone', add: true, update: { class: 'class' }, fill: { phone: 'phone' } },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'student', column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'amount', label: 'Amount', kind: 'money', min: 1, column: 'amount' },
      { key: 'mode', label: 'Paid by', kind: 'choice', options: ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'] },
      { key: 'fee_for', label: 'Fee for', kind: 'months', extraChoices: ['Admission fee'], hint: 'Tap every month this payment covers.' },
      { key: 'reference', label: 'UPI or cheque number', kind: 'text', hint: 'Leave empty for cash.' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'enquiry',
    title: 'New enquiry',
    noun: 'enquiry',
    button: 'Save enquiry',
    prefix: 'ENQ',
    tab: 'Enquiries',
    group: 'Students',
    color: '#2C5FC4',
    summary: ['student_name', 'class', 'phone'],
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'name', column: 'name' },
      { key: 'parent_name', label: 'Parent name', kind: 'name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'email', label: 'Email', kind: 'email' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'subjects', label: 'Subjects or course', kind: 'text', placeholder: 'For example: Maths, Science' },
      { key: 'school', label: 'School', kind: 'text' },
      { key: 'source', label: 'How did they hear about us?', kind: 'choice', options: ['Walk-in', 'Phone call', 'Friend or relative', 'Social media', 'Poster or banner', 'Other'] },
      { key: 'follow_up', label: 'Call back on', kind: 'date', sheetLabel: 'Follow-up date' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'admission',
    title: 'New admission',
    noun: 'admission',
    button: 'Save admission',
    prefix: 'ADM',
    tab: 'Admissions',
    group: 'Students',
    color: '#17784E',
    summary: ['student_name', 'class', 'phone'],
    person: {
      kind: 'student', field: 'student_name', classField: 'class', phoneField: 'phone', add: true,
      status: 'Active', dateField: 'date', update: { class: 'class', phone: 'phone' },
      details: ['parent_name', 'phone_2', 'school', 'subjects', 'fee_amount', 'fee_plan', 'address'],
    },
    fields: [
      { key: 'date', label: 'Admission date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'student', column: 'name' },
      { key: 'parent_name', label: 'Father or guardian name', kind: 'name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'phone_2', label: 'Second phone number', kind: 'phone' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'subjects', label: 'Subjects or batch', kind: 'text' },
      { key: 'school', label: 'School', kind: 'text' },
      { key: 'fee_amount', label: 'Fee agreed', kind: 'money', column: 'amount' },
      { key: 'fee_plan', label: 'Fee is paid', kind: 'choice', options: ['Monthly', 'Every 3 months', 'Every 6 months', 'Yearly', 'One time'] },
      { key: 'address', label: 'Address', kind: 'textarea' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'marks',
    title: 'Add marks',
    noun: 'marks',
    button: 'Save marks',
    prefix: 'MRK',
    tab: 'Marks',
    group: 'Students',
    color: '#6941C6',
    summary: ['student_name', 'test', 'marks'],
    person: { kind: 'student', field: 'student_name', classField: 'class', add: true },
    fields: [
      { key: 'date', label: 'Test date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student', kind: 'student', column: 'name', hint: 'Choose from the list. A new name is added to Students.' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'exam', label: 'Exam', kind: 'choice', options: EXAMS },
      { key: 'test', label: 'Test name', kind: 'text', placeholder: 'For example: Maths paper, Unit test 3' },
      { key: 'subject', label: 'Subject', kind: 'text', placeholder: 'For example: Maths' },
      { key: 'marks', label: 'Marks scored', kind: 'number', notMoreThan: 'out_of' },
      { key: 'out_of', label: 'Out of', kind: 'number', min: 1, default: '100' },
      { key: 'remarks', label: 'Remarks', kind: 'textarea' },
    ],
  },
  {
    type: 'exam',
    title: 'Exam dates',
    noun: 'exam date',
    button: 'Save exam dates',
    prefix: 'EXM',
    tab: 'Exam Dates',
    group: 'Students',
    color: '#2E6F95',
    summary: ['student_name', 'exam', 'starts_on'],
    person: { kind: 'student', field: 'student_name', classField: 'class', add: true },
    fields: [
      { key: 'student_name', label: 'Student', kind: 'student', column: 'name', hint: 'Leave empty if the dates are for the whole class.' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'school', label: 'School', kind: 'text' },
      { key: 'exam', label: 'Exam', kind: 'choice', options: EXAMS },
      { key: 'starts_on', label: 'Starts on', kind: 'date', column: 'entry_date' },
      { key: 'ends_on', label: 'Ends on', kind: 'date', notBefore: 'starts_on' },
      { key: 'subjects', label: 'Subjects or timetable', kind: 'textarea' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'student_left',
    title: 'Student left',
    noun: 'student who left',
    button: 'Save',
    prefix: 'STL',
    tab: 'Students Left',
    group: 'Students',
    color: '#5B6780',
    summary: ['student_name', 'class', 'reason'],
    person: { kind: 'student', field: 'student_name', classField: 'class', phoneField: 'phone', add: true, status: 'Left', dateField: 'date', fill: { phone: 'phone' } },
    fields: [
      { key: 'date', label: 'Date left', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'student', column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'reason', label: 'Why did they leave?', kind: 'choice', sheetLabel: 'Reason', options: ['Course finished', 'Moved to another city', 'Fees problem', 'Not happy with classes', 'Joined another institute', 'Other'] },
      { key: 'fees_pending', label: 'Fees still to be paid', kind: 'money', column: 'amount' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'teacher_payment',
    title: 'Teacher payment',
    noun: 'teacher payment',
    button: 'Save payment',
    prefix: 'TPY',
    tab: 'Teacher Payments',
    group: 'Payments made',
    color: '#7A6200',
    summary: ['teacher_name', 'amount', 'payment_for'],
    person: { kind: 'teacher', field: 'teacher_name', add: true },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'teacher_name', label: 'Teacher', kind: 'teacher', column: 'name' },
      { key: 'amount', label: 'Amount paid', kind: 'money', min: 1, column: 'amount' },
      { key: 'mode', label: 'Paid by', kind: 'choice', options: ['Cash', 'UPI', 'Bank transfer', 'Cheque'] },
      { key: 'payment_for', label: 'Payment for', kind: 'choice', options: ['Salary', 'Per-class fee', 'Advance', 'Bonus', 'Other'], sheetLabel: 'Payment type' },
      { key: 'paid_for', label: 'For month', kind: 'months', hint: 'Tap every month this payment covers.' },
      { key: 'reference', label: 'UPI or cheque number', kind: 'text', hint: 'Leave empty for cash.' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'expense',
    title: 'Other payment',
    noun: 'other payment',
    button: 'Save payment',
    prefix: 'EXP',
    tab: 'Other Payments',
    group: 'Payments made',
    color: '#8B4513',
    summary: ['paid_to', 'amount', 'what_for'],
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'what_for', label: 'Paid for', kind: 'choice', options: ['Rent', 'Electricity', 'Internet or phone', 'Stationery', 'Repairs', 'Advertising', 'Staff (not teachers)', 'Other'] },
      { key: 'paid_to', label: 'Paid to', kind: 'name', column: 'name', placeholder: 'For example: landlord, electricity board' },
      { key: 'amount', label: 'Amount paid', kind: 'money', min: 1, column: 'amount' },
      { key: 'mode', label: 'Paid by', kind: 'choice', options: ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'] },
      { key: 'paid_for', label: 'For month', kind: 'months', hint: 'Tap every month this payment covers.' },
      { key: 'reference', label: 'UPI, cheque or bill number', kind: 'text' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'teacher',
    title: 'New teacher',
    noun: 'teacher',
    button: 'Save teacher',
    prefix: 'TCH',
    tab: 'Teachers Joined',
    group: 'Teachers',
    color: '#0D7373',
    summary: ['teacher_name', 'subjects'],
    person: {
      kind: 'teacher', field: 'teacher_name', phoneField: 'phone', add: true, status: 'Active', dateField: 'date',
      update: { phone: 'phone' }, details: ['subjects', 'classes', 'salary', 'qualification', 'address'],
    },
    fields: [
      { key: 'date', label: 'Joining date', kind: 'date', default: 'today', column: 'entry_date' },
      { key: 'teacher_name', label: 'Teacher name', kind: 'teacher', column: 'name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'subjects', label: 'Subjects', kind: 'text' },
      { key: 'classes', label: 'Classes or batches', kind: 'text' },
      { key: 'salary', label: 'Salary per month', kind: 'money', column: 'amount' },
      { key: 'qualification', label: 'Qualification', kind: 'text' },
      { key: 'address', label: 'Address', kind: 'textarea' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'teacher_left',
    title: 'Teacher left',
    noun: 'teacher who left',
    button: 'Save',
    prefix: 'TCL',
    tab: 'Teachers Left',
    group: 'Teachers',
    color: '#94466B',
    summary: ['teacher_name', 'reason'],
    person: { kind: 'teacher', field: 'teacher_name', add: true, status: 'Left', dateField: 'date' },
    fields: [
      { key: 'date', label: 'Last working day', kind: 'date', default: 'today', column: 'entry_date' },
      { key: 'teacher_name', label: 'Teacher name', kind: 'teacher', column: 'name' },
      { key: 'subjects', label: 'Subjects', kind: 'text' },
      { key: 'reason', label: 'Why did they leave?', kind: 'choice', sheetLabel: 'Reason', options: ['Resigned', 'Moved away', 'Contract ended', 'Asked to leave', 'Other'] },
      { key: 'dues', label: 'Salary still to be paid', kind: 'money', column: 'amount' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'complaint',
    title: 'New complaint',
    noun: 'complaint',
    button: 'Save complaint',
    prefix: 'CMP',
    tab: 'Complaints',
    group: 'Other',
    color: '#B5401F',
    summary: ['person_name', 'about'],
    person: { kind: 'student', field: 'student_name', add: false, optional: true },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'from', label: 'Complaint by', kind: 'choice', options: ['Parent', 'Student', 'Teacher', 'Other'] },
      { key: 'person_name', label: 'Their name', kind: 'name', column: 'name', sheetLabel: 'Name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'student_name', label: 'Student it is about', kind: 'student', hint: 'Leave empty if it is not about a student.', sheetLabel: 'Student' },
      { key: 'about', label: 'About', kind: 'choice', options: ['Teaching', 'A teacher', 'Fees', 'Timings', 'Classroom', 'Other'] },
      { key: 'details', label: 'What is the complaint?', kind: 'textarea', sheetLabel: 'Details' },
      { key: 'action', label: 'What was done about it?', kind: 'textarea', sheetLabel: 'Action taken' },
    ],
  },
  {
    type: 'note',
    title: 'Add note',
    noun: 'note',
    button: 'Save note',
    prefix: 'NTE',
    tab: 'Notes',
    group: 'Other',
    color: '#4A5578',
    hidden: true, // opened from a student's or teacher's page
    summary: ['person_name', 'note'],
    person: { kind: 'any', field: 'person_name', add: false, optional: true },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', column: 'entry_date' },
      { key: 'person_name', label: 'For', kind: 'person', column: 'name', sheetLabel: 'Name' },
      { key: 'note', label: 'Note', kind: 'textarea' },
    ],
  },
];

// Columns of the Students and Teachers tabs in the Google Sheet.
// `d.` means a detail copied from the admission or joining form.
export const REGISTER_COLUMNS = {
  student: [
    { key: 'code', label: 'Student ID', kind: 'code' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'class', label: 'Class', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'phone', label: 'Phone number', kind: 'phone' },
    { key: 'd.parent_name', label: 'Father or guardian', kind: 'text' },
    { key: 'd.school', label: 'School', kind: 'text' },
    { key: 'd.subjects', label: 'Subjects or batch', kind: 'text' },
    { key: 'joined_on', label: 'Admission date', kind: 'date' },
    { key: 'left_on', label: 'Left on', kind: 'date' },
    { key: 'd.fee_amount', label: 'Fee agreed (₹)', kind: 'money' },
    { key: 'd.fee_plan', label: 'Fee plan', kind: 'text' },
    { key: 'total_paid', label: 'Total fees paid (₹)', kind: 'money' },
    { key: 'payments', label: 'Payments', kind: 'number' },
    { key: 'last_paid_on', label: 'Last payment', kind: 'date' },
    { key: 'last_amount', label: 'Last amount (₹)', kind: 'money' },
    { key: 'tests', label: 'Tests', kind: 'number' },
    { key: 'last_percent', label: 'Last test %', kind: 'number' },
    { key: 'notes', label: 'Notes', kind: 'number' },
    { key: 'created_from', label: 'Added by entry', kind: 'code' },
  ],
  teacher: [
    { key: 'code', label: 'Teacher ID', kind: 'code' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'phone', label: 'Phone number', kind: 'phone' },
    { key: 'd.subjects', label: 'Subjects', kind: 'text' },
    { key: 'd.classes', label: 'Classes or batches', kind: 'text' },
    { key: 'd.salary', label: 'Salary per month (₹)', kind: 'money' },
    { key: 'd.qualification', label: 'Qualification', kind: 'text' },
    { key: 'joined_on', label: 'Joining date', kind: 'date' },
    { key: 'left_on', label: 'Left on', kind: 'date' },
    { key: 'total_paid', label: 'Total paid (₹)', kind: 'money' },
    { key: 'payments', label: 'Payments', kind: 'number' },
    { key: 'last_paid_on', label: 'Last payment', kind: 'date' },
    { key: 'last_amount', label: 'Last amount (₹)', kind: 'money' },
    { key: 'notes', label: 'Notes', kind: 'number' },
    { key: 'created_from', label: 'Added by entry', kind: 'code' },
  ],
};

// Columns of the Tasks tab in the Google Sheet.
export const TASK_STAGES = ['To do', 'Doing', 'Done'];
export const TASK_COLUMNS = [
  { key: 'code', label: 'Task ID', kind: 'code' },
  { key: 'title', label: 'Task', kind: 'text' },
  { key: 'stage', label: 'Stage', kind: 'status' },
  { key: 'due_on', label: 'Due on', kind: 'date' },
  { key: 'owner', label: 'Who', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'text' },
  { key: 'created_at', label: 'Added', kind: 'timestamp' },
  { key: 'done_at', label: 'Done on', kind: 'timestamp' },
];

/* ------------------------------------------------------------------ */
/* Everything below is shared code. You should not need to change it.  */
/* ------------------------------------------------------------------ */

export const FIELD_KINDS = ['name', 'text', 'phone', 'email', 'date', 'money', 'number', 'select', 'choice', 'months', 'textarea', 'student', 'teacher', 'person'];
export const PICKER_KINDS = ['student', 'teacher', 'person'];
const FIXED_COLUMNS = ['entry_date', 'name', 'phone', 'amount'];
const PERSON_COLUMNS = ['class', 'phone'];
const MAX_LENGTH = { name: 80, text: 120, email: 120, textarea: 1000, months: 160 };
const MAX_MONEY = 10000000; // one crore
const MAX_NUMBER = 100000;
const RESERVED_TABS = ['About'];
const SHEET_COLUMNS_BEFORE = [
  { key: '_code', label: 'Entry ID', kind: 'code' },
  { key: '_status', label: 'Status', kind: 'status' },
];
const SHEET_COLUMNS_AFTER = [
  { key: '_saved_at', label: 'Saved at', kind: 'timestamp' },
  { key: '_cancel_reason', label: 'Cancel reason', kind: 'text' },
];

export function getForm(type) {
  return FORMS.find((form) => form.type === type) || null;
}

/** The register settings for a person kind (student or teacher). */
export function getPeople(kind) {
  return PEOPLE[kind] || null;
}

/** How names are compared: spaces tidied and capital letters ignored. */
export function nameKey(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** "Nov 2026" for 2026-11-13. */
export function monthLabel(isoDate) {
  const [y, m] = String(isoDate).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Today's date as YYYY-MM-DD on this device. */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's date as YYYY-MM-DD in India (used by the server). */
export function indiaToday() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

/**
 * Checks and tidies one entry. Unknown fields are dropped.
 * Returns { ok, data, errors } where errors maps a field key to a message for the person typing.
 */
export function validateEntry(form, input, today) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const data = {};
  const errors = {};
  for (const field of form.fields) {
    const result = cleanValue(field, source[field.key], today);
    if (result.error) errors[field.key] = result.error;
    else if (result.value !== '') data[field.key] = result.value;
  }
  const filled = form.fields.some((field) => data[field.key] !== undefined
    && field.default !== 'today'
    && (field.default === undefined || String(data[field.key]) !== String(field.default)));
  if (!filled && Object.keys(errors).length === 0) errors._form = 'Please fill in at least one thing before saving.';
  for (const field of form.fields) {
    const other = field.notMoreThan ? form.fields.find((f) => f.key === field.notMoreThan) : null;
    if (other && !errors[field.key] && typeof data[field.key] === 'number' && typeof data[other.key] === 'number' && data[field.key] > data[other.key]) {
      errors[field.key] = `This cannot be more than "${other.label}" (${data[other.key]}).`;
    }
    const before = field.notBefore ? form.fields.find((f) => f.key === field.notBefore) : null;
    if (before && !errors[field.key] && data[field.key] !== undefined && data[before.key] !== undefined && data[field.key] < data[before.key]) {
      errors[field.key] = `This cannot be before "${before.label}".`;
    }
  }
  return { ok: Object.keys(errors).length === 0, data, errors };
}

/** Values copied into the fixed database columns (entry_date, name, phone, amount). */
export function fixedColumns(form, data) {
  const out = { entry_date: null, name: null, phone: null, amount: null };
  for (const field of form.fields) {
    if (field.column && data[field.key] !== undefined) out[field.column] = data[field.key];
  }
  return out;
}

/** The tabs and columns of the Google Sheet. */
export function sheetSchema() {
  return {
    version: APP_VERSION,
    tabs: FORMS.map((form) => ({
      type: form.type,
      tab: form.tab,
      color: form.color,
      columns: [
        ...SHEET_COLUMNS_BEFORE,
        ...(form.person ? [{ key: '_person', label: personColumnLabel(form.person.kind), kind: 'code' }] : []),
        ...form.fields.map((field) => ({ key: field.key, label: sheetLabel(field), kind: field.kind })),
        ...SHEET_COLUMNS_AFTER,
      ],
    })),
    registers: Object.values(PEOPLE).map((p) => ({ kind: p.kind, tab: p.tab, color: p.color, columns: REGISTER_COLUMNS[p.kind] })),
    tasks: { tab: 'Tasks', color: '#5A3EA6', columns: TASK_COLUMNS },
  };
}

/** Finds mistakes in FORMS. Returns a list of problems (empty when all is well). */
export function checkForms(forms = FORMS) {
  const problems = [];
  const used = { type: new Set(), prefix: new Set([...Object.values(PEOPLE).map((p) => p.prefix), 'TSK'].map((x) => x.toLowerCase())), tab: new Set([...RESERVED_TABS, 'Tasks', ...Object.values(PEOPLE).map((p) => p.tab)].map((t) => t.toLowerCase())) };
  for (const form of forms) {
    const where = `Form "${form.title || form.type}"`;
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(form.type || '')) problems.push(`${where}: type must use only small letters, numbers and _.`);
    if (!/^[A-Z]{2,5}$/.test(form.prefix || '')) problems.push(`${where}: prefix must be 2 to 5 capital letters.`);
    if (!form.tab || form.tab.length > 50) problems.push(`${where}: tab name is missing or too long.`);
    if (!form.title || !form.button || !form.noun) problems.push(`${where}: needs a title, noun and button.`);
    if (!GROUPS.includes(form.group)) problems.push(`${where}: group must be one of ${GROUPS.join(', ')}.`);
    if (!/^#[0-9A-Fa-f]{6}$/.test(form.color || '')) problems.push(`${where}: color must look like #2C5FC4.`);
    for (const k of ['type', 'prefix', 'tab']) {
      const value = String(form[k] || '').toLowerCase();
      if (used[k].has(value)) problems.push(`${where}: the ${k} "${form[k]}" is already used by another form or register.`);
      used[k].add(value);
    }
    if (!Array.isArray(form.fields) || form.fields.length === 0) {
      problems.push(`${where}: has no fields.`);
      continue;
    }
    const keys = new Set();
    const labels = new Set([...SHEET_COLUMNS_BEFORE, ...SHEET_COLUMNS_AFTER].map((c) => c.label));
    if (form.person) labels.add(personColumnLabel(form.person.kind));
    const fixed = new Set();
    for (const field of form.fields) {
      const name = `${where}, field "${field.key}"`;
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(field.key || '')) problems.push(`${name}: key must use only small letters, numbers and _.`);
      if (keys.has(field.key)) problems.push(`${name}: two fields use this key.`);
      keys.add(field.key);
      if (!field.label) problems.push(`${name}: needs a label.`);
      if (!FIELD_KINDS.includes(field.kind)) problems.push(`${name}: kind "${field.kind}" is not one of ${FIELD_KINDS.join(', ')}.`);
      if ((field.kind === 'select' || field.kind === 'choice') && !(Array.isArray(field.options) && field.options.length > 0)) {
        problems.push(`${name}: needs a list of options.`);
      }
      const label = sheetLabel(field);
      if (labels.has(label)) problems.push(`${name}: two sheet columns would both be called "${label}". Give one a sheetLabel.`);
      labels.add(label);
      if (field.column) {
        if (!FIXED_COLUMNS.includes(field.column)) problems.push(`${name}: column must be one of ${FIXED_COLUMNS.join(', ')}.`);
        if (fixed.has(field.column)) problems.push(`${name}: another field already fills the ${field.column} column.`);
        fixed.add(field.column);
      }
    }
    for (const field of form.fields) {
      if (field.notMoreThan && !keys.has(field.notMoreThan)) problems.push(`${where}, field "${field.key}": notMoreThan names a field that does not exist.`);
      if (field.notBefore && !form.fields.some((f) => f.key === field.notBefore && f.kind === 'date')) problems.push(`${where}, field "${field.key}": notBefore must name a date field.`);
    }
    for (const key of form.summary || []) {
      if (!keys.has(key)) problems.push(`${where}: summary lists "${key}", which is not a field.`);
    }
    const p = form.person;
    if (p) {
      if (!['student', 'teacher', 'any'].includes(p.kind)) problems.push(`${where}: person kind must be student, teacher or any.`);
      if (!keys.has(p.field)) problems.push(`${where}: person field "${p.field}" is not a field.`);
      for (const k of ['classField', 'phoneField', 'dateField']) {
        if (p[k] && !keys.has(p[k])) problems.push(`${where}: person ${k} "${p[k]}" is not a field.`);
      }
      if (p.kind === 'any' && p.add) problems.push(`${where}: a person of kind "any" cannot be added automatically.`);
      if (p.status && !['Active', 'Left'].includes(p.status)) problems.push(`${where}: person status must be Active or Left.`);
      for (const k of ['update', 'fill']) {
        for (const [column, fieldKey] of Object.entries(p[k] || {})) {
          if (!PERSON_COLUMNS.includes(column)) problems.push(`${where}: person ${k} can only set ${PERSON_COLUMNS.join(' or ')}.`);
          if (!keys.has(fieldKey)) problems.push(`${where}: person ${k} uses "${fieldKey}", which is not a field.`);
        }
      }
      for (const key of p.details || []) {
        if (!keys.has(key)) problems.push(`${where}: person details lists "${key}", which is not a field.`);
      }
    }
  }
  return problems;
}

function personColumnLabel(kind) {
  if (kind === 'student') return 'Student ID';
  if (kind === 'teacher') return 'Teacher ID';
  return 'Person ID';
}

function sheetLabel(field) {
  const base = field.sheetLabel || field.label;
  return field.kind === 'money' ? `${base} (₹)` : base;
}

function cleanValue(field, raw, today) {
  const isEmpty = raw === undefined || raw === null
    || (typeof raw === 'string' && raw.trim() === '')
    || (Array.isArray(raw) && raw.every((x) => String(x).trim() === ''));
  if (isEmpty) return field.required ? { error: requiredMessage(field) } : { value: '' };

  switch (field.kind) {
    case 'name':
    case 'student':
    case 'teacher':
    case 'person':
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { error: 'Please type this again.' };
      const value = field.kind === 'textarea'
        ? raw.replace(/\r\n?/g, '\n').trim()
        : raw.replace(/\s+/g, ' ').trim();
      const max = MAX_LENGTH[field.kind] || MAX_LENGTH.name;
      if (value.length > max) return { error: `Please keep this under ${max} letters.` };
      return { value };
    }
    case 'phone': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'Enter a 10-digit phone number.' };
      let digits = String(raw).replace(/\D/g, '');
      if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
      else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      if (digits.length !== 10) return { error: 'Enter a 10-digit phone number.' };
      return { value: digits };
    }
    case 'email': {
      if (typeof raw !== 'string') return { error: 'Enter an email like name@example.com.' };
      const value = raw.trim().toLowerCase();
      if (value.length > MAX_LENGTH.email) return { error: `Please keep this under ${MAX_LENGTH.email} letters.` };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: 'Enter an email like name@example.com.' };
      return { value };
    }
    case 'date': {
      const value = String(raw).trim();
      if (!isRealDate(value)) return { error: 'Pick a date.' };
      if (field.notFuture && today && value > addDays(today, 1)) return { error: 'This date is in the future. Please check it.' };
      return { value };
    }
    case 'money': {
      const text = String(raw).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
      if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter the amount in rupees, like 1500.' };
      const value = Number(text);
      if (value > MAX_MONEY) return { error: 'This amount looks too big. Please check it.' };
      if (field.min !== undefined && value < field.min) return { error: `The amount must be at least ₹${field.min}.` };
      return { value };
    }
    case 'number': {
      const text = String(raw).replace(/[,\s]/g, '');
      if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter a number, like 45.' };
      const value = Number(text);
      if (value > MAX_NUMBER) return { error: 'This number looks too big. Please check it.' };
      if (field.min !== undefined && value < field.min) return { error: `This must be at least ${field.min}.` };
      return { value };
    }
    case 'select':
    case 'choice': {
      const value = String(raw).trim();
      if (!field.options.includes(value)) return { error: 'Please choose one.' };
      return { value };
    }
    case 'months': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const items = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
      if (items.some((x) => x.length > 40)) return { error: 'Please choose from the list.' };
      const value = items.join(', ');
      if (value.length > MAX_LENGTH.months) return { error: 'Too many items. Please choose fewer.' };
      return { value };
    }
    default:
      return { error: 'This field is not set up correctly.' };
  }
}

function requiredMessage(field) {
  switch (field.kind) {
    case 'select':
    case 'choice': return 'Please choose one.';
    case 'months': return 'Tap at least one.';
    case 'date': return 'Pick a date.';
    case 'phone': return 'Enter the phone number.';
    case 'email': return 'Enter the email.';
    case 'money': return 'Enter the amount.';
    case 'number': return 'Enter a number.';
    case 'student': return 'Enter the student\'s name.';
    case 'teacher': return 'Enter the teacher\'s name.';
    default: return 'Please fill this in.';
  }
}

export function isRealDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2099) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
