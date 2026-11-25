/**
 * Global configuration, role hierarchy, and sheet schemas for
 * Team Resource & Compliance Tracker (100% Google Sheets + Drive + Apps Script).
 */

const APP_CONFIG = {
  APP_NAME: 'Team Resource & Compliance Tracker',
  FIRM_NAME: 'VMG & Associates',
  TIMEZONE: 'Asia/Kolkata',
  DRIVE_ROOT_FOLDER_NAME: 'ComplianceTracker',
  SESSION_TTL_SECONDS: 21600, // 6 hours rolling session
  LATE_ATTENDANCE_HOUR: 10,
  LATE_ATTENDANCE_MINUTE: 30,
  SELF_STATUS_LOCK_HOUR: 11, // 11:00 AM IST lock for self availability status changes
  MAX_DAILY_TIMESHEET_HOURS: 10,
  INITIAL_ADMIN: {
    full_name: 'Shahrukh Kamal',
    email: 'shahrukh.kamal@vmgassociates.in',
    role: 'Partner',
    location: 'New Delhi',
    temp_pin: '123456'
  }
};

const ROLE_LEVELS = {
  'Executive': 1,
  'Associate': 2,
  'Senior Associate': 3,
  'Manager': 4,
  'Associate Director': 5,
  'Associate Partner': 6,
  'Partner': 7
};

const MANAGER_MIN_LEVEL = 4; // Manager and above

const TASK_STATUSES = [
  'Pending',
  'In Process',
  'Pending for Review',
  'Approved',
  'Filed'
];

const FREQUENCIES = [
  'Daily',
  'Weekly',
  'Monthly',
  'Quarterly',
  'Half-Yearly',
  'Yearly',
  'One-time'
];

const SHEETS = {
  EMPLOYEES: 'Employee_Master',
  CLIENTS: 'Client_Master',
  COMPLIANCE_MASTER: 'Compliance_Master',
  CLIENT_COMPLIANCE_MAP: 'Client_Compliance_Map',
  TASKS: 'Task_Register',
  TASKS_ARCHIVE: 'Task_Register_Archive',
  TASK_AUDIT: 'Task_Audit_Log',
  ATTENDANCE: 'Attendance_Register',
  BOOKINGS: 'Resource_Booking',
  TIMESHEET_WEEK: 'Timesheet_Week',
  TIMESHEET_WEEK_ARCHIVE: 'Timesheet_Week_Archive',
  TIMESHEET_DETAIL: 'Timesheet_Detail',
  TODOS: 'ToDo_List',
  SETTINGS: 'App_Settings'
};

const SHEET_HEADERS = {
  Employee_Master: [
    'employee_id', 'full_name', 'email', 'role', 'role_level', 'location',
    'reporting_to', 'status', 'availability_status', 'leave_reason',
    'leave_updated_at', 'pin_hash', 'pin_salt', 'must_change_pin', 'created_at'
  ],
  Client_Master: [
    'client_id', 'client_name', 'pan', 'gstin', 'cin', 'entity_type',
    'location', 'primary_partner', 'contact_name', 'contact_email',
    'contact_phone', 'kyc_folder_url', 'status', 'created_at'
  ],
  Compliance_Master: [
    'compliance_id', 'compliance_name', 'category', 'frequency',
    'default_due_day', 'statutory_due_rule', 'description', 'active'
  ],
  Client_Compliance_Map: [
    'map_id', 'client_id', 'client_name', 'compliance_id', 'compliance_name',
    'frequency', 'start_date', 'due_day', 'default_assigned_to',
    'default_reviewer', 'active', 'last_generated_period'
  ],
  Task_Register: [
    'task_id', 'client_id', 'client_name', 'compliance_id', 'compliance_name',
    'frequency', 'period_label', 'assigned_to_id', 'assigned_to_name',
    'assigned_to_email', 'reviewer_id', 'reviewer_name', 'reviewer_email',
    'assigned_by_name', 'assigned_date', 'due_date', 'status',
    'completion_date', 'approval_date', 'filing_date', 'filing_file_url',
    'filing_file_name', 'remarks', 'last_reminded_on', 'created_at', 'updated_at'
  ],
  Task_Register_Archive: [
    'task_id', 'client_id', 'client_name', 'compliance_id', 'compliance_name',
    'frequency', 'period_label', 'assigned_to_id', 'assigned_to_name',
    'assigned_to_email', 'reviewer_id', 'reviewer_name', 'reviewer_email',
    'assigned_by_name', 'assigned_date', 'due_date', 'status',
    'completion_date', 'approval_date', 'filing_date', 'filing_file_url',
    'filing_file_name', 'remarks', 'last_reminded_on', 'created_at', 'updated_at',
    'archived_at'
  ],
  Task_Audit_Log: [
    'log_id', 'task_id', 'action', 'old_status', 'new_status',
    'actor_id', 'actor_name', 'actor_role', 'notes', 'timestamp'
  ],
  Attendance_Register: [
    'attendance_id', 'employee_id', 'employee_name', 'employee_role',
    'date', 'check_in_time', 'status', 'latitude', 'longitude', 'location_note'
  ],
  Resource_Booking: [
    'booking_id', 'employee_id', 'employee_name', 'booked_by_id',
    'booked_by_name', 'client_name', 'start_date', 'end_date',
    'reason', 'status', 'created_at'
  ],
  Timesheet_Week: [
    'week_id', 'employee_id', 'employee_name', 'employee_email',
    'employee_role', 'week_start', 'week_end', 'total_hours',
    'status', 'submitted_at', 'created_at'
  ],
  Timesheet_Week_Archive: [
    'week_id', 'employee_id', 'employee_name', 'employee_email',
    'employee_role', 'week_start', 'week_end', 'total_hours',
    'status', 'submitted_at', 'created_at', 'archived_at'
  ],
  Timesheet_Detail: [
    'detail_id', 'week_id', 'employee_id', 'employee_name', 'week_start',
    'work_date', 'day_name', 'client_id', 'client_name', 'compliance_name',
    'task_description', 'hours', 'updated_at'
  ],
  ToDo_List: [
    'todo_id', 'employee_id', 'employee_name', 'title', 'linked_task_id',
    'due_date', 'priority', 'status', 'created_at', 'completed_at'
  ],
  App_Settings: [
    'key', 'value', 'description'
  ]
};

/**
 * Date & utility helpers (always store ISO YYYY-MM-DD in Sheets; format Indian DD-MMM-YYYY in emails/files)
 */
function getISTNow() {
  return new Date();
}

function formatISODate(dateObj) {
  return Utilities.formatDate(dateObj || new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function formatISOTimestamp(dateObj) {
  return Utilities.formatDate(dateObj || new Date(), APP_CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'+05:30'");
}

function formatIndianDate(isoDateStr) {
  if (!isoDateStr) return '';
  var s = String(isoDateStr).slice(0, 10);
  var parts = s.split('-');
  if (parts.length !== 3) return s;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var mIdx = parseInt(parts[1], 10) - 1;
  return parts[2] + '-' + (months[mIdx] || parts[1]) + '-' + parts[0];
}

function generateId(prefix) {
  var rand = Math.floor(1000 + Math.random() * 9000);
  var ts = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyMMddHHmmss');
  return prefix + '-' + ts + '-' + rand;
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheetOrThrow(sheetName) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName + '. Please run setupWorkbook() first.');
  }
  return sheet;
}

function readSheetObjects(sheetName) {
  var sheet = getSheetOrThrow(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var rowArr = values[i];
    var isEmpty = true;
    var obj = { _rowIndex: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      var val = rowArr[j];
      if (val instanceof Date) {
        // Keep ISO date for pure dates, ISO timestamp if time component exists
        var timePart = Utilities.formatDate(val, APP_CONFIG.TIMEZONE, 'HH:mm:ss');
        val = (timePart === '00:00:00') ? formatISODate(val) : formatISOTimestamp(val);
      }
      if (val !== '' && val !== null && val !== undefined) isEmpty = false;
      obj[headers[j]] = (val === null || val === undefined) ? '' : String(val);
    }
    if (!isEmpty) rows.push(obj);
  }
  return rows;
}

function appendSheetObject(sheetName, obj) {
  var sheet = getSheetOrThrow(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var row = headers.map(function (h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
  sheet.appendRow(row);
  return obj;
}

function updateSheetRow(sheetName, rowIndex, updates) {
  var sheet = getSheetOrThrow(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var range = sheet.getRange(rowIndex, 1, 1, headers.length);
  var current = range.getValues()[0];
  for (var j = 0; j < headers.length; j++) {
    var key = headers[j];
    if (updates.hasOwnProperty(key)) {
      current[j] = updates[key];
    }
  }
  range.setValues([current]);
}

function getSetting(key, fallback) {
  var rows = readSheetObjects(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) return rows[i].value;
  }
  return fallback;
}

function setSetting(key, value, description) {
  var sheet = getSheetOrThrow(SHEETS.SETTINGS);
  var rows = readSheetObjects(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      updateSheetRow(SHEETS.SETTINGS, rows[i]._rowIndex, {
        value: String(value),
        description: description || rows[i].description
      });
      return;
    }
  }
  appendSheetObject(SHEETS.SETTINGS, {
    key: key,
    value: String(value),
    description: description || ''
  });
}
