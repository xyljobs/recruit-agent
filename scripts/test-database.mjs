import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Pool } = pg;
const composeProject = 'zhipin-agent-test';
const composeFile = resolve(process.cwd(), 'docker-compose.test.yml');
const databasePort = process.env.TEST_DATABASE_PORT || '55432';
const connectionString = `postgresql://postgres:postgres@127.0.0.1:${databasePort}/zhipin_test`;

function dockerCompose(...args) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-name', composeProject, '-f', composeFile, ...args],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`docker compose ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout.trim();
}

async function assertBaseline(pool) {
  const requiredTables = [
    'organizations',
    'users',
    'job_requirements',
    'candidates',
    'match_records',
    'match_runs',
    'match_status_events',
    'authorization_records',
    'audit_logs',
    'integration_connections',
    'external_entity_links',
    'integration_sync_runs',
    'shortlist_runs',
    'shortlist_entries',
    'recommendation_decision_events',
    'recruiting_outcome_events',
    'candidate_rights_requests',
    'communication_briefs',
    'integration_outbox',
    'scoring_weight_versions',
    'calibration_proposals',
    'organization_invitations',
  ];
  const { rows } = await pool.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::TEXT[])`,
    [requiredTables],
  );
  const actual = new Set(rows.map(row => row.tablename));
  const missing = requiredTables.filter(table => !actual.has(table));
  if (missing.length > 0) {
    throw new Error(`migration did not create required tables: ${missing.join(', ')}`);
  }

  const { rows: functionRows } = await pool.query(
    `SELECT proname
     FROM pg_proc
     WHERE proname = ANY($1::TEXT[])`,
    [[
      'current_organization_id',
      'append_match_status_event',
      'get_dashboard_metrics',
      'create_shortlist_batch',
      'finalize_shortlist_run',
      'record_shortlist_decision',
      'qualify_shortlist_run',
      'record_recruiting_outcome',
      'record_recruiting_outcome_with_writeback',
      'record_authorized_ats_outcome',
      'import_integration_page',
      'approve_integration_writeback',
      'create_communication_brief',
      'claim_integration_outbox',
      'complete_integration_outbox',
      'record_candidate_rights_request',
      'set_job_lifecycle',
      'propose_scoring_calibration',
      'revoke_candidate_authorization',
      'count_expired_authorization_active_processing',
      'update_match_batch_task_from_worker',
      'set_organization_ai_policy',
      'accept_organization_invitation',
    ]],
  );
  const functions = new Set(functionRows.map(row => row.proname));
  for (const name of [
    'current_organization_id',
    'append_match_status_event',
    'get_dashboard_metrics',
    'create_shortlist_batch',
    'finalize_shortlist_run',
    'record_shortlist_decision',
    'qualify_shortlist_run',
    'record_recruiting_outcome',
    'record_recruiting_outcome_with_writeback',
    'record_authorized_ats_outcome',
    'import_integration_page',
    'approve_integration_writeback',
    'create_communication_brief',
    'claim_integration_outbox',
    'complete_integration_outbox',
    'record_candidate_rights_request',
    'set_job_lifecycle',
    'propose_scoring_calibration',
    'revoke_candidate_authorization',
    'count_expired_authorization_active_processing',
    'update_match_batch_task_from_worker',
    'set_organization_ai_policy',
    'accept_organization_invitation',
  ]) {
    if (!functions.has(name)) {
      throw new Error(`migration did not create required function: ${name}`);
    }
  }
}

async function withClaims(pool, claims, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function expectDatabaseError(callback, code) {
  let caught;
  try {
    await callback();
  } catch (error) {
    caught = error;
  }
  if (!caught || caught.code !== code) {
    throw new Error(`expected database error ${code}, received ${caught?.code || 'success'}`);
  }
}

async function seedDecisionFixture(pool) {
  const ids = {
    organizationA: '11111111-1111-4111-8111-111111111111',
    organizationB: '22222222-2222-4222-8222-222222222222',
    userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    jobA: '33333333-3333-4333-8333-333333333333',
    jobB: '33333333-3333-4333-8333-333333333334',
    candidateA: '44444444-4444-4444-8444-444444444444',
    candidateB: '44444444-4444-4444-8444-444444444445',
    matchA: '55555555-5555-4555-8555-555555555555',
    connectionA: '66666666-6666-4666-8666-666666666666',
  };
  await pool.query(
    `INSERT INTO organizations (id, name, slug, metrics_enabled_at)
     VALUES ($1, 'Tenant A', 'tenant-a', NOW()), ($2, 'Tenant B', 'tenant-b', NOW())`,
    [ids.organizationA, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, email, password_hash, name, role)
     VALUES ($1, $2, 'a@example.test', 'hash', 'A', 'admin'),
            ($3, $4, 'b@example.test', 'hash', 'B', 'admin')`,
    [ids.userA, ids.organizationA, ids.userB, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO job_requirements (
       id, organization_id, title, department, status, completeness,
       skills_required, activated_at, owner_user_id
     ) VALUES ($1, $2, 'Backend Engineer', 'R&D', 'active', 100, '["TypeScript"]', NOW(), $3)`,
    [ids.jobA, ids.organizationA, ids.userA],
  );
  await pool.query(
    `INSERT INTO job_requirements (
       id, organization_id, title, department, status, completeness,
       skills_required, activated_at, owner_user_id
     ) VALUES ($1, $2, 'Tenant B Job', 'Other', 'active', 100, '[]', NOW(), $3)`,
    [ids.jobB, ids.organizationB, ids.userB],
  );
  await pool.query(
    `INSERT INTO candidates (
       id, organization_id, name, skills, resume_text, is_authorized, data_source
     ) VALUES ($1, $2, 'encrypted-name', '["TypeScript"]', 'encrypted-resume', true, 'authorized_import')`,
    [ids.candidateA, ids.organizationA],
  );
  await pool.query(
    `INSERT INTO candidates (
       id, organization_id, name, skills, resume_text, is_authorized, data_source
     ) VALUES ($1, $2, 'tenant-b-name', '[]', 'tenant-b-resume', true, 'authorized_import')`,
    [ids.candidateB, ids.organizationB],
  );
  await pool.query(
    `INSERT INTO authorization_records (
       organization_id, candidate_id, authorized_at, purpose, processing_expires_at,
       source_type, source_reference, proof_type, proof_reference, notice_version,
       notice_snapshot, notice_text_sha256, external_processors,
       automated_decision_disclosed, automated_decision_preference,
       collected_by_user_id, collection_context_sha256, evidence_sha256,
       impact_assessment_reference, impact_assessment_completed_at,
       evidence_status, is_active
     ) VALUES (
       $1, $2, NOW() - INTERVAL '1 day', 'recruitment', NOW() + INTERVAL '30 days',
       'authorized_import', 'fixture', 'signed_notice', 'fixture-proof', 'v1',
       '{}'::JSONB, repeat('a', 64), '["private-deployment"]'::JSONB, true, 'assistive',
       $3, repeat('b', 64), repeat('c', 64), 'fixture-assessment', NOW(), 'verified', true
     )`,
    [ids.organizationA, ids.candidateA, ids.userA],
  );
  await pool.query(
    `INSERT INTO match_records (
       id, organization_id, job_id, candidate_id, overall_score, scoring_status, status
     ) VALUES ($1, $2, $3, $4, 88, 'succeeded', 'pending')`,
    [ids.matchA, ids.organizationA, ids.jobA, ids.candidateA],
  );
  await pool.query(
    `INSERT INTO integration_connections (
       id, organization_id, name, connector_type, status, capabilities, created_by
     ) VALUES ($1, $2, 'Fixture ATS', 'generic_ats', 'enabled',
       '["inbound_jobs","inbound_candidates","inbound_outcomes","outbound_outcomes"]'::JSONB, $3)`,
    [ids.connectionA, ids.organizationA, ids.userA],
  );
  await pool.query(
    `INSERT INTO external_entity_links (
       organization_id, integration_id, entity_type, external_id, local_entity_id
     ) VALUES
       ($1, $2, 'candidate', 'ats-candidate-a', $3),
       ($1, $2, 'job', 'ats-job-a', $4)`,
    [ids.organizationA, ids.connectionA, ids.candidateA, ids.jobA],
  );
  return ids;
}

async function assertDecisionCopilotBehavior(pool) {
  const ids = await seedDecisionFixture(pool);
  process.stdout.write('database checkpoint: fixture seeded\n');
  const claimsA = { organizationId: ids.organizationA, userId: ids.userA, appRole: 'admin' };
  const claimsB = { organizationId: ids.organizationB, userId: ids.userB, appRole: 'admin' };
  const shortlistClientId = '77777777-7777-4777-8777-777777777777';

  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `UPDATE match_records SET status = 'hired' WHERE id = $1`,
      [ids.matchA],
    )),
    '42501',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `UPDATE authorization_records SET is_active = true, revoked_at = NULL
       WHERE candidate_id = $1`,
      [ids.candidateA],
    )),
    '42501',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `DELETE FROM candidates WHERE id = $1`,
      [ids.candidateA],
    )),
    '42501',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `INSERT INTO match_records (
         organization_id, job_id, candidate_id, overall_score, scoring_status
       ) VALUES ($1, $2, $3, 50, 'succeeded')`,
      [ids.organizationA, ids.jobB, ids.candidateB],
    )),
    '23503',
  );

  const created = await withClaims(pool, claimsA, client => client.query(
    `SELECT create_shortlist_batch($1, $2::JSONB, 10, $3) AS result`,
    [ids.jobA, JSON.stringify([ids.candidateA]), shortlistClientId],
  ));
  const runId = created.rows[0].result.shortlist_run_id;
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT create_shortlist_batch($1, NULL, 10, $2)`,
      [ids.jobA, shortlistClientId],
    )),
    '23505',
  );

  const { rows: candidateRows } = await pool.query(
    `SELECT analytics_subject_id FROM candidates WHERE id = $1`,
    [ids.candidateA],
  );
  const analyticsSubjectId = candidateRows[0].analytics_subject_id;
  const entryPayload = [{
    candidate_id: ids.candidateA,
    match_record_id: ids.matchA,
    rank: 1,
    recommendation_band: 'strong',
    confidence_score: 90,
    confidence_breakdown: { formula: 'shortlist-confidence-v1' },
    evidence_snapshot: [{ candidate_excerpt: 'TypeScript', job_excerpt: 'TypeScript' }],
    missing_information: [],
  }];
  await pool.query('BEGIN');
  try {
    await pool.query('SET LOCAL ROLE service_role');
    await pool.query(`SELECT finalize_shortlist_run($1, $2, $3::JSONB, 1)`, [ids.organizationA, runId, JSON.stringify(entryPayload)]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  const { rows: entryRows } = await pool.query(`SELECT id FROM shortlist_entries WHERE shortlist_run_id = $1`, [runId]);
  const entryId = entryRows[0].id;
  await withClaims(pool, claimsA, client => client.query(
    `SELECT record_shortlist_decision($1, 'accepted', NULL, NULL, $2, NOW())`,
    [entryId, '88888888-8888-4888-8888-888888888888'],
  ));
  const qualificationClientId = '88888888-8888-4888-8888-888888888889';
  await withClaims(pool, claimsA, client => client.query(
    `SELECT qualify_shortlist_run($1, $2)`,
    [runId, qualificationClientId],
  ));
  const repeatedQualification = await withClaims(pool, claimsA, client => client.query(
    `SELECT qualify_shortlist_run($1, $2) AS result`,
    [runId, qualificationClientId],
  ));
  if (!repeatedQualification.rows[0].result.idempotent) {
    throw new Error('shortlist qualification is not idempotent');
  }
  await withClaims(pool, claimsA, client => client.query(
    `SELECT create_communication_brief(
       $1, 'brief-v1', 'rules_only', '["TypeScript"]', '[]', '["请说明项目"]',
       '["不得承诺录用"]', '您好，我们希望进一步了解您的项目经历。'
     )`,
    [entryId],
  ));

  const outcomeClientIds = {
    outreach: '90000000-0000-4000-8000-000000000001',
    offer: '90000000-0000-4000-8000-000000000002',
    lateInterview: '90000000-0000-4000-8000-000000000003',
    hired: '90000000-0000-4000-8000-000000000004',
    laterOffer: '90000000-0000-4000-8000-000000000007',
    olderCorrection: '90000000-0000-4000-8000-000000000008',
  };
  const recordOutcome = (type, clientId, occurredAt) => withClaims(pool, claimsA, client => client.query(
    `SELECT record_recruiting_outcome($1, $2, 'human', $3, $4, NULL, NULL, NULL, NULL) AS result`,
    [ids.matchA, type, clientId, occurredAt],
  ));
  await recordOutcome('outreach_sent', outcomeClientIds.outreach, '2026-07-01T00:00:00Z');
  const offer = await recordOutcome('offer', outcomeClientIds.offer, '2026-07-03T00:00:00Z');
  await recordOutcome('interview_scheduled', outcomeClientIds.lateInterview, '2026-07-02T00:00:00Z');
  const hired = await recordOutcome('hired', outcomeClientIds.hired, '2026-07-04T00:00:00Z');
  // P1-3：轻量事件（interview_feedback / offer_details）不推进阶段，metadata 持久化
  const feedbackClientId = '90000000-0000-4000-8000-000000000009';
  const feedback = await withClaims(pool, claimsA, client => client.query(
    `SELECT record_recruiting_outcome($1, 'interview_feedback', 'human', $2, '2026-07-05T00:00:00Z', NULL, NULL, NULL, NULL, '{"summary":"技术面试通过","verdict":"pass"}'::jsonb) AS result`,
    [ids.matchA, feedbackClientId],
  ));
  if (feedback.rows[0].result.current_status !== 'hired') {
    throw new Error('interview feedback advanced a terminal recruiting status');
  }
  const offerDetailsClientId = '90000000-0000-4000-8000-000000000010';
  const offerDetails = await withClaims(pool, claimsA, client => client.query(
    `SELECT record_recruiting_outcome($1, 'offer_details', 'human', $2, '2026-07-05T00:00:00Z', NULL, NULL, NULL, NULL, '{"compensation_note":"月薪面议","approval_note":"已过薪酬审批"}'::jsonb) AS result`,
    [ids.matchA, offerDetailsClientId],
  ));
  if (offerDetails.rows[0].result.current_status !== 'hired') {
    throw new Error('offer details advanced a terminal recruiting status');
  }
  const { rows: metadataRows } = await pool.query(
    `SELECT metadata->>'verdict' AS verdict, metadata->>'compensation_note' AS compensation_note
       FROM recruiting_outcome_events WHERE client_event_id = ANY($1)`,
    [[feedbackClientId, offerDetailsClientId]],
  );
  if (metadataRows.length !== 2 || !metadataRows.some(row => row.verdict === 'pass')
    || !metadataRows.some(row => row.compensation_note === '月薪面议')) {
    throw new Error('outcome metadata was not persisted');
  }
  const duplicateOffer = await recordOutcome('offer', outcomeClientIds.offer, '2026-07-03T00:00:00Z');
  if (!duplicateOffer.rows[0].result.idempotent || offer.rows[0].result.current_status !== 'offered') {
    throw new Error('outcome idempotency or forward state transition failed');
  }
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT record_recruiting_outcome($1, 'candidate_replied', 'human', $2, '2026-07-03T00:00:00Z', NULL, NULL, NULL, NULL)`,
      [ids.matchA, outcomeClientIds.offer],
    )),
    '23505',
  );
  const { rows: statusRows } = await pool.query(`SELECT status FROM match_records WHERE id = $1`, [ids.matchA]);
  if (statusRows[0].status !== 'hired') throw new Error('late event regressed a terminal recruiting status');

  const correctionClientId = '90000000-0000-4000-8000-000000000005';
  const correction = await withClaims(pool, claimsA, client => client.query(
    `SELECT record_recruiting_outcome(
       $1, 'stage_corrected', 'admin_correction', $2, '2026-07-05T00:00:00Z',
       'ats_reconciliation', '管理员依据原始记录更正', 'interviewing', $3
     ) AS result`,
    [ids.matchA, correctionClientId, hired.rows[0].result.event_id],
  ));
  if (correction.rows[0].result.current_status !== 'interviewing') {
    throw new Error('admin correction did not supersede the terminal stage');
  }

  const writebackClientId = '99999999-9999-4999-8999-999999999999';
  const writeback = await withClaims(pool, claimsA, client => client.query(
    `SELECT approve_integration_writeback($1, $2, $3) AS result`,
    [ids.connectionA, duplicateOffer.rows[0].result.event_id, writebackClientId],
  ));
  const retriedWriteback = await withClaims(pool, claimsA, client => client.query(
    `SELECT approve_integration_writeback($1, $2, $3) AS result`,
    [ids.connectionA, duplicateOffer.rows[0].result.event_id, writebackClientId],
  ));
  if (!retriedWriteback.rows[0].result.idempotent
    || retriedWriteback.rows[0].result.outbox_id !== writeback.rows[0].result.outbox_id) {
    throw new Error('writeback retry did not use the stable payload fingerprint');
  }
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT approve_integration_writeback($1, $2, $3)`,
      [ids.connectionA, hired.rows[0].result.event_id, writebackClientId],
    )),
    '23505',
  );
  const atomicOutcomeClientId = '90000000-0000-4000-8000-000000000006';
  const atomicWritebackClientId = '99999999-9999-4999-8999-999999999998';
  const atomic = await withClaims(pool, claimsA, client => client.query(
    `SELECT record_recruiting_outcome_with_writeback(
       $1, 'complaint', 'human', $2, '2026-07-06T00:00:00Z',
       'candidate_complaint', '候选人要求人工处理', NULL, NULL, $3, $4
     ) AS result`,
    [ids.matchA, atomicOutcomeClientId, ids.connectionA, atomicWritebackClientId],
  ));
  if (!atomic.rows[0].result.event_id || !atomic.rows[0].result.writeback?.outbox_id) {
    throw new Error('outcome and writeback intent were not committed by one RPC');
  }
  await recordOutcome('offer', outcomeClientIds.laterOffer, '2026-07-10T00:00:00Z');
  const olderCorrection = await withClaims(pool, claimsA, client => client.query(
    `SELECT record_recruiting_outcome(
       $1, 'stage_corrected', 'admin_correction', $2, '2026-07-07T00:00:00Z',
       'late_reconciliation', '更正较早事件', 'contacted', $3
     ) AS result`,
    [ids.matchA, outcomeClientIds.olderCorrection, duplicateOffer.rows[0].result.event_id],
  ));
  if (olderCorrection.rows[0].result.current_status !== 'offered') {
    throw new Error('an older correction overrode a newer effective stage event');
  }
  process.stdout.write('database checkpoint: event replay verified\n');
  const serviceClient = await pool.connect();
  try {
    await serviceClient.query('BEGIN');
    await serviceClient.query('SET LOCAL ROLE service_role');
    const claimed = await serviceClient.query(
      `SELECT claim_integration_outbox('fixture-worker', 300) AS result`,
    );
    if (!claimed.rows[0].result || claimed.rows[0].result.attempt_count !== 1) {
      throw new Error('outbox worker did not claim an approved intent');
    }
    if (claimed.rows[0].result.payload?.event_type !== 'offer'
      || claimed.rows[0].result.payload?.external_candidate_id !== 'ats-candidate-a'
      || claimed.rows[0].result.payload?.external_job_id !== 'ats-job-a') {
      throw new Error('outbox payload was not derived from the immutable outcome and mappings');
    }
    await serviceClient.query(
      `SELECT complete_integration_outbox($1, $2, 'fixture-worker', false, NULL, 'fixture failure')`,
      [ids.organizationA, claimed.rows[0].result.id],
    );
    await serviceClient.query('COMMIT');
  } catch (error) {
    await serviceClient.query('ROLLBACK');
    throw error;
  } finally {
    serviceClient.release();
  }

  await withClaims(pool, claimsA, client => client.query(
    `SELECT import_integration_page($1, 'candidate', $2::JSONB, NULL, 'cursor-1')`,
    [ids.connectionA, JSON.stringify([{ external_id: 'candidate-1', local_entity_id: ids.candidateA }])],
  ));
  await withClaims(pool, claimsA, client => client.query(
    `SELECT import_integration_page($1, 'job', $2::JSONB, 'cursor-1', 'cursor-2')`,
    [ids.connectionA, JSON.stringify([{
      external_id: 'job-imported-1',
      data: {
        title: 'Imported Platform Engineer',
        department: 'Platform',
        skills_required: ['PostgreSQL'],
      },
    }])],
  ));
  await withClaims(pool, claimsA, client => client.query(
    `SELECT import_integration_page($1, 'candidate', $2::JSONB, 'cursor-2', 'cursor-3')`,
    [ids.connectionA, JSON.stringify([{
      external_id: 'candidate-imported-1',
      data: {
        name: 'encrypted-imported-name',
        skills: ['PostgreSQL'],
        resume_text: 'encrypted-imported-resume',
        data_source: 'authorized_import',
      },
      authorization: {
        authorized_at: '2026-07-01T00:00:00Z',
        purpose: 'recruitment',
        processing_expires_at: '2027-07-01T00:00:00Z',
        source_type: 'authorized_import',
        source_reference: 'fixture-import',
        proof_type: 'signed_notice',
        proof_reference: 'fixture-import-proof',
        proof_sha256: null,
        notice_version: 'v1',
        notice_snapshot: {},
        notice_text_sha256: 'a'.repeat(64),
        external_processors: ['private-deployment'],
        automated_decision_disclosed: true,
        automated_decision_preference: 'assistive',
        impact_assessment_reference: 'fixture-assessment',
        impact_assessment_completed_at: '2026-06-01T00:00:00Z',
        collection_context_sha256: 'b'.repeat(64),
        evidence_sha256: 'c'.repeat(64),
        evidence_status: 'verified',
      },
    }])],
  ));
  await withClaims(pool, claimsA, client => client.query(
    `SELECT import_integration_page($1, 'job', $2::JSONB, 'cursor-3', 'cursor-4')`,
    [ids.connectionA, JSON.stringify([{
      external_id: 'job-imported-1',
      data: {
        title: 'Imported Platform Engineer II',
        department: 'Platform',
        skills_required: ['PostgreSQL', 'TypeScript'],
      },
    }])],
  ));
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT import_integration_page($1, 'candidate', $2::JSONB, NULL, 'cursor-2')`,
      [ids.connectionA, JSON.stringify([{ external_id: 'candidate-2', local_entity_id: ids.candidateA }])],
    )),
    '40001',
  );
  const { rows: syncRows } = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM integration_sync_runs WHERE integration_id = $1`, [ids.connectionA]);
  if (syncRows[0].count !== 4) throw new Error('failed integration page advanced sync history');
  const { rows: importedRows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM job_requirements WHERE organization_id = $1 AND title = 'Imported Platform Engineer II')::INTEGER AS jobs,
       (SELECT COUNT(*) FROM candidates WHERE organization_id = $1 AND data_source = 'authorized_import')::INTEGER AS candidates,
       (SELECT COUNT(*) FROM authorization_records WHERE organization_id = $1 AND source_reference = 'fixture-import')::INTEGER AS authorizations`,
    [ids.organizationA],
  ).catch(error => { throw new Error(`import verification query failed: ${error.message}`); });
  if (importedRows[0].jobs !== 1 || importedRows[0].candidates < 2 || importedRows[0].authorizations !== 1) {
    throw new Error('CSV/JSON baseline did not create entities and authorization atomically');
  }
  process.stdout.write('database checkpoint: integration import verified\n');

  const tenantBVisibility = await withClaims(pool, claimsB, client => client.query(`SELECT COUNT(*)::INTEGER AS count FROM shortlist_runs`));
  if (tenantBVisibility.rows[0].count !== 0) throw new Error('RLS exposed another tenant shortlist');
  const tenantAiPolicy = await withClaims(pool, claimsA, client => client.query(
    `SELECT set_organization_ai_policy('approved_cloud', '["processor-a"]'::JSONB) AS result`,
  ));
  if (tenantAiPolicy.rows[0].result.ai_execution_mode !== 'approved_cloud') {
    throw new Error('tenant AI policy approval was not persisted');
  }
  await withClaims(pool, claimsA, client => client.query(
    `SELECT set_organization_ai_policy('rules_only', '[]'::JSONB)`,
  ));

  await pool.query(
    `INSERT INTO candidates (
       organization_id, name, skills, resume_text, is_authorized, data_source
     )
     SELECT $1, 'encrypted-performance-' || series, '["TypeScript"]'::JSONB,
       'encrypted-performance-resume', true, 'authorized_import'
    FROM generate_series(1, 98) AS series`,
    [ids.organizationA],
  ).catch(error => { throw new Error(`performance candidate seed failed: ${error.message}`); });
  await pool.query(
    `INSERT INTO authorization_records (
       organization_id, candidate_id, authorized_at, purpose, processing_expires_at,
       source_type, source_reference, proof_type, proof_reference, notice_version,
       notice_snapshot, notice_text_sha256, external_processors,
       automated_decision_disclosed, automated_decision_preference,
       collected_by_user_id, collection_context_sha256, evidence_sha256,
       impact_assessment_reference, impact_assessment_completed_at,
       evidence_status, is_active
     )
     SELECT $1::VARCHAR, candidate.id, NOW() - INTERVAL '1 day', 'recruitment', NOW() + INTERVAL '30 days',
       'authorized_import', 'performance-' || candidate.id, 'signed_notice',
       'performance-proof', 'v1', '{}'::JSONB, repeat('a', 64),
       '["private-deployment"]'::JSONB, true, 'assistive', $2::VARCHAR,
       repeat('b', 64), repeat('c', 64), 'performance-assessment', NOW(),
       'verified', true
     FROM candidates AS candidate
     WHERE candidate.organization_id = $1::VARCHAR
       AND NOT EXISTS (
         SELECT 1 FROM authorization_records AS authorization_record
         WHERE authorization_record.candidate_id = candidate.id
       )`,
    [ids.organizationA, ids.userA],
  ).catch(error => { throw new Error(`performance authorization seed failed: ${error.message}`); });

  const workerStartBatch = await withClaims(pool, claimsA, client => client.query(
    `SELECT create_shortlist_batch($1, NULL, 10, $2) AS result`,
    [ids.jobA, '72000000-0000-4000-8000-000000000001'],
  )).catch(error => { throw new Error(`worker start batch setup failed: ${error.message}`); });
  const workerStartTaskId = workerStartBatch.rows[0].result.task_id;
  const workerStartRunId = workerStartBatch.rows[0].result.shortlist_run_id;
  await pool.query(
    `UPDATE match_batch_tasks
     SET status = 'running', worker_id = 'fixture-match-worker',
         lease_until = NOW() + INTERVAL '5 minutes'
     WHERE id = $1`,
    [workerStartTaskId],
  ).catch(error => { throw new Error(`worker lease setup failed: ${error.message}`); });
  const workerClient = await pool.connect();
  try {
    await workerClient.query('BEGIN');
    await workerClient.query('SET LOCAL ROLE service_role');
    await workerClient.query(
      `SELECT update_match_batch_task_from_worker(
         $1, $2, 'fixture-match-worker', 'start', NULL, NULL, NULL,
         'shortlist-confidence-v1', 'match-weights-v1'
       )`,
      [ids.organizationA, workerStartTaskId],
    );
    await workerClient.query('COMMIT');
  } catch (error) {
    await workerClient.query('ROLLBACK');
    throw new Error(`worker start RPC failed: ${error.message}`);
  } finally {
    workerClient.release();
  }
  const { rows: workerStartRows } = await pool.query(
    `SELECT status, confidence_formula_version, scoring_weights_version
     FROM shortlist_runs WHERE id = $1`,
    [workerStartRunId],
  );
  if (workerStartRows[0].status !== 'running'
    || workerStartRows[0].confidence_formula_version !== 'shortlist-confidence-v1'
    || workerStartRows[0].scoring_weights_version !== 'match-weights-v1') {
    throw new Error('worker start RPC did not persist string scoring version metadata');
  }

  const performanceRunId = '72000000-0000-4000-8000-000000000002';
  await pool.query(
    `INSERT INTO shortlist_runs (
       id, organization_id, job_id, requested_by, request_client_event_id,
       status, candidate_count, top_n, confidence_formula_version, completed_at
     ) VALUES (
       $1, $2, $3, $4, '72000000-0000-4000-8000-000000000003',
       'ready', 100, 50, 'shortlist-confidence-v1', NOW()
     )`,
    [performanceRunId, ids.organizationA, ids.jobA, ids.userA],
  ).catch(error => { throw new Error(`performance shortlist run seed failed: ${error.message}`); });
  await pool.query(
    `INSERT INTO shortlist_entries (
       organization_id, shortlist_run_id, candidate_id, analytics_subject_id,
       rank, recommendation_band, confidence_score, confidence_breakdown,
       evidence_snapshot, missing_information
     )
     SELECT $1::VARCHAR, $2::VARCHAR, candidate.id, candidate.analytics_subject_id,
       row_number() OVER (ORDER BY candidate.id), 'consider', 80,
       '{"jd_completeness":25,"candidate_completeness":30,"evidence_coverage":35,"freshness":10}'::JSONB,
       jsonb_build_array(jsonb_build_object(
         'criterion_id', 'skills', 'dimension', '技能',
         'finding', '候选人与职位均记录 TypeScript', 'support_level', 'supported',
         'candidate_source_path', 'candidates.skills', 'candidate_excerpt', 'TypeScript',
         'job_source_path', 'job_requirements.skills_required', 'job_excerpt', 'TypeScript'
       )),
       '[]'::JSONB
     FROM candidates AS candidate
     WHERE candidate.organization_id = $1::VARCHAR
     ORDER BY candidate.id
     LIMIT 50`,
    [ids.organizationA, performanceRunId],
  ).catch(error => { throw new Error(`performance shortlist entry seed failed: ${error.message}`); });
  process.stdout.write('database checkpoint: worker RPC and performance data verified\n');

  const shortlistSubmissionDurations = [];
  const outcomeWriteDurations = [];
  const readDurations = [];
  for (let index = 0; index < 20; index += 1) {
    let startedAt = performance.now();
    await withClaims(pool, claimsA, client => client.query(
      `SELECT create_shortlist_batch($1, NULL, 10, $2)`,
      [ids.jobA, `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`],
    ));
    shortlistSubmissionDurations.push(performance.now() - startedAt);

    startedAt = performance.now();
    await withClaims(pool, claimsA, client => client.query(
      `SELECT record_recruiting_outcome(
         $1, 'candidate_replied', 'human', $2, NOW(), NULL, NULL, NULL, NULL
       )`,
      [ids.matchA, `71000000-0000-4000-8000-${String(index).padStart(12, '0')}`],
    ));
    outcomeWriteDurations.push(performance.now() - startedAt);

    startedAt = performance.now();
    const materialized = await withClaims(pool, claimsA, client => client.query(
      `WITH shortlist_payload AS (
         SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entry_id', entry.id,
           'rank', entry.rank,
           'recommendation_band', entry.recommendation_band,
           'confidence_score', entry.confidence_score,
           'confidence_breakdown', entry.confidence_breakdown,
           'evidence_snapshot', entry.evidence_snapshot,
           'missing_information', entry.missing_information,
           'candidate', jsonb_build_object(
             'id', candidate.id,
             'name', candidate.name,
             'skills', candidate.skills,
             'current_position', candidate.current_position
           )
         ) ORDER BY entry.rank), '[]'::JSONB) AS payload
         FROM shortlist_entries AS entry
         JOIN candidates AS candidate
           ON candidate.id = entry.candidate_id
          AND candidate.organization_id = entry.organization_id
         WHERE entry.organization_id = current_organization_id()
           AND entry.shortlist_run_id = $1
       ), metric_payload AS (
         SELECT jsonb_build_object(
           'outcomes', (SELECT COALESCE(jsonb_agg(to_jsonb(outcome_event)), '[]'::JSONB)
             FROM recruiting_outcome_events AS outcome_event
             WHERE outcome_event.organization_id = current_organization_id()),
           'decisions', (SELECT COALESCE(jsonb_agg(to_jsonb(decision_event)), '[]'::JSONB)
             FROM recommendation_decision_events AS decision_event
             WHERE decision_event.organization_id = current_organization_id()),
           'shortlist_runs', (SELECT COALESCE(jsonb_agg(to_jsonb(shortlist_run)), '[]'::JSONB)
             FROM shortlist_runs AS shortlist_run
             WHERE shortlist_run.organization_id = current_organization_id()),
           'jobs', (SELECT COALESCE(jsonb_agg(to_jsonb(job)), '[]'::JSONB)
             FROM job_requirements AS job
             WHERE job.organization_id = current_organization_id()),
           'rights_requests', (SELECT COALESCE(jsonb_agg(to_jsonb(rights_request)), '[]'::JSONB)
             FROM candidate_rights_requests AS rights_request
             WHERE rights_request.organization_id = current_organization_id())
         ) AS payload
       )
       SELECT shortlist_payload.payload AS shortlist_payload,
              metric_payload.payload AS metric_payload
       FROM shortlist_payload CROSS JOIN metric_payload`,
      [performanceRunId],
    ));
    if (!Array.isArray(materialized.rows[0].shortlist_payload)
      || materialized.rows[0].shortlist_payload.length !== 50
      || !Array.isArray(materialized.rows[0].metric_payload.outcomes)) {
      throw new Error('performance read did not materialize the persisted shortlist and metric sources');
    }
    readDurations.push(performance.now() - startedAt);
  }
  const percentile95 = values => [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1];
  const performanceEnvelope = {
    shortlist_submission_p95_ms: percentile95(shortlistSubmissionDurations),
    outcome_write_p95_ms: percentile95(outcomeWriteDurations),
    shortlist_metric_materialization_read_p95_ms: percentile95(readDurations),
  };
  if (performanceEnvelope.shortlist_submission_p95_ms >= 500
    || performanceEnvelope.outcome_write_p95_ms >= 2_000
    || performanceEnvelope.shortlist_metric_materialization_read_p95_ms >= 2_000) {
    throw new Error(`decision copilot performance envelope failed: ${JSON.stringify(performanceEnvelope)}`);
  }
  process.stdout.write(`performance envelope passed: ${JSON.stringify(performanceEnvelope)}\n`);

  const calibration = await withClaims(pool, claimsA, client => client.query(
    `SELECT propose_scoring_calibration('{"skill":0.5,"experience":0.5}', 'fixture') AS result`,
  ));
  if (calibration.rows[0].result.eligible !== false) throw new Error('calibration ignored minimum sample gates');
  const proposalId = '12121212-1212-4212-8212-121212121212';
  await pool.query(
    `INSERT INTO calibration_proposals (
       id, organization_id, reviewed_entries, outreach_events, completed_interviews,
       metrics_snapshot, proposed_weights, rationale, created_by
     ) VALUES (
       $1, $2, 100, 30, 10, '{}'::JSONB,
       '{"SKILL":0.4,"EXPERIENCE":0.2,"SALARY":0.15,"LOCATION":0.1,"AVAILABILITY":0.1,"STABILITY":0.05}'::JSONB,
       'fixture eligible proposal', $3
     )`,
    [proposalId, ids.organizationA, ids.userA],
  );
  await withClaims(pool, claimsA, client => client.query(
    `SELECT review_scoring_calibration($1, 'approved')`,
    [proposalId],
  ));
  const { rows: weightsRows } = await pool.query(
    `SELECT version, status FROM scoring_weight_versions WHERE organization_id = $1`,
    [ids.organizationA],
  );
  const { rows: shortlistVersionRows } = await pool.query(
    `SELECT scoring_weights_version FROM shortlist_runs WHERE id = $1`,
    [runId],
  );
  if (weightsRows.length !== 1 || weightsRows[0].status !== 'active'
    || shortlistVersionRows[0].scoring_weights_version !== 'match-weights-v1') {
    throw new Error('calibration approval did not create future-only immutable weights');
  }

  await pool.query(
    `UPDATE integration_outbox
     SET status = 'succeeded', payload_encrypted = 'legacy-sensitive-payload',
         payload_fingerprint = repeat('d', 64)
     WHERE organization_id = $1`,
    [ids.organizationA],
  );
  await pool.query(
    `INSERT INTO external_entity_links (
       organization_id, integration_id, entity_type, external_id, local_entity_id
     ) VALUES ($1, $2, 'outcome', 'ats-outcome-a', $3)`,
    [ids.organizationA, ids.connectionA, duplicateOffer.rows[0].result.event_id],
  );
  await pool.query(
    `INSERT INTO candidate_rights_requests (
       organization_id, candidate_id, analytics_subject_id, request_type,
       source_reference, resolution_reference, due_at, created_by
     ) VALUES ($1, $2, $3, 'delete', 'identity-bearing-source',
       'identity-bearing-resolution', NOW() + INTERVAL '1 day', $4)`,
    [ids.organizationA, ids.candidateA, analyticsSubjectId, ids.userA],
  );

  await pool.query(
    `UPDATE authorization_records
     SET processing_expires_at = NOW() - INTERVAL '1 second'
     WHERE organization_id = $1 AND candidate_id = $2`,
    [ids.organizationA, ids.candidateA],
  );
  const expiredVisibility = await withClaims(pool, claimsA, client => client.query(
    `SELECT
       (SELECT COUNT(*) FROM candidates WHERE id = $1)::INTEGER AS candidates,
       (SELECT COUNT(*) FROM match_records WHERE id = $2)::INTEGER AS matches,
       (SELECT COUNT(*) FROM shortlist_entries WHERE id = $3)::INTEGER AS shortlist_entries,
       (SELECT COUNT(*) FROM communication_briefs WHERE shortlist_entry_id = $3)::INTEGER AS briefs`,
    [ids.candidateA, ids.matchA, entryId],
  ));
  if (Object.values(expiredVisibility.rows[0]).some(value => value !== 0)) {
    throw new Error(`expired authorization still exposed candidate processing data: ${JSON.stringify(expiredVisibility.rows[0])}`);
  }
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT create_communication_brief(
         $1, 'brief-expired', 'rules_only', '[]', '[]', '[]',
         '["不得承诺录用"]', '不应创建'
       )`,
      [entryId],
    )),
    '55000',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT record_shortlist_decision(
         $1, 'needs_information', NULL, '授权到期后不应写入', $2, NOW()
       )`,
      [entryId, '73000000-0000-4000-8000-000000000001'],
    )),
    '55000',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT record_recruiting_outcome(
         $1, 'candidate_replied', 'human', $2, NOW(), NULL, NULL, NULL, NULL
       )`,
      [ids.matchA, '73000000-0000-4000-8000-000000000002'],
    )),
    '55000',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT approve_integration_writeback($1, $2, $3)`,
      [ids.connectionA, duplicateOffer.rows[0].result.event_id, '73000000-0000-4000-8000-000000000003'],
    )),
    '55000',
  );
  await expectDatabaseError(
    () => withClaims(pool, claimsA, client => client.query(
      `SELECT record_recruiting_outcome_with_writeback(
         $1, 'candidate_replied', 'human', $2, NOW(), NULL, NULL, NULL, NULL, $3, $4
       )`,
      [
        ids.matchA,
        '73000000-0000-4000-8000-000000000004',
        ids.connectionA,
        '73000000-0000-4000-8000-000000000005',
      ],
    )),
    '55000',
  );
  const expiredOutboxClient = await pool.connect();
  try {
    await expiredOutboxClient.query('BEGIN');
    await expiredOutboxClient.query('SET LOCAL ROLE service_role');
    const expiredClaim = await expiredOutboxClient.query(
      `SELECT claim_integration_outbox('expired-authorization-worker', 300) AS result`,
    );
    if (expiredClaim.rows[0].result !== null) {
      throw new Error('outbox worker claimed data after the authorization processing window expired');
    }
    await expiredOutboxClient.query('COMMIT');
  } catch (error) {
    await expiredOutboxClient.query('ROLLBACK');
    throw error;
  } finally {
    expiredOutboxClient.release();
  }

  await withClaims(pool, claimsA, client => client.query(
    `SELECT revoke_candidate_authorization($1, '{}'::JSONB)`,
    [ids.candidateA],
  ));
  const { rows: cleanupRows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM candidates WHERE id = $1)::INTEGER AS candidates,
       (SELECT COUNT(*) FROM match_records WHERE id = $2)::INTEGER AS matches,
       (SELECT COUNT(*) FROM recruiting_outcome_events WHERE analytics_subject_id = $3 AND candidate_id IS NULL AND match_record_id IS NULL)::INTEGER AS detached_outcomes,
       (SELECT COUNT(*) FROM integration_outbox WHERE analytics_subject_id = $3)::INTEGER AS subject_outbox,
       (SELECT COUNT(*) FROM integration_outbox WHERE analytics_subject_id = $3 AND (payload_encrypted IS NOT NULL OR payload_fingerprint IS NOT NULL))::INTEGER AS uncleared_outbox,
       (SELECT COUNT(*) FROM external_entity_links WHERE organization_id = $4 AND (
         (entity_type = 'candidate' AND local_entity_id = $1)
         OR (entity_type = 'outcome' AND local_entity_id = $5)
       ))::INTEGER AS identifying_links,
       (SELECT COUNT(*) FROM candidate_rights_requests WHERE organization_id = $4 AND analytics_subject_id = $3 AND (source_reference IS NOT NULL OR resolution_reference IS NOT NULL))::INTEGER AS identifying_rights_refs`,
    [ids.candidateA, ids.matchA, analyticsSubjectId, ids.organizationA, duplicateOffer.rows[0].result.event_id],
  );
  if (cleanupRows[0].candidates !== 0 || cleanupRows[0].matches !== 0
    || cleanupRows[0].detached_outcomes < 1 || cleanupRows[0].subject_outbox < 1
    || cleanupRows[0].uncleared_outbox !== 0
    || cleanupRows[0].identifying_links !== 0 || cleanupRows[0].identifying_rights_refs !== 0) {
    throw new Error(`strongest candidate cleanup did not detach facts and clear active processing: ${JSON.stringify(cleanupRows[0])}`);
  }
}

async function assertInvitationFlow(pool) {
  const ids = {
    organization: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    inactiveOrganization: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    hr: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  };
  const inviteeEmail = 'invitee@example.test';
  const passwordHash = 'bcrypt-placeholder';
  const hashValid = 'e'.repeat(64);
  const hashWrongEmail = 'f'.repeat(64);
  const hashExpired = '1'.repeat(64);
  const hashInactiveOrg = '2'.repeat(64);

  await pool.query(
    `INSERT INTO organizations (id, name, slug, is_active, metrics_enabled_at)
     VALUES ($1, 'Invite Org', 'invite-org', true, NOW()),
            ($2, 'Inactive Org', 'inactive-org', false, NOW())`,
    [ids.organization, ids.inactiveOrganization],
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, email, password_hash, name, role)
     VALUES ($1, $2, 'invite-admin@example.test', 'hash', 'Invite Admin', 'admin'),
            ($3, $2, 'invite-hr@example.test', 'hash', 'Invite HR', 'hr')`,
    [ids.admin, ids.organization, ids.hr],
  );
  await pool.query(
    `INSERT INTO organization_invitations (
       organization_id, email, role, token_hash, invited_by, expires_at
     ) VALUES
       ($1, $2, 'hr', $3, $4, NOW() + INTERVAL '7 days'),
       ($1, 'other@example.test', 'hr', $5, $4, NOW() + INTERVAL '7 days'),
       ($1, $2, 'hr', $6, $4, NOW() - INTERVAL '1 day'),
       ($7, $2, 'hr', $8, $4, NOW() + INTERVAL '7 days')`,
    [
      ids.organization,
      inviteeEmail,
      hashValid,
      ids.admin,
      hashWrongEmail,
      hashExpired,
      ids.inactiveOrganization,
      hashInactiveOrg,
    ],
  );

  const asService = async (query, params) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE service_role');
      const result = await client.query(query, params);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const acceptInvitation = (hash, email) => asService(
    `SELECT accept_organization_invitation($1, $2, $3, $4) AS result`,
    [hash, email, passwordHash, 'Invitee'],
  );

  const accepted = await acceptInvitation(hashValid, inviteeEmail);
  const acceptedResult = accepted.rows[0].result;
  if (acceptedResult.email !== inviteeEmail
    || acceptedResult.role !== 'hr'
    || acceptedResult.organization_id !== ids.organization
    || !acceptedResult.id) {
    throw new Error(`invitation accept returned unexpected result: ${JSON.stringify(acceptedResult)}`);
  }
  const { rows: userRows } = await pool.query(
    `SELECT role, company FROM users WHERE id = $1`,
    [acceptedResult.id],
  );
  if (userRows[0].role !== 'hr' || userRows[0].company !== 'Invite Org') {
    throw new Error('accepted invitation did not create the user with invited role and organization name');
  }
  const { rows: memberRows } = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count FROM organization_members
     WHERE organization_id = $1 AND user_id = $2`,
    [ids.organization, acceptedResult.id],
  );
  if (memberRows[0].count !== 1) {
    throw new Error('accepted invitation did not create the organization membership');
  }
  const { rows: acceptedInviteRows } = await pool.query(
    `SELECT accepted_at IS NOT NULL AS accepted FROM organization_invitations WHERE token_hash = $1`,
    [hashValid],
  );
  if (!acceptedInviteRows[0].accepted) {
    throw new Error('accepted invitation was not marked as used');
  }
  process.stdout.write('database checkpoint: invitation accept verified\n');

  const expectInvitationRejection = async (attempt, label) => {
    let caught;
    try {
      await attempt();
    } catch (error) {
      caught = error;
    }
    if (!caught || caught.code !== 'P0001') {
      throw new Error(`${label} was not rejected with a raise exception`);
    }
    if (!/invitation|expired|used/i.test(caught.message)) {
      throw new Error(`${label} message is not recognized by the register error mapping: ${caught.message}`);
    }
  };
  await expectInvitationRejection(
    () => acceptInvitation(hashValid, inviteeEmail),
    'replayed invitation',
  );
  await expectInvitationRejection(
    () => acceptInvitation(hashWrongEmail, inviteeEmail),
    'wrong email invitation',
  );
  await expectInvitationRejection(
    () => acceptInvitation(hashExpired, inviteeEmail),
    'expired invitation',
  );
  await expectInvitationRejection(
    () => acceptInvitation(hashInactiveOrg, inviteeEmail),
    'inactive organization invitation',
  );
  const { rows: duplicateRows } = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count FROM users WHERE email = $1`,
    [inviteeEmail],
  );
  if (duplicateRows[0].count !== 1) {
    throw new Error('rejected invitation replays created duplicate users');
  }
  process.stdout.write('database checkpoint: invitation rejection gates verified\n');

  const claimsAdmin = { organizationId: ids.organization, userId: ids.admin, appRole: 'admin' };
  const claimsHr = { organizationId: ids.organization, userId: ids.hr, appRole: 'hr' };
  const visible = await withClaims(pool, claimsAdmin, client => client.query(
    `SELECT COUNT(*)::INTEGER AS count FROM organization_invitations WHERE organization_id = $1`,
    [ids.organization],
  ));
  if (visible.rows[0].count !== 3) {
    throw new Error('admin could not list own organization invitations');
  }
  const invisible = await withClaims(pool, claimsHr, client => client.query(
    `SELECT COUNT(*)::INTEGER AS count FROM organization_invitations WHERE organization_id = $1`,
    [ids.organization],
  ));
  if (invisible.rows[0].count !== 0) {
    throw new Error('RLS exposed invitations to a non-admin member');
  }
  // SELECT/DELETE 无匹配策略时静默过滤为 0 行；INSERT 的 WITH CHECK 不满足才抛 42501
  const deleted = await withClaims(pool, claimsAdmin, client => client.query(
    `DELETE FROM organization_invitations WHERE token_hash = $1 AND accepted_at IS NULL`,
    [hashWrongEmail],
  ));
  if (deleted.rowCount !== 1) {
    throw new Error('admin could not revoke a pending invitation');
  }
  const hrDeleted = await withClaims(pool, claimsHr, client => client.query(
    `DELETE FROM organization_invitations WHERE token_hash = $1 AND accepted_at IS NULL`,
    [hashExpired],
  ));
  if (hrDeleted.rowCount !== 0) {
    throw new Error('non-admin member revoked an invitation');
  }
  await expectDatabaseError(
    () => withClaims(pool, claimsHr, client => client.query(
      `INSERT INTO organization_invitations (
         organization_id, email, role, token_hash, invited_by, expires_at
       ) VALUES ($1, 'sneaky@example.test', 'admin', $2, $3, NOW() + INTERVAL '7 days')`,
      [ids.organization, '3'.repeat(64), ids.hr],
    )),
    '42501',
  );
  process.stdout.write('database checkpoint: invitation RLS gates verified\n');
}

async function main() {
  dockerCompose('up', '-d', '--wait');
  const pool = new Pool({ connectionString });
  try {
    const migration = readFileSync(resolve(process.cwd(), 'scripts', 'migrate.sql'), 'utf8');
    await pool.query(migration);
    await assertBaseline(pool);
    await pool.query(migration);
    await assertBaseline(pool);
    await assertDecisionCopilotBehavior(pool);
    await assertInvitationFlow(pool);
    process.stdout.write('database migration, RLS, state, idempotency, integration and cleanup checks passed\n');
  } finally {
    await pool.end();
    dockerCompose('down', '--volumes', '--remove-orphans');
  }
}

main().catch(error => {
  try {
    dockerCompose('down', '--volumes', '--remove-orphans');
  } catch {
    // Preserve the original verification failure.
  }
  const position = Number(error && typeof error === 'object' ? error.position : NaN);
  const location = Number.isFinite(position)
    ? ` at SQL character ${position}`
    : '';
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}${location}\n`);
  process.exitCode = 1;
});
