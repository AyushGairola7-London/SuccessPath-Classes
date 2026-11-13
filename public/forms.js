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
//   * Field kinds: name, text, phone, date, money, select, choice, months, textarea.
//     `select` suits long lists (dropdown). `choice` suits up to 6 options (big buttons).
//   * `column` copies a value into a fixed database column, so it can be searched later:
//     entry_date, name, phone or amount (one field each per form).

export const APP_NAME = 'SuccessPath Classes';
export const APP_VERSION = '1.0.0';

// The order of the sections on the home screen.
export const GROUPS = ['Students', 'Teachers', 'Other'];

const CLASSES = [
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6',
  'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12',
  'College', 'Competitive exam', 'Other',
];

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
    fields: [
      { key: 'date', label: 'Date', kind: 'date', required: true, default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'name', required: true, column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES, required: true },
      { key: 'amount', label: 'Amount', kind: 'money', required: true, min: 1, column: 'amount' },
      { key: 'mode', label: 'Paid by', kind: 'choice', options: ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'], required: true },
      { key: 'fee_for', label: 'Fee for', kind: 'months', hint: 'Tap every month this payment covers.' },
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
      { key: 'date', label: 'Date', kind: 'date', required: true, default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'name', required: true, column: 'name' },
      { key: 'parent_name', label: 'Parent name', kind: 'name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', required: true, column: 'phone' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES, required: true },
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
    tab: 'Students',
    group: 'Students',
    color: '#17784E',
    summary: ['student_name', 'class', 'phone'],
    fields: [
      { key: 'date', label: 'Admission date', kind: 'date', required: true, default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'name', required: true, column: 'name' },
      { key: 'parent_name', label: 'Father or guardian name', kind: 'name', required: true },
      { key: 'phone', label: 'Phone number', kind: 'phone', required: true, column: 'phone' },
      { key: 'phone_2', label: 'Second phone number', kind: 'phone' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES, required: true },
      { key: 'subjects', label: 'Subjects or batch', kind: 'text' },
      { key: 'school', label: 'School', kind: 'text' },
      { key: 'fee_amount', label: 'Fee agreed', kind: 'money', column: 'amount' },
      { key: 'fee_plan', label: 'Fee is paid', kind: 'choice', options: ['Monthly', 'Every 3 months', 'Every 6 months', 'Yearly', 'One time'] },
      { key: 'address', label: 'Address', kind: 'textarea' },
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
    fields: [
      { key: 'date', label: 'Date left', kind: 'date', required: true, default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'name', required: true, column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES, required: true },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'reason', label: 'Why did they leave?', kind: 'choice', required: true, sheetLabel: 'Reason', options: ['Course finished', 'Moved to another city', 'Fees problem', 'Not happy with classes', 'Joined another institute', 'Other'] },
      { key: 'fees_pending', label: 'Fees still to be paid', kind: 'money', column: 'amount' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'teacher',
    title: 'New teacher',
    noun: 'teacher',
    button: 'Save teacher',
    prefix: 'TCH',
    tab: 'Teachers',
    group: 'Teachers',
    color: '#0D7373',
    summary: ['teacher_name', 'subjects'],
    fields: [
      { key: 'date', label: 'Joining date', kind: 'date', required: true, default: 'today', column: 'entry_date' },
      { key: 'teacher_name', label: 'Teacher name', kind: 'name', required: true, column: 'name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', required: true, column: 'phone' },
      { key: 'subjects', label: 'Subjects', kind: 'text', required: true },
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
    fields: [
      { key: 'date', label: 'Last working day', kind: 'date', required: true, default: 'today', column: 'entry_date' },
      { key: 'teacher_name', label: 'Teacher name', kind: 'name', required: true, column: 'name' },
      { key: 'subjects', label: 'Subjects', kind: 'text' },
      { key: 'reason', label: 'Why did they leave?', kind: 'choice', required: true, sheetLabel: 'Reason', options: ['Resigned', 'Moved away', 'Contract ended', 'Asked to leave', 'Other'] },
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
    fields: [
      { key: 'date', label: 'Date', kind: 'date', required: true, default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'from', label: 'Complaint by', kind: 'choice', required: true, options: ['Parent', 'Student', 'Teacher', 'Other'] },
      { key: 'person_name', label: 'Their name', kind: 'name', required: true, column: 'name', sheetLabel: 'Name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'student_name', label: 'Student it is about', kind: 'name', hint: 'Leave empty if it is not about a student.', sheetLabel: 'Student' },
      { key: 'about', label: 'About', kind: 'choice', required: true, options: ['Teaching', 'A teacher', 'Fees', 'Timings', 'Classroom', 'Other'] },
      { key: 'details', label: 'What is the complaint?', kind: 'textarea', required: true, sheetLabel: 'Details' },
      { key: 'action', label: 'What was done about it?', kind: 'textarea', sheetLabel: 'Action taken' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Everything below is shared code. You should not need to change it.  */
/* ------------------------------------------------------------------ */

export const FIELD_KINDS = ['name', 'text', 'phone', 'date', 'money', 'select', 'choice', 'months', 'textarea'];
const FIXED_COLUMNS = ['entry_date', 'name', 'phone', 'amount'];
const MAX_LENGTH = { name: 80, text: 120, textarea: 1000, months: 160 };
const MAX_MONEY = 10000000; // one crore
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
        ...form.fields.map((field) => ({ key: field.key, label: sheetLabel(field), kind: field.kind })),
        ...SHEET_COLUMNS_AFTER,
      ],
    })),
  };
}

/** Finds mistakes in FORMS. Returns a list of problems (empty when all is well). */
export function checkForms(forms = FORMS) {
  const problems = [];
  const used = { type: new Set(), prefix: new Set(), tab: new Set() };
  for (const form of forms) {
    const where = `Form "${form.title || form.type}"`;
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(form.type || '')) problems.push(`${where}: type must use only small letters, numbers and _.`);
    if (!/^[A-Z]{2,5}$/.test(form.prefix || '')) problems.push(`${where}: prefix must be 2 to 5 capital letters.`);
    if (!form.tab || form.tab.length > 50) problems.push(`${where}: tab name is missing or too long.`);
    if (RESERVED_TABS.includes(form.tab)) problems.push(`${where}: the tab name "${form.tab}" is kept for the sheet's own use.`);
    if (!form.title || !form.button || !form.noun) problems.push(`${where}: needs a title, noun and button.`);
    if (!GROUPS.includes(form.group)) problems.push(`${where}: group must be one of ${GROUPS.join(', ')}.`);
    if (!/^#[0-9A-Fa-f]{6}$/.test(form.color || '')) problems.push(`${where}: color must look like #2C5FC4.`);
    for (const k of ['type', 'prefix', 'tab']) {
      const value = String(form[k] || '').toLowerCase();
      if (used[k].has(value)) problems.push(`${where}: another form already uses the ${k} "${form[k]}".`);
      used[k].add(value);
    }
    if (!Array.isArray(form.fields) || form.fields.length === 0) {
      problems.push(`${where}: has no fields.`);
      continue;
    }
    const keys = new Set();
    const labels = new Set([...SHEET_COLUMNS_BEFORE, ...SHEET_COLUMNS_AFTER].map((c) => c.label));
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
    for (const key of form.summary || []) {
      if (!keys.has(key)) problems.push(`${where}: summary lists "${key}", which is not a field.`);
    }
  }
  return problems;
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
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { error: 'Please type this again.' };
      const value = field.kind === 'textarea'
        ? raw.replace(/\r\n?/g, '\n').trim()
        : raw.replace(/\s+/g, ' ').trim();
      const max = MAX_LENGTH[field.kind];
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
    case 'money': return 'Enter the amount.';
    default: return 'Please fill this in.';
  }
}

function isRealDate(value) {
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
