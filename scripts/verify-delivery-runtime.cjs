'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const activeStatuses = new Set(['queued', 'running', 'waiting']);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function validateRuntimeAssignments(ledger, databasePath) {
  const errors = [];
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const assignment = database.prepare('SELECT status, assignee_bot_id FROM assignments WHERE id = ?');
    for (const story of ledger.stories || []) {
      for (const [claimed, field, ownerField, label] of [
        [story.stage === 'implementation', 'activeOwnerAssignmentId', 'ownerAssignment', 'implementation'],
        [story.reviewSlotReserved === true, 'activeReviewAssignmentId', 'reviewerAssignment', 'review'],
      ]) {
        if (!claimed) continue;
        const id = story[field];
        if (typeof id !== 'string' || !uuid.test(id)) {
          errors.push(`${story.id}: ${label} has no exact active assignment ID`);
          continue;
        }
        const row = assignment.get(id);
        if (!row) errors.push(`${story.id}: ${label} assignment ${id} is absent from runtime`);
        else {
          if (!activeStatuses.has(row.status)) errors.push(`${story.id}: ${label} assignment ${id} is ${row.status}`);
          const owner = assignment.get(story[ownerField]);
          if (!owner || row.assignee_bot_id !== owner.assignee_bot_id) {
            errors.push(`${story.id}: ${label} assignment ${id} has a different assignee`);
          }
        }
      }
    }
  } catch (error) {
    errors.push(`Runtime assignment check unavailable: ${error.message}`);
  } finally {
    database?.close();
  }
  return errors;
}

module.exports = { validateRuntimeAssignments };

if (require.main === module) {
  try {
    const ledger = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const errors = validateRuntimeAssignments(ledger, process.argv[3]);
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, errors: [error.message] }));
    process.exitCode = 1;
  }
}
