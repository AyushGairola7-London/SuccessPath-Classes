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
//   * `hidden: true` on a field keeps it off the office's form; the portals fill it in.
//   * A money field refuses a minus amount, unless it has `minus`: `minus: 'ignore'` reads -6000 as
//     6000, and `minus: 'refund'` saves the whole entry as that other form instead (a fee of -6000
//     is saved as Money returned, ₹6,000).

export const APP_NAME = 'SuccessPath Classes';
export const APP_VERSION = '3.2.0';

// The order of the sections on the home screen.
export const GROUPS = ['Students', 'Payments made', 'Teachers', 'Other'];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EXAMS = ['Half-yearly', 'Annual', 'Unit test', 'Pre-board', 'Board exam', 'Other'];
// What a student can write to a teacher from the student portal.
export const MESSAGE_KINDS = ['Complaint', 'Help with a topic', 'Notes for the teacher', 'Special requirement', 'Other'];
const FEE_PLANS = ['Monthly', 'Every 3 months', 'Every 6 months', 'Yearly', 'One time'];

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
      { key: 'amount', label: 'Amount', kind: 'money', min: 1, column: 'amount', minus: 'refund' },
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
    // A new name is added to Students as an Enquiry. From their page: Move to demo, then Full admission.
    person: {
      kind: 'student', field: 'student_name', classField: 'class', phoneField: 'phone', add: true, status: 'Enquiry',
      fill: { class: 'class', phone: 'phone' }, details: ['parent_name', 'email', 'school', 'subjects'],
    },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'student', column: 'name', hint: 'A new name is added to Students as an enquiry.' },
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
      details: ['enrollment_no', 'parent_name', 'phone_2', 'school', 'subjects', 'fee_amount', 'fee_plan', 'address'],
    },
    fields: [
      { key: 'date', label: 'Admission date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'student', column: 'name' },
      { key: 'enrollment_no', label: 'Enrollment number', kind: 'text', hint: 'The number in the paper register, if there is one.' },
      { key: 'parent_name', label: 'Father or guardian name', kind: 'name' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'phone_2', label: 'Second phone number', kind: 'phone' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'subjects', label: 'Subjects or batch', kind: 'text' },
      { key: 'school', label: 'School', kind: 'text' },
      { key: 'fee_amount', label: 'Fee agreed', kind: 'money', column: 'amount' },
      { key: 'fee_plan', label: 'Fee is paid', kind: 'choice', options: FEE_PLANS },
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
      { key: 'added_by', label: 'Added by', kind: 'text', hidden: true }, // "Student portal" when a student added it
    ],
  },
  {
    type: 'demo',
    title: 'Demo classes',
    noun: 'demo',
    button: 'Move to demo',
    prefix: 'DEM',
    tab: 'Demo Classes',
    group: 'Students',
    color: '#6B4BC4',
    hidden: true, // opened from an enquiry's page: Move to demo
    summary: ['student_name', 'demo_from', 'subjects'],
    // An enquiry moves to Demo; a student already admitted stays as they are.
    person: {
      kind: 'student', field: 'student_name', classField: 'class', phoneField: 'phone', add: true, status: 'Demo',
      fill: { class: 'class', phone: 'phone' }, details: ['demo_from', 'subjects'],
    },
    fields: [
      { key: 'demo_from', label: 'Demo classes from', kind: 'date', default: 'today', column: 'entry_date' },
      { key: 'student_name', label: 'Student', kind: 'student', column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'subjects', label: 'Subjects or batch', kind: 'text' },
      { key: 'teacher_name', label: 'With teacher', kind: 'teacher' },
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
    then: { type: 'refund', label: 'Record money returned' },
    person: { kind: 'student', field: 'student_name', classField: 'class', phoneField: 'phone', add: true, status: 'Left', dateField: 'date', fill: { phone: 'phone' } },
    fields: [
      { key: 'date', label: 'Date left', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student name', kind: 'student', column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'reason', label: 'Why did they leave?', kind: 'choice', sheetLabel: 'Reason', options: ['Course finished', 'Moved to another city', 'Fees problem', 'Not happy with classes', 'Joined another institute', 'Did not join', 'Other'] },
      { key: 'fees_pending', label: 'Fees still to be paid', kind: 'money', column: 'amount' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'refund',
    title: 'Money returned',
    noun: 'refund',
    button: 'Save',
    prefix: 'RFD',
    tab: 'Refunds',
    group: 'Students',
    color: '#B42318',
    summary: ['student_name', 'amount', 'reason'],
    person: { kind: 'student', field: 'student_name', classField: 'class', add: false, optional: true },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'student_name', label: 'Student', kind: 'student', column: 'name', hint: 'Choose from the list.' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'amount', label: 'Money returned', kind: 'money', min: 1, column: 'amount', minus: 'ignore', hint: 'It counts as money paid out.' },
      { key: 'mode', label: 'Returned by', kind: 'choice', options: ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'] },
      { key: 'reason', label: 'Why', kind: 'text', placeholder: 'For example: left after two months' },
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
    type: 'teacher_enquiry',
    title: 'Teacher enquiry',
    noun: 'teacher enquiry',
    button: 'Save enquiry',
    prefix: 'TEQ',
    tab: 'Teacher Enquiries',
    group: 'Teachers',
    color: '#4E5BA6',
    summary: ['teacher_name', 'subjects', 'outcome'],
    person: {
      kind: 'teacher', field: 'teacher_name', phoneField: 'phone', add: true, status: 'Enquiry',
      fill: { phone: 'phone' }, details: ['subjects', 'classes', 'qualification', 'experience', 'salary_asked', 'address'],
    },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', notFuture: true, column: 'entry_date' },
      { key: 'teacher_name', label: 'Name', kind: 'teacher', column: 'name', hint: 'They are kept under Teachers, Enquiries. They are not counted as a teacher.' },
      { key: 'phone', label: 'Phone number', kind: 'phone', column: 'phone' },
      { key: 'subjects', label: 'Subjects', kind: 'text', placeholder: 'For example: Maths, Physics' },
      { key: 'classes', label: 'Classes they can teach', kind: 'text' },
      { key: 'qualification', label: 'Qualification', kind: 'text' },
      { key: 'experience', label: 'Experience', kind: 'text', placeholder: 'For example: 3 years at a school' },
      { key: 'salary_asked', label: 'Salary asked for', kind: 'money', column: 'amount' },
      { key: 'source', label: 'How did they find us?', kind: 'choice', options: ['Walk-in', 'Reference', 'Newspaper or poster', 'Online', 'Other'] },
      { key: 'outcome', label: 'What was decided?', kind: 'choice', options: ['Not hired', 'Maybe later', 'Interview planned'] },
      { key: 'address', label: 'Address', kind: 'textarea' },
      { key: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
  {
    type: 'leave',
    title: 'Teacher leave',
    noun: 'leave',
    button: 'Save leave',
    prefix: 'LVE',
    tab: 'Teacher Leave',
    group: 'Teachers',
    color: '#9A3F7A',
    summary: ['teacher_name', 'from', 'reason'],
    person: { kind: 'teacher', field: 'teacher_name', add: true },
    fields: [
      { key: 'teacher_name', label: 'Teacher', kind: 'teacher', column: 'name', hint: 'Choose from the list.' },
      { key: 'from', label: 'From', kind: 'date', default: 'today', column: 'entry_date' },
      { key: 'to', label: 'To (last day of leave)', kind: 'date', notBefore: 'from', hint: 'Leave empty if it is one day.' },
      { key: 'reason', label: 'Reason', kind: 'choice', options: ['Sick', 'Family function', 'Personal work', 'Travel', 'Festival', 'Other'] },
      { key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'For example: only the evening batch' },
      { key: 'request_code', label: 'Asked for in the portal', kind: 'text', hidden: true }, // LRQ-0001 when approved from a request
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
    type: 'holiday',
    title: 'Holiday',
    noun: 'holiday',
    button: 'Save holiday',
    prefix: 'HOL',
    tab: 'Holidays',
    group: 'Other',
    color: '#C2410C',
    summary: ['holiday', 'from'],
    fields: [
      { key: 'holiday', label: 'Holiday', kind: 'text', column: 'name', placeholder: 'For example: Diwali' },
      { key: 'from', label: 'From', kind: 'date', column: 'entry_date' },
      { key: 'to', label: 'To (last day)', kind: 'date', notBefore: 'from', hint: 'Leave empty if it is one day.' },
      { key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'For example: classes start again on Monday' },
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
  {
    type: 'portal_message',
    title: 'Portal message',
    noun: 'message',
    button: 'Send message',
    prefix: 'MSG',
    tab: 'Portal Messages',
    group: 'Other',
    color: '#0E7490',
    hidden: true, // between one student and one teacher, sent from the portals, either way
    summary: ['student_name', 'teacher_name', 'about'],
    person: { kind: 'student', field: 'student_name', classField: 'class', add: false },
    fields: [
      { key: 'date', label: 'Date', kind: 'date', default: 'today', column: 'entry_date' },
      { key: 'student_name', label: 'Student', kind: 'student', column: 'name' },
      { key: 'class', label: 'Class', kind: 'select', options: CLASSES },
      { key: 'teacher_name', label: 'Teacher', kind: 'teacher' },
      { key: 'teacher_code', label: 'Teacher ID', kind: 'text' },
      { key: 'from', label: 'Sent by', kind: 'choice', options: ['Student', 'Teacher'] }, // empty on the first messages: the student
      { key: 'about', label: 'About', kind: 'choice', options: MESSAGE_KINDS },
      { key: 'message', label: 'Message', kind: 'textarea' },
    ],
  },
];

// Columns of the Students and Teachers tabs in the Google Sheet.
// `d.` means a detail copied from the admission or joining form.
export const REGISTER_COLUMNS = {
  student: [
    { key: 'code', label: 'Student ID', kind: 'code' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'd.enrollment_no', label: 'Enrollment no.', kind: 'text' },
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
    { key: 'refunded', label: 'Money returned (₹)', kind: 'money' },
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
    { key: 'd.experience', label: 'Experience', kind: 'text' },
    { key: 'd.salary_asked', label: 'Salary asked for (₹)', kind: 'money' },
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

// Fields on a student's or teacher's "Edit details" page. `to` names the column of the register
// it changes; the others are details first given on the admission or new-teacher form.
// `ifLeft` fields show only for someone who has left.
export const PERSON_EDIT_FIELDS = {
  student: [
    { key: 'listed_as', label: 'In the student list as', kind: 'choice', options: ['Enquiry', 'Demo', 'Student'], to: 'status',
      values: { Enquiry: 'Enquiry', Demo: 'Demo', Student: 'Active' }, ifStatus: ['Enquiry', 'Demo', 'Active'] },
    { key: 'name', label: 'Student name', kind: 'name', to: 'name', required: true },
    { key: 'enrollment_no', label: 'Enrollment number', kind: 'text' },
    { key: 'class', label: 'Class', kind: 'select', options: CLASSES, to: 'class' },
    { key: 'phone', label: 'Phone number', kind: 'phone', to: 'phone' },
    { key: 'phone_2', label: 'Second phone number', kind: 'phone' },
    { key: 'parent_name', label: 'Father or guardian name', kind: 'name' },
    { key: 'school', label: 'School', kind: 'text' },
    { key: 'subjects', label: 'Subjects or batch', kind: 'text' },
    { key: 'fee_amount', label: 'Fee agreed', kind: 'money' },
    { key: 'fee_plan', label: 'Fee is paid', kind: 'choice', options: FEE_PLANS },
    { key: 'email', label: 'Email', kind: 'email' },
    { key: 'demo_from', label: 'Demo classes from', kind: 'date' },
    { key: 'joined_on', label: 'Admission date', kind: 'date', to: 'joined_on' },
    { key: 'left_on', label: 'Left on', kind: 'date', to: 'left_on', ifLeft: true },
    { key: 'address', label: 'Address', kind: 'textarea' },
  ],
  teacher: [
    { key: 'listed_as', label: 'In the teacher list as', kind: 'choice', options: ['Teacher', 'Enquiry, not hired'], to: 'status',
      values: { Teacher: 'Active', 'Enquiry, not hired': 'Enquiry' }, ifStatus: ['Active', 'Enquiry'] },
    { key: 'name', label: 'Teacher name', kind: 'name', to: 'name', required: true },
    { key: 'phone', label: 'Phone number', kind: 'phone', to: 'phone' },
    { key: 'subjects', label: 'Subjects', kind: 'text' },
    { key: 'classes', label: 'Classes or batches', kind: 'text' },
    { key: 'salary', label: 'Salary per month', kind: 'money' },
    { key: 'qualification', label: 'Qualification', kind: 'text' },
    { key: 'experience', label: 'Experience', kind: 'text' },
    { key: 'salary_asked', label: 'Salary asked for', kind: 'money' },
    { key: 'joined_on', label: 'Joining date', kind: 'date', to: 'joined_on' },
    { key: 'left_on', label: 'Last working day', kind: 'date', to: 'left_on', ifLeft: true },
    { key: 'address', label: 'Address', kind: 'textarea' },
  ],
};

// Columns of the Tasks tab in the Google Sheet.
export const TASK_STAGES = ['To do', 'Doing', 'Done'];
export const TASK_COLUMNS = [
  { key: 'code', label: 'Task ID', kind: 'code' },
  { key: 'title', label: 'Task', kind: 'text' },
  { key: 'stage', label: 'Stage', kind: 'status' },
  { key: 'start_on', label: 'Start date', kind: 'date' },
  { key: 'due_on', label: 'End date', kind: 'date' },
  { key: 'budget', label: 'Budget (₹)', kind: 'money' },
  { key: 'owner', label: 'Owner', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'text' },
  { key: 'changed_by', label: 'Last changed by', kind: 'text' },
  { key: 'created_at', label: 'Added', kind: 'timestamp' },
  { key: 'done_at', label: 'Done on', kind: 'timestamp' },
];

/* ------------------------------------------------------------------ */
/* Everything below is shared code. You should not need to change it.  */
/* ------------------------------------------------------------------ */

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const NOT_A_CLASS = /^\s*(?:batch|batches|student|students|hour|hours|hrs|hr|day|days|week|weeks|month|months|year|years|yrs|am|pm|a\.m|p\.m|:|%|minutes|mins)/;

/**
 * The classes a teacher teaches, read from the "Classes or batches" on their record, such as
 * "9th, 10th", "Class 6-8", "IX & X", "11-12 PCM", "JEE batch" or "All classes". The teacher
 * portal uses it for "My students"; the teacher's page in the office app shows what it found.
 */
export function classesFromText(text) {
  let t = ` ${String(text || '').toLowerCase().replace(/[–—]/g, '-')} `;
  const found = new Set();
  const numbered = CLASSES.filter((c) => /^Class \d+$/.test(c));
  if (/\ball\b/.test(t)) for (const c of numbered) found.add(c);
  // Roman numerals: VI to XII anywhere, I to V only after "class" or "std" (so "I teach" is not class 1).
  t = t.replace(/\b(class|std|standard)\.?\s*(iii|ii|iv|v|i)\b/g, (m, word, r) => `${word} ${ROMAN[r]}`);
  t = t.replace(/\b(xii|xi|x|ix|viii|vii|vi)\b/g, (m) => ` ${ROMAN[m]} `);
  t = t.replace(/(\d{1,2})\s*(-|to)\s*(iii|ii|iv|v|i)\b/g, (m, a, dash, r) => `${a}-${ROMAN[r]}`);
  const add = (n) => { if (n >= 1 && n <= 12) found.add(`Class ${n}`); };
  // "6-8" is classes 6, 7 and 8; "4-6 pm" is a time. Either way the numbers are then rubbed out.
  const range = /(?<![\d:.])(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|to|till|until)\s*(\d{1,2})(?:st|nd|rd|th)?(?![\d:.])/g;
  t = t.replace(range, (whole, a, b, offset, all) => {
    if (!NOT_A_CLASS.test(all.slice(offset + whole.length)) && Number(a) <= Number(b) && Number(b) - Number(a) <= 11) {
      for (let n = Number(a); n <= Number(b); n++) add(n);
    }
    return ' '.repeat(whole.length);
  });
  let m;
  const single = /(?<![\d:.])(\d{1,2})(?:st|nd|rd|th)?(?![\d:.])/g;
  while ((m = single.exec(t))) {
    if (NOT_A_CLASS.test(t.slice(m.index + m[0].length))) continue;
    add(Number(m[1]));
  }
  if (/\b(college|graduat|degree|b\.?\s?sc|b\.?\s?com|bba|bca|undergrad)/.test(t)) found.add('College');
  if (/\b(competitive|jee|neet|ssc|upsc|cuet|nda|cds|olympiad|ntse|banking)/.test(t)) found.add('Competitive exam');
  return CLASSES.filter((c) => found.has(c));
}

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
/**
 * A fee typed with a minus amount is money given back. Returns { form, data } to save instead
 * (the Money returned form, with the amount made positive), or null when nothing changes.
 * Values the other form has no place for (fee months, cheque number) are left out.
 */
export function swapForMinus(form, data, today) {
  const field = form && data && form.fields.find((f) => f.kind === 'money' && f.minus && f.minus !== 'ignore'
    && typeof data[f.key] === 'number' && data[f.key] < 0);
  if (!field) return null;
  const target = getForm(field.minus);
  if (!target) return null;
  const out = {};
  for (const f of target.fields) {
    if (data[f.key] === undefined) continue;
    const value = f.key === field.key ? -data[f.key] : data[f.key];
    const result = cleanValue(f, value, today);
    if (!result.error && result.value !== '') out[f.key] = result.value;
  }
  // what the other form has no place for (the months, a cheque number) goes into its notes
  const notes = target.fields.find((f) => f.kind === 'textarea');
  const extra = form.fields
    .filter((f) => f !== field && data[f.key] !== undefined && data[f.key] !== '' && out[f.key] === undefined)
    .map((f) => `${f.label}: ${Array.isArray(data[f.key]) ? data[f.key].join(', ') : data[f.key]}`);
  if (notes && extra.length) {
    const result = cleanValue(notes, [out[notes.key], ...extra].filter(Boolean).join('\n'), today);
    if (!result.error && result.value !== '') out[notes.key] = result.value;
  }
  return { form: target, data: out };
}

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

/**
 * Should this student have paid by `today`? Monthly (or no plan given): every month. Longer plans:
 * when the last payment is older than the plan's period. One time: only if nothing was ever paid.
 * (Whether this month is already paid is checked separately.)
 */
export function feeIsDue(plan, lastPaidOn, today) {
  const p = plan || 'Monthly';
  if (p === 'Monthly') return true;
  if (!lastPaidOn) return true;
  if (p === 'One time') return false;
  const months = { 'Every 3 months': 3, 'Every 6 months': 6, Yearly: 12 }[p] || 1;
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const back = new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 7);
  return lastPaidOn < `${back}${today.slice(7)}`;
}

/**
 * Checks the values from the "Edit details" page. Only the fields that were sent change; an empty
 * value clears that detail. The name cannot be emptied. Returns { ok, values, errors }.
 */
export function validatePersonEdit(kind, input, today) {
  const fields = PERSON_EDIT_FIELDS[kind];
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const values = {};
  const errors = {};
  if (!fields) return { ok: false, values, errors: { _form: 'Unknown list.' } };
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field.key)) continue;
    const result = cleanValue(field, source[field.key], today);
    if (result.error) errors[field.key] = result.error;
    else values[field.key] = result.value === '' ? null : result.value;
  }
  if (!Object.keys(values).length && !Object.keys(errors).length) errors._form = 'Nothing to change.';
  return { ok: Object.keys(errors).length === 0, values, errors };
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
      if (field.minus !== undefined) {
        const target = field.minus === 'ignore' ? null : forms.find((f) => f.type === field.minus);
        if (field.kind !== 'money') problems.push(`${where}, field "${field.key}": only a money field can have minus.`);
        else if (field.minus !== 'ignore' && !(target && target.type !== form.type && target.fields.some((f) => f.key === field.key && f.kind === 'money' && f.minus !== field.minus))) {
          problems.push(`${where}, field "${field.key}": minus must be 'ignore' or name another form with a money field "${field.key}".`);
        }
      }
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
      if (p.status && !['Active', 'Left', 'Enquiry', 'Demo'].includes(p.status)) problems.push(`${where}: person status must be Active, Left, Enquiry or Demo.`);
      if (p.status === 'Enquiry' && !['student', 'teacher'].includes(p.kind)) problems.push(`${where}: only students and teachers can be enquiries.`);
      if (p.status === 'Demo' && p.kind !== 'student') problems.push(`${where}: only students take demo classes.`);
      if (form.then && !FORMS.some((f) => f.type === form.then.type)) problems.push(`${where}: "then" names a form that does not exist.`);
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
      let text = String(raw).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
      // a minus sign typed on a phone can be -, − or –
      const minus = /^[-\u2212\u2013]/.test(text);
      if (minus) text = text.slice(1);
      if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter the amount in rupees, like 1500.' };
      const size = Number(text);
      if (minus && !field.minus) return { error: 'Enter the amount without a minus sign.' };
      if (size > MAX_MONEY) return { error: 'This amount looks too big. Please check it.' };
      if (field.min !== undefined && size < field.min) return { error: `The amount must be at least ₹${field.min}.` };
      return { value: minus && field.minus !== 'ignore' ? -size : size };
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
