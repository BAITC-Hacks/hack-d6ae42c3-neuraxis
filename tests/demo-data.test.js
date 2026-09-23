import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedDemoData, DEMO_PROFILE_IDS, DEMO_PROPOSAL_IDS } from '../server/demo-data.js';
import { RESERVED_AKIM_EMAIL } from '../src/shared/community.js';

// A tiny test fixture; deployed archival assets are supplied by the photo manifest.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==', 'base64');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qala-demo-'));
  t.after(() => { db.close(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE profiles (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, team TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'city', role TEXT NOT NULL DEFAULT 'citizen');
    CREATE TABLE accounts (profile_id TEXT PRIMARY KEY REFERENCES profiles(id), login TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, email TEXT UNIQUE);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES accounts(profile_id), expires_at INTEGER NOT NULL);
    CREATE TABLE reserved_accounts (email TEXT PRIMARY KEY, reason TEXT NOT NULL);
    CREATE TABLE proposals (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES profiles(id), title TEXT NOT NULL,
      description TEXT NOT NULL, location TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE proposal_ratings (proposal_id TEXT NOT NULL REFERENCES proposals(id), profile_id TEXT NOT NULL REFERENCES profiles(id),
      value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5), PRIMARY KEY(proposal_id, profile_id));
    CREATE TABLE proposal_comments (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id),
      author_id TEXT NOT NULL REFERENCES profiles(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE proposal_images (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id), position INTEGER NOT NULL,
      mime TEXT NOT NULL, image BLOB NOT NULL);
  `);
  db.prepare('INSERT INTO reserved_accounts VALUES (?, ?)').run(RESERVED_AKIM_EMAIL, 'Reserved real address');
  const photos = Object.fromEntries(['trash', 'road', 'dump'].map((key, index) => {
    const file = `${key}.jpg`;
    fs.writeFileSync(path.join(rootDir, file), jpeg);
    return [key, { file, sourceName: `Архив ${key}`, sourceUrl: `https://example.invalid/archive/${key}`, year: 2020 + index }];
  }));
  return { db, rootDir, photos };
}

test('demo seed creates four fictional citizens with photos, non-self ratings and comments, and is idempotent', t => {
  const { db, ...options } = fixture(t);
  assert.deepEqual(seedDemoData(db, options), { profiles: 4, proposals: 4, images: 4, ratings: 8, comments: 8 });
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY profile_id').all();
  assert.equal(accounts.length, 4);
  assert.equal(new Set(accounts.map(account => account.password_hash)).size, 4);
  assert.equal(new Set(accounts.map(account => account.salt)).size, 4);
  for (const account of accounts) {
    assert.match(account.email, /^demo\.[a-z]+@example\.invalid$/);
    assert.equal(account.login, account.email);
    assert.match(account.salt, /^[a-f0-9]{32}$/);
    assert.match(account.password_hash, /^[a-f0-9]{128}$/);
    assert.notEqual(account.email, RESERVED_AKIM_EMAIL);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reserved_accounts').get().n, 1);
  for (const profile of db.prepare('SELECT * FROM profiles').all()) {
    assert.equal(profile.is_demo, 1);
    assert.equal(profile.role, 'citizen');
    assert.match(profile.team, /Вымышленный/);
  }
  for (const proposal of db.prepare('SELECT * FROM proposals').all()) {
    assert.equal(proposal.is_demo, 1);
    assert.match(proposal.description, /Демонстрационное предложение вымышленного гражданина/);
    assert.match(proposal.description, /архивная фотография Астаны/);
    assert.match(proposal.location, /условная локация/);
    const ratings = db.prepare('SELECT profile_id, value FROM proposal_ratings WHERE proposal_id = ?').all(proposal.id);
    assert.equal(ratings.length, 2);
    assert.equal(ratings.reduce((sum, rating) => sum + rating.value, 0) / ratings.length, 4.5);
    assert.ok(ratings.every(rating => rating.profile_id !== proposal.author_id));
    const comments = db.prepare('SELECT * FROM proposal_comments WHERE proposal_id = ?').all(proposal.id);
    assert.equal(comments.length, 2);
    assert.ok(comments.every(comment => comment.body.startsWith('Демонстрационный отзыв: ')));
    const photo = db.prepare('SELECT * FROM proposal_images WHERE proposal_id = ?').get(proposal.id);
    assert.equal(photo.mime, 'image/jpeg');
    assert.deepEqual(Buffer.from(photo.image), jpeg);
    assert.match(photo.source_name, /\(архив, 202[0-2]\)$/);
    assert.match(photo.source_url, /^https:\/\/example\.invalid\/archive\//);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(seedDemoData(db, options), { profiles: 0, proposals: 0, images: 0, ratings: 0, comments: 0 });
  assert.deepEqual(db.prepare('SELECT * FROM accounts ORDER BY profile_id').all(), accounts);
});

test('seed preserves existing citizens, content, and edits to previously seeded rows', t => {
  const { db, ...options } = fixture(t);
  db.prepare('INSERT INTO profiles (id, nickname, team, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('existing', 'Existing citizen', 'Existing team', 'before', 'before');
  db.prepare('INSERT INTO proposals (id, author_id, title, description, location, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('existing-proposal', 'existing', 'Original title', 'Original description', 'Original location', 'cleanup', 'before');
  seedDemoData(db, options);
  db.prepare('UPDATE profiles SET nickname = ? WHERE id = ?').run('Edited demo name', DEMO_PROFILE_IDS[0]);
  db.prepare('UPDATE proposals SET description = ? WHERE id = ?').run('Edited demo description', DEMO_PROPOSAL_IDS[0]);
  db.prepare('UPDATE proposal_ratings SET value = 2 WHERE proposal_id = ? AND profile_id = ?').run(DEMO_PROPOSAL_IDS[0], DEMO_PROFILE_IDS[1]);
  const before = db.prepare('SELECT * FROM profiles WHERE id = ?').get('existing');
  const proposalBefore = db.prepare('SELECT * FROM proposals WHERE id = ?').get('existing-proposal');
  seedDemoData(db, options);
  assert.deepEqual(db.prepare('SELECT * FROM profiles WHERE id = ?').get('existing'), before);
  assert.deepEqual(db.prepare('SELECT * FROM proposals WHERE id = ?').get('existing-proposal'), proposalBefore);
  assert.equal(before.is_demo, 0);
  assert.equal(proposalBefore.is_demo, 0);
  assert.equal(db.prepare('SELECT nickname FROM profiles WHERE id = ?').get(DEMO_PROFILE_IDS[0]).nickname, 'Edited demo name');
  assert.equal(db.prepare('SELECT description FROM proposals WHERE id = ?').get(DEMO_PROPOSAL_IDS[0]).description, 'Edited demo description');
  assert.equal(db.prepare('SELECT value FROM proposal_ratings WHERE proposal_id = ? AND profile_id = ?').get(DEMO_PROPOSAL_IDS[0], DEMO_PROFILE_IDS[1]).value, 2);
});

test('missing or invalid photo fails before writing any seed data or migration', t => {
  const { db, rootDir, photos } = fixture(t);
  photos.dump.file = 'missing.jpg';
  assert.throws(() => seedDemoData(db, { rootDir, photos }), /Demo photo unavailable: missing\.jpg/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n, 0);
  assert.equal(db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'is_demo'), false);
  photos.dump.file = 'trash.jpg';
  fs.writeFileSync(path.join(rootDir, 'trash.jpg'), 'not a jpeg');
  assert.throws(() => seedDemoData(db, { rootDir, photos }), /must be a JPEG under 1 MB/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n, 0);
});

test('constraint failure rolls back all seed records and migrations without altering existing accounts', t => {
  const { db, ...options } = fixture(t);
  db.prepare('INSERT INTO profiles (id, nickname, team, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('existing', 'Existing citizen', '', 'before', 'before');
  db.prepare('INSERT INTO accounts (profile_id, login, salt, password_hash, email) VALUES (?, ?, ?, ?, ?)')
    .run('existing', 'demo.maria@example.invalid', 'untouched-salt', 'untouched-hash', 'demo.maria@example.invalid');
  assert.throws(() => seedDemoData(db, options), /UNIQUE constraint/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM proposals').get().n, 0);
  assert.equal(db.prepare('SELECT password_hash FROM accounts WHERE profile_id = ?').get('existing').password_hash, 'untouched-hash');
  assert.equal(db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'is_demo'), false);
});

test('an existing non-demo citizen with a reserved seed ID is preserved and rejects the seed', t => {
  const { db, ...options } = fixture(t);
  db.prepare('INSERT INTO profiles (id, nickname, team, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(DEMO_PROFILE_IDS[0], 'Existing citizen', '', 'before', 'before');
  assert.throws(() => seedDemoData(db, options), /conflicts with an existing non-demo profile/);
  assert.equal(db.prepare('SELECT nickname FROM profiles WHERE id = ?').get(DEMO_PROFILE_IDS[0]).nickname, 'Existing citizen');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
});
