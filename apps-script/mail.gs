/**
 * Automated email notifications via Apps Script MailApp.sendEmail().
 * Default mode ('daily_digest'): sends STRICTLY AT MOST ONE consolidated
 * daily digest email per person per day (at 9:00 AM IST) so a 35–50 person
 * firm stays comfortably inside Google's free @gmail.com 100/day email quota.
 */

function isDailyDigestOnlyMode() {
  try {
    return getSetting('email_mode', 'daily_digest') === 'daily_digest';
  } catch (e) {
    return true;
  }
}

function safeSendEmail(to, subject, htmlBody, cc) {
  if (!to) return;
  try {
    var options = {
      name: APP_CONFIG.FIRM_NAME + ' Compliance Tracker',
      htmlBody: htmlBody
    };
    if (cc) options.cc = cc;
    MailApp.sendEmail(to, subject, htmlBody.replace(/<[^>]+>/g, ' '), options);
  } catch (e) {
    Logger.log('Email failed to ' + to + ': ' + e.message);
  }
}

function buildEmailWrapper(title, bodyHtml) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">' +
    '<div style="background:#0f172a;color:#ffffff;padding:16px 20px;">' +
    '<div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">' + APP_CONFIG.FIRM_NAME + '</div>' +
    '<div style="font-size:18px;font-weight:600;margin-top:4px;">' + title + '</div>' +
    '</div>' +
    '<div style="padding:20px;color:#1e293b;font-size:14px;line-height:1.6;">' + bodyHtml + '</div>' +
    '<div style="background:#f8fafc;padding:12px 20px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">' +
    'Daily Consolidated Digest &bull; ' + APP_CONFIG.APP_NAME + ' (1 email/day per person).' +
    '</div></div>';
}

function renderDigestSection(title, colorHex, itemsHtml) {
  if (!itemsHtml || itemsHtml.length === 0) return '';
  return '<div style="margin:16px 0 8px;padding:6px 10px;border-left:4px solid ' + colorHex + ';background:#f8fafc;font-weight:700;color:#0f172a;">' +
    title + ' (' + itemsHtml.length + ')' +
    '</div><ul style="margin:6px 0 14px;padding-left:20px;">' +
    itemsHtml.map(function (li) { return '<li style="margin-bottom:6px;">' + li + '</li>'; }).join('') +
    '</ul>';
}

/**
 * Sends ONE consolidated daily digest email to a single team member.
 */
function sendDailyDigestEmail(employee, todayIso, digest) {
  var totalItems =
    digest.overdue.length +
    digest.escalations.length +
    digest.upcoming.length +
    digest.pendingReview.length +
    digest.approvedToFile.length +
    (digest.timesheetReminder ? 1 : 0);

  if (totalItems === 0) return false;

  var body = '<p>Hi <strong>' + employee.full_name + '</strong>,</p>' +
    '<p>Here is your single daily compliance summary for <strong>' + formatIndianDate(todayIso) + '</strong>:</p>';

  body += renderDigestSection('Overdue Tasks (Action Required)', '#dc2626', digest.overdue);
  body += renderDigestSection('Overdue Escalations (Manager / Partner Alert)', '#b91c1c', digest.escalations);
  body += renderDigestSection('Tasks Pending Your Review', '#7c3aed', digest.pendingReview);
  body += renderDigestSection('Approved — Ready for Filing Upload', '#16a34a', digest.approvedToFile);
  body += renderDigestSection('Upcoming Due Dates & Reminders', '#d97706', digest.upcoming);

  if (digest.timesheetReminder) {
    body += '<div style="margin:16px 0;padding:12px 14px;border-radius:8px;background:#fef3c7;border:1px solid #fde68a;color:#92400e;">' +
      '<strong>Weekly Timesheet Reminder:</strong> ' + digest.timesheetReminder +
      '</div>';
  }

  body += '<p style="margin-top:16px;">Please open the Compliance Tracker app to update task statuses, review submissions, or upload filings.</p>';

  var subject = '[Daily Digest - ' + formatIndianDate(todayIso) + '] ' + totalItems +
    ' item' + (totalItems === 1 ? '' : 's') + ' needing your attention';
  if (digest.overdue.length > 0 || digest.escalations.length > 0) {
    subject = '[Action Required - ' + formatIndianDate(todayIso) + '] ' +
      (digest.overdue.length + digest.escalations.length) + ' Overdue + ' + totalItems + ' Total Items';
  }

  safeSendEmail(employee.email, subject, buildEmailWrapper('Daily Compliance Digest', body));
  return true;
}

/**
 * Real-time workflow hooks: in default 'daily_digest' mode, these are intentionally
 * suppressed so nobody receives more than 1 email per day. If you ever switch
 * App_Settings -> email_mode to 'instant' (e.g. on Google Workspace), they activate automatically.
 */
function sendTaskAssignedEmail(task) {
  if (isDailyDigestOnlyMode()) return;
  var html = buildEmailWrapper(
    'New Compliance Task Assigned',
    '<p>Hi <strong>' + task.assigned_to_name + '</strong>,</p>' +
    '<p>Assigned: <strong>' + task.client_name + ' — ' + task.compliance_name + '</strong> (Due ' + formatIndianDate(task.due_date) + ').</p>'
  );
  safeSendEmail(task.assigned_to_email, '[Assigned] ' + task.client_name + ' - ' + task.compliance_name, html);
}

function sendTaskSubmittedForReviewEmail(task) {
  if (isDailyDigestOnlyMode()) return;
  var html = buildEmailWrapper(
    'Task Ready for Your Review',
    '<p>Hi <strong>' + task.reviewer_name + '</strong>, <strong>' + task.assigned_to_name + '</strong> submitted <strong>' + task.client_name + ' — ' + task.compliance_name + '</strong> for review.</p>'
  );
  safeSendEmail(task.reviewer_email, '[Pending Review] ' + task.client_name + ' - ' + task.compliance_name, html);
}

function sendTaskApprovedEmail(task) {
  if (isDailyDigestOnlyMode()) return;
  var html = buildEmailWrapper(
    'Task Approved — Ready for Filing Upload',
    '<p>Hi <strong>' + task.assigned_to_name + '</strong>, <strong>' + task.reviewer_name + '</strong> approved <strong>' + task.client_name + ' — ' + task.compliance_name + '</strong>.</p>'
  );
  safeSendEmail(task.assigned_to_email, '[Approved] ' + task.client_name + ' - ' + task.compliance_name, html);
}

function sendTaskRejectedEmail(task, reason) {
  if (isDailyDigestOnlyMode()) return;
  var html = buildEmailWrapper(
    'Task Sent Back for Revision',
    '<p>Hi <strong>' + task.assigned_to_name + '</strong>, <strong>' + task.reviewer_name + '</strong> returned <strong>' + task.client_name + ' — ' + task.compliance_name + '</strong>. Remarks: ' + (reason || 'Please review.') + '</p>'
  );
  safeSendEmail(task.assigned_to_email, '[Revision Needed] ' + task.client_name + ' - ' + task.compliance_name, html);
}

function sendTaskFiledEmail(task) {
  if (isDailyDigestOnlyMode()) return;
  var html = buildEmailWrapper(
    'Compliance Filed & Archived',
    '<p><strong>' + task.client_name + ' — ' + task.compliance_name + '</strong> was marked Filed on ' + formatIndianDate(task.filing_date) + '. <a href="' + task.filing_file_url + '">Open Filing</a></p>'
  );
  var recipients = [task.assigned_to_email, task.reviewer_email].filter(Boolean).join(',');
  safeSendEmail(recipients, '[Filed] ' + task.client_name + ' - ' + task.compliance_name, html);
}
