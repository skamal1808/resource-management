/**
 * 100% Google Sheets & Apps Script Authentication (Zero MS365 / Entra ID dependency).
 * Employees sign in with their work email (e.g. shahrukh.kamal@vmgassociates.in) + 6-digit PIN.
 * PINs are stored as salted SHA-256 hashes in Employee_Master.
 * Active sessions use rolling 6-hour tokens stored in ScriptCache.
 */

function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function hashPin(pin, salt) {
  var raw = String(salt) + '::' + String(pin).trim();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0) ? b + 256 : b;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function findEmployeeByEmail(email) {
  var target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  var rows = readSheetObjects(SHEETS.EMPLOYEES);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').trim().toLowerCase() === target) {
      return rows[i];
    }
  }
  return null;
}

function findEmployeeById(empId) {
  var rows = readSheetObjects(SHEETS.EMPLOYEES);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].employee_id === empId) return rows[i];
  }
  return null;
}

function sanitizeEmployee(emp) {
  return {
    employee_id: emp.employee_id,
    full_name: emp.full_name,
    email: emp.email,
    role: emp.role,
    role_level: Number(emp.role_level) || ROLE_LEVELS[emp.role] || 1,
    location: emp.location,
    reporting_to: emp.reporting_to,
    status: emp.status,
    availability_status: emp.role === 'Partner' ? 'Always Available' : (emp.availability_status || 'Available'),
    leave_reason: emp.leave_reason || '',
    leave_updated_at: emp.leave_updated_at || '',
    must_change_pin: emp.must_change_pin === 'Yes'
  };
}

function handleLogin(payload) {
  var email = String(payload.email || '').trim().toLowerCase();
  var pin = String(payload.pin || '').trim();
  if (!email || !pin) {
    throw new Error('Please enter both your work email and PIN.');
  }

  var emp = findEmployeeByEmail(email);
  if (!emp) {
    throw new Error('No account found for ' + email + '. Ask a Manager or Partner to add you in Team Directory.');
  }
  if (emp.status !== 'Active') {
    throw new Error('Your account is currently deactivated. Contact a Manager or Partner.');
  }

  var computed = hashPin(pin, emp.pin_salt);
  if (computed !== emp.pin_hash) {
    throw new Error('Incorrect PIN. Please try again or ask a Partner to reset your PIN.');
  }

  var token = Utilities.getUuid() + '-' + Utilities.getUuid();
  var cache = CacheService.getScriptCache();
  cache.put('SESSION_' + token, emp.employee_id, APP_CONFIG.SESSION_TTL_SECONDS);

  return {
    token: token,
    user: sanitizeEmployee(emp)
  };
}

function handleLogout(token) {
  if (token) {
    CacheService.getScriptCache().remove('SESSION_' + token);
  }
  return { ok: true };
}

function requireSession(token) {
  if (!token) {
    throw new Error('AUTH_REQUIRED: Session missing. Please sign in.');
  }
  var cache = CacheService.getScriptCache();
  var empId = cache.get('SESSION_' + token);
  if (!empId) {
    throw new Error('AUTH_REQUIRED: Session expired. Please sign in again.');
  }
  var emp = findEmployeeById(empId);
  if (!emp || emp.status !== 'Active') {
    cache.remove('SESSION_' + token);
    throw new Error('AUTH_REQUIRED: Account is inactive.');
  }
  // Refresh rolling 6-hour session TTL
  cache.put('SESSION_' + token, emp.employee_id, APP_CONFIG.SESSION_TTL_SECONDS);
  return sanitizeEmployee(emp);
}

function requireManagerOrAbove(user) {
  if (Number(user.role_level) < MANAGER_MIN_LEVEL) {
    throw new Error('PERMISSION_DENIED: Only Manager and above can perform this action.');
  }
}

function handleChangePin(user, payload) {
  var currentPin = String(payload.current_pin || '').trim();
  var newPin = String(payload.new_pin || '').trim();
  if (!/^\d{4,8}$/.test(newPin)) {
    throw new Error('New PIN must be 4 to 8 digits.');
  }
  var emp = findEmployeeById(user.employee_id);
  if (!emp) throw new Error('Employee not found.');

  if (hashPin(currentPin, emp.pin_salt) !== emp.pin_hash) {
    throw new Error('Current PIN is incorrect.');
  }

  var newSalt = generateSalt();
  var newHash = hashPin(newPin, newSalt);
  updateSheetRow(SHEETS.EMPLOYEES, emp._rowIndex, {
    pin_salt: newSalt,
    pin_hash: newHash,
    must_change_pin: 'No'
  });
  return { ok: true };
}
