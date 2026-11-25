/**
 * Main JSON API Router for Team Resource & Compliance Tracker.
 * Deploy as Web App: Execute as "Me", Access "Anyone".
 * All requests POST JSON { action, token, payload } (using text/plain to avoid CORS preflight).
 */

function doGet(e) {
  return jsonResponse({
    ok: true,
    app: APP_CONFIG.APP_NAME,
    firm: APP_CONFIG.FIRM_NAME,
    status: 'online',
    timestamp: formatISOTimestamp()
  });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var action = body.action || '';
    var token = body.token || '';
    var payload = body.payload || {};

    if (action === 'ping') {
      return jsonResponse({ ok: true, status: 'online', firm: APP_CONFIG.FIRM_NAME });
    }
    if (action === 'login') {
      return jsonResponse({ ok: true, data: handleLogin(payload) });
    }
    if (action === 'logout') {
      return jsonResponse({ ok: true, data: handleLogout(token) });
    }

    // All other routes require a valid session token
    var user = requireSession(token);
    var result = dispatchAction(action, user, payload);
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatchAction(action, user, payload) {
  switch (action) {
    case 'getBootstrap': return apiGetBootstrap(user);
    case 'changePin': return handleChangePin(user, payload);

    // Tasks
    case 'createTask': return apiCreateTask(user, payload);
    case 'startTask': return apiStartTask(user, payload);
    case 'submitTaskForReview': return apiSubmitTaskForReview(user, payload);
    case 'reviewTask': return apiReviewTask(user, payload);
    case 'uploadFilingAndClose': return apiUploadFilingAndClose(user, payload);
    case 'endAssignmentEarly': return apiEndAssignmentEarly(user, payload);

    // Resource Availability, Attendance & Bookings
    case 'markAttendance': return apiMarkAttendance(user, payload);
    case 'updateAvailabilityStatus': return apiUpdateAvailabilityStatus(user, payload);
    case 'createResourceBooking': return apiCreateResourceBooking(user, payload);
    case 'completeResourceBooking': return apiCompleteResourceBooking(user, payload);

    // Weekly Timesheets
    case 'ensureCurrentTimesheet': return apiEnsureCurrentTimesheet(user);
    case 'saveTimesheetDetail': return apiSaveTimesheetDetail(user, payload);
    case 'addTimesheetRow': return apiAddTimesheetRow(user, payload);
    case 'submitTimesheetWeek': return apiSubmitTimesheetWeek(user, payload);

    // Personal To-Do
    case 'createTodo': return apiCreateTodo(user, payload);
    case 'toggleTodoDone': return apiToggleTodoDone(user, payload);

    // Clients, KYC & Compliance Library (Manager+)
    case 'createClient': return apiCreateClient(user, payload);
    case 'uploadClientKyc': return apiUploadClientKyc(user, payload);
    case 'createComplianceTemplate': return apiCreateComplianceTemplate(user, payload);
    case 'createClientComplianceMap': return apiCreateClientComplianceMap(user, payload);
    case 'toggleClientComplianceMap': return apiToggleClientComplianceMap(user, payload);

    // Team Directory (Manager+ / Partner)
    case 'createEmployee': return apiCreateEmployee(user, payload);
    case 'toggleEmployeeStatus': return apiToggleEmployeeStatus(user, payload);
    case 'resetEmployeePin': return apiResetEmployeePin(user, payload);

    // Admin Backup
    case 'triggerManualBackup':
      requireManagerOrAbove(user);
      return runWorkbookBackup();

    default:
      throw new Error('Unknown API action: ' + action);
  }
}

/* ==========================================================================
   BOOTSTRAP & COMPUTED RESOURCE AVAILABILITY ENGINE
   ========================================================================== */

function computeResourceAvailability(employees, tasks, bookings, attendanceToday, attendanceAffects) {
  var today = formatISODate();
  var belowManagers = employees.filter(function (e) {
    return e.status === 'Active' && Number(e.role_level) < MANAGER_MIN_LEVEL;
  });

  var rows = belowManagers.map(function (emp) {
    var activeTasks = tasks.filter(function (t) {
      return t.assigned_to_id === emp.employee_id && t.status !== 'Filed';
    });
    var activeBooking = bookings.find(function (b) {
      return b.employee_id === emp.employee_id &&
        b.status === 'Active' &&
        b.start_date <= today &&
        b.end_date >= today;
    });
    var checkedIn = attendanceToday.find(function (a) {
      return a.employee_id === emp.employee_id;
    });

    // Layered availability priority:
    // 1. On Leave / Exam Leave override
    // 2. No Attendance today (if enabled)
    // 3. Active Booking (Blocked)
    // 4. Active Task Count: 0 = Free, 1 = Available Soon, 2+ = Busy
    var computedStatus = 'Free';
    var statusColor = 'green';
    var rankWeight = 1;

    if (emp.availability_status === 'On Leave' || emp.availability_status === 'Exam Leave') {
      computedStatus = emp.availability_status;
      statusColor = 'gray';
      rankWeight = 5;
    } else if (attendanceAffects && !checkedIn) {
      computedStatus = 'Absent';
      statusColor = 'slate';
      rankWeight = 4;
    } else if (activeBooking) {
      computedStatus = 'Blocked';
      statusColor = 'purple';
      rankWeight = 4;
    } else if (activeTasks.length === 0) {
      computedStatus = 'Free';
      statusColor = 'green';
      rankWeight = 1;
    } else if (activeTasks.length === 1) {
      computedStatus = 'Available Soon';
      statusColor = 'orange';
      rankWeight = 2;
    } else {
      computedStatus = 'Busy';
      statusColor = 'red';
      rankWeight = 3;
    }

    // Working With (unique Reviewer / Manager names on active tasks)
    var managersMap = {};
    activeTasks.forEach(function (t) {
      if (t.reviewer_name) managersMap[t.reviewer_name] = true;
    });
    if (activeBooking && activeBooking.booked_by_name) {
      managersMap[activeBooking.booked_by_name] = true;
    }
    var workingWith = Object.keys(managersMap).join(', ');

    // Expected Free Date: blank ("Free") when 0 active tasks & Free; else MAX(Today, Latest Due_Date)
    var expectedFreeDate = '';
    if (activeTasks.length > 0) {
      var latest = activeTasks.reduce(function (maxD, t) {
        return (t.due_date && t.due_date > maxD) ? t.due_date : maxD;
      }, today);
      expectedFreeDate = latest < today ? today : latest;
    } else if (activeBooking && activeBooking.end_date) {
      expectedFreeDate = activeBooking.end_date < today ? today : activeBooking.end_date;
    }

    return {
      employee_id: emp.employee_id,
      full_name: emp.full_name,
      email: emp.email,
      role: emp.role,
      role_level: Number(emp.role_level),
      location: emp.location,
      manual_status: emp.availability_status || 'Available',
      leave_reason: emp.leave_reason || '',
      attendance_today: checkedIn ? checkedIn.status : 'Not Marked',
      check_in_time: checkedIn ? checkedIn.check_in_time : '',
      active_task_count: activeTasks.length,
      computed_status: computedStatus,
      status_color: statusColor,
      working_with: workingWith,
      expected_free_date: expectedFreeDate,
      active_booking: activeBooking || null,
      _rankWeight: rankWeight
    };
  });

  // Sort by Auto Resource Suggestion ranking: Free -> Available Soon -> lowest active tasks -> earliest expected free date
  rows.sort(function (a, b) {
    if (a._rankWeight !== b._rankWeight) return a._rankWeight - b._rankWeight;
    if (a.active_task_count !== b.active_task_count) return a.active_task_count - b.active_task_count;
    var dateA = a.expected_free_date || '0000-00-00';
    var dateB = b.expected_free_date || '0000-00-00';
    return dateA.localeCompare(dateB);
  });

  return rows;
}

function apiGetBootstrap(user) {
  var isManager = Number(user.role_level) >= MANAGER_MIN_LEVEL;
  var today = formatISODate();

  var allEmployees = readSheetObjects(SHEETS.EMPLOYEES).map(sanitizeEmployee);
  var allTasks = readSheetObjects(SHEETS.TASKS);
  var archivedTasks = readSheetObjects(SHEETS.TASKS_ARCHIVE);
  var auditLogs = readSheetObjects(SHEETS.TASK_AUDIT);
  var clients = readSheetObjects(SHEETS.CLIENTS);
  var compliances = readSheetObjects(SHEETS.COMPLIANCE_MASTER);
  var clientMaps = readSheetObjects(SHEETS.CLIENT_COMPLIANCE_MAP);
  var attendanceAll = readSheetObjects(SHEETS.ATTENDANCE);
  var bookings = readSheetObjects(SHEETS.BOOKINGS);
  var tsWeeks = readSheetObjects(SHEETS.TIMESHEET_WEEK);
  var tsArchive = readSheetObjects(SHEETS.TIMESHEET_WEEK_ARCHIVE);
  var tsDetails = readSheetObjects(SHEETS.TIMESHEET_DETAIL);
  var todos = readSheetObjects(SHEETS.TODOS).filter(function (td) {
    return td.employee_id === user.employee_id;
  });

  var attendanceToday = attendanceAll.filter(function (a) { return a.date === today; });
  var attendanceAffects = getSetting('attendance_affects_availability', 'true') === 'true';

  // Enforce Executive Screen Lock at API layer too
  var visibleTasks = isManager
    ? allTasks
    : allTasks.filter(function (t) {
        return t.assigned_to_id === user.employee_id || t.reviewer_id === user.employee_id;
      });

  var visibleArchive = isManager
    ? archivedTasks
    : archivedTasks.filter(function (t) {
        return t.assigned_to_id === user.employee_id || t.reviewer_id === user.employee_id;
      });

  var visibleTsWeeks = isManager
    ? tsWeeks
    : tsWeeks.filter(function (w) { return w.employee_id === user.employee_id; });

  var visibleTsArchive = isManager
    ? tsArchive
    : tsArchive.filter(function (w) { return w.employee_id === user.employee_id; });

  var visibleTsDetails = isManager
    ? tsDetails
    : tsDetails.filter(function (d) { return d.employee_id === user.employee_id; });

  var resourceAvailability = isManager
    ? computeResourceAvailability(allEmployees, allTasks, bookings, attendanceToday, attendanceAffects)
    : [];

  return {
    user: user,
    today: today,
    firm_name: getSetting('firm_name', APP_CONFIG.FIRM_NAME),
    drive_root_url: getSetting('drive_root_url', ''),
    last_backup_at: getSetting('last_backup_at', ''),
    self_status_lock_hour: Number(getSetting('self_status_lock_hour', '11')),
    employees: allEmployees,
    clients: clients,
    compliances: compliances,
    client_compliance_map: isManager ? clientMaps : [],
    tasks: visibleTasks,
    archived_tasks: visibleArchive,
    audit_logs: isManager ? auditLogs.slice(-200) : auditLogs.filter(function (l) {
      return visibleTasks.some(function (t) { return t.task_id === l.task_id; });
    }),
    attendance_today: isManager ? attendanceToday : attendanceToday.filter(function (a) {
      return a.employee_id === user.employee_id;
    }),
    attendance_history: isManager ? attendanceAll.slice(-150) : attendanceAll.filter(function (a) {
      return a.employee_id === user.employee_id;
    }).slice(-30),
    bookings: isManager ? bookings : [],
    resource_availability: resourceAvailability,
    timesheet_weeks: visibleTsWeeks,
    timesheet_archive: visibleTsArchive,
    timesheet_details: visibleTsDetails,
    todos: todos
  };
}

/* ==========================================================================
   TASK LIFECYCLE & AUDIT TRAIL
   ========================================================================== */

function logTaskAudit(taskId, action, oldStatus, newStatus, user, notes) {
  appendSheetObject(SHEETS.TASK_AUDIT, {
    log_id: generateId('AUD'),
    task_id: taskId,
    action: action,
    old_status: oldStatus || '',
    new_status: newStatus || '',
    actor_id: user.employee_id,
    actor_name: user.full_name,
    actor_role: user.role,
    notes: notes || '',
    timestamp: formatISOTimestamp()
  });
}

function apiCreateTask(user, payload) {
  requireManagerOrAbove(user);

  var assignee = findEmployeeById(payload.assigned_to_id);
  var reviewer = findEmployeeById(payload.reviewer_id);
  if (!assignee || assignee.status !== 'Active') {
    throw new Error('Selected Assignee must be an active employee.');
  }
  if (Number(assignee.role_level) >= MANAGER_MIN_LEVEL) {
    throw new Error('Tasks can only be assigned to active roles below Manager (Senior Associate, Associate, Executive).');
  }
  if (!reviewer || reviewer.status !== 'Active') {
    throw new Error('Selected Reviewer must be an active employee.');
  }
  if (reviewer.role === 'Executive') {
    throw new Error('Executives cannot be selected as Reviewer.');
  }
  if (assignee.employee_id === reviewer.employee_id) {
    throw new Error('Reviewer and Assignee cannot be the same person.');
  }
  if (Number(reviewer.role_level) <= Number(assignee.role_level)) {
    throw new Error('Reviewer must be at a higher hierarchy level than the Assignee.');
  }
  if (!payload.client_id || !payload.compliance_name || !payload.due_date) {
    throw new Error('Client, Compliance, and Due Date are required.');
  }

  var clients = readSheetObjects(SHEETS.CLIENTS);
  var client = clients.find(function (c) { return c.client_id === payload.client_id; });
  if (!client) throw new Error('Client not found.');

  var today = formatISODate();
  var task = {
    task_id: generateId('TSK'),
    client_id: client.client_id,
    client_name: client.client_name,
    compliance_id: payload.compliance_id || '',
    compliance_name: payload.compliance_name,
    frequency: payload.frequency || 'One-time',
    period_label: payload.period_label || '',
    assigned_to_id: assignee.employee_id,
    assigned_to_name: assignee.full_name,
    assigned_to_email: assignee.email,
    reviewer_id: reviewer.employee_id,
    reviewer_name: reviewer.full_name,
    reviewer_email: reviewer.email,
    assigned_by_name: user.full_name,
    assigned_date: today,
    due_date: payload.due_date,
    status: 'Pending',
    completion_date: '',
    approval_date: '',
    filing_date: '',
    filing_file_url: '',
    filing_file_name: '',
    remarks: payload.remarks || '',
    last_reminded_on: '',
    created_at: formatISOTimestamp(),
    updated_at: formatISOTimestamp()
  };

  appendSheetObject(SHEETS.TASKS, task);
  logTaskAudit(task.task_id, 'Task Assigned', '', 'Pending', user, 'Assigned to ' + assignee.full_name);

  // Auto-create To-Do item for Assignee
  appendSheetObject(SHEETS.TODOS, {
    todo_id: generateId('TODO'),
    employee_id: assignee.employee_id,
    employee_name: assignee.full_name,
    title: task.client_name + ' — ' + task.compliance_name,
    linked_task_id: task.task_id,
    due_date: task.due_date,
    priority: 'High',
    status: 'Open',
    created_at: formatISOTimestamp(),
    completed_at: ''
  });

  sendTaskAssignedEmail(task);
  return task;
}

function findTaskRow(taskId) {
  var tasks = readSheetObjects(SHEETS.TASKS);
  var task = tasks.find(function (t) { return t.task_id === taskId; });
  if (!task) throw new Error('Task not found (it may already be Filed and Archived).');
  if (task.status === 'Filed') throw new Error('Filed tasks are permanently frozen and read-only.');
  return task;
}

function apiStartTask(user, payload) {
  var task = findTaskRow(payload.task_id);
  if (task.assigned_to_id !== user.employee_id && Number(user.role_level) < MANAGER_MIN_LEVEL) {
    throw new Error('Only the assigned employee can start this task.');
  }
  if (task.status !== 'Pending') {
    throw new Error('Only Pending tasks can be started.');
  }
  updateSheetRow(SHEETS.TASKS, task._rowIndex, {
    status: 'In Process',
    updated_at: formatISOTimestamp()
  });
  logTaskAudit(task.task_id, 'Start Work', 'Pending', 'In Process', user, '');
  return { ok: true, status: 'In Process' };
}

function apiSubmitTaskForReview(user, payload) {
  var task = findTaskRow(payload.task_id);
  if (task.assigned_to_id !== user.employee_id && Number(user.role_level) < MANAGER_MIN_LEVEL) {
    throw new Error('Only the assigned employee can submit this task for review.');
  }
  if (task.status !== 'In Process' && task.status !== 'Pending') {
    throw new Error('Task must be In Process before submitting for review.');
  }
  var compDate = task.completion_date || formatISODate(); // Lock completion_date once
  var updates = {
    status: 'Pending for Review',
    completion_date: compDate,
    remarks: payload.remarks !== undefined ? payload.remarks : task.remarks,
    updated_at: formatISOTimestamp()
  };
  updateSheetRow(SHEETS.TASKS, task._rowIndex, updates);
  logTaskAudit(task.task_id, 'Submitted for Review', task.status, 'Pending for Review', user, payload.remarks || '');

  task.status = 'Pending for Review';
  task.completion_date = compDate;
  sendTaskSubmittedForReviewEmail(task);
  return { ok: true, status: 'Pending for Review' };
}

function apiReviewTask(user, payload) {
  var task = findTaskRow(payload.task_id);
  var decision = payload.decision; // 'Approve' or 'Reject'
  if (task.status !== 'Pending for Review') {
    throw new Error('Task is not currently Pending for Review.');
  }
  if (task.assigned_to_id === user.employee_id) {
    throw new Error('NO SELF-APPROVAL: You cannot approve or review your own task.');
  }
  if (task.reviewer_id !== user.employee_id && Number(user.role_level) < MANAGER_MIN_LEVEL) {
    throw new Error('Only the designated Reviewer or a Manager+ can review this task.');
  }

  if (decision === 'Approve') {
    var apprDate = task.approval_date || formatISODate(); // Lock approval_date once
    updateSheetRow(SHEETS.TASKS, task._rowIndex, {
      status: 'Approved',
      approval_date: apprDate,
      remarks: payload.remarks ? (task.remarks ? task.remarks + ' | Reviewer: ' + payload.remarks : payload.remarks) : task.remarks,
      updated_at: formatISOTimestamp()
    });
    logTaskAudit(task.task_id, 'Approved', 'Pending for Review', 'Approved', user, payload.remarks || '');
    task.status = 'Approved';
    task.approval_date = apprDate;
    sendTaskApprovedEmail(task);
    return { ok: true, status: 'Approved' };
  }

  if (decision === 'Reject') {
    updateSheetRow(SHEETS.TASKS, task._rowIndex, {
      status: 'In Process',
      remarks: payload.remarks || 'Sent back by reviewer',
      updated_at: formatISOTimestamp()
    });
    logTaskAudit(task.task_id, 'Rejected', 'Pending for Review', 'In Process', user, payload.remarks || '');
    sendTaskRejectedEmail(task, payload.remarks);
    return { ok: true, status: 'In Process' };
  }

  throw new Error('Invalid review decision.');
}

function apiUploadFilingAndClose(user, payload) {
  var task = findTaskRow(payload.task_id);
  if (task.status !== 'Approved') {
    throw new Error('Task must be Approved before uploading final filing.');
  }
  if (!payload.file_base64) {
    throw new Error('A filing document attachment is mandatory to mark a task as Filed.');
  }

  // Upload to Drive with structured naming & timestamp
  var uploaded = uploadTaskFilingToDrive(
    task,
    payload.file_base64,
    payload.file_name || 'filing.pdf',
    payload.mime_type || 'application/pdf'
  );

  var filingDate = task.filing_date || formatISODate();
  var nowTs = formatISOTimestamp();

  // Archive into Task_Register_Archive and remove from active Task_Register (no deletion of history)
  var archivedRecord = Object.assign({}, task, {
    status: 'Filed',
    filing_date: filingDate,
    filing_file_url: uploaded.file_url,
    filing_file_name: uploaded.file_name,
    updated_at: nowTs,
    archived_at: nowTs
  });
  appendSheetObject(SHEETS.TASKS_ARCHIVE, archivedRecord);

  // Delete active row only after archive copy succeeds
  var activeSheet = getSheetOrThrow(SHEETS.TASKS);
  activeSheet.deleteRow(task._rowIndex);

  // Auto-complete linked To-Do
  var todos = readSheetObjects(SHEETS.TODOS);
  todos.forEach(function (td) {
    if (td.linked_task_id === task.task_id && td.status !== 'Done') {
      updateSheetRow(SHEETS.TODOS, td._rowIndex, {
        status: 'Done',
        completed_at: nowTs
      });
    }
  });

  logTaskAudit(task.task_id, 'Filed & Archived', 'Approved', 'Filed', user, uploaded.file_name);
  sendTaskFiledEmail(archivedRecord);

  return {
    ok: true,
    status: 'Filed',
    filing_file_url: uploaded.file_url,
    filing_file_name: uploaded.file_name
  };
}

function apiEndAssignmentEarly(user, payload) {
  requireManagerOrAbove(user);
  var task = findTaskRow(payload.task_id);
  if (task.reviewer_id !== user.employee_id && Number(user.role_level) < 6) {
    throw new Error('You can only end your own resource assignments early.');
  }
  var today = formatISODate();
  updateSheetRow(SHEETS.TASKS, task._rowIndex, {
    due_date: today,
    remarks: (task.remarks ? task.remarks + ' | ' : '') + 'Assignment ended early by ' + user.full_name,
    updated_at: formatISOTimestamp()
  });
  logTaskAudit(task.task_id, 'Ended Assignment Early', task.status, task.status, user, 'Due date moved to ' + today);
  return { ok: true };
}

/* ==========================================================================
   ATTENDANCE, DAILY 11 AM STATUS LOCK & RESOURCE BOOKINGS
   ========================================================================== */

function apiMarkAttendance(user, payload) {
  var today = formatISODate();
  var all = readSheetObjects(SHEETS.ATTENDANCE);
  var existing = all.find(function (a) {
    return a.employee_id === user.employee_id && a.date === today;
  });
  if (existing) {
    throw new Error('Attendance already marked today at ' + existing.check_in_time + '.');
  }

  var now = new Date();
  var hh = parseInt(Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'H'), 10);
  var mm = parseInt(Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'm'), 10);
  var isLate = (hh > APP_CONFIG.LATE_ATTENDANCE_HOUR) ||
    (hh === APP_CONFIG.LATE_ATTENDANCE_HOUR && mm > APP_CONFIG.LATE_ATTENDANCE_MINUTE);

  var record = {
    attendance_id: generateId('ATT'),
    employee_id: user.employee_id,
    employee_name: user.full_name,
    employee_role: user.role,
    date: today,
    check_in_time: Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'hh:mm a'),
    status: isLate ? 'Late' : 'Present',
    latitude: payload.latitude ? String(payload.latitude) : '',
    longitude: payload.longitude ? String(payload.longitude) : '',
    location_note: payload.location_note || user.location || ''
  };
  appendSheetObject(SHEETS.ATTENDANCE, record);
  return record;
}

function apiUpdateAvailabilityStatus(user, payload) {
  var targetId = payload.employee_id || user.employee_id;
  var newStatus = payload.availability_status; // 'Available', 'On Leave', 'Exam Leave'
  var leaveReason = payload.leave_reason || '';

  if (['Available', 'On Leave', 'Exam Leave'].indexOf(newStatus) === -1) {
    throw new Error('Invalid status. Choose Available, On Leave, or Exam Leave.');
  }

  var target = findEmployeeById(targetId);
  if (!target) throw new Error('Employee not found.');
  if (target.role === 'Partner') {
    throw new Error('Partner status is permanently set to Always Available.');
  }

  var isSelf = (target.employee_id === user.employee_id);
  var isManager = Number(user.role_level) >= MANAGER_MIN_LEVEL;

  if (!isSelf && !isManager) {
    throw new Error('Only Managers and above can update another team member\'s availability.');
  }

  // Daily 11:00 AM IST lock for self-updates by non-Managers
  if (isSelf && !isManager) {
    var currentHour = parseInt(Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'H'), 10);
    var lockHour = Number(getSetting('self_status_lock_hour', String(APP_CONFIG.SELF_STATUS_LOCK_HOUR)));
    if (currentHour >= lockHour) {
      throw new Error('Self-status updates lock at ' + lockHour + ':00 AM IST. Please ask your Manager to update your leave status.');
    }
  }

  updateSheetRow(SHEETS.EMPLOYEES, target._rowIndex, {
    availability_status: newStatus,
    leave_reason: newStatus === 'Available' ? '' : leaveReason,
    leave_updated_at: formatISOTimestamp()
  });

  return { ok: true, employee_id: targetId, availability_status: newStatus };
}

function apiCreateResourceBooking(user, payload) {
  requireManagerOrAbove(user);
  var target = findEmployeeById(payload.employee_id);
  if (!target || target.status !== 'Active') throw new Error('Target resource must be an active employee.');
  if (Number(target.role_level) >= MANAGER_MIN_LEVEL) {
    throw new Error('Resource bookings apply only to active staff below Manager.');
  }
  if (!payload.start_date || !payload.end_date || payload.end_date < payload.start_date) {
    throw new Error('Valid start_date and end_date are required.');
  }

  var booking = {
    booking_id: generateId('BKG'),
    employee_id: target.employee_id,
    employee_name: target.full_name,
    booked_by_id: user.employee_id,
    booked_by_name: user.full_name,
    client_name: payload.client_name || '',
    start_date: payload.start_date,
    end_date: payload.end_date,
    reason: payload.reason || 'Client engagement',
    status: 'Active',
    created_at: formatISOTimestamp()
  };
  appendSheetObject(SHEETS.BOOKINGS, booking);
  return booking;
}

function apiCompleteResourceBooking(user, payload) {
  requireManagerOrAbove(user);
  var bookings = readSheetObjects(SHEETS.BOOKINGS);
  var b = bookings.find(function (x) { return x.booking_id === payload.booking_id; });
  if (!b) throw new Error('Booking not found.');
  updateSheetRow(SHEETS.BOOKINGS, b._rowIndex, { status: 'Completed' });
  return { ok: true };
}

/* ==========================================================================
   WEEKLY TIMESHEET SYSTEM (PREVIOUS-WEEK MON–SAT CONSULTING GRID)
   ========================================================================== */

function apiEnsureCurrentTimesheet(user) {
  var range = getPreviousWeekRange(new Date());
  var allWeeks = readSheetObjects(SHEETS.TIMESHEET_WEEK).concat(
    readSheetObjects(SHEETS.TIMESHEET_WEEK_ARCHIVE)
  );
  var existing = allWeeks.find(function (w) {
    return w.employee_id === user.employee_id && w.week_start === range.weekStart;
  });
  if (existing) return existing;
  return createTimesheetWeekForEmployee(user, range);
}

function recalculateWeekTotalHours(weekId) {
  var details = readSheetObjects(SHEETS.TIMESHEET_DETAIL).filter(function (d) {
    return d.week_id === weekId;
  });
  var total = details.reduce(function (sum, d) {
    return sum + (parseFloat(d.hours) || 0);
  }, 0);
  var weeks = readSheetObjects(SHEETS.TIMESHEET_WEEK);
  var wk = weeks.find(function (w) { return w.week_id === weekId; });
  if (wk) {
    updateSheetRow(SHEETS.TIMESHEET_WEEK, wk._rowIndex, { total_hours: String(Math.round(total * 100) / 100) });
  }
  return total;
}

function apiSaveTimesheetDetail(user, payload) {
  var details = readSheetObjects(SHEETS.TIMESHEET_DETAIL);
  var row = details.find(function (d) { return d.detail_id === payload.detail_id; });
  if (!row) throw new Error('Timesheet row not found.');
  if (row.employee_id !== user.employee_id) {
    throw new Error('You can only edit your own timesheet rows.');
  }

  var weeks = readSheetObjects(SHEETS.TIMESHEET_WEEK);
  var wk = weeks.find(function (w) { return w.week_id === row.week_id; });
  if (!wk || wk.status === 'Submitted') {
    throw new Error('This timesheet week is already submitted and locked.');
  }

  var newHours = parseFloat(payload.hours) || 0;
  if (newHours < 0 || newHours > APP_CONFIG.MAX_DAILY_TIMESHEET_HOURS) {
    throw new Error('Hours must be between 0 and ' + APP_CONFIG.MAX_DAILY_TIMESHEET_HOURS + ' per day.');
  }

  // Validate total hours for the same work_date <= 10h
  var sameDayOtherHours = details.reduce(function (sum, d) {
    if (d.week_id === row.week_id && d.work_date === row.work_date && d.detail_id !== row.detail_id) {
      return sum + (parseFloat(d.hours) || 0);
    }
    return sum;
  }, 0);
  if (sameDayOtherHours + newHours > APP_CONFIG.MAX_DAILY_TIMESHEET_HOURS) {
    throw new Error('Total hours on ' + formatIndianDate(row.work_date) + ' cannot exceed ' + APP_CONFIG.MAX_DAILY_TIMESHEET_HOURS + ' hours.');
  }

  updateSheetRow(SHEETS.TIMESHEET_DETAIL, row._rowIndex, {
    client_id: payload.client_id || '',
    client_name: payload.client_name || '',
    compliance_name: payload.compliance_name || '',
    task_description: payload.task_description || '',
    hours: String(newHours),
    updated_at: formatISOTimestamp()
  });

  var total = recalculateWeekTotalHours(row.week_id);
  return { ok: true, total_hours: total };
}

function apiAddTimesheetRow(user, payload) {
  var weeks = readSheetObjects(SHEETS.TIMESHEET_WEEK);
  var wk = weeks.find(function (w) { return w.week_id === payload.week_id; });
  if (!wk || wk.employee_id !== user.employee_id) {
    throw new Error('Timesheet week not found or access denied.');
  }
  if (wk.status === 'Submitted') {
    throw new Error('Cannot add rows to a submitted timesheet.');
  }
  var newRow = {
    detail_id: generateId('TSD'),
    week_id: wk.week_id,
    employee_id: user.employee_id,
    employee_name: user.full_name,
    week_start: wk.week_start,
    work_date: payload.work_date,
    day_name: payload.day_name || '',
    client_id: payload.client_id || '',
    client_name: payload.client_name || '',
    compliance_name: payload.compliance_name || '',
    task_description: payload.task_description || '',
    hours: '0',
    updated_at: formatISOTimestamp()
  };
  appendSheetObject(SHEETS.TIMESHEET_DETAIL, newRow);
  return newRow;
}

function apiSubmitTimesheetWeek(user, payload) {
  var weeks = readSheetObjects(SHEETS.TIMESHEET_WEEK);
  var wk = weeks.find(function (w) { return w.week_id === payload.week_id; });
  if (!wk) throw new Error('Timesheet week not found.');
  if (wk.employee_id !== user.employee_id) {
    throw new Error('You can only submit your own timesheet.');
  }
  if (wk.status === 'Submitted') {
    throw new Error('Timesheet is already submitted.');
  }

  var total = recalculateWeekTotalHours(wk.week_id);
  var nowTs = formatISOTimestamp();

  // Archive to Timesheet_Week_Archive while keeping Timesheet_Detail rows readable via employee_name & week_start
  var archived = Object.assign({}, wk, {
    total_hours: String(Math.round(total * 100) / 100),
    status: 'Submitted',
    submitted_at: nowTs,
    archived_at: nowTs
  });
  appendSheetObject(SHEETS.TIMESHEET_WEEK_ARCHIVE, archived);

  var activeSheet = getSheetOrThrow(SHEETS.TIMESHEET_WEEK);
  activeSheet.deleteRow(wk._rowIndex);

  return { ok: true, week_id: wk.week_id, total_hours: total };
}

/* ==========================================================================
   TO-DO LIST, CLIENTS, KYC, COMPLIANCE LIBRARY & TEAM DIRECTORY
   ========================================================================== */

function apiCreateTodo(user, payload) {
  if (!payload.title) throw new Error('To-Do title is required.');
  var todo = {
    todo_id: generateId('TODO'),
    employee_id: user.employee_id,
    employee_name: user.full_name,
    title: payload.title,
    linked_task_id: payload.linked_task_id || '',
    due_date: payload.due_date || '',
    priority: payload.priority || 'Medium',
    status: 'Open',
    created_at: formatISOTimestamp(),
    completed_at: ''
  };
  appendSheetObject(SHEETS.TODOS, todo);
  return todo;
}

function apiToggleTodoDone(user, payload) {
  var todos = readSheetObjects(SHEETS.TODOS);
  var td = todos.find(function (x) { return x.todo_id === payload.todo_id && x.employee_id === user.employee_id; });
  if (!td) throw new Error('To-Do item not found.');
  var next = td.status === 'Done' ? 'Open' : 'Done';
  updateSheetRow(SHEETS.TODOS, td._rowIndex, {
    status: next,
    completed_at: next === 'Done' ? formatISOTimestamp() : ''
  });
  return { ok: true, status: next };
}

function apiCreateClient(user, payload) {
  requireManagerOrAbove(user);
  if (!payload.client_name) throw new Error('Client name is required.');
  var kycFolder = ensureClientKycFolder(payload.client_name);
  var client = {
    client_id: generateId('CLN'),
    client_name: payload.client_name.trim(),
    pan: (payload.pan || '').toUpperCase().trim(),
    gstin: (payload.gstin || '').toUpperCase().trim(),
    cin: (payload.cin || '').toUpperCase().trim(),
    entity_type: payload.entity_type || 'Private Limited',
    location: payload.location || '',
    primary_partner: payload.primary_partner || user.full_name,
    contact_name: payload.contact_name || '',
    contact_email: payload.contact_email || '',
    contact_phone: payload.contact_phone || '',
    kyc_folder_url: kycFolder.getUrl(),
    status: 'Active',
    created_at: formatISOTimestamp()
  };
  appendSheetObject(SHEETS.CLIENTS, client);
  return client;
}

function apiUploadClientKyc(user, payload) {
  requireManagerOrAbove(user);
  var clients = readSheetObjects(SHEETS.CLIENTS);
  var client = clients.find(function (c) { return c.client_id === payload.client_id; });
  if (!client) throw new Error('Client not found.');
  var res = uploadClientKycToDrive(
    client.client_name,
    payload.doc_type || 'KYC',
    payload.file_base64,
    payload.file_name || 'kyc.pdf',
    payload.mime_type || 'application/pdf'
  );
  if (!client.kyc_folder_url) {
    updateSheetRow(SHEETS.CLIENTS, client._rowIndex, { kyc_folder_url: res.folder_url });
  }
  return res;
}

function apiCreateComplianceTemplate(user, payload) {
  requireManagerOrAbove(user);
  if (!payload.compliance_name) throw new Error('Compliance name is required.');
  var item = {
    compliance_id: generateId('CMP'),
    compliance_name: payload.compliance_name.trim(),
    category: payload.category || 'GST',
    frequency: payload.frequency || 'Monthly',
    default_due_day: String(payload.default_due_day || '15'),
    statutory_due_rule: payload.statutory_due_rule || '',
    description: payload.description || '',
    active: 'Yes'
  };
  appendSheetObject(SHEETS.COMPLIANCE_MASTER, item);
  return item;
}

function apiCreateClientComplianceMap(user, payload) {
  requireManagerOrAbove(user);
  var clients = readSheetObjects(SHEETS.CLIENTS);
  var compliances = readSheetObjects(SHEETS.COMPLIANCE_MASTER);
  var cl = clients.find(function (c) { return c.client_id === payload.client_id; });
  var cm = compliances.find(function (c) { return c.compliance_id === payload.compliance_id; });
  if (!cl || !cm) throw new Error('Valid Client and Compliance template required.');

  var rec = {
    map_id: generateId('MAP'),
    client_id: cl.client_id,
    client_name: cl.client_name,
    compliance_id: cm.compliance_id,
    compliance_name: cm.compliance_name,
    frequency: payload.frequency || cm.frequency,
    start_date: payload.start_date || formatISODate(),
    due_day: String(payload.due_day || cm.default_due_day || '15'),
    default_assigned_to: payload.default_assigned_to || '',
    default_reviewer: payload.default_reviewer || '',
    active: 'Yes',
    last_generated_period: ''
  };
  appendSheetObject(SHEETS.CLIENT_COMPLIANCE_MAP, rec);
  return rec;
}

function apiToggleClientComplianceMap(user, payload) {
  requireManagerOrAbove(user);
  var maps = readSheetObjects(SHEETS.CLIENT_COMPLIANCE_MAP);
  var m = maps.find(function (x) { return x.map_id === payload.map_id; });
  if (!m) throw new Error('Mapping not found.');
  var next = m.active === 'Yes' ? 'No' : 'Yes';
  updateSheetRow(SHEETS.CLIENT_COMPLIANCE_MAP, m._rowIndex, { active: next });
  return { ok: true, active: next };
}

function apiCreateEmployee(user, payload) {
  requireManagerOrAbove(user);
  var email = String(payload.email || '').trim().toLowerCase();
  if (!payload.full_name || !email || !ROLE_LEVELS[payload.role]) {
    throw new Error('Full name, valid work email, and hierarchy role are required.');
  }
  if (findEmployeeByEmail(email)) {
    throw new Error('An employee with email ' + email + ' already exists.');
  }

  var tempPin = String(payload.temp_pin || '123456').trim();
  var salt = generateSalt();
  var hash = hashPin(tempPin, salt);

  var emp = {
    employee_id: generateId('EMP'),
    full_name: payload.full_name.trim(),
    email: email,
    role: payload.role,
    role_level: ROLE_LEVELS[payload.role],
    location: payload.location || 'New Delhi',
    reporting_to: payload.reporting_to || '',
    status: 'Active',
    availability_status: payload.role === 'Partner' ? 'Always Available' : 'Available',
    leave_reason: '',
    leave_updated_at: formatISOTimestamp(),
    pin_hash: hash,
    pin_salt: salt,
    must_change_pin: 'Yes',
    created_at: formatISOTimestamp()
  };
  appendSheetObject(SHEETS.EMPLOYEES, emp);
  return sanitizeEmployee(emp);
}

function apiToggleEmployeeStatus(user, payload) {
  requireManagerOrAbove(user);
  // Rule: Never delete employees — deactivate only so history & audit trails remain intact
  var emp = findEmployeeById(payload.employee_id);
  if (!emp) throw new Error('Employee not found.');
  if (emp.employee_id === user.employee_id) {
    throw new Error('You cannot deactivate your own account.');
  }
  var nextStatus = emp.status === 'Active' ? 'Inactive' : 'Active';
  updateSheetRow(SHEETS.EMPLOYEES, emp._rowIndex, { status: nextStatus });
  return { ok: true, employee_id: emp.employee_id, status: nextStatus };
}

function apiResetEmployeePin(user, payload) {
  requireManagerOrAbove(user);
  var emp = findEmployeeById(payload.employee_id);
  if (!emp) throw new Error('Employee not found.');
  var newPin = String(payload.new_pin || '123456').trim();
  if (!/^\d{4,8}$/.test(newPin)) throw new Error('PIN must be 4 to 8 digits.');
  var salt = generateSalt();
  updateSheetRow(SHEETS.EMPLOYEES, emp._rowIndex, {
    pin_salt: salt,
    pin_hash: hashPin(newPin, salt),
    must_change_pin: 'Yes'
  });
  return { ok: true };
}
