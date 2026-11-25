/**
 * One-click workbook initialization, default compliance templates,
 * initial Partner account seeding, and automated trigger setup.
 * Run setupWorkbook() once from the Apps Script editor.
 */

function setupWorkbook() {
  var ss = getSpreadsheet();
  var sheetNames = Object.keys(SHEET_HEADERS);

  sheetNames.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    var headers = SHEET_HEADERS[name];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#0F172A')
        .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }
  });

  // Remove default empty "Sheet1" if unused
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  // Ensure Drive root & backup folders exist
  var rootFolder = getOrCreateRootFolder();
  getOrCreateSubfolder(rootFolder, 'Backups');

  // Seed settings
  setSetting('firm_name', APP_CONFIG.FIRM_NAME, 'Organization display name');
  setSetting('drive_root_id', rootFolder.getId(), 'Google Drive root folder ID');
  setSetting('drive_root_url', rootFolder.getUrl(), 'Google Drive root folder URL');
  setSetting('late_cutoff', '10:30', 'Attendance late mark cutoff (IST)');
  setSetting('self_status_lock_hour', '11', 'Hour (IST) after which employees cannot self-edit leave status');
  setSetting('attendance_affects_availability', 'true', 'Show Absent if no check-in today for below-Manager staff');
  setSetting('email_mode', 'daily_digest', 'daily_digest = strictly max 1 consolidated email per person per day (free Gmail safe)');

  // Seed initial Partner account (Shahrukh Kamal) if Employee_Master is empty
  var employees = readSheetObjects(SHEETS.EMPLOYEES);
  if (employees.length === 0) {
    var salt = generateSalt();
    var hash = hashPin(APP_CONFIG.INITIAL_ADMIN.temp_pin, salt);
    appendSheetObject(SHEETS.EMPLOYEES, {
      employee_id: 'EMP-001',
      full_name: APP_CONFIG.INITIAL_ADMIN.full_name,
      email: APP_CONFIG.INITIAL_ADMIN.email.toLowerCase(),
      role: APP_CONFIG.INITIAL_ADMIN.role,
      role_level: ROLE_LEVELS[APP_CONFIG.INITIAL_ADMIN.role],
      location: APP_CONFIG.INITIAL_ADMIN.location,
      reporting_to: '',
      status: 'Active',
      availability_status: 'Always Available',
      leave_reason: '',
      leave_updated_at: formatISOTimestamp(),
      pin_hash: hash,
      pin_salt: salt,
      must_change_pin: 'Yes',
      created_at: formatISOTimestamp()
    });
  }

  // Seed Indian CA statutory compliance library if empty
  var compliances = readSheetObjects(SHEETS.COMPLIANCE_MASTER);
  if (compliances.length === 0) {
    var defaults = [
      ['CMP-001', 'GSTR-1 Monthly Return', 'GST', 'Monthly', '11', '11th of following month', 'Outward supplies return under GST', 'Yes'],
      ['CMP-002', 'GSTR-3B Monthly Return', 'GST', 'Monthly', '20', '20th of following month', 'Summary GST return and tax payment', 'Yes'],
      ['CMP-003', 'TDS Monthly Payment (Challan 281)', 'Income Tax', 'Monthly', '7', '7th of following month', 'Monthly deposit of Tax Deducted at Source', 'Yes'],
      ['CMP-004', 'TDS Quarterly Return (24Q / 26Q)', 'Income Tax', 'Quarterly', '31', '31st of month following quarter', 'Quarterly TDS statement filing', 'Yes'],
      ['CMP-005', 'PF & ESI Monthly Filing', 'Labour Law', 'Monthly', '15', '15th of following month', 'Monthly EPF ECR and ESIC challan filing', 'Yes'],
      ['CMP-006', 'Advance Tax Installment', 'Income Tax', 'Quarterly', '15', '15th Jun/Sep/Dec/Mar', 'Quarterly advance income tax computation & deposit', 'Yes'],
      ['CMP-007', 'Tax Audit Report (Form 3CD)', 'Income Tax', 'Yearly', '30', '30th September annually', 'Statutory tax audit u/s 44AB', 'Yes'],
      ['CMP-008', 'Income Tax Return (ITR)', 'Income Tax', 'Yearly', '31', '31st Oct (Audit) / 31st Jul', 'Annual income tax return filing', 'Yes'],
      ['CMP-009', 'ROC Annual Filing (AOC-4 & MGT-7)', 'MCA / ROC', 'Yearly', '30', 'Within 30/60 days of AGM', 'Annual financial statements and annual return with MCA', 'Yes'],
      ['CMP-010', 'Half-Yearly GST Reconciliation', 'GST', 'Half-Yearly', '15', '15th Oct & 15th Apr', '2B vs Books reconciliation and ITC review', 'Yes']
    ];
    defaults.forEach(function (d) {
      appendSheetObject(SHEETS.COMPLIANCE_MASTER, {
        compliance_id: d[0],
        compliance_name: d[1],
        category: d[2],
        frequency: d[3],
        default_due_day: d[4],
        statutory_due_rule: d[5],
        description: d[6],
        active: d[7]
      });
    });
  }

  // Install time-driven automation triggers
  installAutomationTriggers();

  Logger.log('Setup complete! Root Drive folder: ' + rootFolder.getUrl());
  return {
    ok: true,
    drive_root_url: rootFolder.getUrl(),
    admin_email: APP_CONFIG.INITIAL_ADMIN.email,
    temp_pin: APP_CONFIG.INITIAL_ADMIN.temp_pin
  };
}
