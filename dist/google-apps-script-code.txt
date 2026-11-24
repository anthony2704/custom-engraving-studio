/* Deploy as a Web app: execute as the owner; access Anyone.
 * The browser never calls this URL directly. Cloudflare supplies the shared
 * secret, which is held in Script Properties and Cloudflare encrypted secrets.
 */
var INTAKE_RECIPIENT = 'khoa.v.nguyen.work@gmail.com';
var INTAKE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
var INTAKE_MAX_BODY_CHARS = 14 * 1024 * 1024;
var INTAKE_EMAIL_LEASE_MS = 10 * 60 * 1000;

/** Run once in the Apps Script editor, then authorize Google Drive and Mail. */
function setup() {
  var properties = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var folder;
  try {
    var folderId = properties.getProperty('GOOGLE_DRIVE_FOLDER_ID');
    folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.createFolder('Khac rieng - Yeu cau thiet ke');
    properties.setProperty('GOOGLE_DRIVE_FOLDER_ID', folder.getId());
    if (!properties.getProperty('DESIGN_INTAKE_SECRET')) {
      properties.setProperty('DESIGN_INTAKE_SECRET', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    }
    var hasRetryTrigger = ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'retryPendingEmails';
    });
    if (!hasRetryTrigger) ScriptApp.newTrigger('retryPendingEmails').timeBased().everyMinutes(5).create();
  } finally {
    lock.releaseLock();
  }
  // This authorizes the Mail service without sending a test message.
  var remainingQuota = MailApp.getRemainingDailyQuota();
  console.log('Setup complete. Private design folder: ' + folder.getUrl());
  console.log('Copy DESIGN_INTAKE_SECRET from Project Settings > Script Properties into the Cloudflare secret of the same name. Do not share it in chat.');
  console.log('Deploy > New deployment > Web app: Execute as Me; Who has access: Anyone. Copy the /exec URL to Cloudflare GOOGLE_APPS_SCRIPT_URL.');
  return { ready: true, folderUrl: folder.getUrl(), remainingDailyEmailQuota: remainingQuota };
}

function doGet() {
  return jsonOutput_({ service: 'classic-design-intake', version: 1 });
}

function doPost(event) {
  try {
    var contents = event && event.postData && event.postData.contents;
    if (typeof contents !== 'string' || contents.length > INTAKE_MAX_BODY_CHARS) fail_('INVALID_REQUEST');
    var payload;
    try { payload = JSON.parse(contents); } catch (_) { fail_('INVALID_REQUEST'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail_('INVALID_REQUEST');
    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = properties.getProperty('DESIGN_INTAKE_SECRET');
    var folderId = properties.getProperty('GOOGLE_DRIVE_FOLDER_ID');
    if (!expectedSecret || !folderId) fail_('NOT_CONFIGURED');
    if (!equalSecret_(payload.secret, expectedSecret)) fail_('UNAUTHORIZED');
    var design = validateDesign_(payload);
    var stored = persistDesign_(folderId, design);
    var emailSent = false;
    try { emailSent = sendStoredEmail_(stored.folderId); } catch (_) {
      // Accept a safely stored design even if a Mail/Lock service is unavailable.
    }
    return jsonOutput_({ success: true, requestId: design.requestId, stored: true, emailSent: emailSent, duplicate: stored.duplicate });
  } catch (error) {
    var safeCodes = ['INVALID_REQUEST', 'NOT_CONFIGURED', 'UNAUTHORIZED', 'INVALID_FIELD', 'INVALID_IMAGE', 'IMAGE_TOO_LARGE', 'REQUEST_CONFLICT', 'BUSY'];
    var code = safeCodes.indexOf(error.intakeCode) >= 0 ? error.intakeCode : 'STORAGE_FAILED';
    return jsonOutput_({ success: false, code: code });
  }
}

function validateDesign_(payload) {
  if (typeof payload.requestId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,99}$/.test(payload.requestId)) fail_('INVALID_FIELD');
  if (payload.product !== 'Classic') fail_('INVALID_FIELD');
  var name = field_(payload.name, 1, 120, false);
  var contact = field_(payload.contact, 1, 200, false);
  var note = field_(payload.note === undefined ? '' : payload.note, 0, 3000, true);
  if (!payload.designs || typeof payload.designs !== 'object') fail_('INVALID_IMAGE');
  var front = png_(payload.designs.front, 'thiet-ke-mat-truoc.png');
  var back = png_(payload.designs.back, 'thiet-ke-mat-sau.png');
  if (front.size + back.size > 2 * INTAKE_MAX_IMAGE_BYTES) fail_('IMAGE_TOO_LARGE');
  var fingerprint = sha256_(JSON.stringify([payload.requestId, name, contact, note, 'Classic', front.sha256, back.sha256]));
  return { requestId: payload.requestId, name: name, contact: contact, note: note, product: 'Classic', front: front, back: back, fingerprint: fingerprint };
}

function field_(value, minimum, maximum, multiline) {
  if (typeof value !== 'string') fail_('INVALID_FIELD');
  var result = value.trim();
  var controls = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/;
  if (result.length < minimum || result.length > maximum || controls.test(result)) fail_('INVALID_FIELD');
  return result;
}

function png_(dataUrl, filename) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(INTAKE_MAX_IMAGE_BYTES / 3) * 4 + 22) fail_('IMAGE_TOO_LARGE');
  var match = /^data:image\/png;base64,([a-zA-Z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[1].length % 4 !== 0) fail_('INVALID_IMAGE');
  var bytes;
  try { bytes = Utilities.base64Decode(match[1]); } catch (_) { fail_('INVALID_IMAGE'); }
  if (bytes.length > INTAKE_MAX_IMAGE_BYTES) fail_('IMAGE_TOO_LARGE');
  var signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some(function (byte, index) { return (bytes[index] & 255) !== byte; })) fail_('INVALID_IMAGE');
  if (unsigned32_(bytes, 8) !== 13 || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) fail_('INVALID_IMAGE');
  if (Utilities.base64Encode(bytes) !== match[1]) fail_('INVALID_IMAGE');
  var width = unsigned32_(bytes, 16);
  var height = unsigned32_(bytes, 20);
  if (width < 1 || width > 4096 || height < 1 || height > 4096) fail_('INVALID_IMAGE');
  return { blob: Utilities.newBlob(bytes, 'image/png', filename), size: bytes.length, sha256: sha256_(bytes), filename: filename };
}

function unsigned32_(bytes, start) {
  return (bytes[start] & 255) * 16777216 + (bytes[start + 1] & 255) * 65536 + (bytes[start + 2] & 255) * 256 + (bytes[start + 3] & 255);
}

function sha256_(value) {
  var digest = typeof value === 'string'
    ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return digest.map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function equalSecret_(actual, expected) {
  if (typeof actual !== 'string' || actual.length < 32 || actual.length > 256) return false;
  var difference = actual.length ^ expected.length;
  for (var i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
  return difference === 0;
}

function persistDesign_(parentId, design) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) fail_('BUSY');
  try {
    var parent = DriveApp.getFolderById(parentId);
    var matches = parent.getFoldersByName(design.requestId);
    var folder = matches.hasNext() ? matches.next() : parent.createFolder(design.requestId);
    var recordFile = firstFile_(folder, 'request.json');
    var record = recordFile ? JSON.parse(recordFile.getBlob().getDataAsString('UTF-8')) : null;
    if (record && record.fingerprint !== design.fingerprint) fail_('REQUEST_CONFLICT');
    if (record && record.stored === true) return { folderId: folder.getId(), duplicate: true };
    if (!record) {
      record = {
        version: 1, requestId: design.requestId, fingerprint: design.fingerprint,
        name: design.name, contact: design.contact, note: design.note, product: 'Classic',
        receivedAt: new Date().toISOString(), stored: false, emailStatus: 'pending', emailAttempts: 0,
        images: { front: { name: design.front.filename, sha256: design.front.sha256 }, back: { name: design.back.filename, sha256: design.back.sha256 } }
      };
      recordFile = folder.createFile('request.json', JSON.stringify(record), 'application/json');
    }
    ensureImageFile_(folder, design.front);
    ensureImageFile_(folder, design.back);
    record.stored = true;
    record.storedAt = new Date().toISOString();
    recordFile.setContent(JSON.stringify(record));
    return { folderId: folder.getId(), duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function ensureImageFile_(folder, image) {
  var existing = firstFile_(folder, image.filename);
  if (existing) {
    if (sha256_(existing.getBlob().getBytes()) !== image.sha256) fail_('REQUEST_CONFLICT');
    return;
  }
  folder.createFile(image.blob);
}

function firstFile_(folder, filename) {
  var files = folder.getFilesByName(filename);
  return files.hasNext() ? files.next() : null;
}

function sendStoredEmail_(folderId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return false;
  var folder;
  var record;
  var claim;
  try {
    folder = DriveApp.getFolderById(folderId);
    var recordFile = firstFile_(folder, 'request.json');
    if (!recordFile) return false;
    record = JSON.parse(recordFile.getBlob().getDataAsString('UTF-8'));
    if (!record.stored) return false;
    if (record.emailStatus === 'sent') return true;
    if (record.emailStatus === 'sending' && record.emailLeaseUntil > Date.now()) return false;
    if (MailApp.getRemainingDailyQuota() < 1) return false;
    claim = Utilities.getUuid();
    record.emailStatus = 'sending';
    record.emailClaim = claim;
    record.emailLeaseUntil = Date.now() + INTAKE_EMAIL_LEASE_MS;
    record.emailAttempts = Number(record.emailAttempts || 0) + 1;
    recordFile.setContent(JSON.stringify(record));
  } catch (_) {
    return false;
  } finally {
    lock.releaseLock();
  }

  var sent = false;
  try {
    var frontFile = firstFile_(folder, record.images.front.name);
    var backFile = firstFile_(folder, record.images.back.name);
    if (!frontFile || !backFile) throw new Error('INCOMPLETE_DESIGN');
    var frontBlob = frontFile.getBlob().setName(record.images.front.name);
    var backBlob = backFile.getBlob().setName(record.images.back.name);
    var privateUrl = folder.getUrl();
    var plainBody = 'Yêu cầu thiết kế Classic\nMã yêu cầu: ' + record.requestId + '\nHọ tên: ' + record.name
      + '\nLiên hệ: ' + record.contact + '\nLời nhắn: ' + (record.note || 'Không có lời nhắn')
      + '\n\nHai ảnh PNG được đính kèm. Bản lưu riêng tư trên Google Drive: ' + privateUrl;
    var htmlBody = '<h2>Yêu cầu thiết kế Classic</h2><p><b>Mã yêu cầu:</b> ' + escapeHtml_(record.requestId)
      + '</p><p><b>Họ tên:</b> ' + escapeHtml_(record.name) + '</p><p><b>Liên hệ:</b> ' + escapeHtml_(record.contact)
      + '</p><p><b>Lời nhắn:</b><br>' + escapeHtml_(record.note || 'Không có lời nhắn').replace(/\n/g, '<br>')
      + '</p><p><a href="' + escapeHtml_(privateUrl) + '">Mở bản lưu trong Google Drive</a> (dành cho chủ tài khoản)</p>';
    var message = { to: INTAKE_RECIPIENT, subject: 'Thiết kế Classic - ' + record.name + ' [' + record.requestId + ']', body: plainBody, attachments: [frontBlob, backBlob], name: 'Khắc riêng Classic' };
    // Large designs keep both attachments; omit duplicate inline copies to stay
    // below Gmail's total message-size limit after MIME/base64 encoding.
    if (frontFile.getSize() + backFile.getSize() <= 7 * 1024 * 1024) {
      message.inlineImages = { frontDesign: frontBlob, backDesign: backBlob };
      htmlBody += '<h3>Mặt trước</h3><img src="cid:frontDesign" alt="Mặt trước" width="300" style="max-width:100%;height:auto">'
        + '<h3>Mặt sau</h3><img src="cid:backDesign" alt="Mặt sau" width="300" style="max-width:100%;height:auto">';
    }
    message.htmlBody = htmlBody;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.contact)) message.replyTo = record.contact;
    MailApp.sendEmail(message);
    sent = true;
  } catch (_) {
    // A stored request remains available in Drive even when sending is delayed.
  }

  if (!lock.tryLock(5000)) return sent;
  try {
    var currentFile = firstFile_(folder, 'request.json');
    var current = JSON.parse(currentFile.getBlob().getDataAsString('UTF-8'));
    if (current.emailClaim === claim) {
      current.emailStatus = sent ? 'sent' : 'pending';
      current.emailLeaseUntil = 0;
      if (sent) current.emailSentAt = new Date().toISOString();
      else current.lastEmailError = 'MAIL_SEND_FAILED';
      currentFile.setContent(JSON.stringify(current));
    }
  } catch (_) {
    // Keep the sending lease when the result cannot be persisted safely.
  } finally {
    lock.releaseLock();
  }
  return sent;
}

/** Installed by setup(); each run scans a bounded batch without holding a lock. */
function retryPendingEmails() {
  var properties = PropertiesService.getScriptProperties();
  var folderId = properties.getProperty('GOOGLE_DRIVE_FOLDER_ID');
  if (!folderId || MailApp.getRemainingDailyQuota() < 1) return;
  var token = properties.getProperty('EMAIL_RETRY_CURSOR');
  var folders;
  try { folders = token ? DriveApp.continueFolderIterator(token) : DriveApp.getFolderById(folderId).getFolders(); }
  catch (_) { folders = DriveApp.getFolderById(folderId).getFolders(); }
  var scanned = 0;
  var attempted = 0;
  while (folders.hasNext() && scanned < 40 && attempted < 10) {
    var folder = folders.next();
    scanned++;
    try {
      var recordFile = firstFile_(folder, 'request.json');
      if (!recordFile) continue;
      var record = JSON.parse(recordFile.getBlob().getDataAsString('UTF-8'));
      if (!record.stored || record.emailStatus === 'sent') continue;
      if (record.emailStatus === 'sending' && record.emailLeaseUntil > Date.now()) continue;
      attempted++;
      sendStoredEmail_(folder.getId());
    } catch (_) {
      // Continue with other saved requests. No customer information is logged.
    }
  }
  if (folders.hasNext()) properties.setProperty('EMAIL_RETRY_CURSOR', folders.getContinuationToken());
  else properties.deleteProperty('EMAIL_RETRY_CURSOR');
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; });
}

function fail_(code) {
  var error = new Error(code);
  error.intakeCode = code;
  throw error;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
