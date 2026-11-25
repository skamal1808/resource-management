/**
 * Time-driven automation triggers:
 * 1. Daily 9:00 AM IST:
 *    - Auto-expire completed Resource Bookings
 *    - Auto-generate recurring tasks from Client_Compliance_Map (preventing duplicates)
 *    - Send STRICTLY ONE consolidated daily digest email per person (combining overdue tasks,
 *      pre-due reminders 30/14/7/2/0 days, pending reviews, approved tasks ready to file,
 *      Day 1/3/7+ escalations, and on Fridays the Executive weekly timesheet reminder)
 * 2. Monday 9:00 AM IST:
 *    - Auto-generate previous week's Mon–Sat Timesheet_Week + 6 pre-filled Timesheet_Detail rows
 * 3. Sunday 11:00 PM IST:
 *    - Automated Excel + PDF backup of Google Sheet to Drive Backups/YYYY-MM/
 */

function installAutomationTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  existing.forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (
      fn === 'runDailyComplianceAutomation' ||
      fn === 'runMondayTimesheetGenerator' ||
      fn === 'runFridayExecutiveTimesheetReminder' ||
      fn === 'runWeeklyDriveBackup'
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('runDailyComplianceAutomation')
    .timeBased().everyDays(1).atHour(9).create();

  ScriptApp.newTrigger('runMondayTimesheetGenerator')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();

  ScriptApp.newTrigger('runWeeklyDriveBackup')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
}

function daysBetweenISO(isoA, isoB) {
  var a = new Date(isoA + 'T00:00:00Z');
  var b = new Date(isoB + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function runDailyComplianceAutomation() {
  var today = formatISODate();
  expireOldResourceBookings(today);
  generateRecurringComplianceTasks(today);
  sendDailyConsolidatedDigests(today);
}

function expireOldResourceBookings(today) {
  var bookings = readSheetObjects(SHEETS.BOOKINGS);
  bookings.forEach(function (b) {
    if (b.status === 'Active' && b.end_date && b.end_date < today) {
      updateSheetRow(SHEETS.BOOKINGS, b._rowIndex, { status: 'Completed' });
    }
  });
}

function computeCurrentPeriodAndDueDate(frequency, dueDayStr, todayDate) {
  var y = todayDate.getFullYear();
  var m = todayDate.getMonth();
  var dueDay = Math.min(Math.max(parseInt(dueDayStr, 10) || 15, 1), 28);
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (frequency === 'Monthly') {
    return { period: months[m] + '-' + y, dueDate: y + '-' + pad(m + 1) + '-' + pad(dueDay) };
  }
  if (frequency === 'Quarterly') {
    var q = Math.floor(m / 3) + 1;
    return { period: 'Q' + q + '-' + y, dueDate: y + '-' + pad(q * 3) + '-' + pad(dueDay) };
  }
  if (frequency === 'Half-Yearly') {
    var h = m < 6 ? 1 : 2;
    return { period: 'H' + h + '-' + y, dueDate: y + '-' + pad(h === 1 ? 6 : 12) + '-' + pad(dueDay) };
  }
  if (frequency === 'Yearly') {
    return { period: 'FY-' + y, dueDate: y + '-09-' + pad(dueDay) };
  }
  if (frequency === 'Weekly') {
    var d = new Date(todayDate.getTime());
    var diffToFri = (5 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diffToFri);
    return { period: 'Wk-' + formatISODate(d), dueDate: formatISODate(d) };
  }
  return { period: formatISODate(todayDate), dueDate: formatISODate(todayDate) };
}

function generateRecurringComplianceTasks(today) {
  var mappings = readSheetObjects(SHEETS.CLIENT_COMPLIANCE_MAP);
  var openTasks = readSheetObjects(SHEETS.TASKS);
  var employees = readSheetObjects(SHEETS.EMPLOYEES);
  var now = new Date();

  var empById = {};
  employees.forEach(function (e) { empById[e.employee_id] = e; });

  mappings.forEach(function (m) {
    if (m.active !== 'Yes' || m.frequency === 'One-time') return;
    if (m.start_date && m.start_date > today) return;

    var info = computeCurrentPeriodAndDueDate(m.frequency, m.due_day, now);
    if (m.last_generated_period === info.period) return;

    var hasOpen = openTasks.some(function (t) {
      return t.client_id === m.client_id &&
        t.compliance_id === m.compliance_id &&
        t.status !== 'Filed';
    });
    if (hasOpen) return;

    var assignee = empById[m.default_assigned_to];
    var reviewer = empById[m.default_reviewer];
    if (!assignee || assignee.status !== 'Active' || !reviewer || reviewer.status !== 'Active') return;

    var newTask = {
      task_id: generateId('TSK'),
      client_id: m.client_id,
      client_name: m.client_name,
      compliance_id: m.compliance_id,
      compliance_name: m.compliance_name,
      frequency: m.frequency,
      period_label: info.period,
      assigned_to_id: assignee.employee_id,
      assigned_to_name: assignee.full_name,
      assigned_to_email: assignee.email,
      reviewer_id: reviewer.employee_id,
      reviewer_name: reviewer.full_name,
      reviewer_email: reviewer.email,
      assigned_by_name: 'Auto Scheduler',
      assigned_date: today,
      due_date: info.dueDate,
      status: 'Pending',
      completion_date: '',
      approval_date: '',
      filing_date: '',
      filing_file_url: '',
      filing_file_name: '',
      remarks: 'Auto-generated recurring compliance task',
      last_reminded_on: '',
      created_at: formatISOTimestamp(),
      updated_at: formatISOTimestamp()
    };

    appendSheetObject(SHEETS.TASKS, newTask);
    updateSheetRow(SHEETS.CLIENT_COMPLIANCE_MAP, m._rowIndex, { last_generated_period: info.period });
    appendSheetObject(SHEETS.TODOS, {
      todo_id: generateId('TODO'),
      employee_id: assignee.employee_id,
      employee_name: assignee.full_name,
      title: newTask.client_name + ' — ' + newTask.compliance_name + ' (' + info.period + ')',
      linked_task_id: newTask.task_id,
      due_date: newTask.due_date,
      priority: 'High',
      status: 'Open',
      created_at: formatISOTimestamp(),
      completed_at: ''
    });
  });
}

/**
 * Aggregates EVERY relevant alert for each active employee and sends
 * STRICTLY AT MOST ONE email per person per day.
 */
function sendDailyConsolidatedDigests(today) {
  var employees = readSheetObjects(SHEETS.EMPLOYEES).filter(function (e) {
    return e.status === 'Active' && e.email;
  });
  var tasks = readSheetObjects(SHEETS.TASKS).filter(function (t) {
    return t.status !== 'Filed';
  });
  var openTimesheets = readSheetObjects(SHEETS.TIMESHEET_WEEK).filter(function (w) {
    return w.status !== 'Submitted';
  });

  var isFriday = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'u') === '5';
  var partners = employees.filter(function (e) { return e.role === 'Partner'; });

  // Prepare per-employee digest buckets
  var digestById = {};
  employees.forEach(function (emp) {
    digestById[emp.employee_id] = {
      employee: emp,
      overdue: [],
      escalations: [],
      upcoming: [],
      pendingReview: [],
      approvedToFile: [],
      timesheetReminder: ''
    };
  });

  tasks.forEach(function (t) {
    var assigneeBucket = digestById[t.assigned_to_id];
    var reviewerBucket = digestById[t.reviewer_id];
    var daysDiff = t.due_date ? daysBetweenISO(today, t.due_date) : null;
    var label = '<strong>' + t.client_name + '</strong> — ' + t.compliance_name +
      ' (Due: ' + formatIndianDate(t.due_date) + ', Status: ' + t.status + ')';

    // 1. Overdue items & escalations (Day 1 -> Employee + Reviewer, Day 3 -> Reviewer/Manager, Day 7+ -> Partners)
    if (daysDiff !== null && daysDiff < 0) {
      var overdueDays = Math.abs(daysDiff);
      var ovLine = label + ' — <strong style="color:#dc2626;">Overdue by ' + overdueDays + ' day' + (overdueDays === 1 ? '' : 's') + '</strong>';
      if (assigneeBucket) assigneeBucket.overdue.push(ovLine);
      if (reviewerBucket && overdueDays >= 1) {
        reviewerBucket.escalations.push(ovLine + ' (Assigned to: ' + t.assigned_to_name + ')');
      }
      if (overdueDays >= 7) {
        partners.forEach(function (p) {
          if (p.employee_id !== t.assigned_to_id && p.employee_id !== t.reviewer_id && digestById[p.employee_id]) {
            digestById[p.employee_id].escalations.push(
              ovLine + ' (Assigned to: ' + t.assigned_to_name + ', Reviewer: ' + t.reviewer_name + ')'
            );
          }
        });
      }
    } else if (daysDiff !== null) {
      // 2. Pre-due reminders: 30d (Half-Yearly/Yearly), 14d, 7d, 2d, 0d (Due Today)
      var isReminderDay =
        (daysDiff === 30 && (t.frequency === 'Half-Yearly' || t.frequency === 'Yearly')) ||
        daysDiff === 14 || daysDiff === 7 || daysDiff === 2 || daysDiff === 0;
      if (isReminderDay && assigneeBucket) {
        var whenText = daysDiff === 0 ? 'DUE TODAY' : ('Due in ' + daysDiff + ' day' + (daysDiff === 1 ? '' : 's'));
        assigneeBucket.upcoming.push(label + ' — <strong>' + whenText + '</strong>');
      }
    }

    // 3. Pending Review items for Reviewer
    if (t.status === 'Pending for Review' && reviewerBucket) {
      reviewerBucket.pendingReview.push(label + ' (Prepared by: ' + t.assigned_to_name + ')');
    }

    // 4. Approved items awaiting Filing upload by Assignee
    if (t.status === 'Approved' && assigneeBucket) {
      assigneeBucket.approvedToFile.push(label + ' (Approved by: ' + t.reviewer_name + ' — please upload filing PDF)');
    }
  });

  // 5. On Fridays, fold Executive-only unsubmitted timesheet reminder into the SAME daily digest
  if (isFriday) {
    openTimesheets.forEach(function (w) {
      var bucket = digestById[w.employee_id];
      if (bucket && bucket.employee.role === 'Executive') {
        bucket.timesheetReminder = 'Your weekly timesheet for ' +
          formatIndianDate(w.week_start) + ' to ' + formatIndianDate(w.week_end) +
          ' has not been submitted yet. Please log your hours and click Submit Week today.';
      }
    });
  }

  // Send at most 1 email per active employee
  var sentCount = 0;
  Object.keys(digestById).forEach(function (empId) {
    var b = digestById[empId];
    if (sendDailyDigestEmail(b.employee, today, b)) {
      sentCount++;
    }
  });
  Logger.log('Daily consolidated digests sent: ' + sentCount);
}

function getPreviousWeekRange(refDate) {
  var d = new Date((refDate || new Date()).getTime());
  var day = d.getDay();
  var daysSinceMonday = (day === 0 ? 6 : day - 1);
  var prevMon = new Date(d.getTime());
  prevMon.setDate(d.getDate() - daysSinceMonday - 7);
  var prevSat = new Date(prevMon.getTime());
  prevSat.setDate(prevMon.getDate() + 5);
  return {
    weekStart: formatISODate(prevMon),
    weekEnd: formatISODate(prevSat),
    mondayDate: prevMon
  };
}

function createTimesheetWeekForEmployee(emp, weekRange) {
  var weekId = generateId('TSW');
  var weekObj = {
    week_id: weekId,
    employee_id: emp.employee_id,
    employee_name: emp.full_name,
    employee_email: emp.email,
    employee_role: emp.role,
    week_start: weekRange.weekStart,
    week_end: weekRange.weekEnd,
    total_hours: '0',
    status: 'Draft',
    submitted_at: '',
    created_at: formatISOTimestamp()
  };
  appendSheetObject(SHEETS.TIMESHEET_WEEK, weekObj);

  var dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (var i = 0; i < 6; i++) {
    var dayDate = new Date(weekRange.mondayDate.getTime());
    dayDate.setDate(weekRange.mondayDate.getDate() + i);
    appendSheetObject(SHEETS.TIMESHEET_DETAIL, {
      detail_id: generateId('TSD'),
      week_id: weekId,
      employee_id: emp.employee_id,
      employee_name: emp.full_name,
      week_start: weekRange.weekStart,
      work_date: formatISODate(dayDate),
      day_name: dayNames[i],
      client_id: '',
      client_name: '',
      compliance_name: '',
      task_description: '',
      hours: '0',
      updated_at: formatISOTimestamp()
    });
  }
  return weekObj;
}

function runMondayTimesheetGenerator() {
  var employees = readSheetObjects(SHEETS.EMPLOYEES).filter(function (e) {
    return e.status === 'Active';
  });
  var existingWeeks = readSheetObjects(SHEETS.TIMESHEET_WEEK).concat(
    readSheetObjects(SHEETS.TIMESHEET_WEEK_ARCHIVE)
  );
  var range = getPreviousWeekRange(new Date());

  employees.forEach(function (emp) {
    var exists = existingWeeks.some(function (w) {
      return w.employee_id === emp.employee_id && w.week_start === range.weekStart;
    });
    if (!exists) {
      createTimesheetWeekForEmployee(emp, range);
    }
  });
}

function runWeeklyDriveBackup() {
  return runWorkbookBackup();
}
