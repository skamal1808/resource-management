/**
 * Google Drive structured folder management, auto-named filing uploads,
 * Client KYC folder uploads, and scheduled Excel + PDF workbook backups.
 *
 * Structure:
 *   ComplianceTracker/
 *     <Client_Name>/
 *       KYC_Documents/
 *       <Compliance_Name>/
 *         <Client_Name>_<Compliance_Name>_<DD-MMM-YYYY>_<HHMMSS>.<ext>
 *     Backups/
 *       YYYY-MM/
 *         ComplianceTracker_Backup_<YYYY-MM-DD>.xlsx
 *         ComplianceTracker_Backup_<YYYY-MM-DD>.pdf
 */

function sanitizeFolderName(name) {
  return String(name || 'General')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFileSlug(name) {
  return String(name || 'File')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getOrCreateRootFolder() {
  var storedId = '';
  try {
    storedId = getSetting('drive_root_id', '');
  } catch (e) {
    storedId = '';
  }
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (e) {
      // Fallback to search/create
    }
  }
  var iter = DriveApp.getFoldersByName(APP_CONFIG.DRIVE_ROOT_FOLDER_NAME);
  if (iter.hasNext()) {
    return iter.next();
  }
  return DriveApp.createFolder(APP_CONFIG.DRIVE_ROOT_FOLDER_NAME);
}

function getOrCreateSubfolder(parentFolder, subfolderName) {
  var clean = sanitizeFolderName(subfolderName);
  var iter = parentFolder.getFoldersByName(clean);
  if (iter.hasNext()) {
    return iter.next();
  }
  return parentFolder.createFolder(clean);
}

function ensureClientKycFolder(clientName) {
  var root = getOrCreateRootFolder();
  var clientFolder = getOrCreateSubfolder(root, clientName);
  var kycFolder = getOrCreateSubfolder(clientFolder, 'KYC_Documents');
  return kycFolder;
}

function uploadTaskFilingToDrive(task, base64Data, originalFileName, mimeType) {
  if (!base64Data) {
    throw new Error('Filing attachment is mandatory before marking a task as Filed.');
  }
  var root = getOrCreateRootFolder();
  var clientFolder = getOrCreateSubfolder(root, task.client_name);
  var complianceFolder = getOrCreateSubfolder(clientFolder, task.compliance_name);

  var ext = 'pdf';
  if (originalFileName && originalFileName.indexOf('.') !== -1) {
    ext = originalFileName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  }

  var now = new Date();
  var dateStamp = Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'dd-MMM-yyyy');
  var timeStamp = Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'HHmmss');
  var finalName = sanitizeFileSlug(task.client_name) + '_' +
    sanitizeFileSlug(task.compliance_name) + '_' +
    dateStamp + '_' + timeStamp + '.' + ext;

  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', finalName);
  var file = complianceFolder.createFile(blob);

  return {
    file_id: file.getId(),
    file_name: finalName,
    file_url: file.getUrl()
  };
}

function uploadClientKycToDrive(clientName, docType, base64Data, originalFileName, mimeType) {
  if (!base64Data) throw new Error('File content is required.');
  var kycFolder = ensureClientKycFolder(clientName);

  var ext = 'pdf';
  if (originalFileName && originalFileName.indexOf('.') !== -1) {
    ext = originalFileName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  }
  var dateStamp = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd-MMM-yyyy');
  var finalName = sanitizeFileSlug(clientName) + '_' +
    sanitizeFileSlug(docType || 'KYC') + '_' + dateStamp + '.' + ext;

  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/pdf', finalName);
  var file = kycFolder.createFile(blob);

  return {
    file_id: file.getId(),
    file_name: finalName,
    file_url: file.getUrl(),
    folder_url: kycFolder.getUrl()
  };
}

function runWorkbookBackup() {
  var ss = getSpreadsheet();
  var ssId = ss.getId();
  var token = ScriptApp.getOAuthToken();
  var now = new Date();
  var monthFolderName = Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'yyyy-MM');
  var dateLabel = Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmm');

  var root = getOrCreateRootFolder();
  var backupsRoot = getOrCreateSubfolder(root, 'Backups');
  var monthFolder = getOrCreateSubfolder(backupsRoot, monthFolderName);

  // Export XLSX
  var xlsxUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
  var xlsxResp = UrlFetchApp.fetch(xlsxUrl, {
    headers: { Authorization: 'Bearer ' + token }
  });
  var xlsxFile = monthFolder.createFile(
    xlsxResp.getBlob().setName('ComplianceTracker_Backup_' + dateLabel + '.xlsx')
  );

  // Export PDF
  var pdfUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=pdf&size=A4&portrait=false&fitw=true';
  var pdfResp = UrlFetchApp.fetch(pdfUrl, {
    headers: { Authorization: 'Bearer ' + token }
  });
  var pdfFile = monthFolder.createFile(
    pdfResp.getBlob().setName('ComplianceTracker_Backup_' + dateLabel + '.pdf')
  );

  setSetting('last_backup_at', formatISOTimestamp(now), 'Timestamp of latest Drive backup');
  return {
    ok: true,
    xlsx_url: xlsxFile.getUrl(),
    pdf_url: pdfFile.getUrl(),
    folder_url: monthFolder.getUrl()
  };
}
