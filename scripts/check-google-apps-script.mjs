// Runs the real Apps Script handlers against local memory only. No email/network.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const properties = new Map();
const folders = new Map();
const messages = [];
const triggers = [];
const iteratorTokens = new Map();
let sequence = 0;
let mailFails = false;
let failingFilename = '';
let quota = 100;

function iterator(items, start = 0) {
  let at = start;
  return {
    hasNext: () => at < items.length,
    next: () => items[at++],
    getContinuationToken() {
      const token = 'cursor-' + ++sequence;
      iteratorTokens.set(token, { items, at });
      return token;
    }
  };
}

function blob(bytes, type, name) {
  const buffer = Buffer.from(bytes);
  return {
    getBytes: () => Array.from(buffer, n => n > 127 ? n - 256 : n),
    getDataAsString: () => buffer.toString('utf8'),
    setName(value) { this.name = value; return this; },
    name, type, buffer
  };
}

function folder(name, parent = null) {
  const files = [];
  const children = [];
  const id = 'folder-' + ++sequence;
  const value = {
    name,
    getId: () => id,
    getUrl: () => 'https://drive.google.com/drive/folders/' + id,
    getParents: () => iterator(parent ? [parent] : []),
    getFolders: () => iterator(children),
    getFoldersByName: n => iterator(children.filter(f => f.name === n)),
    getFilesByName: n => iterator(files.filter(f => f.name === n)),
    createFolder(n) { const child = folder(n, value); children.push(child); return child; },
    createFile(value, contents, type) {
      const data = typeof value === 'string' ? blob(Buffer.from(contents), type, value) : value;
      if (data.name === failingFilename) throw Error('Simulated Drive failure');
      const file = {
        name: data.name,
        getBlob: () => data,
        getSize: () => data.buffer.length,
        setContent(text) {
          const updated = blob(Buffer.from(text), 'application/json', file.name);
          file.getBlob = () => updated;
          return file;
        }
      };
      files.push(file);
      return file;
    }
  };
  folders.set(id, value);
  return value;
}

const rootFolder = folder('root');
const context = {
  console: { log() {} },
  Date, JSON, Error, Object, Array, String, Number, Math, RegExp,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key)
    })
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
  DriveApp: {
    getFolderById: id => { const value = folders.get(id); if (!value) throw Error('Unknown folder'); return value; },
    getFoldersByName: name => iterator([...folders.values()].filter(value => value.name === name)),
    continueFolderIterator: token => {
      const saved = iteratorTokens.get(token);
      if (!saved) throw Error('Expired continuation token');
      return iterator(saved.items, saved.at);
    },
    createFolder: name => rootFolder.createFolder(name)
  },
  MailApp: {
    getRemainingDailyQuota: () => quota,
    sendEmail: message => { if (mailFails) throw Error('Simulated Mail failure'); messages.push(message); }
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    base64Decode: text => Array.from(Buffer.from(text, 'base64'), n => n > 127 ? n - 256 : n),
    base64Encode: bytes => Buffer.from(bytes).toString('base64'),
    newBlob: blob,
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (algorithm, value) => Array.from(
      crypto.createHash(algorithm).update(typeof value === 'string' ? value : Buffer.from(value)).digest(),
      n => n > 127 ? n - 256 : n
    )
  },
  ScriptApp: {
    getProjectTriggers: () => triggers,
    newTrigger: name => ({
      timeBased() { return this; },
      everyMinutes(interval) { assert.equal(interval, 5); return this; },
      create() { const trigger = { getHandlerFunction: () => name }; triggers.push(trigger); return trigger; }
    })
  },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: data => ({ data, setMimeType() { return this; } })
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../integrations/google-apps-script/Code.gs', import.meta.url), 'utf8'), context);
context.setup();
context.setup();
assert.equal(triggers.length, 1, 'setup must not create duplicate retry triggers');
assert.equal(messages.length, 0, 'setup must not send real or simulated email');
assert.equal(properties.get('DESIGN_INTAKE_SECRET').length, 64);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ7cAAAAASUVORK5CYII=';
const base = {
  secret: properties.get('DESIGN_INTAKE_SECRET'),
  requestId: 'design_request_000001', name: 'Khoa', email: 'Customer@Example.com', contact: 'Customer@Example.com', phone: '+84 912 345 678',
  customerNote: 'Two faces', note: 'Two faces\n\nSố điện thoại: +84 912 345 678', product: 'Classic',
  designs: { front: png, back: png }
};
const post = payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).data);
const requestFolder = id => [...folders.values()].find(value => value.name === id);
const record = id => JSON.parse(requestFolder(id).getFilesByName('request.json').next().getBlob().getDataAsString());

const initialFolderCount = folders.size;
assert.equal(post({ ...base, secret: 'x'.repeat(64) }).code, 'UNAUTHORIZED');
assert.equal(folders.size, initialFolderCount, 'wrong secret must not write to Drive');
assert.equal(messages.length, 0);

mailFails = true;
let result = post(base);
assert.equal(result.success, true);
assert.equal(result.stored, true);
assert.equal(result.emailSent, false);
assert.equal(record(base.requestId).stored, true, 'mail failure must preserve the accepted design');
assert.equal(record(base.requestId).version, 2);
assert.equal(record(base.requestId).email, 'customer@example.com');
assert.equal(record(base.requestId).phone, '+84 912 345 678');
assert.equal(record(base.requestId).note, 'Two faces', 'v2 must not duplicate the legacy phone suffix in the customer note');
assert.equal(requestFolder(base.requestId).getParents().next().name, 'customer@example.com');
const savedFolderCount = folders.size;

mailFails = false;
result = post(base);
assert.equal(result.duplicate, true);
assert.equal(result.emailSent, true);
assert.equal(folders.size, savedFolderCount, 'retry must reuse the request folder');
assert.equal(messages.length, 1);
assert.equal(messages[0].attachments.length, 2);
assert.equal(messages[0].to, 'khoa.v.nguyen.work@gmail.com');
assert.equal(messages[0].replyTo, 'customer@example.com');
assert.match(messages[0].body, /Số điện thoại: \+84 912 345 678/);
assert.match(messages[0].htmlBody, /Số điện thoại/);
assert.equal(messages[0].body.match(/Số điện thoại/g).length, 1);
assert.equal(Object.keys(messages[0].inlineImages).length, 2);
post(base);
assert.equal(messages.length, 1, 'retry after sending must not send duplicate mail');
assert.equal(post({ ...base, name: 'Changed' }).code, 'REQUEST_CONFLICT');
assert.equal(post({ ...base, phone: '0912345679' }).code, 'REQUEST_CONFLICT');
assert.equal(post({ ...base, email: 'someone@example.com', contact: 'someone@example.com' }).code, 'REQUEST_CONFLICT', 'changing email cannot bypass the ID conflict check');

const partial = { ...base, requestId: 'design_request_partial1' };
failingFilename = 'thiet-ke-mat-sau.png';
result = post(partial);
assert.equal(result.success, false);
assert.equal(result.code, 'STORAGE_FAILED');
assert.equal(record(partial.requestId).stored, false);
assert.equal(messages.length, 1, 'partially stored requests must not send mail');
const partialFolderCount = folders.size;
failingFilename = '';
result = post(partial);
assert.equal(result.stored, true);
assert.equal(result.emailSent, true);
assert.equal(folders.size, partialFolderCount);
assert.equal(messages.length, 2);

mailFails = true;
result = post({ ...base, requestId: 'design_request_retry001' });
assert.equal(result.stored, true);
assert.equal(result.emailSent, false);
mailFails = false;
context.retryPendingEmails();
assert.equal(messages.length, 3);
context.retryPendingEmails();
assert.equal(messages.length, 3, 'retry trigger must skip completed requests');

quota = 0;
result = post({ ...base, requestId: 'design_request_quota001' });
assert.equal(result.stored, true);
assert.equal(result.emailSent, false);
assert.equal(messages.length, 3);
assert.equal(post({ ...base, requestId: 'design_request_badimage', designs: { front: 'data:image/png;base64,YWJj', back: png } }).code, 'INVALID_IMAGE');
assert.equal(post({ ...base, requestId: 'design_request_badcontact', contact: 'x@example.com\r\nBcc: other@example.com' }).code, 'INVALID_FIELD');

for (const request of [base, partial, { requestId: 'design_request_retry001' }, { requestId: 'design_request_quota001' }]) {
  const saved = requestFolder(request.requestId);
  assert.equal(saved.getFilesByName('thiet-ke-mat-truoc.png').hasNext(), true);
  assert.equal(saved.getFilesByName('thiet-ke-mat-sau.png').hasNext(), true);
  assert.equal('secret' in record(request.requestId), false);
}

quota = 100;
const intakeRoot = folders.get(properties.get('GOOGLE_DRIVE_FOLDER_ID'));
const customerFolder = requestFolder(base.requestId).getParents().next();
const beforeSameCustomer = folders.size;
result = post({ ...base, requestId: 'design_request_sameemail', email: 'customer@EXAMPLE.COM', contact: 'customer@EXAMPLE.COM' });
assert.equal(result.success, true);
assert.equal(folders.size, beforeSameCustomer + 1, 'same email with different casing must reuse the customer folder');
assert.equal(requestFolder('design_request_sameemail').getParents().next().getId(), customerFolder.getId());

const beforeDifferentCustomer = folders.size;
result = post({ ...base, requestId: 'design_request_otheremail', email: 'customer+gift@example.com', contact: 'customer+gift@example.com' });
assert.equal(result.success, true);
assert.equal(folders.size, beforeDifferentCustomer + 2, 'a different full email needs its own folder and request');
assert.equal(requestFolder('design_request_otheremail').getParents().next().name, 'customer+gift@example.com');

const legacy = { ...base, requestId: 'design_request_legacy001', email: undefined, phone: undefined, customerNote: undefined, contact: 'legacy@example.com', note: 'Older note' };
function seedRequest(parent, payload, version = 2, emailStatus = 'pending') {
  const design = context.validateDesign_(payload);
  const saved = parent.createFolder(payload.requestId);
  saved.createFile('request.json', JSON.stringify({
    version, requestId: design.requestId, fingerprint: version === 1 ? design.legacyFingerprint : design.fingerprint,
    name: design.name, contact: design.contact, email: version === 2 ? design.email : undefined,
    phone: version === 2 ? design.phone : undefined, note: version === 1 ? payload.note : design.note, product: 'Classic', stored: true,
    emailStatus, emailAttempts: 0,
    images: { front: { name: design.front.filename, sha256: design.front.sha256 }, back: { name: design.back.filename, sha256: design.back.sha256 } }
  }), 'application/json');
  saved.createFile(design.front.blob);
  saved.createFile(design.back.blob);
  return saved;
}
const legacyFolder = seedRequest(intakeRoot, legacy, 1);
const beforeLegacyReplay = folders.size;
result = post(legacy);
assert.equal(result.success, true);
assert.equal(result.duplicate, true);
assert.equal(result.emailSent, true);
assert.equal(folders.size, beforeLegacyReplay, 'root request from v1 must be reused without creating an email folder');
assert.equal(requestFolder(legacy.requestId).getId(), legacyFolder.getId());
assert.equal(record(legacy.requestId).version, 1, 'a replay must not rewrite historical v1 metadata');

const bridge = { ...base, requestId: 'design_request_upgradebridge' };
seedRequest(intakeRoot, { ...bridge, email: undefined, phone: undefined, customerNote: undefined }, 1, 'sent');
const beforeBridgeReplay = folders.size;
result = post(bridge);
assert.equal(result.success, true, 'v2 payload must match v1 fingerprint when the proxy previously embedded phone in legacy note');
assert.equal(result.duplicate, true);
assert.equal(folders.size, beforeBridgeReplay);
assert.match(record(bridge.requestId).note, /Số điện thoại/);

const noEmail = { ...legacy, requestId: 'design_request_legacyphone', email: '', contact: '0912345678' };
result = post(noEmail);
assert.equal(result.success, true, 'legacy explicit empty email must accept the contact-only phone payload');
assert.equal(requestFolder(noEmail.requestId).getParents().next().name, 'Khach-chua-co-email');
assert.equal(record(noEmail.requestId).phone, '0912345678');

for (const [key, value] of [
  ['email', 'bad/name@example.com'], ['email', 'bad\\name@example.com'],
  ['phone', '0912+345678'], ['phone', '0912\t345678'], ['phone', '0912\r\n345678'], ['phone', '1234']
]) {
  assert.equal(post({ ...base, requestId: 'design_request_invalid', [key]: value }).code, 'INVALID_FIELD');
}

// Force two-level continuation by putting a pending nested request after more
// than the forty-folder scan budget, plus a pending legacy root request later.
for (let index = 0; index < 45; index++) {
  seedRequest(customerFolder, { ...base, requestId: 'design_request_seed_' + index.toString().padStart(3, '0') }, 2, 'sent');
}
const nestedQueued = { ...base, requestId: 'design_request_nestedqueue' };
seedRequest(customerFolder, nestedQueued);
const rootQueued = { ...legacy, requestId: 'design_request_rootqueue' };
seedRequest(intakeRoot, rootQueued, 1);
let iterations = 0;
while ((record(nestedQueued.requestId).emailStatus !== 'sent' || record(rootQueued.requestId).emailStatus !== 'sent') && iterations < 10) {
  context.retryPendingEmails();
  iterations++;
}
assert.equal(record(nestedQueued.requestId).emailStatus, 'sent', 'nested request beyond scan budget must eventually be retried');
assert.equal(record(rootQueued.requestId).emailStatus, 'sent', 'legacy root request must not starve behind a large customer folder');
assert.ok(iterations > 1, 'fixture must exercise saved continuation state');
assert.equal(messages.filter(message => message.subject.includes(nestedQueued.requestId)).length, 1);
assert.equal(messages.filter(message => message.subject.includes(rootQueued.requestId)).length, 1);

console.log('Apps Script checks passed: email-grouped folders, case normalization, separate phone metadata/mail, legacy root replay, nested/root retry continuation, partial-storage recovery, authorization and quota fallback. No cloud requests or real mail.');
