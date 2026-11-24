// Runs the real Apps Script handlers against local memory only. No email/network.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const properties = new Map();
const folders = new Map();
const messages = [];
const triggers = [];
let sequence = 0;
let mailFails = false;
let failingFilename = '';
let quota = 100;

function iterator(items) {
  let at = 0;
  return { hasNext: () => at < items.length, next: () => items[at++], getContinuationToken: () => 'cursor' };
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

function folder(name) {
  const files = [];
  const children = [];
  const id = 'folder-' + ++sequence;
  const value = {
    name,
    getId: () => id,
    getUrl: () => 'https://drive.google.com/drive/folders/' + id,
    getFolders: () => iterator(children),
    getFoldersByName: n => iterator(children.filter(f => f.name === n)),
    getFilesByName: n => iterator(files.filter(f => f.name === n)),
    createFolder(n) { const child = folder(n); children.push(child); return child; },
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
  requestId: 'design_request_000001', name: 'Khoa', contact: 'customer@example.com', note: 'Two faces', product: 'Classic',
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
assert.equal(Object.keys(messages[0].inlineImages).length, 2);
post(base);
assert.equal(messages.length, 1, 'retry after sending must not send duplicate mail');
assert.equal(post({ ...base, name: 'Changed' }).code, 'REQUEST_CONFLICT');

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

console.log('Apps Script checks passed: authorization, two-image persistence, setup/retry idempotence, conflict rejection, partial-storage recovery, pending mail retry, quota fallback. No cloud requests or real mail.');
