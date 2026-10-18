'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { validateRuntimeAssignments } = require('./verify-delivery-runtime.cjs');

test('an active delivery claim requires a live assignment to the recorded owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omb-delivery-runtime-'));
  const databasePath = path.join(dir, 'runtime.db');
  try {
    const database = new DatabaseSync(databasePath);
    database.exec('CREATE TABLE assignments (id TEXT PRIMARY KEY, status TEXT, assignee_bot_id TEXT)');
    const insert = database.prepare('INSERT INTO assignments VALUES (?, ?, ?)');
    insert.run('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed', 'owner');
    insert.run('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cancelled', 'owner');
    insert.run('cccccccc-cccc-cccc-cccc-cccccccccccc', 'running', 'owner');
    insert.run('dddddddd-dddd-dddd-dddd-dddddddddddd', 'running', 'other');
    database.close();

    const story = {
      id: 'FLUX-184',
      stage: 'implementation',
      ownerAssignment: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      activeOwnerAssignmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    };
    const errors = () => validateRuntimeAssignments({ stories: [story] }, databasePath);
    assert.match(errors().join('\n'), /is cancelled/);
    story.activeOwnerAssignmentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    assert.deepEqual(errors(), []);
    story.activeOwnerAssignmentId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    assert.match(errors().join('\n'), /different assignee/);
    delete story.activeOwnerAssignmentId;
    assert.match(errors().join('\n'), /no exact active assignment ID/);
    story.stage = 'blocked';
    story.reviewSlotReserved = true;
    story.reviewerAssignment = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    story.activeReviewAssignmentId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    assert.match(errors().join('\n'), /review assignment .* is cancelled/);
    story.reviewSlotReserved = false;
    assert.deepEqual(errors(), []);
    assert.match(validateRuntimeAssignments({ stories: [story] }, path.join(dir, 'missing.db')).join('\n'), /unavailable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
