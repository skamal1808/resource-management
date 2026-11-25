/**
 * Team Resource & Compliance Tracker v2 — Complete Frontend Application
 * Works identically as:
 *   1. Native Windows (.exe) & macOS (.dmg) desktop app via Tauri v2
 *   2. Installable Mobile / Desktop PWA via GitHub Pages
 * Backend: 100% Google Sheets + Google Drive + Google Apps Script
 */

(function () {
  'use strict';

  const MANAGER_MIN_LEVEL = 4;
  const ROLE_HIERARCHY = [
    { role: 'Partner', level: 7 },
    { role: 'Associate Partner', level: 6 },
    { role: 'Associate Director', level: 5 },
    { role: 'Manager', level: 4 },
    { role: 'Senior Associate', level: 3 },
    { role: 'Associate', level: 2 },
    { role: 'Executive', level: 1 }
  ];

  const STATE = {
    mode: 'live',
    token: localStorage.getItem('tct_token') || '',
    apiUrl: (window.APP_CONFIG && window.APP_CONFIG.API_URL) || localStorage.getItem('tct_api_url') || '',
    data: null,
    activeView: 'dashboard',
    selectedClientId: null,
    reportMonth: '',
    historyFilters: { q: '', resource: '', month: '' }
  };

  /* ========================================================================
     UTILITIES & INDIAN DATE FORMATTING
     ======================================================================== */

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayISO() {
    if (STATE.data && STATE.data.today) return STATE.data.today;
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatIndianDate(iso) {
    if (!iso) return '—';
    const s = String(iso).slice(0, 10);
    const p = s.split('-');
    if (p.length !== 3) return s;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return p[2] + '-' + (months[parseInt(p[1], 10) - 1] || p[1]) + '-' + p[0];
  }

  function daysBetween(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00Z');
    const b = new Date(isoB + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  }

  function isOverdue(task) {
    return task.status !== 'Filed' && task.due_date && task.due_date < todayISO();
  }

  function isManager() {
    return STATE.data && STATE.data.user && Number(STATE.data.user.role_level) >= MANAGER_MIN_LEVEL;
  }

  function canAssign() {
    return STATE.data && STATE.data.user && Number(STATE.data.user.role_level) >= 2;
  }

  function canEditHierarchy() {
    return STATE.data && STATE.data.user && Number(STATE.data.user.role_level) >= 6;
  }

  function isExecutive() {
    return STATE.data && STATE.data.user && STATE.data.user.role === 'Executive';
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-backdrop').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
  }

  function statusPill(status, overdue) {
    if (overdue) {
      const tag = status === 'Waiting on Client' ? 'Client Delay' : 'Overdue';
      return '<span class="pill ' + (status === 'Waiting on Client' ? 'pill-orange' : 'pill-red') + '">' + tag + '</span> <span class="pill pill-gray">' + esc(status) + '</span>';
    }
    const map = {
      'Pending': 'pill-orange',
      'In Process': 'pill-info',
      'Waiting on Client': 'pill-orange',
      'Pending for Review': 'pill-purple',
      'Approved': 'pill-green',
      'Filed': 'pill-green',
      'Free': 'pill-green',
      'Available Soon': 'pill-orange',
      'Busy': 'pill-red',
      'Blocked': 'pill-purple',
      'On Leave': 'pill-gray',
      'Exam Leave': 'pill-gray',
      'Absent': 'pill-slate',
      'Present': 'pill-green',
      'Late': 'pill-orange',
      'Submitted': 'pill-green',
      'Draft': 'pill-orange',
      'Active': 'pill-green',
      'Inactive': 'pill-gray'
    };
    return '<span class="pill ' + (map[status] || 'pill-gray') + '">' + esc(status) + '</span>';
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        const idx = res.indexOf(',');
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
  }

  /* ========================================================================
     API CLIENT (LIVE GOOGLE APPS SCRIPT + INTERACTIVE DEMO MODE)
     ======================================================================== */

  async function apiCall(action, payload) {
    if (STATE.mode === 'demo') {
      return demoApiCall(action, payload || {});
    }
    if (!STATE.apiUrl) {
      throw new Error('Apps Script Web App URL is not configured.');
    }
    const resp = await fetch(STATE.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: action,
        token: STATE.token,
        payload: payload || {}
      })
    });
    const json = await resp.json();
    if (!json.ok) {
      if (String(json.error || '').indexOf('AUTH_REQUIRED') === 0) {
        handleSignOut();
      }
      throw new Error(json.error || 'Request failed');
    }
    return json.data;
  }

  async function refreshData(silent) {
    if (STATE._refreshing) return;
    STATE._refreshing = true;
    try {
      STATE.data = await apiCall('getBootstrap', {});
      renderShell();
      renderView();
    } catch (err) {
      if (!silent) showToast('Error: ' + err.message);
    } finally {
      STATE._refreshing = false;
    }
  }

  function startAutoSync() {
    if (STATE._autoSyncTimer) clearInterval(STATE._autoSyncTimer);
    STATE._autoSyncTimer = setInterval(() => {
      if (!STATE.token || !STATE.data || STATE.mode !== 'live') return;
      if (document.hidden) return;
      const modal = document.getElementById('modal-backdrop');
      if (modal && !modal.classList.contains('hidden')) return;
      const active = document.activeElement;
      if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
      refreshData(true);
    }, 30000);
  }

  /* ========================================================================
     INTERACTIVE DEMO DATA ENGINE (ALL 13+ MODULES)
     ======================================================================== */

  function buildDemoState(asRole) {
    const today = todayISO();
    const shiftDate = (delta) => {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    };
    const employees = [
      { employee_id: 'EMP-001', full_name: 'Shahrukh Kamal', email: 'shahrukh.kamal@vmgassociates.in', role: 'Partner', role_level: 7, location: 'New Delhi', reporting_to: '', status: 'Active', availability_status: 'Always Available', leave_reason: '' },
      { employee_id: 'EMP-002', full_name: 'Neha Sharma', email: 'neha.sharma@vmgassociates.in', role: 'Associate Partner', role_level: 6, location: 'Mumbai', reporting_to: 'Shahrukh Kamal', status: 'Active', availability_status: 'Available', leave_reason: '' },
      { employee_id: 'EMP-003', full_name: 'Rajiv Mehta', email: 'rajiv.mehta@vmgassociates.in', role: 'Associate Director', role_level: 5, location: 'Gurugram', reporting_to: 'Shahrukh Kamal', status: 'Active', availability_status: 'Available', leave_reason: '' },
      { employee_id: 'EMP-004', full_name: 'Priya Verma', email: 'priya.verma@vmgassociates.in', role: 'Manager', role_level: 4, location: 'New Delhi', reporting_to: 'Rajiv Mehta', status: 'Active', availability_status: 'Available', leave_reason: '' },
      { employee_id: 'EMP-005', full_name: 'Amitabh Kulkarni', email: 'amitabh.k@vmgassociates.in', role: 'Senior Associate', role_level: 3, location: 'New Delhi', reporting_to: 'Priya Verma', status: 'Active', availability_status: 'Available', leave_reason: '' },
      { employee_id: 'EMP-006', full_name: 'Riya Gupta', email: 'riya.gupta@vmgassociates.in', role: 'Associate', role_level: 2, location: 'Noida', reporting_to: 'Priya Verma', status: 'Active', availability_status: 'Available', leave_reason: '' },
      { employee_id: 'EMP-007', full_name: 'Karan Malhotra', email: 'karan.m@vmgassociates.in', role: 'Executive', role_level: 1, location: 'New Delhi', reporting_to: 'Amitabh Kulkarni', status: 'Active', availability_status: 'Available', leave_reason: '' },
      { employee_id: 'EMP-008', full_name: 'Sneha Nair', email: 'sneha.nair@vmgassociates.in', role: 'Executive', role_level: 1, location: 'Bengaluru', reporting_to: 'Priya Verma', status: 'Active', availability_status: 'Exam Leave', leave_reason: 'CA Final Group II' }
    ];

    const clients = [
      { client_id: 'CLN-001', client_name: 'Apex Manufacturing Pvt Ltd', pan: 'AAACA1234B', gstin: '07AAACA1234B1Z5', entity_type: 'Private Limited', location: 'New Delhi', primary_partner: 'Shahrukh Kamal', contact_name: 'Rohan Jain', contact_email: 'finance@apexmfg.in', kyc_folder_url: 'https://drive.google.com', status: 'Active' },
      { client_id: 'CLN-002', client_name: 'Meridian Tech Solutions LLP', pan: 'ABMFM9876K', gstin: '27ABMFM9876K1Z2', entity_type: 'LLP', location: 'Mumbai', primary_partner: 'Neha Sharma', contact_name: 'Ananya Rao', contact_email: 'accounts@meridiantech.in', kyc_folder_url: 'https://drive.google.com', status: 'Active' },
      { client_id: 'CLN-003', client_name: 'Kaveri Infra Projects Ltd', pan: 'AADCK4567P', gstin: '06AADCK4567P1Z9', entity_type: 'Public Limited', location: 'Gurugram', primary_partner: 'Shahrukh Kamal', contact_name: 'Vikram Singh', contact_email: 'cfo@kaveriinfra.in', kyc_folder_url: 'https://drive.google.com', status: 'Active' }
    ];

    const compliances = [
      { compliance_id: 'CMP-001', compliance_name: 'GSTR-1 Monthly Return', category: 'GST', frequency: 'Monthly', default_due_day: '11', statutory_due_rule: '11th of following month', active: 'Yes' },
      { compliance_id: 'CMP-002', compliance_name: 'GSTR-3B Monthly Return', category: 'GST', frequency: 'Monthly', default_due_day: '20', statutory_due_rule: '20th of following month', active: 'Yes' },
      { compliance_id: 'CMP-003', compliance_name: 'TDS Monthly Payment (Challan 281)', category: 'Income Tax', frequency: 'Monthly', default_due_day: '7', statutory_due_rule: '7th of following month', active: 'Yes' },
      { compliance_id: 'CMP-004', compliance_name: 'TDS Quarterly Return (24Q / 26Q)', category: 'Income Tax', frequency: 'Quarterly', default_due_day: '31', statutory_due_rule: '31st of month following quarter', active: 'Yes' },
      { compliance_id: 'CMP-005', compliance_name: 'Tax Audit Report (Form 3CD)', category: 'Income Tax', frequency: 'Yearly', default_due_day: '30', statutory_due_rule: '30th September annually', active: 'Yes' }
    ];

    const tasks = [
      { task_id: 'TSK-101', client_id: 'CLN-001', client_name: 'Apex Manufacturing Pvt Ltd', compliance_id: 'CMP-003', compliance_name: 'TDS Monthly Payment (Challan 281)', frequency: 'Monthly', period_label: 'Oct-2026', assigned_to_id: 'EMP-007', assigned_to_name: 'Karan Malhotra', assigned_to_email: 'karan.m@vmgassociates.in', reviewer_id: 'EMP-004', reviewer_name: 'Priya Verma', reviewer_email: 'priya.verma@vmgassociates.in', assigned_by_name: 'Priya Verma', assigned_date: shiftDate(-10), due_date: shiftDate(-2), status: 'In Process', completion_date: '', approval_date: '', filing_date: '', remarks: 'Challan reconciliation in progress' },
      { task_id: 'TSK-102', client_id: 'CLN-002', client_name: 'Meridian Tech Solutions LLP', compliance_id: 'CMP-001', compliance_name: 'GSTR-1 Monthly Return', frequency: 'Monthly', period_label: 'Nov-2026', assigned_to_id: 'EMP-007', assigned_to_name: 'Karan Malhotra', assigned_to_email: 'karan.m@vmgassociates.in', reviewer_id: 'EMP-001', reviewer_name: 'Shahrukh Kamal', reviewer_email: 'shahrukh.kamal@vmgassociates.in', assigned_by_name: 'Shahrukh Kamal', assigned_date: shiftDate(-4), due_date: shiftDate(3), status: 'Pending for Review', completion_date: today, approval_date: '', filing_date: '', remarks: 'B2B invoices matched with sales register' },
      { task_id: 'TSK-103', client_id: 'CLN-003', client_name: 'Kaveri Infra Projects Ltd', compliance_id: 'CMP-002', compliance_name: 'GSTR-3B Monthly Return', frequency: 'Monthly', period_label: 'Nov-2026', assigned_to_id: 'EMP-005', assigned_to_name: 'Amitabh Kulkarni', assigned_to_email: 'amitabh.k@vmgassociates.in', reviewer_id: 'EMP-001', reviewer_name: 'Shahrukh Kamal', reviewer_email: 'shahrukh.kamal@vmgassociates.in', assigned_by_name: 'Shahrukh Kamal', assigned_date: shiftDate(-3), due_date: shiftDate(6), status: 'Approved', completion_date: shiftDate(-1), approval_date: today, filing_date: '', remarks: 'Ready for portal filing upload' }
    ];

    const archived = [
      { task_id: 'TSK-090', client_id: 'CLN-001', client_name: 'Apex Manufacturing Pvt Ltd', compliance_id: 'CMP-001', compliance_name: 'GSTR-1 Monthly Return', frequency: 'Monthly', period_label: 'Oct-2026', assigned_to_id: 'EMP-007', assigned_to_name: 'Karan Malhotra', reviewer_id: 'EMP-004', reviewer_name: 'Priya Verma', due_date: shiftDate(-14), status: 'Filed', filing_date: shiftDate(-15), filing_file_name: 'Apex_Manufacturing_GSTR_1_10-Nov-2026_153210.pdf', filing_file_url: 'https://drive.google.com' }
    ];

    const attendance = [
      { attendance_id: 'ATT-1', employee_id: 'EMP-005', employee_name: 'Amitabh Kulkarni', employee_role: 'Senior Associate', date: today, check_in_time: '09:42 AM', status: 'Present', latitude: '28.6139', longitude: '77.2090', location_note: 'New Delhi' },
      { attendance_id: 'ATT-2', employee_id: 'EMP-006', employee_name: 'Riya Gupta', employee_role: 'Associate', date: today, check_in_time: '09:58 AM', status: 'Present', latitude: '28.5355', longitude: '77.3910', location_note: 'Noida' },
      { attendance_id: 'ATT-3', employee_id: 'EMP-007', employee_name: 'Karan Malhotra', employee_role: 'Executive', date: today, check_in_time: '10:44 AM', status: 'Late', latitude: '28.6270', longitude: '77.2167', location_note: 'New Delhi' }
    ];

    const prevMon = shiftDate(-7);
    const prevSat = shiftDate(-2);
    const tsWeeks = [
      { week_id: 'TSW-DEMO-1', employee_id: 'EMP-007', employee_name: 'Karan Malhotra', employee_role: 'Executive', week_start: prevMon, week_end: prevSat, total_hours: '14', status: 'Draft' },
      { week_id: 'TSW-DEMO-2', employee_id: 'EMP-001', employee_name: 'Shahrukh Kamal', employee_role: 'Partner', week_start: prevMon, week_end: prevSat, total_hours: '8', status: 'Draft' }
    ];
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const tsDetails = [];
    ['EMP-007', 'EMP-001'].forEach((eid, idx) => {
      const wid = idx === 0 ? 'TSW-DEMO-1' : 'TSW-DEMO-2';
      const ename = idx === 0 ? 'Karan Malhotra' : 'Shahrukh Kamal';
      for (let i = 0; i < 6; i++) {
        tsDetails.push({
          detail_id: 'TSD-' + idx + '-' + i,
          week_id: wid,
          employee_id: eid,
          employee_name: ename,
          week_start: prevMon,
          work_date: shiftDate(-7 + i),
          day_name: dayNames[i],
          client_id: i < 2 ? 'CLN-001' : '',
          client_name: i < 2 ? 'Apex Manufacturing Pvt Ltd' : '',
          compliance_name: i < 2 ? 'TDS Monthly Payment' : '',
          task_description: i < 2 ? 'Challan preparation & verification' : '',
          hours: i < 2 ? (idx === 0 ? '7' : '4') : '0'
        });
      }
    });

    const user = asRole === 'Executive' ? employees[6] : employees[0];

    return {
      today: today,
      user: user,
      firm_name: 'TCA India',
      drive_root_url: 'https://drive.google.com',
      last_backup_at: shiftDate(-1) + 'T23:00:00+05:30',
      self_status_lock_hour: 11,
      employees: employees,
      clients: clients,
      compliances: compliances,
      client_compliance_map: [
        { map_id: 'MAP-1', client_id: 'CLN-001', client_name: 'Apex Manufacturing Pvt Ltd', compliance_id: 'CMP-001', compliance_name: 'GSTR-1 Monthly Return', frequency: 'Monthly', start_date: '2026-04-01', due_day: '11', default_assigned_to: 'EMP-007', default_reviewer: 'EMP-004', active: 'Yes' }
      ],
      tasks: tasks,
      archived_tasks: archived,
      audit_logs: [
        { log_id: 'AUD-1', task_id: 'TSK-102', action: 'Submitted for Review', old_status: 'In Process', new_status: 'Pending for Review', actor_name: 'Karan Malhotra', actor_role: 'Executive', notes: 'All invoices reconciled', timestamp: today + 'T10:15:00+05:30' }
      ],
      attendance_today: attendance,
      attendance_history: attendance,
      bookings: [],
      timesheet_weeks: tsWeeks,
      timesheet_archive: [],
      timesheet_details: tsDetails,
      todos: [
        { todo_id: 'TD-1', employee_id: user.employee_id, title: 'Review Meridian Tech GSTR-1 before due date', linked_task_id: 'TSK-102', due_date: shiftDate(3), priority: 'High', status: 'Open' },
        { todo_id: 'TD-2', employee_id: user.employee_id, title: 'Follow up with Apex CFO on KYC PAN update', linked_task_id: '', due_date: shiftDate(5), priority: 'Medium', status: 'Open' }
      ]
    };
  }

  let DEMO_DB = null;

  function computeDemoAvailability(db) {
    const today = db.today;
    const rows = db.employees
      .filter((e) => e.status === 'Active' && Number(e.role_level) < MANAGER_MIN_LEVEL)
      .map((emp) => {
        const activeTasks = db.tasks.filter((t) => t.assigned_to_id === emp.employee_id && t.status !== 'Filed');
        const booking = db.bookings.find((b) => b.employee_id === emp.employee_id && b.status === 'Active' && b.start_date <= today && b.end_date >= today);
        const att = db.attendance_today.find((a) => a.employee_id === emp.employee_id);
        let computed = 'Free', color = 'green', rank = 1;
        if (emp.availability_status === 'On Leave' || emp.availability_status === 'Exam Leave') {
          computed = emp.availability_status; color = 'gray'; rank = 5;
        } else if (!att) {
          computed = 'Absent'; color = 'slate'; rank = 4;
        } else if (booking) {
          computed = 'Blocked'; color = 'purple'; rank = 4;
        } else if (activeTasks.length === 0) {
          computed = 'Free'; color = 'green'; rank = 1;
        } else if (activeTasks.length === 1) {
          computed = 'Available Soon'; color = 'orange'; rank = 2;
        } else {
          computed = 'Busy'; color = 'red'; rank = 3;
        }
        const mgrs = [...new Set(activeTasks.map((t) => t.reviewer_name).filter(Boolean))].join(', ');
        let expFree = '';
        if (activeTasks.length > 0) {
          const latest = activeTasks.reduce((mx, t) => (t.due_date > mx ? t.due_date : mx), today);
          expFree = latest < today ? today : latest;
        } else if (booking) {
          expFree = booking.end_date < today ? today : booking.end_date;
        }
        return {
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          email: emp.email,
          role: emp.role,
          role_level: emp.role_level,
          location: emp.location,
          manual_status: emp.availability_status,
          leave_reason: emp.leave_reason,
          attendance_today: att ? att.status : 'Not Marked',
          check_in_time: att ? att.check_in_time : '',
          active_task_count: activeTasks.length,
          computed_status: computed,
          status_color: color,
          working_with: mgrs,
          expected_free_date: expFree,
          active_booking: booking || null,
          _rank: rank
        };
      });
    rows.sort((a, b) => a._rank - b._rank || a.active_task_count - b.active_task_count || (a.expected_free_date || '').localeCompare(b.expected_free_date || ''));
    return rows;
  }

  function demoApiCall(action, p) {
    const db = DEMO_DB;
    const u = db.user;
    if (action === 'getBootstrap') {
      const mgr = Number(u.role_level) >= MANAGER_MIN_LEVEL;
      return Object.assign({}, db, {
        resource_availability: mgr ? computeDemoAvailability(db) : [],
        tasks: mgr ? db.tasks : db.tasks.filter((t) => t.assigned_to_id === u.employee_id || t.reviewer_id === u.employee_id),
        archived_tasks: mgr ? db.archived_tasks : db.archived_tasks.filter((t) => t.assigned_to_id === u.employee_id),
        timesheet_weeks: mgr ? db.timesheet_weeks : db.timesheet_weeks.filter((w) => w.employee_id === u.employee_id),
        timesheet_details: mgr ? db.timesheet_details : db.timesheet_details.filter((d) => d.employee_id === u.employee_id),
        todos: db.todos.filter((td) => td.employee_id === u.employee_id)
      });
    }
    if (action === 'createTask') {
      const asg = db.employees.find((e) => e.employee_id === p.assigned_to_id);
      const rev = db.employees.find((e) => e.employee_id === p.reviewer_id);
      const cl = db.clients.find((c) => c.client_id === p.client_id);
      if (!asg || !rev || !cl) throw new Error('Select valid Client, Assignee, and Reviewer.');
      if (asg.employee_id === rev.employee_id) throw new Error('Reviewer cannot be the same as Assignee.');
      const t = {
        task_id: 'TSK-' + Math.floor(200 + Math.random() * 799),
        client_id: cl.client_id, client_name: cl.client_name,
        compliance_id: p.compliance_id || '', compliance_name: p.compliance_name,
        frequency: p.frequency || 'One-time', period_label: p.period_label || '',
        assigned_to_id: asg.employee_id, assigned_to_name: asg.full_name, assigned_to_email: asg.email,
        reviewer_id: rev.employee_id, reviewer_name: rev.full_name, reviewer_email: rev.email,
        assigned_by_name: u.full_name, assigned_date: db.today, due_date: p.due_date,
        status: 'Pending', completion_date: '', approval_date: '', filing_date: '', remarks: p.remarks || ''
      };
      db.tasks.unshift(t);
      return t;
    }
    if (action === 'startTask') {
      const t = db.tasks.find((x) => x.task_id === p.task_id);
      if (t) t.status = 'In Process';
      return { ok: true };
    }
    if (action === 'submitTaskForReview') {
      const t = db.tasks.find((x) => x.task_id === p.task_id);
      if (t) { t.status = 'Pending for Review'; t.completion_date = t.completion_date || db.today; }
      return { ok: true };
    }
    if (action === 'reviewTask') {
      const t = db.tasks.find((x) => x.task_id === p.task_id);
      if (!t) throw new Error('Task not found');
      if (t.assigned_to_id === u.employee_id) throw new Error('NO SELF-APPROVAL: Cannot approve your own task.');
      if (p.decision === 'Approve') { t.status = 'Approved'; t.approval_date = t.approval_date || db.today; }
      else { t.status = 'In Process'; t.remarks = p.remarks || 'Revision requested'; }
      return { ok: true };
    }
    if (action === 'uploadFilingAndClose') {
      const idx = db.tasks.findIndex((x) => x.task_id === p.task_id);
      if (idx === -1) throw new Error('Task not found');
      if (!p.file_base64) throw new Error('Filing document attachment is mandatory.');
      const t = db.tasks.splice(idx, 1)[0];
      t.status = 'Filed'; t.filing_date = db.today; t.filing_file_name = p.file_name || 'filing.pdf'; t.filing_file_url = 'https://drive.google.com';
      db.archived_tasks.unshift(t);
      return { ok: true };
    }
    if (action === 'endAssignmentEarly') {
      const t = db.tasks.find((x) => x.task_id === p.task_id);
      if (t) t.due_date = db.today;
      return { ok: true };
    }
    if (action === 'markAttendance') {
      if (db.attendance_today.some((a) => a.employee_id === u.employee_id)) throw new Error('Already marked present today.');
      const rec = { attendance_id: 'ATT-' + Date.now(), employee_id: u.employee_id, employee_name: u.full_name, employee_role: u.role, date: db.today, check_in_time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), status: 'Present', latitude: p.latitude || '', longitude: p.longitude || '', location_note: u.location };
      db.attendance_today.unshift(rec);
      db.attendance_history.unshift(rec);
      return rec;
    }
    if (action === 'updateAvailabilityStatus') {
      const emp = db.employees.find((e) => e.employee_id === (p.employee_id || u.employee_id));
      if (emp.role === 'Partner') throw new Error('Partners are always set to Always Available.');
      emp.availability_status = p.availability_status;
      emp.leave_reason = p.leave_reason || '';
      return { ok: true };
    }
    if (action === 'createResourceBooking') {
      const emp = db.employees.find((e) => e.employee_id === p.employee_id);
      db.bookings.unshift({ booking_id: 'BKG-' + Date.now(), employee_id: emp.employee_id, employee_name: emp.full_name, booked_by_id: u.employee_id, booked_by_name: u.full_name, client_name: p.client_name, start_date: p.start_date, end_date: p.end_date, reason: p.reason, status: 'Active' });
      return { ok: true };
    }
    if (action === 'saveTimesheetDetail') {
      const row = db.timesheet_details.find((d) => d.detail_id === p.detail_id);
      if (row) Object.assign(row, p);
      const wk = db.timesheet_weeks.find((w) => w.week_id === row.week_id);
      if (wk) {
        wk.total_hours = String(db.timesheet_details.filter((d) => d.week_id === wk.week_id).reduce((s, x) => s + (parseFloat(x.hours) || 0), 0));
      }
      return { ok: true };
    }
    if (action === 'addTimesheetRow') {
      const nr = { detail_id: 'TSD-' + Date.now(), week_id: p.week_id, employee_id: u.employee_id, employee_name: u.full_name, work_date: p.work_date, day_name: p.day_name, client_id: '', client_name: '', compliance_name: '', task_description: '', hours: '0' };
      db.timesheet_details.push(nr);
      return nr;
    }
    if (action === 'submitTimesheetWeek') {
      const idx = db.timesheet_weeks.findIndex((w) => w.week_id === p.week_id);
      if (idx >= 0) {
        const wk = db.timesheet_weeks.splice(idx, 1)[0];
        wk.status = 'Submitted';
        db.timesheet_archive.unshift(wk);
      }
      return { ok: true };
    }
    if (action === 'createTodo') {
      db.todos.unshift({ todo_id: 'TD-' + Date.now(), employee_id: u.employee_id, title: p.title, due_date: p.due_date || '', priority: p.priority || 'Medium', status: 'Open' });
      return { ok: true };
    }
    if (action === 'toggleTodoDone') {
      const td = db.todos.find((x) => x.todo_id === p.todo_id);
      if (td) td.status = td.status === 'Done' ? 'Open' : 'Done';
      return { ok: true };
    }
    if (action === 'createClient') {
      db.clients.push({ client_id: 'CLN-' + Date.now(), client_name: p.client_name, pan: p.pan || '', gstin: p.gstin || '', entity_type: p.entity_type || 'Private Limited', location: p.location || '', primary_partner: u.full_name, contact_name: p.contact_name || '', contact_email: p.contact_email || '', kyc_folder_url: 'https://drive.google.com', status: 'Active' });
      return { ok: true };
    }
    if (action === 'createEmployee') {
      const roleObj = ROLE_HIERARCHY.find((r) => r.role === p.role) || { level: 1 };
      db.employees.push({ employee_id: 'EMP-' + Date.now(), full_name: p.full_name, email: p.email, role: p.role, role_level: roleObj.level, location: p.location || 'New Delhi', reporting_to: p.reporting_to || '', status: 'Active', availability_status: p.role === 'Partner' ? 'Always Available' : 'Available', leave_reason: '' });
      return { ok: true };
    }
    if (action === 'toggleEmployeeStatus') {
      const emp = db.employees.find((e) => e.employee_id === p.employee_id);
      if (emp) emp.status = emp.status === 'Active' ? 'Inactive' : 'Active';
      return { ok: true };
    }
    if (action === 'triggerManualBackup') {
      db.last_backup_at = new Date().toISOString();
      return { ok: true };
    }
    return { ok: true };
  }

  /* ========================================================================
     NAVIGATION & EXECUTIVE SCREEN LOCK
     ======================================================================== */

  function getNavItems() {
    const d = STATE.data;
    const u = d.user;
    const myOpen = d.tasks.filter((t) => t.assigned_to_id === u.employee_id && t.status !== 'Filed').length;
    const pendingRev = d.tasks.filter((t) => t.status === 'Pending for Review' && t.assigned_to_id !== u.employee_id && (t.reviewer_id === u.employee_id || isManager())).length;
    const overdueCount = d.tasks.filter(isOverdue).length;

    // Strict Executive Screen Lock
    if (isExecutive()) {
      return [
        { section: 'My Workspace' },
        { id: 'my-tasks', label: 'My Tasks', badge: myOpen },
        { id: 'todos', label: 'My To-Do List', badge: d.todos.filter((x) => x.status !== 'Done').length },
        { id: 'timesheet', label: 'Weekly Timesheet' },
        { id: 'attendance', label: 'Attendance & Leave' },
        { id: 'history', label: 'My Archived Tasks' }
      ];
    }

    // Associates & Senior Associates: own workspace + Pending Review + Resource Availability & Downward Assignment
    if (!isManager()) {
      return [
        { section: 'Work & Reviews' },
        { id: 'my-tasks', label: 'My Tasks', badge: myOpen },
        { id: 'pending-review', label: 'Pending Review', badge: pendingRev },
        { id: 'my-assignments', label: 'My Resource Assignments' },
        { id: 'calendar', label: 'Compliance Calendar' },
        { id: 'history', label: 'My Archived Tasks' },
        { section: 'Resources & Time' },
        { id: 'resources', label: 'Resource Availability & Leave' },
        { id: 'utilization', label: 'Resource Utilization' },
        { id: 'attendance', label: 'Attendance & Planned Leave' },
        { id: 'timesheet', label: 'Weekly Timesheet' },
        { id: 'todos', label: 'My To-Do List', badge: d.todos.filter((x) => x.status !== 'Done').length }
      ];
    }

    const items = [
      { section: 'Compliance' },
      { id: 'dashboard', label: 'Compliance Control Center', badge: overdueCount, badgeRed: overdueCount > 0 },
      { id: 'my-tasks', label: 'My Tasks', badge: myOpen },
      { id: 'pending-review', label: 'Pending Review', badge: pendingRev },
      { id: 'calendar', label: 'Compliance Calendar' },
      { id: 'history', label: 'Task History (Archive)' },
      { section: 'Resources & Time' },
      { id: 'resources', label: 'Resource Availability & Leave' },
      { id: 'utilization', label: 'Resource Utilization' },
      { id: 'my-assignments', label: 'My Resource Assignments' },
      { id: 'attendance', label: 'Attendance & Planned Leave' },
      { id: 'timesheet', label: 'Weekly Timesheet' },
      { id: 'todos', label: 'My To-Do List', badge: d.todos.filter((x) => x.status !== 'Done').length },
      { section: 'Firm Setup & Reports' },
      { id: 'reports', label: 'Partner Reports (Hours & Payroll)' },
      { id: 'clients', label: 'Clients & KYC' },
      { id: 'library', label: 'Compliance Library' },
      { id: 'hierarchy', label: 'Team Hierarchy' },
      { id: 'directory', label: 'Team Directory & Backups' }
    ];
    return items;
  }

  function renderShell() {
    const d = STATE.data;
    const u = d.user;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    const firmEl = document.getElementById('firm-name-label'); if (firmEl) firmEl.textContent = d.firm_name || 'TCA India';
    document.getElementById('user-chip').innerHTML =
      '<strong>' + esc(u.full_name) + '</strong>' +
      '<div>' + esc(u.role) + ' &bull; ' + esc(u.location || 'India') + '</div>';

    document.getElementById('mode-pill').classList.toggle('hidden', STATE.mode !== 'demo');
    document.getElementById('quick-assign-btn').classList.toggle('hidden', !canAssign());

    const navItems = getNavItems();
    const validIds = navItems.filter((x) => x.id).map((x) => x.id);
    if (!validIds.includes(STATE.activeView)) {
      STATE.activeView = validIds[0];
    }

    const navEl = document.getElementById('nav-menu');
    navEl.innerHTML = navItems.map((item) => {
      if (item.section) {
        return '<div class="nav-section-label">' + esc(item.section) + '</div>';
      }
      const badgeHtml = item.badge > 0
        ? '<span class="nav-badge ' + (item.badgeRed ? 'nav-badge-red' : '') + '">' + item.badge + '</span>'
        : '';
      return '<button class="nav-item ' + (STATE.activeView === item.id ? 'active' : '') + '" data-view="' + item.id + '">' +
        '<span>' + esc(item.label) + '</span>' + badgeHtml + '</button>';
    }).join('');

    navEl.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        STATE.activeView = btn.dataset.view;
        STATE.selectedClientId = null;
        document.getElementById('sidebar').classList.remove('open');
        renderShell();
        renderView();
      });
    });
  }

  function renderView() {
    const container = document.getElementById('view-container');
    const titleEl = document.getElementById('view-title');
    const subEl = document.getElementById('view-subtitle');
    subEl.textContent = 'Today: ' + formatIndianDate(todayISO()) + ' (IST)';

    const map = {
      'dashboard': ['Compliance Control Center', renderDashboard],
      'my-tasks': ['My Tasks', renderMyTasks],
      'pending-review': ['Pending Review', renderPendingReview],
      'my-assignments': ['My Resource Assignments', renderMyAssignments],
      'resources': ['Resource Availability & Control Panel', renderResources],
      'utilization': ['Resource Utilization', renderUtilization],
      'calendar': ['Compliance Calendar', renderCalendar],
      'attendance': ['Attendance Register', renderAttendance],
      'timesheet': ['Weekly Timesheet (Mon–Sat)', renderTimesheet],
      'todos': ['My To-Do List', renderTodos],
      'clients': ['Clients & KYC Vault', renderClients],
      'library': ['Compliance Library & Auto-Scheduler', renderLibrary],
      'reports': ['Partner Reports — Client Hours & Monthly Attendance', renderReports],
      'hierarchy': ['Team Hierarchy (7 Levels)', renderHierarchy],
      'history': ['Task History (Archived Filings)', renderHistory],
      'directory': ['Team Directory & Drive Backups', renderDirectory]
    };

    const entry = map[STATE.activeView] || map['my-tasks'];
    titleEl.textContent = entry[0];
    container.innerHTML = entry[1]();
    bindViewHandlers();
  }

  /* ========================================================================
     VIEW RENDERERS
     ======================================================================== */

  function renderDashboard() {
    const d = STATE.data;
    const today = todayISO();
    const overdueTeam = d.tasks.filter((t) => isOverdue(t) && t.status !== 'Waiting on Client');
    const waitingClient = d.tasks.filter((t) => t.status === 'Waiting on Client');
    const due7 = d.tasks.filter((t) => !isOverdue(t) && daysBetween(today, t.due_date) <= 7);
    const pendingRev = d.tasks.filter((t) => t.status === 'Pending for Review');
    const freeCount = (d.resource_availability || []).filter((r) => r.computed_status === 'Free').length;

    const sortedTasks = d.tasks.slice().sort((a, b) => {
      const ao = isOverdue(a) ? 0 : 1;
      const bo = isOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.due_date || '').localeCompare(b.due_date || '');
    });

    return '' +
      '<div class="kpi-grid">' +
        '<div class="kpi-card kpi-red"><div class="kpi-label">Overdue (Team Action)</div><div class="kpi-value">' + overdueTeam.length + '</div></div>' +
        '<div class="kpi-card kpi-orange"><div class="kpi-label">Waiting on Client</div><div class="kpi-value">' + waitingClient.length + '</div></div>' +
        '<div class="kpi-card kpi-orange"><div class="kpi-label">Due Within 7 Days</div><div class="kpi-value">' + due7.length + '</div></div>' +
        '<div class="kpi-card kpi-blue"><div class="kpi-label">Pending Review</div><div class="kpi-value">' + pendingRev.length + '</div></div>' +
        '<div class="kpi-card kpi-green"><div class="kpi-label">Free Resources Now</div><div class="kpi-value">' + freeCount + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">Filed &amp; Archived</div><div class="kpi-value">' + d.archived_tasks.length + '</div></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-header"><h3>Active Compliance Queue (Overdue First)</h3><span class="muted">Client delays separated from team delays &bull; 1-click Reassign available</span></div>' +
        '<div class="table-wrap"><table><thead><tr>' +
          '<th>Client</th><th>Compliance</th><th>Assigned To</th><th>Reviewer</th><th>Due Date</th><th>Status</th><th>Action</th>' +
        '</tr></thead><tbody>' +
        (sortedTasks.length ? sortedTasks.map((t) => {
          const ov = isOverdue(t);
          return '<tr class="' + (ov && t.status !== 'Waiting on Client' ? 'row-overdue' : '') + '">' +
            '<td><strong>' + esc(t.client_name) + '</strong></td>' +
            '<td>' + esc(t.compliance_name) + '<div class="muted">' + esc(t.remarks || t.period_label || t.frequency) + '</div></td>' +
            '<td>' + esc(t.assigned_to_name) + '</td>' +
            '<td>' + esc(t.reviewer_name) + '</td>' +
            '<td><strong>' + formatIndianDate(t.due_date) + '</strong></td>' +
            '<td>' + statusPill(t.status, ov) + '</td>' +
            '<td><button class="btn btn-outline btn-sm" data-act="reassign-task" data-id="' + esc(t.task_id) + '">Reassign</button></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="7" class="muted">No active compliance tasks right now.</td></tr>') +
        '</tbody></table></div>' +
      '</div>';
  }

  function renderMyTasks() {
    const u = STATE.data.user;
    const mine = STATE.data.tasks.filter((t) => t.assigned_to_id === u.employee_id);
    return '<div class="card">' +
      '<div class="card-header"><h3>Tasks Assigned to ' + esc(u.full_name) + '</h3><span class="muted">Pending &rarr; In Process / Waiting on Client &rarr; Pending for Review &rarr; Approved &rarr; Filed</span></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Client &amp; Compliance</th><th>Reviewer</th><th>Due Date</th><th>Status</th><th>Action</th>' +
      '</tr></thead><tbody>' +
      (mine.length ? mine.map((t) => {
        const ov = isOverdue(t);
        let actionBtn = '';
        if (t.status === 'Pending') {
          actionBtn = '<button class="btn btn-primary btn-sm" data-act="start-task" data-id="' + esc(t.task_id) + '">Start Work</button> ' +
            '<button class="btn btn-outline btn-sm" data-act="wait-client" data-id="' + esc(t.task_id) + '">Waiting on Client</button>';
        } else if (t.status === 'In Process') {
          actionBtn = '<button class="btn btn-warning btn-sm" data-act="submit-review" data-id="' + esc(t.task_id) + '">Submit for Review</button> ' +
            '<button class="btn btn-outline btn-sm" data-act="wait-client" data-id="' + esc(t.task_id) + '">Waiting on Client</button>';
        } else if (t.status === 'Waiting on Client') {
          actionBtn = '<button class="btn btn-primary btn-sm" data-act="start-task" data-id="' + esc(t.task_id) + '">Resume Work</button>';
        } else if (t.status === 'Pending for Review') {
          actionBtn = '<span class="muted">Awaiting ' + esc(t.reviewer_name) + '</span>';
        } else if (t.status === 'Approved') {
          actionBtn = '<button class="btn btn-success btn-sm" data-act="open-filing-modal" data-id="' + esc(t.task_id) + '">Upload Filing &amp; Close</button>';
        }
        return '<tr class="' + (ov && t.status !== 'Waiting on Client' ? 'row-overdue' : '') + '">' +
          '<td><strong>' + esc(t.client_name) + '</strong><div>' + esc(t.compliance_name) + '</div><div class="muted">' + esc(t.remarks || '') + '</div></td>' +
          '<td>' + esc(t.reviewer_name) + '</td>' +
          '<td>' + formatIndianDate(t.due_date) + '</td>' +
          '<td>' + statusPill(t.status, ov) + '</td>' +
          '<td class="action-row">' + actionBtn + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="5" class="muted">You have no active tasks assigned right now.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderPendingReview() {
    const u = STATE.data.user;
    const queue = STATE.data.tasks.filter((t) =>
      t.status === 'Pending for Review' &&
      t.assigned_to_id !== u.employee_id &&
      (t.reviewer_id === u.employee_id || isManager())
    );
    return '<div class="card">' +
      '<div class="card-header"><h3>Tasks Awaiting Review &amp; Approval</h3><span class="muted">Self-approval is strictly blocked by system rules</span></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Client &amp; Compliance</th><th>Prepared By</th><th>Completed On</th><th>Due Date</th><th>Decision</th>' +
      '</tr></thead><tbody>' +
      (queue.length ? queue.map((t) =>
        '<tr>' +
          '<td><strong>' + esc(t.client_name) + '</strong><div>' + esc(t.compliance_name) + '</div><div class="muted">' + esc(t.remarks || '') + '</div></td>' +
          '<td>' + esc(t.assigned_to_name) + '</td>' +
          '<td>' + formatIndianDate(t.completion_date) + '</td>' +
          '<td>' + formatIndianDate(t.due_date) + '</td>' +
          '<td class="action-row">' +
            '<button class="btn btn-success btn-sm" data-act="approve-task" data-id="' + esc(t.task_id) + '">Approve</button>' +
            '<button class="btn btn-danger btn-sm" data-act="reject-task" data-id="' + esc(t.task_id) + '">Reject</button>' +
          '</td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="5" class="muted">No tasks pending your review.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderMyAssignments() {
    const u = STATE.data.user;
    const rows = STATE.data.tasks.filter((t) => t.reviewer_id === u.employee_id || t.assigned_by_name === u.full_name);
    return '<div class="card">' +
      '<div class="card-header"><h3>My Resource Assignments</h3><button class="btn btn-primary btn-sm" id="btn-assign-inline">+ Assign New Task</button></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Resource</th><th>Client</th><th>Compliance</th><th>Due Date</th><th>Status</th><th>Action</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map((t) =>
        '<tr>' +
          '<td><strong>' + esc(t.assigned_to_name) + '</strong></td>' +
          '<td>' + esc(t.client_name) + '</td>' +
          '<td>' + esc(t.compliance_name) + '</td>' +
          '<td>' + formatIndianDate(t.due_date) + '</td>' +
          '<td>' + statusPill(t.status, isOverdue(t)) + '</td>' +
          '<td class="action-row"><button class="btn btn-outline btn-sm" data-act="reassign-task" data-id="' + esc(t.task_id) + '">Reassign</button><button class="btn btn-outline btn-sm" data-act="end-early" data-id="' + esc(t.task_id) + '">End Early</button></td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="6" class="muted">No active assignments under your supervision.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderResources() {
    const list = STATE.data.resource_availability || [];
    const u = STATE.data.user;
    const bookings = STATE.data.bookings || [];
    const plannedLeaves = bookings.filter((b) => String(b.client_name || '').indexOf('PLANNED_LEAVE:') === 0);
    const clientBookings = bookings.filter((b) => String(b.client_name || '').indexOf('PLANNED_LEAVE:') !== 0);

    return '<div class="card">' +
      '<div class="card-header">' +
        '<h3>Real-Time Resource Availability (Below-Manager Staff)</h3>' +
        '<div class="action-row">' +
          (u.role !== 'Partner' ? '<button class="btn btn-primary btn-sm" id="btn-schedule-leave">+ Schedule Holiday / Leave</button>' : '') +
          (isManager() ? '<button class="btn btn-secondary btn-sm" id="btn-open-booking">Book / Block Resource</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="card-body"><div class="alert alert-info">Priority: <strong>Planned / Manual Leave</strong> &rarr; <strong>Absent</strong> &rarr; <strong>Blocked</strong> &rarr; <strong>Free (0)</strong> / <strong>Available Soon (1)</strong> / <strong>Busy (2+)</strong>. Same-day self-updates lock at <strong>11:00 AM IST</strong>; future holidays can be scheduled anytime.</div></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Resource</th><th>Role &amp; Office</th><th>Attendance</th><th>Active Tasks</th><th>Working With</th><th>Expected Free</th><th>Status</th>' + (isManager() ? '<th>Quick Switch</th>' : '') +
      '</tr></thead><tbody>' +
      (list.length ? list.map((r) =>
        '<tr>' +
          '<td><strong>' + esc(r.full_name) + '</strong>' + (r.leave_reason ? '<div class="muted">' + esc(r.leave_reason) + '</div>' : '') + '</td>' +
          '<td>' + esc(r.role) + '<div class="muted">' + esc(r.location) + '</div></td>' +
          '<td>' + statusPill(r.attendance_today) + (r.check_in_time ? '<div class="muted">' + esc(r.check_in_time) + '</div>' : '') + '</td>' +
          '<td><strong>' + r.active_task_count + '</strong></td>' +
          '<td>' + esc(r.working_with || '—') + '</td>' +
          '<td>' + (r.expected_free_date ? formatIndianDate(r.expected_free_date) : '<span class="pill pill-green">Free</span>') + '</td>' +
          '<td>' + statusPill(r.computed_status) + '</td>' +
          (isManager() ? '<td class="action-row">' +
            '<button class="btn btn-outline btn-sm" data-act="set-avail" data-emp="' + esc(r.employee_id) + '" data-st="Available">Avail</button>' +
            '<button class="btn btn-outline btn-sm" data-act="set-avail" data-emp="' + esc(r.employee_id) + '" data-st="On Leave">Leave</button>' +
            '<button class="btn btn-outline btn-sm" data-act="set-avail" data-emp="' + esc(r.employee_id) + '" data-st="Exam Leave">Exam</button>' +
          '</td>' : '') +
        '</tr>'
      ).join('') : '<tr><td colspan="8" class="muted">No active below-Manager resources found.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-header"><h3>Active &amp; Upcoming Planned Leaves / Holidays</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Team Member</th><th>Leave Type</th><th>From</th><th>To</th><th>Reason</th><th>Action</th></tr></thead><tbody>' +
      (plannedLeaves.length ? plannedLeaves.map((l) => {
        const ltype = String(l.client_name).replace('PLANNED_LEAVE:', '') || 'On Leave';
        const canCancel = isManager() || l.employee_id === u.employee_id;
        return '<tr><td><strong>' + esc(l.employee_name) + '</strong></td><td>' + statusPill(ltype) + '</td><td>' + formatIndianDate(l.start_date) + '</td><td>' + formatIndianDate(l.end_date) + '</td><td>' + esc(l.reason) + '</td><td>' + (canCancel ? '<button class="btn btn-outline btn-sm" data-act="cancel-leave" data-id="' + esc(l.booking_id) + '">Cancel</button>' : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">No active or upcoming planned leaves scheduled.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-header"><h3>Active Client Resource Bookings</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Resource</th><th>Client / Engagement</th><th>Booked By</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>' +
      (clientBookings.length ? clientBookings.map((b) =>
        '<tr><td><strong>' + esc(b.employee_name) + '</strong></td><td>' + esc(b.client_name) + '</td><td>' + esc(b.booked_by_name) + '</td><td>' + formatIndianDate(b.start_date) + '</td><td>' + formatIndianDate(b.end_date) + '</td><td>' + esc(b.reason) + '</td></tr>'
      ).join('') : '<tr><td colspan="6" class="muted">No active client bookings.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderUtilization() {
    const tasks = STATE.data.tasks.slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    return '<div class="card">' +
      '<div class="card-header"><h3>Resource Utilization (Sorted Earliest Free First)</h3></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Resource</th><th>Client</th><th>Compliance</th><th>Manager / Reviewer</th><th>Expected End Date</th><th>Status</th>' +
      '</tr></thead><tbody>' +
      (tasks.length ? tasks.map((t) =>
        '<tr>' +
          '<td><strong>' + esc(t.assigned_to_name) + '</strong></td>' +
          '<td>' + esc(t.client_name) + '</td>' +
          '<td>' + esc(t.compliance_name) + '</td>' +
          '<td>' + esc(t.reviewer_name) + '</td>' +
          '<td>' + formatIndianDate(t.due_date < todayISO() ? todayISO() : t.due_date) + '</td>' +
          '<td>' + statusPill(t.status, isOverdue(t)) + '</td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="6" class="muted">All resources are currently unallocated.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderCalendar() {
    const today = todayISO();
    const sorted = STATE.data.tasks.slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    return '<div class="card">' +
      '<div class="card-header"><h3>Chronological Compliance Calendar</h3><span class="muted">Red = Overdue / &le;2 days &bull; Orange = &le;7 days &bull; Green = On Track</span></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Due Date</th><th>Urgency</th><th>Client</th><th>Compliance</th><th>Resource</th><th>Status</th>' +
      '</tr></thead><tbody>' +
      (sorted.length ? sorted.map((t) => {
        const diff = daysBetween(today, t.due_date);
        let urg = '<span class="pill pill-green">' + diff + ' days left</span>';
        if (diff < 0) urg = '<span class="pill pill-red">Overdue by ' + Math.abs(diff) + 'd</span>';
        else if (diff === 0) urg = '<span class="pill pill-red">Due Today</span>';
        else if (diff <= 2) urg = '<span class="pill pill-red">Due in ' + diff + 'd</span>';
        else if (diff <= 7) urg = '<span class="pill pill-orange">Due in ' + diff + 'd</span>';
        return '<tr class="' + (diff < 0 ? 'row-overdue' : '') + '">' +
          '<td><strong>' + formatIndianDate(t.due_date) + '</strong></td>' +
          '<td>' + urg + '</td>' +
          '<td>' + esc(t.client_name) + '</td>' +
          '<td>' + esc(t.compliance_name) + '</td>' +
          '<td>' + esc(t.assigned_to_name) + '</td>' +
          '<td>' + statusPill(t.status) + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="6" class="muted">No upcoming filings scheduled.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderAttendance() {
    const d = STATE.data;
    const u = d.user;
    const myToday = d.attendance_today.find((a) => a.employee_id === u.employee_id);
    const todayRows = d.attendance_today || [];
    const myLeaves = (d.bookings || []).filter((b) => b.employee_id === u.employee_id && String(b.client_name || '').indexOf('PLANNED_LEAVE:') === 0);
    return '' +
      '<div class="card"><div class="card-header"><h3>Daily Check-In (GPS Verified)</h3><span class="muted">Late mark applies after 10:30 AM IST</span></div>' +
      '<div class="card-body">' +
      (myToday
        ? '<div class="alert alert-info">Checked in today at <strong>' + esc(myToday.check_in_time) + '</strong> (' + statusPill(myToday.status) + ')' +
          (myToday.latitude ? ' &bull; GPS: ' + esc(myToday.latitude) + ', ' + esc(myToday.longitude) : '') + '</div>'
        : '<button class="btn btn-success" id="btn-mark-present">Mark Present Now (Capture Time &amp; GPS)</button>') +
      '</div></div>' +
      (u.role !== 'Partner' ? '<div class="card"><div class="card-header"><h3>My Planned Leave / Holiday Calendar</h3><button class="btn btn-primary btn-sm" id="btn-schedule-leave">+ Schedule Holiday / Leave</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Leave Type</th><th>From</th><th>To</th><th>Reason</th><th>Action</th></tr></thead><tbody>' +
        (myLeaves.length ? myLeaves.map((l) => {
          const ltype = String(l.client_name).replace('PLANNED_LEAVE:', '') || 'On Leave';
          return '<tr><td>' + statusPill(ltype) + '</td><td>' + formatIndianDate(l.start_date) + '</td><td>' + formatIndianDate(l.end_date) + '</td><td>' + esc(l.reason) + '</td><td><button class="btn btn-outline btn-sm" data-act="cancel-leave" data-id="' + esc(l.booking_id) + '">Cancel</button></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">No upcoming holidays or leaves scheduled. Click "+ Schedule Holiday / Leave" to block dates on the team availability tracker.</td></tr>') +
        '</tbody></table></div></div>' : '') +
      (isManager() ? '<div class="card"><div class="card-header"><h3>Today\'s Full Team Attendance Roster (' + formatIndianDate(todayISO()) + ')</h3><span class="muted">2nd &amp; 4th Saturdays + Sundays never auto-mark Absent (manual Mark Absent only) &bull; Mon–Fri auto-sweep at 7:00 PM IST</span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Role</th><th>Check-In Time</th><th>Status</th><th>GPS / Notes</th><th>Action</th></tr></thead><tbody>' +
        d.employees.filter((e) => e.status === 'Active' && e.role !== 'Partner').map((emp) => {
          const rec = todayRows.find((a) => a.employee_id === emp.employee_id);
          const st = rec ? rec.status : (emp.availability_status === 'On Leave' || emp.availability_status === 'Exam Leave' ? emp.availability_status : 'Not Marked');
          const timeStr = rec ? rec.check_in_time : '—';
          const noteStr = rec ? (rec.latitude ? (rec.latitude + ', ' + rec.longitude) : (rec.location_note || '—')) : (emp.leave_reason || 'No check-in yet');
          const actBtn = (!rec || rec.status !== 'Absent')
            ? '<button class="btn btn-danger btn-sm" data-act="mark-absent" data-id="' + esc(emp.employee_id) + '">Mark Absent</button>'
            : '<span class="muted">Logged Absent</span>';
          return '<tr><td><strong>' + esc(emp.full_name) + '</strong></td><td>' + esc(emp.role) + '</td><td>' + esc(timeStr) + '</td><td>' + statusPill(st) + '</td><td class="muted">' + esc(noteStr) + '</td><td>' + actBtn + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div>' : '') +
      '<div class="card"><div class="card-header"><h3>Firm Holiday Calendar (No Auto-Absent on Holidays, Saturdays, or Sundays)</h3>' +
      (isManager() ? '<button class="btn btn-primary btn-sm" id="btn-add-holiday">+ Add Firm Holiday</button>' : '') +
      '</div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Holiday Name</th><th>Office</th>' + (isManager() ? '<th>Action</th>' : '') + '</tr></thead><tbody>' +
      ((d.holidays || []).length ? d.holidays.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((h) =>
        '<tr><td><strong>' + formatIndianDate(h.date) + '</strong></td><td>' + esc(h.name) + '</td><td>' + esc(h.location || 'All Offices') + '</td>' +
        (isManager() ? '<td><button class="btn btn-outline btn-sm" data-act="del-holiday" data-id="' + esc(h.holiday_id) + '">Remove</button></td>' : '') + '</tr>'
      ).join('') : '<tr><td colspan="4" class="muted">No firm holidays listed yet.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderTimesheet() {
    const d = STATE.data;
    const u = d.user;
    const myDraft = d.timesheet_weeks.find((w) => w.employee_id === u.employee_id);
    const details = myDraft ? d.timesheet_details.filter((x) => x.week_id === myDraft.week_id) : [];

    let html = '<div class="card"><div class="card-header"><h3>My Weekly Timesheet (Previous Week Mon–Sat)</h3>';
    if (myDraft) {
      html += '<div class="action-row">' +
        '<span class="pill pill-info">Total: ' + esc(myDraft.total_hours || '0') + ' hrs</span>' +
        '<button class="btn btn-success btn-sm" id="btn-submit-ts" data-week="' + esc(myDraft.week_id) + '">Submit Week &amp; Lock</button>' +
      '</div>';
    } else {
      html += '<button class="btn btn-primary btn-sm" id="btn-init-ts">Generate Previous Week Sheet</button>';
    }
    html += '</div>';

    if (myDraft) {
      html += '<div class="card-body"><div class="muted" style="margin-bottom:10px;">Week: <strong>' + formatIndianDate(myDraft.week_start) + '</strong> to <strong>' + formatIndianDate(myDraft.week_end) + '</strong> &bull; Max 10 hours/day &bull; Click "+ Split Day" to log multiple clients on the same day.</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Day &amp; Date</th><th>Client</th><th>Work / Compliance</th><th>Hours (&le;10)</th><th>Save</th></tr></thead><tbody>' +
        details.map((row) =>
          '<tr data-ts-row="' + esc(row.detail_id) + '">' +
            '<td><strong>' + esc(row.day_name) + '</strong><div class="muted">' + formatIndianDate(row.work_date) + '</div>' +
              '<button class="btn btn-ghost btn-sm" data-act="add-ts-row" data-week="' + esc(myDraft.week_id) + '" data-date="' + esc(row.work_date) + '" data-day="' + esc(row.day_name) + '">+ Split Day</button></td>' +
            '<td><select class="ts-client" style="width:180px;padding:6px;border-radius:6px;border:1px solid #cbd5e1;">' +
              '<option value="">-- Select Client --</option>' +
              d.clients.map((c) => '<option value="' + esc(c.client_id) + '" data-name="' + esc(c.client_name) + '" ' + (c.client_id === row.client_id ? 'selected' : '') + '>' + esc(c.client_name) + '</option>').join('') +
            '</select></td>' +
            '<td><input class="ts-desc" type="text" value="' + esc(row.task_description || row.compliance_name || '') + '" placeholder="e.g. GSTR-1 reconciliation" style="width:210px;padding:6px;border-radius:6px;border:1px solid #cbd5e1;" /></td>' +
            '<td><input class="ts-hrs" type="number" min="0" max="10" step="0.5" value="' + esc(row.hours || '0') + '" style="width:72px;padding:6px;border-radius:6px;border:1px solid #cbd5e1;" /></td>' +
            '<td><button class="btn btn-outline btn-sm" data-act="save-ts-row" data-id="' + esc(row.detail_id) + '">Save</button></td>' +
          '</tr>'
        ).join('') +
        '</tbody></table></div></div>';
    } else {
      html += '<div class="card-body muted">No open draft timesheet found for the previous week. Click "Generate Previous Week Sheet" to start.</div>';
    }
    html += '</div>';

    if (isManager()) {
      const openAll = d.timesheet_weeks || [];
      const submittedAll = d.timesheet_archive || [];
      html += '<div class="card"><div class="card-header"><h3>Timesheet Compliance Monitor (Firm-Wide)</h3><span class="muted">Friday 6:00 PM IST reminder auto-emails unsubmitted Executives</span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Role</th><th>Week</th><th>Hours</th><th>Status</th></tr></thead><tbody>' +
        openAll.concat(submittedAll).map((w) =>
          '<tr><td><strong>' + esc(w.employee_name) + '</strong></td><td>' + esc(w.employee_role) + '</td><td>' + formatIndianDate(w.week_start) + ' – ' + formatIndianDate(w.week_end) + '</td><td>' + esc(w.total_hours) + 'h</td><td>' + statusPill(w.status) + '</td></tr>'
        ).join('') +
        '</tbody></table></div></div>';
    }
    return html;
  }

  function renderTodos() {
    const todos = STATE.data.todos || [];
    return '<div class="card"><div class="card-header"><h3>My To-Do List</h3><button class="btn btn-primary btn-sm" id="btn-add-todo">+ Add Personal To-Do</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Due Date</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead><tbody>' +
      (todos.length ? todos.map((td) =>
        '<tr>' +
          '<td style="' + (td.status === 'Done' ? 'text-decoration:line-through;color:#94a3b8;' : '') + '"><strong>' + esc(td.title) + '</strong>' + (td.linked_task_id ? ' <span class="pill pill-info">Task</span>' : '') + '</td>' +
          '<td>' + formatIndianDate(td.due_date) + '</td>' +
          '<td>' + esc(td.priority) + '</td>' +
          '<td>' + statusPill(td.status === 'Done' ? 'Filed' : 'Pending') + '</td>' +
          '<td><button class="btn btn-outline btn-sm" data-act="toggle-todo" data-id="' + esc(td.todo_id) + '">' + (td.status === 'Done' ? 'Reopen' : 'Mark Done') + '</button></td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="5" class="muted">No To-Do items yet.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderClients() {
    const d = STATE.data;
    if (STATE.selectedClientId) {
      const cl = d.clients.find((c) => c.client_id === STATE.selectedClientId);
      if (cl) {
        const clTasks = d.tasks.filter((t) => t.client_id === cl.client_id);
        const clArchived = d.archived_tasks.filter((t) => t.client_id === cl.client_id);
        return '<div class="card"><div class="card-header"><h3>' + esc(cl.client_name) + ' — Client Compliance View</h3>' +
          '<div class="action-row">' +
            '<button class="btn btn-outline btn-sm" id="btn-back-clients">&larr; All Clients</button>' +
            '<button class="btn btn-primary btn-sm" data-act="open-kyc-modal" data-client="' + esc(cl.client_id) + '">Upload KYC to Drive</button>' +
            (cl.kyc_folder_url ? '<a class="btn btn-secondary btn-sm" href="' + esc(cl.kyc_folder_url) + '" target="_blank" rel="noopener">Open Drive KYC Folder</a>' : '') +
          '</div></div>' +
          '<div class="card-body">PAN: <strong>' + esc(cl.pan || '—') + '</strong> &bull; GSTIN: <strong>' + esc(cl.gstin || '—') + '</strong> &bull; Partner: <strong>' + esc(cl.primary_partner || '—') + '</strong></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Compliance</th><th>Resource</th><th>Reviewer</th><th>Due Date</th><th>Status</th></tr></thead><tbody>' +
          clTasks.concat(clArchived).map((t) =>
            '<tr><td>' + esc(t.compliance_name) + '</td><td>' + esc(t.assigned_to_name) + '</td><td>' + esc(t.reviewer_name) + '</td><td>' + formatIndianDate(t.due_date) + '</td><td>' + statusPill(t.status, isOverdue(t)) + '</td></tr>'
          ).join('') +
          '</tbody></table></div></div>';
      }
    }

    return '<div class="card"><div class="card-header"><h3>Client Master &amp; KYC Vault</h3>' +
      (isManager() ? '<button class="btn btn-primary btn-sm" id="btn-add-client">+ Add Client</button>' : '') +
      '</div><div class="table-wrap"><table><thead><tr><th>Client Name</th><th>PAN / GSTIN</th><th>Entity Type</th><th>Partner</th><th>Drive KYC</th><th>View</th></tr></thead><tbody>' +
      (d.clients.length ? d.clients.map((c) =>
        '<tr>' +
          '<td><strong>' + esc(c.client_name) + '</strong><div class="muted">' + esc(c.location) + '</div></td>' +
          '<td>' + esc(c.pan || '—') + '<div class="muted">' + esc(c.gstin || '—') + '</div></td>' +
          '<td>' + esc(c.entity_type) + '</td>' +
          '<td>' + esc(c.primary_partner) + '</td>' +
          '<td>' + (c.kyc_folder_url ? '<a href="' + esc(c.kyc_folder_url) + '" target="_blank" rel="noopener">Open Folder</a>' : '—') + '</td>' +
          '<td><button class="btn btn-outline btn-sm" data-act="view-client" data-id="' + esc(c.client_id) + '">Compliance View</button></td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="6" class="muted">No clients added yet.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderLibrary() {
    const d = STATE.data;
    return '<div class="card"><div class="card-header"><h3>Statutory Compliance Library</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Compliance Name</th><th>Category</th><th>Frequency</th><th>Default Due Rule</th></tr></thead><tbody>' +
      d.compliances.map((c) =>
        '<tr><td><strong>' + esc(c.compliance_name) + '</strong></td><td>' + esc(c.category) + '</td><td>' + esc(c.frequency) + '</td><td>' + esc(c.statutory_due_rule || ('Day ' + c.default_due_day)) + '</td></tr>'
      ).join('') +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-header"><h3>Recurring Client–Compliance Auto-Schedule</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Compliance</th><th>Frequency</th><th>Due Day</th><th>Active</th></tr></thead><tbody>' +
      (d.client_compliance_map.length ? d.client_compliance_map.map((m) =>
        '<tr><td><strong>' + esc(m.client_name) + '</strong></td><td>' + esc(m.compliance_name) + '</td><td>' + esc(m.frequency) + '</td><td>' + esc(m.due_day) + '</td><td>' + statusPill(m.active === 'Yes' ? 'Active' : 'Inactive') + '</td></tr>'
      ).join('') : '<tr><td colspan="5" class="muted">No recurring client mappings yet.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderHierarchy() {
    const emps = STATE.data.employees.filter((e) => e.status === 'Active');
    return '<div class="card"><div class="card-header"><h3>7-Level Firm Organizational Hierarchy</h3><span class="muted">Floating Reviewers &bull; Downward Assignment Enforced</span></div><div class="card-body">' +
      ROLE_HIERARCHY.map((tier) => {
        const members = emps.filter((e) => e.role === tier.role);
        return '<div class="hierarchy-tier">' +
          '<div class="hierarchy-tier-title">Level ' + tier.level + ' &mdash; ' + esc(tier.role) + ' (' + members.length + ')</div>' +
          '<div class="hierarchy-chips">' +
          (members.length ? members.map((m) =>
            '<div class="member-pill"><strong>' + esc(m.full_name) + '</strong> <span class="muted">(' + esc(m.location) + ')</span></div>'
          ).join('') : '<span class="muted">No active team members in this tier</span>') +
          '</div></div>';
      }).join('') +
      '</div></div>';
  }

  function downloadCsv(filename, headers, rows) {
    const csvEscape = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [headers.map(csvEscape).join(',')].concat(rows.map((r) => r.map(csvEscape).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderReports() {
    const d = STATE.data;
    const month = STATE.reportMonth || todayISO().slice(0, 7);
    STATE.reportMonth = month;

    const tsRows = (d.timesheet_details || []).filter((r) => !month || (r.work_date || '').slice(0, 7) === month);
    const clientMap = {};
    const empHoursMap = {};
    let grandTotal = 0;
    tsRows.forEach((r) => {
      const h = parseFloat(r.hours) || 0;
      if (h <= 0) return;
      grandTotal += h;
      const cname = r.client_name || 'Internal / Unassigned';
      if (!clientMap[cname]) clientMap[cname] = { hours: 0, staff: new Set() };
      clientMap[cname].hours += h;
      if (r.employee_name) clientMap[cname].staff.add(r.employee_name);
      const ename = r.employee_name || 'Unknown';
      if (!empHoursMap[ename]) empHoursMap[ename] = { hours: 0, clients: new Set() };
      empHoursMap[ename].hours += h;
      if (r.client_name) empHoursMap[ename].clients.add(r.client_name);
    });
    const clientSummary = Object.keys(clientMap).map((k) => ({
      client: k,
      hours: Math.round(clientMap[k].hours * 100) / 100,
      staff: Array.from(clientMap[k].staff).join(', '),
      pct: grandTotal > 0 ? Math.round((clientMap[k].hours / grandTotal) * 1000) / 10 : 0
    })).sort((a, b) => b.hours - a.hours);

    const empSummary = Object.keys(empHoursMap).map((k) => ({
      employee: k,
      hours: Math.round(empHoursMap[k].hours * 100) / 100,
      clients: empHoursMap[k].clients.size
    })).sort((a, b) => b.hours - a.hours);

    const attRows = (d.attendance_history || []).filter((a) => (a.date || '').slice(0, 7) === month);
    const attMatrix = d.employees.filter((e) => e.status === 'Active' && e.role !== 'Partner').map((emp) => {
      const mine = attRows.filter((a) => a.employee_id === emp.employee_id);
      const cnt = (st) => mine.filter((a) => a.status === st).length;
      return {
        name: emp.full_name, role: emp.role, office: emp.location,
        present: cnt('Present'), late: cnt('Late'), absent: cnt('Absent'),
        onLeave: cnt('On Leave'), examLeave: cnt('Exam Leave'), total: mine.length
      };
    });

    STATE._lastReportData = { month, clientSummary, empSummary, attMatrix };

    return '' +
      '<div class="card"><div class="card-body"><div class="filter-bar" style="margin:0;">' +
        '<strong>Report Month:</strong> <input id="report-month-input" type="month" value="' + esc(month) + '" />' +
        '<span class="muted">Total Firm Hours Logged: <strong>' + Math.round(grandTotal * 100) / 100 + ' hrs</strong></span>' +
      '</div></div></div>' +
      '<div class="card"><div class="card-header"><h3>Client-Wise Hours &amp; Billing Summary (' + esc(month) + ')</h3>' +
        '<button class="btn btn-outline btn-sm" id="btn-export-client-hrs">Download CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Total Hours</th><th>% of Firm Hours</th><th>Team Members</th></tr></thead><tbody>' +
        (clientSummary.length ? clientSummary.map((c) =>
          '<tr><td><strong>' + esc(c.client) + '</strong></td><td><strong>' + c.hours + 'h</strong></td><td>' + c.pct + '%</td><td class="muted">' + esc(c.staff) + '</td></tr>'
        ).join('') : '<tr><td colspan="4" class="muted">No client hours logged for ' + esc(month) + '.</td></tr>') +
        '</tbody></table></div></div>' +
      '<div class="card"><div class="card-header"><h3>Employee-Wise Hours Logged (' + esc(month) + ')</h3>' +
        '<button class="btn btn-outline btn-sm" id="btn-export-emp-hrs">Download CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Total Hours</th><th>Clients Served</th></tr></thead><tbody>' +
        (empSummary.length ? empSummary.map((e) =>
          '<tr><td><strong>' + esc(e.employee) + '</strong></td><td><strong>' + e.hours + 'h</strong></td><td>' + e.clients + '</td></tr>'
        ).join('') : '<tr><td colspan="3" class="muted">No employee timesheet hours logged for ' + esc(month) + '.</td></tr>') +
        '</tbody></table></div></div>' +
      '<div class="card"><div class="card-header"><h3>Monthly Attendance Summary Matrix — Payroll Ready (' + esc(month) + ')</h3>' +
        '<button class="btn btn-success btn-sm" id="btn-export-att-csv">Download Payroll CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Role</th><th>Office</th><th>Present</th><th>Late</th><th>Absent</th><th>On Leave</th><th>Exam Leave</th><th>Total Days</th></tr></thead><tbody>' +
        attMatrix.map((m) =>
          '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.role) + '</td><td>' + esc(m.office) + '</td><td>' + m.present + '</td><td>' + m.late + '</td><td><strong style="color:#dc2626;">' + m.absent + '</strong></td><td>' + m.onLeave + '</td><td>' + m.examLeave + '</td><td>' + m.total + '</td></tr>'
        ).join('') +
        '</tbody></table></div></div>';
  }

  function renderHistory() {
    const f = STATE.historyFilters;
    const rows = (STATE.data.archived_tasks || []).filter((t) => {
      if (f.q) {
        const hay = (t.client_name + ' ' + t.compliance_name + ' ' + t.assigned_to_name + ' ' + (t.arn_number || '')).toLowerCase();
        if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
      }
      if (f.month && (t.filing_date || '').slice(0, 7) !== f.month) return false;
      return true;
    });
    return '<div class="card"><div class="card-header"><h3>Filed &amp; Permanently Archived Compliance History</h3></div><div class="card-body">' +
      '<div class="filter-bar">' +
        '<input id="hist-q" type="search" placeholder="Search client, compliance, resource, or ARN/Challan No..." value="' + esc(f.q) + '" style="min-width:280px;" />' +
        '<input id="hist-month" type="month" value="' + esc(f.month) + '" />' +
      '</div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Compliance</th><th>ARN / Ref No.</th><th>Prepared By</th><th>Reviewed By</th><th>Filed On</th><th>Drive Filing</th></tr></thead><tbody>' +
      (rows.length ? rows.map((t) =>
        '<tr>' +
          '<td><strong>' + esc(t.client_name) + '</strong></td>' +
          '<td>' + esc(t.compliance_name) + '</td>' +
          '<td><strong>' + esc(t.arn_number || '—') + '</strong></td>' +
          '<td>' + esc(t.assigned_to_name) + '</td>' +
          '<td>' + esc(t.reviewer_name) + '</td>' +
          '<td>' + formatIndianDate(t.filing_date) + '</td>' +
          '<td>' + (t.filing_file_url ? '<a href="' + esc(t.filing_file_url) + '" target="_blank" rel="noopener">' + esc(t.filing_file_name || 'Open Filing') + '</a>' : '—') + '</td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="7" class="muted">No archived filings match your filter.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function renderDirectory() {
    const d = STATE.data;
    return '<div class="card"><div class="card-header"><h3>Team Directory (Deactivate Only — Zero Data Deletion)</h3>' +
      '<div class="action-row">' +
        '<button class="btn btn-secondary btn-sm" id="btn-run-backup">Run Excel + PDF Drive Backup Now</button>' +
        '<button class="btn btn-primary btn-sm" id="btn-add-emp">+ Add Employee</button>' +
      '</div></div>' +
      '<div class="card-body"><div class="muted">Last Google Drive Backup: <strong>' + esc(d.last_backup_at ? formatIndianDate(d.last_backup_at) : 'Not run yet') + '</strong>' +
      (d.drive_root_url ? ' &bull; <a href="' + esc(d.drive_root_url) + '" target="_blank" rel="noopener">Open ComplianceTracker Drive Root</a>' : '') + '</div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Name &amp; Email</th><th>Role (Level)</th><th>Office</th><th>Status</th><th>Controls</th></tr></thead><tbody>' +
      d.employees.map((e) =>
        '<tr>' +
          '<td><strong>' + esc(e.full_name) + '</strong><div class="muted">' + esc(e.email) + '</div></td>' +
          '<td>' + esc(e.role) + ' (L' + e.role_level + ')</td>' +
          '<td>' + esc(e.location) + '</td>' +
          '<td>' + statusPill(e.status) + '</td>' +
          '<td class="action-row">' +
            (canEditHierarchy() ? '<button class="btn btn-outline btn-sm" data-act="edit-role" data-id="' + esc(e.employee_id) + '">Edit Role</button>' : '') +
            (e.employee_id !== d.user.employee_id ? '<button class="btn btn-outline btn-sm" data-act="toggle-emp" data-id="' + esc(e.employee_id) + '">' + (e.status === 'Active' ? 'Deactivate' : 'Reactivate') + '</button>' : '<span class="muted">You</span>') +
          '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table></div></div>';
  }

  /* ========================================================================
     MODALS (ASSIGN TASK WITH AUTO RESOURCE SUGGESTION, UPLOAD FILING, ETC.)
     ======================================================================== */

  function openAssignTaskModal() {
    const d = STATE.data;
    const myLevel = Number(d.user.role_level);
    const rankedResources = (d.resource_availability || []).filter((r) => Number(r.role_level) < myLevel);
    const reviewers = d.employees.filter((e) => e.status === 'Active' && e.role !== 'Executive');

    openModal('Assign Compliance Task (Auto Resource Suggestion)', '' +
      '<form id="assign-task-form" class="form-stack">' +
        '<div class="field"><label>Client</label><select name="client_id" required>' +
          d.clients.map((c) => '<option value="' + esc(c.client_id) + '">' + esc(c.client_name) + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>Compliance Task</label><select name="compliance_name" required>' +
          d.compliances.map((c) => '<option value="' + esc(c.compliance_name) + '">' + esc(c.compliance_name) + ' (' + esc(c.frequency) + ')</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>Assigned To (Auto-ranked Free &rarr; Available Soon &rarr; Earliest Free)</label><select name="assigned_to_id" required>' +
          rankedResources.map((r, idx) =>
            '<option value="' + esc(r.employee_id) + '" ' + (idx === 0 ? 'selected' : '') + '>' +
              esc(r.full_name) + ' — ' + esc(r.role) + ' [' + esc(r.computed_status) + ', ' + r.active_task_count + ' active]' +
            '</option>'
          ).join('') +
        '</select></div>' +
        '<div class="field"><label>Reviewer (All active roles except Executive)</label><select name="reviewer_id" required>' +
          reviewers.map((r) => '<option value="' + esc(r.employee_id) + '" ' + (r.employee_id === d.user.employee_id ? 'selected' : '') + '>' + esc(r.full_name) + ' (' + esc(r.role) + ')</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>Due Date</label><input type="date" name="due_date" required value="' + todayISO() + '" /></div>' +
        '<div class="field"><label>Period / Remarks</label><input type="text" name="remarks" placeholder="e.g. Nov-2026 filing" /></div>' +
        '<button type="submit" class="btn btn-primary">Assign Task &amp; Notify Employee</button>' +
      '</form>'
    );

    document.getElementById('assign-task-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await apiCall('createTask', Object.fromEntries(fd.entries()));
        closeModal();
        showToast('Task assigned and email notification sent.');
        await refreshData();
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    });
  }

  function openReassignModal(taskId) {
    const d = STATE.data;
    const myLevel = Number(d.user.role_level);
    const ranked = (d.resource_availability || []).filter((r) => Number(r.role_level) < myLevel);
    openModal('Reassign Compliance Task (1-Click Handoff)', '' +
      '<form id="reassign-form" class="form-stack">' +
        '<div class="field"><label>New Assignee (Auto-ranked Free &rarr; Earliest Free)</label><select name="new_assigned_to_id" required>' +
          ranked.map((r) => '<option value="' + esc(r.employee_id) + '">' + esc(r.full_name) + ' — ' + esc(r.role) + ' [' + esc(r.computed_status) + ', ' + r.active_task_count + ' active]</option>').join('') +
        '</select></div>' +
        '<button type="submit" class="btn btn-primary">Confirm Reassignment</button>' +
      '</form>'
    );
    document.getElementById('reassign-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await apiCall('reassignTask', { task_id: taskId, new_assigned_to_id: ev.target.new_assigned_to_id.value });
        closeModal(); showToast('Task reassigned & logged in Audit Trail.'); await refreshData();
      } catch (err) { showToast('Error: ' + err.message); }
    });
  }

  function openFilingUploadModal(taskId) {
    openModal('Upload Filing Acknowledgement (Mandatory)', '' +
      '<form id="filing-upload-form" class="form-stack">' +
        '<div class="alert alert-info">File will be auto-named with Client + Compliance + IST Timestamp and stored in Google Drive. Once filed, the task is permanently locked and archived.</div>' +
        '<div class="field"><label>ARN / Acknowledgement / Challan No. <span class="muted">(searchable in Task History)</span></label><input type="text" id="filing-arn-input" placeholder="e.g. AA0711261234567 / BSR-Challan No." /></div>' +
        '<div class="field"><label>Select Filing PDF / Acknowledgement</label><input type="file" id="filing-file-input" required /></div>' +
        '<button type="submit" class="btn btn-success">Upload to Drive &amp; Mark Filed</button>' +
      '</form>'
    );
    document.getElementById('filing-upload-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const file = document.getElementById('filing-file-input').files[0];
      if (!file) return;
      try {
        const b64 = await readFileAsBase64(file);
        await apiCall('uploadFilingAndClose', {
          task_id: taskId,
          arn_number: document.getElementById('filing-arn-input').value.trim(),
          file_name: file.name,
          mime_type: file.type || 'application/pdf',
          file_base64: b64
        });
        closeModal();
        showToast('Filing uploaded to Drive and task archived.');
        await refreshData();
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    });
  }

  /* ========================================================================
     EVENT BINDINGS
     ======================================================================== */

  function bindViewHandlers() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

    on('btn-assign-inline', openAssignTaskModal);
    on('btn-back-clients', () => { STATE.selectedClientId = null; renderView(); });

    on('btn-mark-present', async () => {
      let coords = { latitude: '', longitude: '' };
      if (navigator.geolocation) {
        await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => { coords.latitude = pos.coords.latitude.toFixed(5); coords.longitude = pos.coords.longitude.toFixed(5); resolve(); },
            () => resolve(),
            { timeout: 4000 }
          );
        });
      }
      try {
        await apiCall('markAttendance', coords);
        showToast('Attendance marked!');
        await refreshData();
      } catch (err) { showToast('Error: ' + err.message); }
    });

    on('btn-schedule-leave', () => {
      openModal('Schedule Holiday / Leave (Blocks Team Calendar)', '' +
        '<form id="leave-form" class="form-stack">' +
          '<div class="alert alert-info">Your dates will automatically show as <strong>On Leave</strong> in Resource Availability and auto-clear when you return.</div>' +
          '<div class="field"><label>Leave Type</label><select name="leave_type"><option value="On Leave">On Leave / Holiday</option><option value="Exam Leave">Exam Leave</option></select></div>' +
          '<div class="field"><label>Start Date</label><input type="date" name="start_date" required value="' + todayISO() + '" /></div>' +
          '<div class="field"><label>End Date</label><input type="date" name="end_date" required value="' + todayISO() + '" /></div>' +
          '<div class="field"><label>Reason</label><input name="reason" required placeholder="e.g. Family Holiday / CA Final Exam" /></div>' +
          '<button type="submit" class="btn btn-primary">Block Calendar Dates</button>' +
        '</form>'
      );
      document.getElementById('leave-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await apiCall('schedulePlannedLeave', Object.fromEntries(new FormData(ev.target).entries()));
          closeModal(); showToast('Holiday / leave scheduled on team calendar.'); await refreshData();
        } catch (err) { showToast('Error: ' + err.message); }
      });
    });

    on('btn-open-booking', () => {
      const list = STATE.data.resource_availability || [];
      openModal('Book / Block Resource', '' +
        '<form id="booking-form" class="form-stack">' +
          '<div class="field"><label>Resource</label><select name="employee_id" required>' +
            list.map((r) => '<option value="' + esc(r.employee_id) + '">' + esc(r.full_name) + ' (' + esc(r.role) + ')</option>').join('') +
          '</select></div>' +
          '<div class="field"><label>Client / Engagement</label><input name="client_name" required placeholder="e.g. Statutory Audit Fieldwork" /></div>' +
          '<div class="field"><label>Start Date</label><input type="date" name="start_date" required value="' + todayISO() + '" /></div>' +
          '<div class="field"><label>End Date</label><input type="date" name="end_date" required value="' + todayISO() + '" /></div>' +
          '<div class="field"><label>Reason</label><input name="reason" required placeholder="Outstation audit / special assignment" /></div>' +
          '<button type="submit" class="btn btn-primary">Confirm Booking</button>' +
        '</form>'
      );
      document.getElementById('booking-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await apiCall('createResourceBooking', Object.fromEntries(new FormData(ev.target).entries()));
          closeModal(); showToast('Resource booked.'); await refreshData();
        } catch (err) { showToast('Error: ' + err.message); }
      });
    });

    on('btn-init-ts', async () => {
      try { await apiCall('ensureCurrentTimesheet', {}); await refreshData(); } catch (err) { showToast('Error: ' + err.message); }
    });

    on('btn-submit-ts', async (ev) => {
      const wid = ev.currentTarget.dataset.week;
      try {
        await apiCall('submitTimesheetWeek', { week_id: wid });
        showToast('Weekly timesheet submitted, locked, and archived.');
        await refreshData();
      } catch (err) { showToast('Error: ' + err.message); }
    });

    on('btn-add-todo', () => {
      openModal('Add Personal To-Do', '' +
        '<form id="todo-form" class="form-stack">' +
          '<div class="field"><label>Title</label><input name="title" required placeholder="Follow up on client documents" /></div>' +
          '<div class="field"><label>Due Date</label><input type="date" name="due_date" value="' + todayISO() + '" /></div>' +
          '<div class="field"><label>Priority</label><select name="priority"><option>High</option><option selected>Medium</option><option>Low</option></select></div>' +
          '<button type="submit" class="btn btn-primary">Add To-Do</button>' +
        '</form>'
      );
      document.getElementById('todo-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await apiCall('createTodo', Object.fromEntries(new FormData(ev.target).entries())); closeModal(); await refreshData(); }
        catch (err) { showToast('Error: ' + err.message); }
      });
    });

    on('btn-add-client', () => {
      openModal('Add New Client (Auto-creates Drive KYC Folder)', '' +
        '<form id="client-form" class="form-stack">' +
          '<div class="field"><label>Client Legal Name</label><input name="client_name" required /></div>' +
          '<div class="field"><label>PAN</label><input name="pan" maxlength="10" /></div>' +
          '<div class="field"><label>GSTIN</label><input name="gstin" maxlength="15" /></div>' +
          '<div class="field"><label>Entity Type</label><select name="entity_type"><option>Private Limited</option><option>LLP</option><option>Public Limited</option><option>Partnership</option><option>Proprietorship</option></select></div>' +
          '<div class="field"><label>City / Location</label><input name="location" value="New Delhi" /></div>' +
          '<button type="submit" class="btn btn-primary">Create Client &amp; KYC Folder</button>' +
        '</form>'
      );
      document.getElementById('client-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await apiCall('createClient', Object.fromEntries(new FormData(ev.target).entries())); closeModal(); showToast('Client created.'); await refreshData(); }
        catch (err) { showToast('Error: ' + err.message); }
      });
    });

    on('btn-add-emp', () => {
      openModal('Add Team Member', '' +
        '<form id="emp-form" class="form-stack">' +
          '<div class="field"><label>Full Name</label><input name="full_name" required /></div>' +
          '<div class="field"><label>Work Email</label><input type="email" name="email" required placeholder="name@vmgassociates.in" /></div>' +
          '<div class="field"><label>Hierarchy Role</label><select name="role">' +
            ROLE_HIERARCHY.map((r) => '<option value="' + esc(r.role) + '">' + esc(r.role) + ' (Level ' + r.level + ')</option>').join('') +
          '</select></div>' +
          '<div class="field"><label>Office Location</label><input name="location" value="New Delhi" /></div>' +
          '<div class="field"><label>Temporary 6-Digit PIN</label><input name="temp_pin" value="123456" required /></div>' +
          '<button type="submit" class="btn btn-primary">Add Employee</button>' +
        '</form>'
      );
      document.getElementById('emp-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await apiCall('createEmployee', Object.fromEntries(new FormData(ev.target).entries())); closeModal(); showToast('Employee added.'); await refreshData(); }
        catch (err) { showToast('Error: ' + err.message); }
      });
    });

    on('btn-run-backup', async () => {
      try { await apiCall('triggerManualBackup', {}); showToast('Excel & PDF backup saved to Google Drive!'); await refreshData(); }
      catch (err) { showToast('Error: ' + err.message); }
    });

    on('btn-add-holiday', () => {
      openModal('Add Firm Holiday', '' +
        '<form id="holiday-form" class="form-stack">' +
          '<div class="field"><label>Holiday Date</label><input type="date" name="date" required value="' + todayISO() + '" /></div>' +
          '<div class="field"><label>Holiday Name</label><input name="name" required placeholder="e.g. Diwali / Holi" /></div>' +
          '<div class="field"><label>Office</label><input name="location" value="All Offices" /></div>' +
          '<button type="submit" class="btn btn-primary">Save Holiday</button>' +
        '</form>'
      );
      document.getElementById('holiday-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await apiCall('createHoliday', Object.fromEntries(new FormData(ev.target).entries())); closeModal(); showToast('Firm holiday added.'); await refreshData(); }
        catch (err) { showToast('Error: ' + err.message); }
      });
    });

    const repM = document.getElementById('report-month-input');
    if (repM) repM.addEventListener('change', (e) => { STATE.reportMonth = e.target.value; renderView(); });
    on('btn-export-client-hrs', () => {
      const r = STATE._lastReportData;
      if (r) downloadCsv('TCA_Client_Hours_' + r.month + '.csv', ['Client', 'Total Hours', '% of Firm Hours', 'Team Members'], r.clientSummary.map((c) => [c.client, c.hours, c.pct + '%', c.staff]));
    });
    on('btn-export-emp-hrs', () => {
      const r = STATE._lastReportData;
      if (r) downloadCsv('TCA_Employee_Hours_' + r.month + '.csv', ['Employee', 'Total Hours', 'Clients Served'], r.empSummary.map((e) => [e.employee, e.hours, e.clients]));
    });
    on('btn-export-att-csv', () => {
      const r = STATE._lastReportData;
      if (r) downloadCsv('TCA_Attendance_Payroll_' + r.month + '.csv', ['Employee', 'Role', 'Office', 'Present', 'Late', 'Absent', 'On Leave', 'Exam Leave', 'Total Days'], r.attMatrix.map((m) => [m.name, m.role, m.office, m.present, m.late, m.absent, m.onLeave, m.examLeave, m.total]));
    });

    const histQ = document.getElementById('hist-q');
    if (histQ) histQ.addEventListener('input', (e) => { STATE.historyFilters.q = e.target.value; renderView(); });
    const histM = document.getElementById('hist-month');
    if (histM) histM.addEventListener('change', (e) => { STATE.historyFilters.month = e.target.value; renderView(); });

    // Delegated data-act buttons
    document.getElementById('view-container').querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        try {
          if (act === 'start-task') { await apiCall('startTask', { task_id: id }); showToast('Task marked In Process.'); await refreshData(); }
          else if (act === 'wait-client') {
            const reason = window.prompt('What documents or info are pending from the client?');
            if (reason === null) return;
            await apiCall('markWaitingOnClient', { task_id: id, reason: reason });
            showToast('Marked Waiting on Client.'); await refreshData();
          }
          else if (act === 'reassign-task') { openReassignModal(id); }
          else if (act === 'del-holiday') { await apiCall('deleteHoliday', { holiday_id: id }); showToast('Holiday removed.'); await refreshData(); }
          else if (act === 'submit-review') { await apiCall('submitTaskForReview', { task_id: id }); showToast('Submitted for review.'); await refreshData(); }
          else if (act === 'open-filing-modal') { openFilingUploadModal(id); }
          else if (act === 'approve-task') { await apiCall('reviewTask', { task_id: id, decision: 'Approve' }); showToast('Task approved.'); await refreshData(); }
          else if (act === 'reject-task') {
            const reason = window.prompt('Enter revision remarks for the assignee:') || 'Please review and resubmit.';
            await apiCall('reviewTask', { task_id: id, decision: 'Reject', remarks: reason });
            showToast('Task sent back to In Process.'); await refreshData();
          }
          else if (act === 'end-early') { await apiCall('endAssignmentEarly', { task_id: id }); showToast('Assignment end date updated to Today.'); await refreshData(); }
          else if (act === 'set-avail') {
            const st = btn.dataset.st;
            const reason = (st === 'On Leave' || st === 'Exam Leave') ? (window.prompt('Leave reason (optional, e.g. CA Final):') || '') : '';
            await apiCall('updateAvailabilityStatus', { employee_id: btn.dataset.emp, availability_status: st, leave_reason: reason });
            showToast('Availability updated to ' + st); await refreshData();
          }
          else if (act === 'save-ts-row') {
            const tr = btn.closest('tr');
            const sel = tr.querySelector('.ts-client');
            const opt = sel.options[sel.selectedIndex];
            await apiCall('saveTimesheetDetail', {
              detail_id: id,
              client_id: sel.value,
              client_name: opt && opt.dataset.name ? opt.dataset.name : '',
              task_description: tr.querySelector('.ts-desc').value,
              hours: tr.querySelector('.ts-hrs').value
            });
            showToast('Timesheet row saved.'); await refreshData();
          }
          else if (act === 'add-ts-row') {
            await apiCall('addTimesheetRow', { week_id: btn.dataset.week, work_date: btn.dataset.date, day_name: btn.dataset.day });
            await refreshData();
          }
          else if (act === 'toggle-todo') { await apiCall('toggleTodoDone', { todo_id: id }); await refreshData(); }
          else if (act === 'view-client') { STATE.selectedClientId = id; renderView(); }
          else if (act === 'open-kyc-modal') {
            const clientId = btn.dataset.client;
            openModal('Upload Client KYC Document to Drive', '' +
              '<form id="kyc-form" class="form-stack">' +
                '<div class="field"><label>Document Type</label><select name="doc_type"><option>PAN Card</option><option>GST Certificate</option><option>COI / MOA</option><option>Other KYC</option></select></div>' +
                '<div class="field"><label>Select File</label><input type="file" id="kyc-file" required /></div>' +
                '<button type="submit" class="btn btn-primary">Upload to KYC Folder</button>' +
              '</form>'
            );
            document.getElementById('kyc-form').addEventListener('submit', async (ev) => {
              ev.preventDefault();
              const file = document.getElementById('kyc-file').files[0];
              if (!file) return;
              const b64 = await readFileAsBase64(file);
              await apiCall('uploadClientKyc', { client_id: clientId, doc_type: ev.target.doc_type.value, file_name: file.name, mime_type: file.type, file_base64: b64 });
              closeModal(); showToast('KYC document uploaded to Google Drive.');
            });
          }
          else if (act === 'mark-absent') {
            const reason = window.prompt('Optional note / reason for marking Absent (leave blank if none):');
            if (reason === null) return;
            await apiCall('markEmployeeAbsent', { employee_id: id, reason: reason });
            showToast('Marked Absent in Attendance Register.'); await refreshData();
          }
          else if (act === 'cancel-leave') { await apiCall('cancelPlannedLeave', { booking_id: id }); showToast('Planned leave cancelled.'); await refreshData(); }
          else if (act === 'edit-role') {
            const emp = STATE.data.employees.find((x) => x.employee_id === id);
            if (!emp) return;
            openModal('Edit Role & Hierarchy — ' + emp.full_name, '' +
              '<form id="edit-role-form" class="form-stack">' +
                '<input type="hidden" name="employee_id" value="' + esc(emp.employee_id) + '" />' +
                '<div class="field"><label>Hierarchy Role</label><select name="role">' +
                  ROLE_HIERARCHY.map((r) => '<option value="' + esc(r.role) + '" ' + (r.role === emp.role ? 'selected' : '') + '>' + esc(r.role) + ' (Level ' + r.level + ')</option>').join('') +
                '</select></div>' +
                '<div class="field"><label>Reporting To</label><input name="reporting_to" value="' + esc(emp.reporting_to || '') + '" placeholder="Optional reporting manager" /></div>' +
                '<div class="field"><label>Office Location</label><input name="location" value="' + esc(emp.location || '') + '" /></div>' +
                '<button type="submit" class="btn btn-primary">Save Role &amp; Hierarchy</button>' +
              '</form>'
            );
            document.getElementById('edit-role-form').addEventListener('submit', async (ev) => {
              ev.preventDefault();
              try {
                await apiCall('updateEmployeeRole', Object.fromEntries(new FormData(ev.target).entries()));
                closeModal(); showToast('Role & hierarchy updated.'); await refreshData();
              } catch (err) { showToast('Error: ' + err.message); }
            });
          }
          else if (act === 'toggle-emp') { await apiCall('toggleEmployeeStatus', { employee_id: id }); showToast('Employee status updated.'); await refreshData(); }
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });
  }

  /* ========================================================================
     AUTH & INITIALIZATION
     ======================================================================== */

  function handleSignOut() {
    STATE.token = '';
    STATE.data = null;
    localStorage.removeItem('tct_token');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  }

  function initApp() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    const emailInput = document.getElementById('login-email');
    const urlInput = document.getElementById('login-api-url');
    emailInput.value = localStorage.getItem('tct_last_email') || '';
    if (urlInput) urlInput.value = STATE.apiUrl;

    document.getElementById('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      const email = emailInput.value.trim();
      const pin = document.getElementById('login-pin').value.trim();
      const apiUrl = (urlInput && urlInput.value.trim()) || STATE.apiUrl;
      if (!apiUrl) {
        errEl.textContent = 'Backend connection URL is missing in config.js. Please contact your administrator.';
        errEl.classList.remove('hidden');
        return;
      }
      STATE.mode = 'live';
      STATE.apiUrl = apiUrl;
      localStorage.setItem('tct_api_url', apiUrl);
      localStorage.setItem('tct_last_email', email);
      try {
        const res = await apiCall('login', { email: email, pin: pin });
        STATE.token = res.token;
        localStorage.setItem('tct_token', res.token);
        await refreshData();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    const demoPartnerBtn = document.getElementById('demo-partner-btn');
    if (demoPartnerBtn) {
      demoPartnerBtn.addEventListener('click', async () => {
        STATE.mode = 'demo';
        DEMO_DB = buildDemoState('Partner');
        STATE.activeView = 'dashboard';
        await refreshData();
      });
    }
    const demoExecBtn = document.getElementById('demo-exec-btn');
    if (demoExecBtn) {
      demoExecBtn.addEventListener('click', async () => {
        STATE.mode = 'demo';
        DEMO_DB = buildDemoState('Executive');
        STATE.activeView = 'my-tasks';
        await refreshData();
      });
    }

    document.getElementById('logout-btn').addEventListener('click', handleSignOut);
    document.getElementById('refresh-btn').addEventListener('click', refreshData);
    document.getElementById('quick-assign-btn').addEventListener('click', openAssignTaskModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
    document.getElementById('open-sidebar-btn').addEventListener('click', () => document.getElementById('sidebar').classList.add('open'));
    document.getElementById('close-sidebar-btn').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));

    document.getElementById('change-pin-btn').addEventListener('click', () => {
      openModal('Change Login PIN', '' +
        '<form id="pin-form" class="form-stack">' +
          '<div class="field"><label>Current PIN</label><input type="password" inputmode="numeric" name="current_pin" required /></div>' +
          '<div class="field"><label>New PIN (4–8 digits)</label><input type="password" inputmode="numeric" name="new_pin" required /></div>' +
          '<button type="submit" class="btn btn-primary">Update PIN</button>' +
        '</form>'
      );
      document.getElementById('pin-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await apiCall('changePin', Object.fromEntries(new FormData(ev.target).entries()));
          closeModal(); showToast('PIN updated successfully.');
        } catch (err) { showToast('Error: ' + err.message); }
      });
    });

    startAutoSync();
    if (STATE.token && STATE.apiUrl) {
      STATE.mode = 'live';
      refreshData();
    }
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
