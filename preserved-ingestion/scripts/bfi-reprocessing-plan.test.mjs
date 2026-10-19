import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBfiReprocessingPlan } from './bfi-reprocessing-plan.mjs';

const url = id => `https://player.bfi.org.uk/free/film/watch-${id}-online`;
const row = (id, extra = {}) => ({ candidate_id: `candidate-${id}`, source_id: `source-${id}`, source_url: url(id), current_source_url: url(id), work_id: null, current_work_id: null, match_review: 'missing title/year/director', snapshot_sha256: `snapshot-${id}`, verification_id: id, record_sha256: `record-${id}`, error_code: 'BFI_DETAIL_OUTSIDE_FREE_CONTRACT', ...extra });
const item = id => ({ registry_source_id: 'bfi_player_free', source_url: url(id), external_id: String(id), external_identifiers: { bfi_nid: String(id) }, title: `Structured ${id}`, year: 1959, director_credit: null });
const catalogue = ids => ({ enumeration_complete: true, candidates: ids.map(item) });

test('read-only BFI plan targets only unresolved historical/current identities, preserves inputs and declares focused discovery', () => {
  const rows = [row(1), row(2, { work_id: 'prior-work', match_review: null }), row(3, { current_work_id: 'already-recovered' }), row(4), row(5, { match_review: 'metadata conflict' })];
  const fresh = catalogue([1, 2, 3, 5]); const before = structuredClone({ rows, fresh });
  const { report, enumeration } = prepareBfiReprocessingPlan(rows, fresh, { runId: 'historical-run' });
  assert.equal(report.proposed_reprocessing_candidates, 1); assert.equal(report.historical_identity_reviews, 3);
  assert.equal(report.excluded_already_resolved_current_sources, 1); assert.equal(report.unmatched_historical_urls, 1);
  assert.equal(report.unmatched[0].candidate_id, 'candidate-4'); assert.equal(report.database_access, 'READ_ONLY'); assert.equal(report.reprocessing_executed, false);
  assert.equal(report.previous_errors_in_proposed_cohort.BFI_DETAIL_OUTSIDE_FREE_CONTRACT, 1);
  assert.equal(enumeration.enumeration_complete, false); assert.equal(enumeration.status, 'FOCUSED_REPROCESSING_COHORT');
  assert.equal(enumeration.candidates[0].title, 'Structured 1'); assert.equal(enumeration.candidates[0].external_id, '1');
  assert.equal(enumeration.candidates[0].reprocessing_provenance.candidate_snapshot_sha256, 'snapshot-1');
  assert.equal(enumeration.cohort_provenance.target_sha256, report.target_sha256);
  assert.deepEqual({ rows, fresh }, before);
  enumeration.candidates[0].external_identifiers.bfi_nid = 'changed'; assert.equal(fresh.candidates[0].external_identifiers.bfi_nid, '1');
});
test('BFI plan refuses incomplete fresh discovery, ambiguous identity and playback URL conflicts', () => {
  assert.throws(() => prepareBfiReprocessingPlan([], { enumeration_complete: false }, { runId: 'run' }), /incomplete/);
  assert.throws(() => prepareBfiReprocessingPlan([row(1)], { enumeration_complete: true, candidates: [item(1), item(1)] }, { runId: 'run' }), /ambiguous/);
  assert.throws(() => prepareBfiReprocessingPlan([row(1, { current_source_url: url(2) })], catalogue([1]), { runId: 'run' }), /conflicting/);
  assert.throws(() => prepareBfiReprocessingPlan([row(1, { source_id: null })], catalogue([1]), { runId: 'run' }), /missing/);
});
