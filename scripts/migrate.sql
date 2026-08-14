-- 人才决策Agent 数据库建表脚本
-- 执行方式: pnpm db:migrate 或手动在 Supabase SQL Editor 中执行

-- ============================================
-- 1. 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'hr' CHECK (role IN ('hr', 'admin')),
  company VARCHAR(200),
  avatar_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  auth_version INTEGER NOT NULL DEFAULT 1,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_encrypted TEXT,
  mfa_pending_secret_encrypted TEXT,
  mfa_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  mfa_last_used_step INTEGER NOT NULL DEFAULT -1,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_used_step INTEGER NOT NULL DEFAULT -1;

-- 移除历史版本内置且凭据已公开的固定管理员。
DELETE FROM users
WHERE email = 'admin@zhipin.com'
  AND role = 'admin';

-- ============================================
-- 2. 职位需求表
-- ============================================
CREATE TABLE IF NOT EXISTS job_requirements (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  department VARCHAR(100),
  location VARCHAR(100),
  salary_range VARCHAR(100),
  salary_min INTEGER,
  salary_max INTEGER,
  experience_required TEXT,
  education_required VARCHAR(100),
  skills_required JSONB DEFAULT '[]',
  bonus_skills JSONB DEFAULT '[]',
  responsibilities JSONB DEFAULT '[]',
  benefits JSONB DEFAULT '[]',
  urgency VARCHAR(20) DEFAULT 'normal' CHECK (urgency IN ('urgent', 'normal', 'low')),
  implicit_requirements JSONB DEFAULT '[]',
  completeness INTEGER DEFAULT 0,
  missing_fields JSONB DEFAULT '[]',
  industry_field VARCHAR(100),
  raw_jd TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'draft')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS job_requirements_status_idx ON job_requirements(status);
CREATE INDEX IF NOT EXISTS job_requirements_created_at_idx ON job_requirements(created_at);

-- ============================================
-- 3. 候选人表
-- ============================================
CREATE TABLE IF NOT EXISTS candidates (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(255),
  resume_url VARCHAR(500),
  skills JSONB DEFAULT '[]',
  experience_years INTEGER DEFAULT 0,
  verified_experience_years NUMERIC(4,1),
  experience_years_status VARCHAR(30),
  experience_years_evidence TEXT,
  education VARCHAR(50),
  current_company VARCHAR(255),
  current_position VARCHAR(255),
  resume_text TEXT,
  notes TEXT,
  current_city VARCHAR(100),
  preferred_locations JSONB DEFAULT '[]',
  salary_expectation VARCHAR(50),
  salary_min INTEGER,
  salary_max INTEGER,
  availability VARCHAR(50),
  job_change_frequency NUMERIC(3,1),
  work_history JSONB DEFAULT '[]',
  email_hmac VARCHAR(64),  -- HMAC-SHA256 of email (for encrypted field search)
  phone_hmac VARCHAR(64),  -- HMAC-SHA256 of phone (for encrypted field search)
  data_source VARCHAR(50) DEFAULT 'manual',
  is_authorized BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS candidates_email_idx ON candidates(email);
CREATE INDEX IF NOT EXISTS candidates_current_city_idx ON candidates(current_city);
CREATE INDEX IF NOT EXISTS candidates_email_hmac_idx ON candidates(email_hmac);
CREATE INDEX IF NOT EXISTS candidates_phone_hmac_idx ON candidates(phone_hmac);

-- ============================================
-- 4. 匹配记录表
-- ============================================
CREATE TABLE IF NOT EXISTS match_records (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(36) NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
  candidate_id VARCHAR(36) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  overall_score INTEGER,
  skill_score INTEGER,
  experience_score INTEGER,
  education_score INTEGER,
  salary_score INTEGER,
  location_score INTEGER,
  availability_score INTEGER,
  stability_score INTEGER,
  culture_fit_score INTEGER,
  scoring_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (scoring_status IN ('pending', 'succeeded', 'failed')),
  scoring_error TEXT,
  scoring_model VARCHAR(200),
  scoring_prompt_version VARCHAR(100),
  scoring_input_snapshot JSONB,
  llm_status VARCHAR(20) NOT NULL DEFAULT 'not_requested' CHECK (llm_status IN ('not_requested', 'succeeded', 'failed')),
  llm_error TEXT,
  llm_model VARCHAR(200),
  llm_prompt_version VARCHAR(100),
  match_details JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn')),
  status_history JSONB DEFAULT '[]',
  generated_script TEXT,
  script_type VARCHAR(50),
  contact_time TIMESTAMP WITH TIME ZONE,
  interview_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE
);

-- 兼容已经创建过 match_records 的环境
ALTER TABLE match_records
  ADD COLUMN IF NOT EXISTS scoring_status VARCHAR(20) NOT NULL DEFAULT 'succeeded'
    CHECK (scoring_status IN ('pending', 'succeeded', 'failed')),
  ADD COLUMN IF NOT EXISTS scoring_error TEXT,
  ADD COLUMN IF NOT EXISTS scoring_model VARCHAR(200),
  ADD COLUMN IF NOT EXISTS scoring_prompt_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS scoring_input_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS llm_status VARCHAR(20) NOT NULL DEFAULT 'not_requested'
    CHECK (llm_status IN ('not_requested', 'succeeded', 'failed')),
  ADD COLUMN IF NOT EXISTS llm_error TEXT,
  ADD COLUMN IF NOT EXISTS llm_model VARCHAR(200),
  ADD COLUMN IF NOT EXISTS llm_prompt_version VARCHAR(100);

-- 历史记录在新增字段时已标记 succeeded；此后新记录必须由评分代码显式转为 succeeded。
ALTER TABLE match_records
  ALTER COLUMN scoring_status SET DEFAULT 'pending',
  ALTER COLUMN overall_score DROP DEFAULT,
  ALTER COLUMN skill_score DROP DEFAULT,
  ALTER COLUMN experience_score DROP DEFAULT,
  ALTER COLUMN education_score DROP DEFAULT;

-- 不扫描并阻断历史脏数据，但立即约束所有新写入/更新的评分。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_records_score_bounds'
      AND conrelid = 'match_records'::regclass
  ) THEN
    ALTER TABLE match_records
      ADD CONSTRAINT match_records_score_bounds CHECK (
        (overall_score IS NULL OR overall_score BETWEEN 0 AND 100)
        AND (skill_score IS NULL OR skill_score BETWEEN 0 AND 100)
        AND (experience_score IS NULL OR experience_score BETWEEN 0 AND 100)
        AND (education_score IS NULL OR education_score BETWEEN 0 AND 100)
        AND (salary_score IS NULL OR salary_score BETWEEN 0 AND 100)
        AND (location_score IS NULL OR location_score BETWEEN 0 AND 100)
        AND (availability_score IS NULL OR availability_score BETWEEN 0 AND 100)
        AND (stability_score IS NULL OR stability_score BETWEEN 0 AND 100)
      ) NOT VALID;
  END IF;
END;
$$;



-- 下面的队列表在完整租户迁移前创建；先确保其依赖和 JWT 辅助函数存在。
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS VARCHAR
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'organizationId', '');
$$;

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS VARCHAR
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'userId', '');
$$;

-- ============================================
-- 16. 服务端限额、SQL 聚合与批量匹配后台队列
-- ============================================
CREATE TABLE IF NOT EXISTS match_batch_tasks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  job_id VARCHAR(36) NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
  candidate_ids JSONB,
  candidate_limit INTEGER NOT NULL DEFAULT 100,
  top_n INTEGER NOT NULL DEFAULT 10,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  result JSONB,
  error_message TEXT,
  worker_id VARCHAR(100),
  lease_until TIMESTAMP WITH TIME ZONE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT match_batch_tasks_limits CHECK (
    candidate_limit BETWEEN 1 AND 100
    AND top_n BETWEEN 1 AND 50
    AND candidate_count BETWEEN 0 AND 100
    AND (
      candidate_ids IS NULL
      OR (
        jsonb_typeof(candidate_ids) = 'array'
        AND jsonb_array_length(candidate_ids) BETWEEN 1 AND 100
      )
    )
  ),
  CONSTRAINT match_batch_tasks_status_check CHECK (
    status IN ('pending', 'running', 'done', 'error')
  )
);

CREATE INDEX IF NOT EXISTS match_batch_tasks_organization_idx
  ON match_batch_tasks(organization_id);
CREATE INDEX IF NOT EXISTS match_batch_tasks_status_created_idx
  ON match_batch_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS match_batch_tasks_lease_until_idx
  ON match_batch_tasks(lease_until);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(100) NOT NULL,
  window_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT api_rate_limits_request_count_check CHECK (request_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS api_rate_limits_subject_scope_unique
  ON api_rate_limits(organization_id, user_id, scope);
CREATE INDEX IF NOT EXISTS api_rate_limits_updated_at_idx
  ON api_rate_limits(updated_at);

DO $$
BEGIN
  IF to_regclass('public.boss_search_tasks') IS NOT NULL
    AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boss_search_tasks_expected_count_limit'
      AND conrelid = to_regclass('public.boss_search_tasks')
  ) THEN
    ALTER TABLE boss_search_tasks
      ADD CONSTRAINT boss_search_tasks_expected_count_limit
      CHECK (expected_count BETWEEN 0 AND 40) NOT VALID;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS consume_api_rate_limit(VARCHAR, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION consume_api_rate_limit(
  p_scope VARCHAR
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR;
  v_user_id VARCHAR;
  v_now TIMESTAMP WITH TIME ZONE := clock_timestamp();
  v_window_started_at TIMESTAMP WITH TIME ZONE;
  v_request_count INTEGER;
  v_limit INTEGER;
  v_window_seconds INTEGER;
BEGIN
  v_organization_id := current_organization_id();
  v_user_id := current_app_user_id();

  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '42501';
  END IF;
  SELECT
    CASE p_scope
      WHEN 'candidates:list' THEN 120
      WHEN 'candidates:search' THEN 120
      WHEN 'jd:parse' THEN 10
      WHEN 'boss:keywords' THEN 10
      WHEN 'boss:execute' THEN 10
      WHEN 'match:batch:submit' THEN 10
      WHEN 'match:batch:status' THEN 120
      WHEN 'match:single' THEN 10
      WHEN 'dashboard:read' THEN 120
      WHEN 'outcomes:create' THEN 30
      WHEN 'communication-briefs:create' THEN 20
      WHEN 'shortlists:create' THEN 10
      WHEN 'shortlists:read' THEN 120
      WHEN 'shortlists:qualify' THEN 10
      WHEN 'shortlists:decision' THEN 30
    END,
    CASE p_scope
      WHEN 'candidates:list' THEN 60
      WHEN 'candidates:search' THEN 60
      WHEN 'jd:parse' THEN 300
      WHEN 'boss:keywords' THEN 300
      WHEN 'boss:execute' THEN 60
      WHEN 'match:batch:submit' THEN 60
      WHEN 'match:batch:status' THEN 60
      WHEN 'match:single' THEN 60
      WHEN 'dashboard:read' THEN 60
      WHEN 'outcomes:create' THEN 60
      WHEN 'communication-briefs:create' THEN 60
      WHEN 'shortlists:create' THEN 60
      WHEN 'shortlists:read' THEN 60
      WHEN 'shortlists:qualify' THEN 60
      WHEN 'shortlists:decision' THEN 60
    END
  INTO v_limit, v_window_seconds;

  IF v_limit IS NULL OR v_window_seconds IS NULL THEN
    RAISE EXCEPTION 'invalid rate limit scope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api_rate_limits (
    organization_id,
    user_id,
    scope,
    window_started_at,
    request_count,
    updated_at
  ) VALUES (
    v_organization_id,
    v_user_id,
    p_scope,
    v_now,
    1,
    v_now
  )
  ON CONFLICT (organization_id, user_id, scope)
  DO UPDATE SET
    window_started_at = CASE
      WHEN api_rate_limits.window_started_at
        <= v_now - make_interval(secs => v_window_seconds)
      THEN v_now
      ELSE api_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN api_rate_limits.window_started_at
        <= v_now - make_interval(secs => v_window_seconds)
      THEN 1
      ELSE api_rate_limits.request_count + 1
    END,
    updated_at = v_now
  RETURNING
    api_rate_limits.window_started_at,
    api_rate_limits.request_count
  INTO v_window_started_at, v_request_count;

  RETURN QUERY SELECT
    v_request_count <= v_limit,
    GREATEST(v_limit - v_request_count, 0),
    CASE
      WHEN v_request_count <= v_limit THEN 0
      ELSE GREATEST(
        CEIL(EXTRACT(EPOCH FROM (
          v_window_started_at
          + make_interval(secs => v_window_seconds)
          - v_now
        )))::INTEGER,
        1
      )
    END;
END;
$$;

CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (
  WITH event_flags AS (
    SELECT
      status_event.match_record_id,
      bool_or(status_event.status = 'contacted') AS contacted,
      bool_or(status_event.status = 'interviewing') AS interviewing,
      bool_or(status_event.status = 'offered') AS offered,
      bool_or(status_event.status = 'hired') AS hired
    FROM match_status_events AS status_event
    WHERE status_event.organization_id = current_organization_id()
      AND status_event.status IN ('contacted', 'interviewing', 'offered', 'hired')
    GROUP BY status_event.match_record_id
  ),
  match_metrics AS (
    SELECT
      count(*)::INTEGER AS total_matches,
      count(*) FILTER (WHERE match_record.status = 'pending')::INTEGER AS pending,
      count(*) FILTER (WHERE match_record.status = 'contacted')::INTEGER AS contacted,
      count(*) FILTER (WHERE match_record.status = 'interviewing')::INTEGER AS interviewing,
      count(*) FILTER (WHERE match_record.status = 'offered')::INTEGER AS offered,
      count(*) FILTER (WHERE match_record.status = 'hired')::INTEGER AS hired,
      count(*) FILTER (WHERE match_record.status = 'rejected')::INTEGER AS rejected,
      count(*) FILTER (WHERE match_record.status = 'withdrawn')::INTEGER AS withdrawn,
      ROUND(AVG(match_record.overall_score))::INTEGER AS overall_avg,
      ROUND(AVG(match_record.skill_score))::INTEGER AS skill_avg,
      ROUND(AVG(match_record.experience_score))::INTEGER AS experience_avg,
      ROUND(AVG(match_record.education_score))::INTEGER AS education_avg,
      ROUND(AVG(match_record.salary_score))::INTEGER AS salary_avg,
      ROUND(AVG(match_record.location_score))::INTEGER AS location_avg,
      ROUND(AVG(match_record.availability_score))::INTEGER AS availability_avg,
      ROUND(AVG(match_record.stability_score))::INTEGER AS stability_avg,
      count(*) FILTER (
        WHERE match_record.status = 'contacted' OR COALESCE(event_flags.contacted, false)
      )::INTEGER AS funnel_contacted,
      count(*) FILTER (
        WHERE match_record.status = 'interviewing' OR COALESCE(event_flags.interviewing, false)
      )::INTEGER AS funnel_interviewing,
      count(*) FILTER (
        WHERE match_record.status = 'offered' OR COALESCE(event_flags.offered, false)
      )::INTEGER AS funnel_offered,
      count(*) FILTER (
        WHERE match_record.status = 'hired' OR COALESCE(event_flags.hired, false)
      )::INTEGER AS funnel_hired
    FROM match_records AS match_record
    LEFT JOIN event_flags ON event_flags.match_record_id = match_record.id
    WHERE match_record.organization_id = current_organization_id()
      AND match_record.scoring_status = 'succeeded'
  )
  SELECT jsonb_build_object(
    'total_jobs', (
      SELECT count(*)::INTEGER
      FROM job_requirements
      WHERE organization_id = current_organization_id()
    ),
    'total_candidates', (
      SELECT count(*)::INTEGER
      FROM candidates
      WHERE organization_id = current_organization_id()
    ),
    'total_matches', match_metrics.total_matches,
    'status_stats', jsonb_build_object(
      'pending', match_metrics.pending,
      'contacted', match_metrics.contacted,
      'interviewing', match_metrics.interviewing,
      'offered', match_metrics.offered,
      'hired', match_metrics.hired,
      'rejected', match_metrics.rejected,
      'withdrawn', match_metrics.withdrawn
    ),
    'avg_scores', jsonb_build_object(
      'overall', match_metrics.overall_avg,
      'skill', match_metrics.skill_avg,
      'experience', match_metrics.experience_avg,
      'education', match_metrics.education_avg,
      'salary', match_metrics.salary_avg,
      'location', match_metrics.location_avg,
      'availability', match_metrics.availability_avg,
      'stability', match_metrics.stability_avg
    ),
    'funnel_counts', jsonb_build_object(
      'contacted', match_metrics.funnel_contacted,
      'interviewing', match_metrics.funnel_interviewing,
      'offered', match_metrics.funnel_offered,
      'hired', match_metrics.funnel_hired
    )
  )
  FROM match_metrics
  );
END;
$$;

CREATE OR REPLACE FUNCTION claim_match_batch_task(
  p_worker_id VARCHAR,
  p_lease_seconds INTEGER DEFAULT 600
)
RETURNS SETOF match_batch_tasks
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH next_task AS (
    SELECT task.id
    FROM match_batch_tasks AS task
    WHERE (
      task.status = 'pending'
      OR (
        task.status = 'running'
        AND task.lease_until IS NOT NULL
        AND task.lease_until < NOW()
      )
    )
    ORDER BY task.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE match_batch_tasks AS task
  SET
    status = 'running',
    worker_id = left(p_worker_id, 100),
    lease_until = NOW() + make_interval(
      secs => LEAST(GREATEST(p_lease_seconds, 60), 3600)
    ),
    attempt_count = task.attempt_count + 1,
    started_at = COALESCE(task.started_at, NOW()),
    error_message = NULL,
    updated_at = NOW()
  FROM next_task
  WHERE task.id = next_task.id
    AND p_worker_id IS NOT NULL
    AND length(trim(p_worker_id)) > 0
  RETURNING task.*;
$$;

ALTER TABLE match_batch_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_batch_tasks_tenant_select ON match_batch_tasks;
CREATE POLICY match_batch_tasks_tenant_select ON match_batch_tasks
  FOR SELECT TO authenticated
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS match_batch_tasks_tenant_insert ON match_batch_tasks;
CREATE POLICY match_batch_tasks_tenant_insert ON match_batch_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_organization_id()
    AND user_id = current_app_user_id()
  );

REVOKE ALL ON match_batch_tasks FROM authenticated;
GRANT SELECT, INSERT ON match_batch_tasks TO authenticated;
REVOKE ALL ON api_rate_limits FROM authenticated;

REVOKE ALL ON FUNCTION consume_api_rate_limit(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_api_rate_limit(VARCHAR) TO authenticated;
REVOKE ALL ON FUNCTION get_dashboard_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_dashboard_metrics() TO authenticated;
REVOKE ALL ON FUNCTION claim_match_batch_task(VARCHAR, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_match_batch_task(VARCHAR, INTEGER) TO service_role;

-- 唯一约束: 同一职位+候选人只能有一条匹配记录
CREATE UNIQUE INDEX IF NOT EXISTS match_records_job_candidate_unique ON match_records(job_id, candidate_id);
CREATE INDEX IF NOT EXISTS match_records_job_id_idx ON match_records(job_id);
CREATE INDEX IF NOT EXISTS match_records_candidate_id_idx ON match_records(candidate_id);
CREATE INDEX IF NOT EXISTS match_records_status_idx ON match_records(status);
CREATE INDEX IF NOT EXISTS match_records_scoring_status_idx ON match_records(scoring_status);
CREATE INDEX IF NOT EXISTS match_records_llm_status_idx ON match_records(llm_status);
CREATE INDEX IF NOT EXISTS match_records_overall_score_idx ON match_records(overall_score);

-- ============================================
-- 5. 搜索记录表
-- ============================================
CREATE TABLE IF NOT EXISTS search_records (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(36) NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
  search_query JSONB,
  results_count INTEGER,
  candidates_found JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_records_job_id_idx ON search_records(job_id);

-- ============================================
-- 6. 授权记录表 (合规)
-- ============================================
CREATE TABLE IF NOT EXISTS authorization_records (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id VARCHAR(36) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  authorized_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  purpose VARCHAR(500) NOT NULL DEFAULT '招聘匹配与沟通',
  processing_expires_at TIMESTAMP WITH TIME ZONE,
  source_type VARCHAR(50),
  source_reference VARCHAR(500),
  proof_type VARCHAR(50),
  proof_reference VARCHAR(1000),
  proof_sha256 VARCHAR(64),
  notice_version VARCHAR(100),
  notice_snapshot JSONB,
  notice_text_sha256 VARCHAR(64),
  external_processors JSONB,
  automated_decision_disclosed BOOLEAN DEFAULT false,
  automated_decision_preference VARCHAR(30),
  automated_decision_objected_at TIMESTAMP WITH TIME ZONE,
  automated_decision_objection_reference VARCHAR(500),
  automated_decision_objected_by_user_id VARCHAR(36),
  impact_assessment_reference VARCHAR(500),
  impact_assessment_completed_at TIMESTAMP WITH TIME ZONE,
  collected_by_user_id VARCHAR(36),
  collection_context_sha256 VARCHAR(64),
  evidence_sha256 VARCHAR(64),
  evidence_status VARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authorization_records_candidate_id_idx ON authorization_records(candidate_id);

-- ============================================
-- 7. 审计日志表 (合规)
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(36),
  details JSONB,
  ip_address VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);

-- ============================================
-- 8. Boss直聘搜索任务表（云端任务队列 + 本地Worker执行）
-- ============================================
CREATE TABLE IF NOT EXISTS boss_search_tasks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  jd_content TEXT NOT NULL,
  city VARCHAR(100),
  keywords JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  expected_count INTEGER DEFAULT 0,
  total_candidates INTEGER DEFAULT 0,
  invalid_count INTEGER DEFAULT 0,
  task_dir VARCHAR(500),
  manifest JSONB,
  result_summary JSONB,
  report_requested BOOLEAN DEFAULT false,
  report_status VARCHAR(50),
  error_message TEXT,
  worker_id VARCHAR(100),
  lease_until TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boss_search_tasks_status_created_idx ON boss_search_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS boss_search_tasks_user_created_idx ON boss_search_tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS boss_search_tasks_lease_until_idx ON boss_search_tasks(lease_until);

-- ============================================
-- 9. Boss候选人联系请求（网页下发，本地Worker在Boss中打开）
-- ============================================
CREATE TABLE IF NOT EXISTS boss_contact_requests (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id VARCHAR(36) NOT NULL REFERENCES boss_search_tasks(id) ON DELETE CASCADE,
  candidate_index INTEGER NOT NULL,
  requested_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'requested',
  error_message TEXT,
  opened_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boss_contact_requests_status_created_idx
  ON boss_contact_requests(status, created_at);
CREATE INDEX IF NOT EXISTS boss_contact_requests_task_candidate_idx
  ON boss_contact_requests(task_id, candidate_index, created_at);

-- ============================================
-- 10. 简历批处理 MCP 凭证（URL 使用应用层 AES-256-GCM 加密）
-- ============================================
CREATE TABLE IF NOT EXISTS resume_batch_credentials (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  mcp_url_encrypted TEXT NOT NULL,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resume_batch_credentials_created_at_idx
  ON resume_batch_credentials(created_at);

-- ============================================
-- 11. 简历批处理钉钉表格预设
-- ============================================
CREATE TABLE IF NOT EXISTS resume_batch_sheets (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  sheet_url TEXT NOT NULL,
  worksheet_id VARCHAR(200),
  credential_id VARCHAR(36) NOT NULL REFERENCES resume_batch_credentials(id) ON DELETE RESTRICT,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resume_batch_sheets_credential_idx
  ON resume_batch_sheets(credential_id);
CREATE INDEX IF NOT EXISTS resume_batch_sheets_created_at_idx
  ON resume_batch_sheets(created_at);

-- ============================================
-- 12. 简历批处理任务（私有 Storage + 本地 Worker）
-- ============================================
CREATE TABLE IF NOT EXISTS resume_batch_tasks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  sheet_preset_id VARCHAR(36) REFERENCES resume_batch_sheets(id) ON DELETE SET NULL,
  credential_id VARCHAR(36) REFERENCES resume_batch_credentials(id) ON DELETE SET NULL,
  sheet_name VARCHAR(200) NOT NULL,
  sheet_url TEXT NOT NULL,
  worksheet_id VARCHAR(200),
  files JSONB NOT NULL DEFAULT '[]',
  overwrite BOOLEAN NOT NULL DEFAULT false,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(50) NOT NULL DEFAULT 'uploading',
  logs JSONB NOT NULL DEFAULT '[]',
  result JSONB,
  error_message TEXT,
  worker_id VARCHAR(100),
  lease_until TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resume_batch_tasks_status_created_idx
  ON resume_batch_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS resume_batch_tasks_user_created_idx
  ON resume_batch_tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS resume_batch_tasks_lease_until_idx
  ON resume_batch_tasks(lease_until);

-- 私有 Bucket；不存在 Supabase Storage 时跳过，首次上传时应用也会再次确保创建。
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'resume-batch-files',
      'resume-batch-files',
      false,
      31457280,
      ARRAY['application/pdf']::text[]
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

-- ============================================
-- 13. 企业租户、邀请注册与行级安全
-- ============================================
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000000001', '历史数据隔离区', 'legacy-quarantine')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE job_requirements ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE match_records ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE search_records ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE authorization_records ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE boss_search_tasks ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE boss_contact_requests ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE resume_batch_credentials ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE resume_batch_sheets ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);
ALTER TABLE resume_batch_tasks ADD COLUMN IF NOT EXISTS organization_id VARCHAR(36);

INSERT INTO organizations (name, slug)
SELECT DISTINCT
  trim(company),
  'legacy-company-' || substr(md5(lower(trim(company))), 1, 16)
FROM users
WHERE organization_id IS NULL
  AND role <> 'admin'
  AND company IS NOT NULL
  AND trim(company) <> ''
ON CONFLICT (slug) DO NOTHING;

UPDATE users
SET organization_id = organizations.id
FROM organizations
WHERE users.organization_id IS NULL
  AND users.role <> 'admin'
  AND users.company IS NOT NULL
  AND organizations.slug = 'legacy-company-' || substr(md5(lower(trim(users.company))), 1, 16);

INSERT INTO organizations (name, slug)
SELECT
  '历史用户 ' || users.id,
  'legacy-user-' || substr(md5(users.id), 1, 20)
FROM users
WHERE organization_id IS NULL
  AND role <> 'admin'
ON CONFLICT (slug) DO NOTHING;

UPDATE users
SET organization_id = organizations.id
FROM organizations
WHERE users.organization_id IS NULL
  AND users.role <> 'admin'
  AND organizations.slug = 'legacy-user-' || substr(md5(users.id), 1, 20);

UPDATE users
SET organization_id = '00000000-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;
UPDATE job_requirements SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE candidates SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE match_records SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE search_records SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE authorization_records SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE audit_logs SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE boss_search_tasks SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE boss_contact_requests SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE resume_batch_credentials SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE resume_batch_sheets SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE resume_batch_tasks SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;

ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE job_requirements ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE candidates ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE match_records ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE search_records ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE authorization_records ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE boss_search_tasks ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE boss_contact_requests ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE resume_batch_credentials ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE resume_batch_sheets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE resume_batch_tasks ALTER COLUMN organization_id SET NOT NULL;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'job_requirements',
    'candidates',
    'match_records',
    'search_records',
    'authorization_records',
    'audit_logs',
    'boss_search_tasks',
    'boss_contact_requests',
    'resume_batch_credentials',
    'resume_batch_sheets',
    'resume_batch_tasks'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
        table_name,
        table_name || '_organization_id_fkey'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END
$$;

CREATE INDEX IF NOT EXISTS users_organization_id_idx ON users(organization_id);
CREATE INDEX IF NOT EXISTS job_requirements_organization_idx ON job_requirements(organization_id);
CREATE INDEX IF NOT EXISTS candidates_organization_idx ON candidates(organization_id);
CREATE INDEX IF NOT EXISTS match_records_organization_idx ON match_records(organization_id);
CREATE INDEX IF NOT EXISTS search_records_organization_idx ON search_records(organization_id);
CREATE INDEX IF NOT EXISTS authorization_records_organization_idx ON authorization_records(organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_organization_idx ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS boss_search_tasks_organization_idx ON boss_search_tasks(organization_id);
CREATE INDEX IF NOT EXISTS boss_contact_requests_organization_idx ON boss_contact_requests(organization_id);
CREATE INDEX IF NOT EXISTS resume_batch_credentials_organization_idx ON resume_batch_credentials(organization_id);
CREATE INDEX IF NOT EXISTS resume_batch_sheets_organization_idx ON resume_batch_sheets(organization_id);
CREATE INDEX IF NOT EXISTS resume_batch_tasks_organization_idx ON resume_batch_tasks(organization_id);

ALTER TABLE resume_batch_credentials DROP CONSTRAINT IF EXISTS resume_batch_credentials_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS resume_batch_credentials_organization_name_unique
  ON resume_batch_credentials(organization_id, name);

CREATE TABLE IF NOT EXISTS organization_members (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'hr' CHECK (role IN ('hr', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_members_user_unique ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS organization_members_organization_idx ON organization_members(organization_id);

INSERT INTO organization_members (organization_id, user_id, role)
SELECT organization_id, id, role
FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS resume_batch_settings (
  organization_id VARCHAR(36) PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  llm_api_key_encrypted TEXT,
  llm_base_url VARCHAR(500),
  text_model VARCHAR(200),
  vision_model VARCHAR(200),
  workers INTEGER CHECK (workers IS NULL OR (workers BETWEEN 1 AND 32)),
  style_sample TEXT,
  updated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'hr' CHECK (role IN ('hr', 'admin')),
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  invited_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organization_invitations_organization_idx
  ON organization_invitations(organization_id);
CREATE INDEX IF NOT EXISTS organization_invitations_email_idx
  ON organization_invitations(email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id SERIAL PRIMARY KEY,
  identifier_hash VARCHAR(64) NOT NULL,
  ip_hash VARCHAR(64) NOT NULL,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_identifier_created_idx
  ON auth_login_attempts(identifier_hash, created_at);
CREATE INDEX IF NOT EXISTS auth_login_attempts_ip_created_idx
  ON auth_login_attempts(ip_hash, created_at);

CREATE OR REPLACE FUNCTION validate_auth_session(
  p_session_id VARCHAR,
  p_user_id VARCHAR,
  p_organization_id VARCHAR,
  p_auth_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  auth_state JSONB;
BEGIN
  SELECT jsonb_build_object(
    'role', members.role,
    'email', users.email,
    'name', users.name,
    'mustChangePassword', users.must_change_password,
    'authVersion', users.auth_version
  )
  INTO auth_state
  FROM auth_sessions
  JOIN users ON users.id = auth_sessions.user_id
  JOIN organization_members AS members
    ON members.user_id = users.id
   AND members.organization_id = auth_sessions.organization_id
  JOIN organizations ON organizations.id = auth_sessions.organization_id
  WHERE auth_sessions.id = p_session_id
    AND auth_sessions.user_id = p_user_id
    AND auth_sessions.organization_id = p_organization_id
    AND auth_sessions.auth_version = p_auth_version
    AND users.auth_version = p_auth_version
    AND auth_sessions.revoked_at IS NULL
    AND auth_sessions.expires_at > NOW()
    AND users.organization_id = p_organization_id
    AND users.is_active = true
    AND members.is_active = true
    AND organizations.is_active = true;

  RETURN auth_state;
END
$$;

REVOKE ALL ON FUNCTION validate_auth_session(VARCHAR, VARCHAR, VARCHAR, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_auth_session(VARCHAR, VARCHAR, VARCHAR, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION record_failed_login(
  p_user_id VARCHAR,
  p_lock_threshold INTEGER,
  p_lock_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated_attempts INTEGER;
  updated_locked_until TIMESTAMP WITH TIME ZONE;
BEGIN
  UPDATE users
  SET
    failed_login_attempts = (
      CASE
        WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 0
        ELSE failed_login_attempts
      END
    ) + 1,
    locked_until = CASE
      WHEN (
        CASE
          WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 0
          ELSE failed_login_attempts
        END
      ) + 1 >= p_lock_threshold
        THEN NOW() + make_interval(mins => p_lock_minutes)
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE id = p_user_id
  RETURNING failed_login_attempts, locked_until
  INTO updated_attempts, updated_locked_until;

  RETURN jsonb_build_object(
    'failedAttempts', updated_attempts,
    'lockedUntil', updated_locked_until
  );
END
$$;

REVOKE ALL ON FUNCTION record_failed_login(VARCHAR, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_failed_login(VARCHAR, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION bump_user_auth_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.mfa_enabled IS DISTINCT FROM OLD.mfa_enabled
  THEN
    NEW.auth_version = OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_bump_auth_version ON users;
CREATE TRIGGER users_bump_auth_version
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION bump_user_auth_version();

CREATE OR REPLACE FUNCTION bump_member_user_auth_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE users
    SET auth_version = auth_version + 1, updated_at = NOW()
    WHERE id = OLD.user_id;
    RETURN OLD;
  END IF;

  UPDATE users
  SET auth_version = auth_version + 1, updated_at = NOW()
  WHERE id = NEW.user_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS organization_members_bump_auth_version ON organization_members;
CREATE TRIGGER organization_members_bump_auth_version
AFTER UPDATE OF role, is_active ON organization_members
FOR EACH ROW
WHEN (
  OLD.role IS DISTINCT FROM NEW.role
  OR OLD.is_active IS DISTINCT FROM NEW.is_active
)
EXECUTE FUNCTION bump_member_user_auth_version();

DROP TRIGGER IF EXISTS organization_members_delete_bump_auth_version ON organization_members;
CREATE TRIGGER organization_members_delete_bump_auth_version
AFTER DELETE ON organization_members
FOR EACH ROW
EXECUTE FUNCTION bump_member_user_auth_version();

CREATE OR REPLACE FUNCTION bump_organization_users_auth_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    UPDATE users
    SET auth_version = auth_version + 1, updated_at = NOW()
    WHERE organization_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS organizations_bump_auth_version ON organizations;
CREATE TRIGGER organizations_bump_auth_version
AFTER UPDATE OF is_active ON organizations
FOR EACH ROW
EXECUTE FUNCTION bump_organization_users_auth_version();

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS VARCHAR
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'organizationId', '');
$$;

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS VARCHAR
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'userId', '');
$$;

CREATE OR REPLACE FUNCTION current_app_role()
RETURNS VARCHAR
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'appRole', '');
$$;

-- ============================================
-- 13.1 关键业务事务与追加式匹配状态事件
-- ============================================
CREATE TABLE IF NOT EXISTS match_status_events (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_record_id VARCHAR(36) NOT NULL REFERENCES match_records(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('pending', 'contacted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn')),
  note TEXT,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS match_status_events_organization_idx
  ON match_status_events(organization_id);
CREATE INDEX IF NOT EXISTS match_status_events_record_created_idx
  ON match_status_events(match_record_id, created_at);

-- 将旧 JSON 历史一次性迁入事件表；没有历史的记录以当前状态建立初始事件。
INSERT INTO match_status_events (
  organization_id,
  match_record_id,
  status,
  note,
  created_at
)
SELECT
  match_record.organization_id,
  match_record.id,
  CASE
    WHEN history_item.value ->> 'status' IN (
      'pending',
      'contacted',
      'interviewing',
      'offered',
      'hired',
      'rejected',
      'withdrawn'
    ) THEN history_item.value ->> 'status'
    ELSE COALESCE(match_record.status, 'pending')
  END,
  NULLIF(history_item.value ->> 'note', ''),
  COALESCE(
    NULLIF(history_item.value ->> 'time', '')::TIMESTAMP WITH TIME ZONE,
    match_record.created_at,
    NOW()
  )
FROM match_records AS match_record
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(match_record.status_history) = 'array' THEN match_record.status_history
    ELSE '[]'::JSONB
  END
) AS history_item(value)
WHERE NOT EXISTS (
  SELECT 1
  FROM match_status_events AS existing_event
  WHERE existing_event.match_record_id = match_record.id
);

INSERT INTO match_status_events (
  organization_id,
  match_record_id,
  status,
  created_at
)
SELECT
  match_record.organization_id,
  match_record.id,
  COALESCE(match_record.status, 'pending'),
  COALESCE(match_record.created_at, NOW())
FROM match_records AS match_record
WHERE NOT EXISTS (
  SELECT 1
  FROM match_status_events AS existing_event
  WHERE existing_event.match_record_id = match_record.id
);

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS verified_experience_years NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS experience_years_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS experience_years_evidence TEXT;

DROP FUNCTION IF EXISTS create_candidate_with_authorization_and_audit(JSONB, JSONB);
CREATE FUNCTION create_candidate_with_authorization_and_audit(
  p_candidate JSONB,
  p_authorization JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  candidate_input candidates%ROWTYPE;
  created_candidate candidates%ROWTYPE;
  created_authorization authorization_records%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO candidate_input
  FROM jsonb_populate_record(NULL::candidates, p_candidate);

  INSERT INTO candidates (
    organization_id,
    name,
    email,
    phone,
    email_hmac,
    phone_hmac,
    resume_url,
    skills,
    experience_years,
    verified_experience_years,
    experience_years_status,
    experience_years_evidence,
    education,
    current_company,
    current_position,
    current_city,
    preferred_locations,
    salary_expectation,
    salary_min,
    salary_max,
    availability,
    job_change_frequency,
    work_history,
    resume_text,
    notes,
    data_source,
    is_authorized
  ) VALUES (
    v_organization_id,
    candidate_input.name,
    candidate_input.email,
    candidate_input.phone,
    candidate_input.email_hmac,
    candidate_input.phone_hmac,
    candidate_input.resume_url,
    candidate_input.skills,
    candidate_input.experience_years,
    candidate_input.verified_experience_years,
    candidate_input.experience_years_status,
    candidate_input.experience_years_evidence,
    candidate_input.education,
    candidate_input.current_company,
    candidate_input.current_position,
    candidate_input.current_city,
    candidate_input.preferred_locations,
    candidate_input.salary_expectation,
    candidate_input.salary_min,
    candidate_input.salary_max,
    candidate_input.availability,
    candidate_input.job_change_frequency,
    candidate_input.work_history,
    candidate_input.resume_text,
    candidate_input.notes,
    COALESCE(candidate_input.data_source, 'manual'),
    true
  )
  RETURNING * INTO created_candidate;

  INSERT INTO authorization_records (
    organization_id,
    candidate_id,
    authorized_at,
    purpose,
    processing_expires_at,
    source_type,
    source_reference,
    proof_type,
    proof_reference,
    proof_sha256,
    notice_version,
    notice_snapshot,
    notice_text_sha256,
    external_processors,
    automated_decision_disclosed,
    automated_decision_preference,
    impact_assessment_reference,
    impact_assessment_completed_at,
    collected_by_user_id,
    collection_context_sha256,
    evidence_sha256,
    evidence_status,
    is_active
  ) VALUES (
    v_organization_id,
    created_candidate.id,
    (p_authorization->>'authorized_at')::TIMESTAMP WITH TIME ZONE,
    p_authorization->>'purpose',
    (p_authorization->>'processing_expires_at')::TIMESTAMP WITH TIME ZONE,
    p_authorization->>'source_type',
    p_authorization->>'source_reference',
    p_authorization->>'proof_type',
    p_authorization->>'proof_reference',
    NULLIF(p_authorization->>'proof_sha256', ''),
    p_authorization->>'notice_version',
    p_authorization->'notice_snapshot',
    p_authorization->>'notice_text_sha256',
    p_authorization->'external_processors',
    COALESCE((p_authorization->>'automated_decision_disclosed')::BOOLEAN, false),
    p_authorization->>'automated_decision_preference',
    NULLIF(p_authorization->>'impact_assessment_reference', ''),
    NULLIF(p_authorization->>'impact_assessment_completed_at', '')::TIMESTAMP WITH TIME ZONE,
    v_user_id,
    p_authorization->>'collection_context_sha256',
    p_authorization->>'evidence_sha256',
    p_authorization->>'evidence_status',
    true
  )
  RETURNING * INTO created_authorization;

  INSERT INTO audit_logs (
    organization_id,
    user_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_organization_id,
    v_user_id,
    'create_candidate',
    'candidate',
    created_candidate.id,
    jsonb_build_object(
      'authorization_record_id', created_authorization.id,
      'authorization_evidence_sha256', created_authorization.evidence_sha256,
      'authorization_source', created_authorization.source_type,
      'notice_version', created_authorization.notice_version,
      'processing_expires_at', created_authorization.processing_expires_at,
      'automated_decision_preference', created_authorization.automated_decision_preference,
      'external_processor_count', jsonb_array_length(created_authorization.external_processors),
      'personal_identifiers_logged', false
    )
  );

  RETURN to_jsonb(created_candidate)
    || jsonb_build_object('authorization_record_id', created_authorization.id);
END
$$;

CREATE OR REPLACE FUNCTION revoke_candidate_authorization(
  p_candidate_id VARCHAR,
  p_anonymized_candidate JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_revoked_at TIMESTAMP WITH TIME ZONE;
  candidate_before candidates%ROWTYPE;
  anonymized_candidate candidates%ROWTYPE;
  deleted_match_count INTEGER := 0;
  revoked_authorization_count INTEGER := 0;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO candidate_before
  FROM candidates
  WHERE id = p_candidate_id
    AND organization_id = v_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT COALESCE(candidate_before.is_authorized, false) THEN
    RAISE EXCEPTION 'candidate authorization already revoked' USING ERRCODE = 'P0001';
  END IF;

  v_revoked_at := clock_timestamp();

  SELECT *
  INTO anonymized_candidate
  FROM jsonb_populate_record(NULL::candidates, p_anonymized_candidate);

  IF anonymized_candidate.name IS NULL
    OR anonymized_candidate.email IS NULL
    OR anonymized_candidate.phone IS NULL THEN
    RAISE EXCEPTION 'anonymized candidate fields are required' USING ERRCODE = '22023';
  END IF;

  DELETE FROM match_records
  WHERE candidate_id = p_candidate_id
    AND organization_id = v_organization_id;
  GET DIAGNOSTICS deleted_match_count = ROW_COUNT;

  UPDATE authorization_records
  SET
    is_active = false,
    revoked_at = v_revoked_at
  WHERE candidate_id = p_candidate_id
    AND organization_id = v_organization_id
    AND is_active = true;
  GET DIAGNOSTICS revoked_authorization_count = ROW_COUNT;

  UPDATE candidates
  SET
    is_authorized = false,
    name = anonymized_candidate.name,
    email = anonymized_candidate.email,
    phone = anonymized_candidate.phone,
    email_hmac = NULL,
    phone_hmac = NULL,
    resume_text = NULL,
    resume_url = NULL,
    skills = '[]'::JSONB,
    current_company = NULL,
    current_position = NULL,
    current_city = NULL,
    preferred_locations = '[]'::JSONB,
    education = NULL,
    experience_years = NULL,
    salary_expectation = NULL,
    salary_min = NULL,
    salary_max = NULL,
    availability = NULL,
    job_change_frequency = NULL,
    data_source = NULL,
    notes = COALESCE(anonymized_candidate.notes, '授权已撤回，个人数据已脱敏'),
    updated_at = v_revoked_at
  WHERE id = p_candidate_id
    AND organization_id = v_organization_id;

  INSERT INTO audit_logs (
    organization_id,
    user_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_organization_id,
    v_user_id,
    'revoke_authorization',
    'candidate',
    p_candidate_id,
    jsonb_build_object(
      'match_records_deleted', deleted_match_count,
      'receipt_generated', true,
      'encryption_cleared', true
    )
  );

  RETURN jsonb_build_object(
    'match_records', deleted_match_count,
    'authorization_records', revoked_authorization_count,
    'revoked_at', v_revoked_at
  );
END
$$;

CREATE OR REPLACE FUNCTION append_match_status_event(
  p_match_record_id VARCHAR,
  p_status VARCHAR,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  current_match match_records%ROWTYPE;
  updated_match match_records%ROWTYPE;
  status_history JSONB;
  event_created_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('pending', 'contacted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'invalid match status' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO current_match
  FROM match_records
  WHERE id = p_match_record_id
    AND organization_id = v_organization_id
    AND scoring_status = 'succeeded'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match record not found' USING ERRCODE = 'P0002';
  END IF;

  event_created_at := clock_timestamp();

  UPDATE match_records
  SET
    status = p_status,
    updated_at = event_created_at
  WHERE id = current_match.id
  RETURNING * INTO updated_match;

  INSERT INTO match_status_events (
    organization_id,
    match_record_id,
    from_status,
    status,
    note,
    created_by,
    created_at
  ) VALUES (
    v_organization_id,
    current_match.id,
    current_match.status,
    p_status,
    NULLIF(p_note, ''),
    v_user_id,
    event_created_at
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'status', status_event.status,
          'time', status_event.created_at,
          'note', status_event.note
        )
      )
      ORDER BY status_event.created_at, status_event.id
    ),
    '[]'::JSONB
  )
  INTO status_history
  FROM match_status_events AS status_event
  WHERE status_event.match_record_id = current_match.id
    AND status_event.organization_id = v_organization_id;

  RETURN to_jsonb(updated_match)
    || jsonb_build_object('status_history', status_history);
END
$$;

REVOKE ALL ON FUNCTION create_candidate_with_authorization_and_audit(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_candidate_authorization(VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_match_status_event(VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_candidate_with_authorization_and_audit(JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_candidate_authorization(VARCHAR, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION append_match_status_event(VARCHAR, VARCHAR, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION accept_organization_invitation(
  p_token_hash VARCHAR,
  p_email VARCHAR,
  p_password_hash VARCHAR,
  p_name VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invitation organization_invitations%ROWTYPE;
  created_user users%ROWTYPE;
BEGIN
  SELECT *
  INTO invitation
  FROM organization_invitations
  WHERE token_hash = p_token_hash
    AND lower(email) = lower(p_email)
    AND accepted_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation invalid, expired, or already used';
  END IF;

  INSERT INTO users (
    organization_id,
    email,
    password_hash,
    name,
    role,
    company
  )
  SELECT
    invitation.organization_id,
    lower(p_email),
    p_password_hash,
    p_name,
    invitation.role,
    organizations.name
  FROM organizations
  WHERE organizations.id = invitation.organization_id
    AND organizations.is_active = true
  RETURNING * INTO created_user;

  IF created_user.id IS NULL THEN
    RAISE EXCEPTION 'invitation organization is inactive';
  END IF;

  INSERT INTO organization_members (
    organization_id,
    user_id,
    role
  ) VALUES (
    invitation.organization_id,
    created_user.id,
    invitation.role
  );

  UPDATE organization_invitations
  SET accepted_at = NOW()
  WHERE id = invitation.id;

  RETURN jsonb_build_object(
    'id', created_user.id,
    'email', created_user.email,
    'name', created_user.name,
    'role', invitation.role,
    'organization_id', invitation.organization_id
  );
END
$$;

REVOKE ALL ON FUNCTION accept_organization_invitation(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_organization_invitation(VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO service_role;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE boss_search_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE boss_contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_batch_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_batch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_batch_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_batch_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_tenant_select ON organizations;
CREATE POLICY organizations_tenant_select ON organizations
  FOR SELECT TO authenticated
  USING (id = current_organization_id());

DROP POLICY IF EXISTS users_self_access ON users;
CREATE POLICY users_self_access ON users
  FOR ALL TO authenticated
  USING (id = current_app_user_id() AND organization_id = current_organization_id())
  WITH CHECK (id = current_app_user_id() AND organization_id = current_organization_id());

DROP POLICY IF EXISTS organization_members_tenant_select ON organization_members;
CREATE POLICY organization_members_tenant_select ON organization_members
  FOR SELECT TO authenticated
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS organization_invitations_admin_access ON organization_invitations;
CREATE POLICY organization_invitations_admin_access ON organization_invitations
  FOR ALL TO authenticated
  USING (
    organization_id = current_organization_id()
    AND current_app_role() = 'admin'
  )
  WITH CHECK (
    organization_id = current_organization_id()
    AND current_app_role() = 'admin'
  );

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'job_requirements',
    'candidates',
    'match_records',
    'search_records',
    'authorization_records',
    'audit_logs',
    'boss_search_tasks',
    'boss_contact_requests',
    'resume_batch_sheets',
    'resume_batch_tasks'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO authenticated USING (organization_id = current_organization_id()) WITH CHECK (organization_id = current_organization_id())',
      table_name
    );
  END LOOP;
END
$$;

DROP POLICY IF EXISTS match_status_events_tenant_select ON match_status_events;
CREATE POLICY match_status_events_tenant_select ON match_status_events
  FOR SELECT TO authenticated
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS match_status_events_tenant_insert ON match_status_events;
CREATE POLICY match_status_events_tenant_insert ON match_status_events
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS resume_batch_credentials_admin_access ON resume_batch_credentials;
CREATE POLICY resume_batch_credentials_admin_access ON resume_batch_credentials
  FOR ALL TO authenticated
  USING (
    organization_id = current_organization_id()
    AND current_app_role() = 'admin'
  )
  WITH CHECK (
    organization_id = current_organization_id()
    AND current_app_role() = 'admin'
  );

DROP POLICY IF EXISTS resume_batch_settings_admin_access ON resume_batch_settings;
CREATE POLICY resume_batch_settings_admin_access ON resume_batch_settings
  FOR ALL TO authenticated
  USING (
    organization_id = current_organization_id()
    AND current_app_role() = 'admin'
  )
  WITH CHECK (
    organization_id = current_organization_id()
    AND current_app_role() = 'admin'
  );

GRANT SELECT ON organizations, organization_members TO authenticated;
REVOKE ALL ON users FROM authenticated;
GRANT SELECT (
  id,
  organization_id,
  email,
  name,
  role,
  company,
  avatar_url,
  is_active,
  last_login_at,
  created_at,
  updated_at,
  must_change_password,
  mfa_enabled
) ON users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organization_invitations,
  job_requirements,
  candidates,
  match_records,
  search_records,
  authorization_records,
  audit_logs,
  boss_search_tasks,
  boss_contact_requests,
  resume_batch_credentials,
  resume_batch_settings,
  resume_batch_sheets,
  resume_batch_tasks
TO authenticated;
REVOKE ALL ON match_status_events FROM authenticated;
GRANT SELECT, INSERT ON match_status_events TO authenticated;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS resume_batch_tenant_objects ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY resume_batch_tenant_objects ON storage.objects
      FOR ALL TO authenticated
      USING (
        bucket_id = 'resume-batch-files'
        AND split_part(name, '/', 1) = current_organization_id()
      )
      WITH CHECK (
        bucket_id = 'resume-batch-files'
        AND split_part(name, '/', 1) = current_organization_id()
      )
    $policy$;
  END IF;
END
$$;

-- ============================================
-- 14. 匹配运行版本与安全缓存
-- ============================================
ALTER TABLE match_records
  ADD COLUMN IF NOT EXISTS current_run_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS current_run_version INTEGER,
  ADD COLUMN IF NOT EXISTS match_schema_version INTEGER,
  ADD COLUMN IF NOT EXISTS scoring_input_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS weights_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS input_fingerprint VARCHAR(64);

CREATE TABLE IF NOT EXISTS match_runs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER GENERATED BY DEFAULT AS IDENTITY UNIQUE NOT NULL,
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id VARCHAR(36) NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
  candidate_id VARCHAR(36) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  match_record_id VARCHAR(36) REFERENCES match_records(id) ON DELETE SET NULL,
  execution_mode VARCHAR(20) NOT NULL CHECK (execution_mode IN ('single', 'batch')),
  trigger VARCHAR(30) NOT NULL CHECK (trigger IN ('initial', 'stale_input', 'manual_recalculate')),
  force_recalculate BOOLEAN NOT NULL DEFAULT false,
  schema_version INTEGER NOT NULL,
  input_version VARCHAR(100) NOT NULL,
  scoring_model VARCHAR(200) NOT NULL,
  weights_version VARCHAR(100) NOT NULL,
  score_weights JSONB NOT NULL,
  llm_model VARCHAR(200),
  llm_prompt_version VARCHAR(100),
  job_fingerprint VARCHAR(64) NOT NULL,
  candidate_fingerprint VARCHAR(64) NOT NULL,
  input_fingerprint VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  error TEXT,
  result_snapshot JSONB,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_records_current_run_id_fkey'
      AND conrelid = 'match_records'::regclass
  ) THEN
    ALTER TABLE match_records
      ADD CONSTRAINT match_records_current_run_id_fkey
      FOREIGN KEY (current_run_id) REFERENCES match_runs(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS match_records_current_run_id_idx ON match_records(current_run_id);
CREATE INDEX IF NOT EXISTS match_records_input_fingerprint_idx ON match_records(input_fingerprint);
CREATE INDEX IF NOT EXISTS match_runs_organization_idx ON match_runs(organization_id);
CREATE INDEX IF NOT EXISTS match_runs_job_candidate_idx ON match_runs(job_id, candidate_id);
CREATE INDEX IF NOT EXISTS match_runs_input_fingerprint_idx ON match_runs(input_fingerprint);
CREATE INDEX IF NOT EXISTS match_runs_status_idx ON match_runs(status);
CREATE INDEX IF NOT EXISTS match_runs_started_at_idx ON match_runs(started_at);

ALTER TABLE match_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON match_runs;
CREATE POLICY tenant_isolation ON match_runs
  FOR ALL TO authenticated
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON match_runs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE match_runs_version_seq TO authenticated;

-- ============================================
-- 15. 可验证授权证据链与自动化决策门禁
-- ============================================
ALTER TABLE candidates ALTER COLUMN is_authorized SET DEFAULT false;

ALTER TABLE authorization_records
  ADD COLUMN IF NOT EXISTS processing_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_reference VARCHAR(500),
  ADD COLUMN IF NOT EXISTS proof_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS proof_reference VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS proof_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS notice_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS notice_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS notice_text_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS external_processors JSONB,
  ADD COLUMN IF NOT EXISTS automated_decision_disclosed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS automated_decision_preference VARCHAR(30),
  ADD COLUMN IF NOT EXISTS automated_decision_objected_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS automated_decision_objection_reference VARCHAR(500),
  ADD COLUMN IF NOT EXISTS automated_decision_objected_by_user_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS impact_assessment_reference VARCHAR(500),
  ADD COLUMN IF NOT EXISTS impact_assessment_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS collected_by_user_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS collection_context_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS evidence_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS evidence_status VARCHAR(30) NOT NULL DEFAULT 'legacy_unverified';

UPDATE authorization_records
SET
  authorized_at = COALESCE(authorized_at, created_at, NOW()),
  is_active = COALESCE(is_active, false),
  evidence_status = COALESCE(evidence_status, 'legacy_unverified');

ALTER TABLE authorization_records
  ALTER COLUMN authorized_at SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN evidence_status SET DEFAULT 'legacy_unverified',
  ALTER COLUMN evidence_status SET NOT NULL;

DROP INDEX IF EXISTS authorization_records_candidate_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS authorization_records_candidate_active_unique
  ON authorization_records(candidate_id)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS authorization_records_expiry_idx
  ON authorization_records(processing_expires_at);
CREATE INDEX IF NOT EXISTS authorization_records_evidence_status_idx
  ON authorization_records(evidence_status);

ALTER TABLE authorization_records
  DROP CONSTRAINT IF EXISTS authorization_records_evidence_status_check,
  ADD CONSTRAINT authorization_records_evidence_status_check
    CHECK (evidence_status IN ('legacy_unverified', 'verified', 'invalid')),
  DROP CONSTRAINT IF EXISTS authorization_records_processing_window_check,
  ADD CONSTRAINT authorization_records_processing_window_check
    CHECK (
      processing_expires_at IS NULL
      OR processing_expires_at > authorized_at
    ),
  DROP CONSTRAINT IF EXISTS authorization_records_verified_evidence_check,
  ADD CONSTRAINT authorization_records_verified_evidence_check
    CHECK (
      evidence_status <> 'verified'
      OR (
        source_type IS NOT NULL
        AND source_reference IS NOT NULL
        AND proof_type IS NOT NULL
        AND proof_reference IS NOT NULL
        AND notice_version IS NOT NULL
        AND notice_snapshot IS NOT NULL
        AND notice_text_sha256 ~ '^[0-9a-f]{64}$'
        AND processing_expires_at IS NOT NULL
        AND jsonb_typeof(external_processors) = 'array'
        AND jsonb_array_length(external_processors) > 0
        AND automated_decision_disclosed = true
        AND automated_decision_preference IN ('assistive', 'human_review_only')
        AND collected_by_user_id IS NOT NULL
        AND collection_context_sha256 ~ '^[0-9a-f]{64}$'
        AND evidence_sha256 ~ '^[0-9a-f]{64}$'
        AND (
          automated_decision_preference = 'human_review_only'
          OR (
            impact_assessment_reference IS NOT NULL
            AND impact_assessment_completed_at IS NOT NULL
          )
        )
      )
    );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'authorization_records_collected_by_user_id_fkey'
      AND conrelid = 'authorization_records'::regclass
  ) THEN
    ALTER TABLE authorization_records
      ADD CONSTRAINT authorization_records_collected_by_user_id_fkey
      FOREIGN KEY (collected_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'authorization_records_automated_decision_objected_by_fkey'
      AND conrelid = 'authorization_records'::regclass
  ) THEN
    ALTER TABLE authorization_records
      ADD CONSTRAINT authorization_records_automated_decision_objected_by_fkey
      FOREIGN KEY (automated_decision_objected_by_user_id)
      REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION record_automated_decision_objection(
  p_candidate_id VARCHAR,
  p_request_reference VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_objected_at TIMESTAMP WITH TIME ZONE := NOW();
  v_authorization_id VARCHAR(36);
  v_deleted_match_count INTEGER := 0;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '28000';
  END IF;
  IF p_request_reference IS NULL OR trim(p_request_reference) = '' THEN
    RAISE EXCEPTION 'request reference is required' USING ERRCODE = '22023';
  END IF;

  UPDATE authorization_records
  SET
    automated_decision_objected_at = v_objected_at,
    automated_decision_objection_reference = p_request_reference,
    automated_decision_objected_by_user_id = v_user_id
  WHERE candidate_id = p_candidate_id
    AND organization_id = v_organization_id
    AND is_active = true
    AND evidence_status = 'verified'
  RETURNING id INTO v_authorization_id;

  IF v_authorization_id IS NULL THEN
    RAISE EXCEPTION 'verified authorization not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM match_records
  WHERE candidate_id = p_candidate_id
    AND organization_id = v_organization_id;
  GET DIAGNOSTICS v_deleted_match_count = ROW_COUNT;

  INSERT INTO audit_logs (
    organization_id,
    user_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_organization_id,
    v_user_id,
    'object_automated_decision',
    'candidate',
    p_candidate_id,
    jsonb_build_object(
      'authorization_record_id', v_authorization_id,
      'request_reference', p_request_reference,
      'match_records_removed', v_deleted_match_count,
      'personal_identifiers_logged', false
    )
  );

  RETURN jsonb_build_object(
    'authorization_record_id', v_authorization_id,
    'objected_at', v_objected_at,
    'match_records_removed', v_deleted_match_count
  );
END
$$;

REVOKE ALL ON FUNCTION record_automated_decision_objection(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_automated_decision_objection(VARCHAR, VARCHAR) TO authenticated;

-- 授权证据正文只允许追加；普通会话只能更新撤回或自动化决策异议状态。
REVOKE UPDATE, DELETE ON authorization_records FROM authenticated;
GRANT UPDATE (
  revoked_at,
  is_active,
  automated_decision_objected_at,
  automated_decision_objection_reference,
  automated_decision_objected_by_user_id
) ON authorization_records TO authenticated;

-- 审计事件为追加式记录，禁止普通会话事后改写或删除。
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated;

-- ============================================
-- 招聘决策副驾驶：增量领域模型
-- ============================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(100),
  ADD COLUMN IF NOT EXISTS metrics_enabled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS ai_execution_mode VARCHAR(30),
  ADD COLUMN IF NOT EXISTS approved_cloud_processors JSONB;
UPDATE organizations
SET
  timezone = COALESCE(timezone, 'Asia/Shanghai'),
  metrics_enabled_at = COALESCE(metrics_enabled_at, NOW()),
  ai_execution_mode = COALESCE(ai_execution_mode, 'rules_only'),
  approved_cloud_processors = COALESCE(approved_cloud_processors, '[]'::JSONB);
ALTER TABLE organizations
  ALTER COLUMN timezone SET DEFAULT 'Asia/Shanghai',
  ALTER COLUMN timezone SET NOT NULL,
  ALTER COLUMN metrics_enabled_at SET DEFAULT NOW(),
  ALTER COLUMN metrics_enabled_at SET NOT NULL,
  ALTER COLUMN ai_execution_mode SET DEFAULT 'rules_only',
  ALTER COLUMN ai_execution_mode SET NOT NULL,
  ALTER COLUMN approved_cloud_processors SET DEFAULT '[]'::JSONB,
  ALTER COLUMN approved_cloud_processors SET NOT NULL,
  DROP CONSTRAINT IF EXISTS organizations_ai_execution_mode_check,
  ADD CONSTRAINT organizations_ai_execution_mode_check
    CHECK (ai_execution_mode IN ('rules_only', 'private_endpoint', 'approved_cloud')),
  DROP CONSTRAINT IF EXISTS organizations_approved_cloud_processors_check,
  ADD CONSTRAINT organizations_approved_cloud_processors_check
    CHECK (jsonb_typeof(approved_cloud_processors) = 'array');

ALTER TABLE job_requirements
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS external_status VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_requirements_owner_user_id_fkey'
      AND conrelid = 'job_requirements'::regclass
  ) THEN
    ALTER TABLE job_requirements
      ADD CONSTRAINT job_requirements_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS job_requirements_owner_idx
  ON job_requirements(organization_id, owner_user_id);
CREATE INDEX IF NOT EXISTS job_requirements_activated_idx
  ON job_requirements(organization_id, activated_at);

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS analytics_subject_id VARCHAR(36);
UPDATE candidates
SET analytics_subject_id = gen_random_uuid()
WHERE analytics_subject_id IS NULL;
ALTER TABLE candidates
  ALTER COLUMN analytics_subject_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN analytics_subject_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS candidates_organization_analytics_subject_unique
  ON candidates(organization_id, analytics_subject_id);

ALTER TABLE match_runs
  ADD COLUMN IF NOT EXISTS ai_mode VARCHAR(30);
UPDATE match_runs
SET ai_mode = 'legacy_unknown'
WHERE ai_mode IS NULL;
ALTER TABLE match_runs
  ALTER COLUMN ai_mode SET DEFAULT 'rules_only',
  ALTER COLUMN ai_mode SET NOT NULL,
  DROP CONSTRAINT IF EXISTS match_runs_ai_mode_check,
  ADD CONSTRAINT match_runs_ai_mode_check
    CHECK (ai_mode IN ('legacy_unknown', 'rules_only', 'private_endpoint', 'approved_cloud'));

ALTER TABLE match_status_events
  ADD COLUMN IF NOT EXISTS decision_source VARCHAR(30),
  ADD COLUMN IF NOT EXISTS reason_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS client_event_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP WITH TIME ZONE;
UPDATE match_status_events
SET
  decision_source = COALESCE(decision_source, 'legacy'),
  occurred_at = COALESCE(occurred_at, created_at);
ALTER TABLE match_status_events
  ALTER COLUMN decision_source SET DEFAULT 'human',
  ALTER COLUMN decision_source SET NOT NULL,
  ALTER COLUMN occurred_at SET DEFAULT NOW(),
  ALTER COLUMN occurred_at SET NOT NULL,
  DROP CONSTRAINT IF EXISTS match_status_events_decision_source_check,
  ADD CONSTRAINT match_status_events_decision_source_check
    CHECK (decision_source IN ('legacy', 'human', 'authorized_ats', 'admin_correction'));
CREATE UNIQUE INDEX IF NOT EXISTS match_status_events_organization_client_event_unique
  ON match_status_events(organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_connections (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  connector_type VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'disabled',
  capabilities JSONB NOT NULL DEFAULT '[]'::JSONB,
  data_boundary_mode VARCHAR(30) NOT NULL DEFAULT 'tenant_private',
  model_endpoint_classification VARCHAR(30) NOT NULL DEFAULT 'none',
  external_processors JSONB NOT NULL DEFAULT '[]'::JSONB,
  configuration_encrypted TEXT,
  webhook_secret_encrypted TEXT,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_connections_status_check
    CHECK (status IN ('disabled', 'enabled', 'error')),
  CONSTRAINT integration_connections_capabilities_check
    CHECK (jsonb_typeof(capabilities) = 'array' AND jsonb_typeof(external_processors) = 'array'),
  CONSTRAINT integration_connections_boundary_check
    CHECK (data_boundary_mode IN ('tenant_private', 'customer_network', 'approved_external')),
  CONSTRAINT integration_connections_model_endpoint_check
    CHECK (model_endpoint_classification IN ('none', 'private', 'approved_cloud'))
);
ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS data_boundary_mode VARCHAR(30) NOT NULL DEFAULT 'tenant_private',
  ADD COLUMN IF NOT EXISTS model_endpoint_classification VARCHAR(30) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS external_processors JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE integration_connections
  DROP CONSTRAINT IF EXISTS integration_connections_boundary_check,
  ADD CONSTRAINT integration_connections_boundary_check
    CHECK (data_boundary_mode IN ('tenant_private', 'customer_network', 'approved_external')),
  DROP CONSTRAINT IF EXISTS integration_connections_model_endpoint_check,
  ADD CONSTRAINT integration_connections_model_endpoint_check
    CHECK (model_endpoint_classification IN ('none', 'private', 'approved_cloud'));
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_organization_name_unique
  ON integration_connections(organization_id, name);
CREATE INDEX IF NOT EXISTS integration_connections_organization_idx
  ON integration_connections(organization_id);

CREATE TABLE IF NOT EXISTS external_entity_links (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id VARCHAR(36) NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  external_id VARCHAR(500) NOT NULL,
  local_entity_id VARCHAR(36) NOT NULL,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT external_entity_links_entity_type_check
    CHECK (entity_type IN ('job', 'candidate', 'outcome'))
);
CREATE UNIQUE INDEX IF NOT EXISTS external_entity_links_source_unique
  ON external_entity_links(integration_id, entity_type, external_id);
CREATE INDEX IF NOT EXISTS external_entity_links_local_idx
  ON external_entity_links(organization_id, entity_type, local_entity_id);

CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id VARCHAR(36) NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  direction VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  cursor_before TEXT,
  cursor_after TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  requested_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_sync_runs_direction_check
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT integration_sync_runs_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT integration_sync_runs_counts_check
    CHECK (
      processed_count >= 0 AND succeeded_count >= 0
      AND skipped_count >= 0 AND failed_count >= 0
    )
);
CREATE INDEX IF NOT EXISTS integration_sync_runs_connection_created_idx
  ON integration_sync_runs(integration_id, created_at);
CREATE INDEX IF NOT EXISTS integration_sync_runs_organization_status_idx
  ON integration_sync_runs(organization_id, status);

CREATE TABLE IF NOT EXISTS shortlist_runs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id VARCHAR(36) NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
  requested_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  request_client_event_id VARCHAR(36) NOT NULL,
  source_match_batch_task_id VARCHAR(36) REFERENCES match_batch_tasks(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  candidate_count INTEGER NOT NULL DEFAULT 0,
  top_n INTEGER NOT NULL DEFAULT 10,
  scoring_schema_version INTEGER NOT NULL DEFAULT 1,
  scoring_weights_version VARCHAR(100) NOT NULL DEFAULT 'match-weights-v1',
  confidence_formula_version VARCHAR(100) NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  review_started_at TIMESTAMP WITH TIME ZONE,
  qualified_at TIMESTAMP WITH TIME ZONE,
  qualified_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  qualification_client_event_id VARCHAR(36),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT shortlist_runs_status_check
    CHECK (status IN ('pending', 'running', 'ready', 'failed')),
  CONSTRAINT shortlist_runs_counts_check
    CHECK (candidate_count >= 0 AND top_n BETWEEN 1 AND 50)
);
CREATE INDEX IF NOT EXISTS shortlist_runs_organization_job_created_idx
  ON shortlist_runs(organization_id, job_id, created_at);
CREATE INDEX IF NOT EXISTS shortlist_runs_status_idx ON shortlist_runs(status);
CREATE UNIQUE INDEX IF NOT EXISTS shortlist_runs_source_batch_unique
  ON shortlist_runs(source_match_batch_task_id)
  WHERE source_match_batch_task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shortlist_runs_request_client_event_unique
  ON shortlist_runs(organization_id, request_client_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS shortlist_runs_qualification_client_event_unique
  ON shortlist_runs(organization_id, qualification_client_event_id)
  WHERE qualification_client_event_id IS NOT NULL;
ALTER TABLE shortlist_runs
  ADD COLUMN IF NOT EXISTS scoring_weights_version VARCHAR(100) NOT NULL DEFAULT 'match-weights-v1';

CREATE TABLE IF NOT EXISTS shortlist_entries (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shortlist_run_id VARCHAR(36) NOT NULL REFERENCES shortlist_runs(id) ON DELETE CASCADE,
  match_record_id VARCHAR(36) REFERENCES match_records(id) ON DELETE SET NULL,
  candidate_id VARCHAR(36) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  analytics_subject_id VARCHAR(36) NOT NULL,
  rank INTEGER NOT NULL,
  recommendation_band VARCHAR(40) NOT NULL,
  confidence_score INTEGER NOT NULL,
  confidence_breakdown JSONB NOT NULL,
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::JSONB,
  missing_information JSONB NOT NULL DEFAULT '[]'::JSONB,
  human_decision VARCHAR(30) NOT NULL DEFAULT 'unreviewed',
  override_reason_code VARCHAR(100),
  override_note TEXT,
  reviewed_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT shortlist_entries_rank_positive CHECK (rank > 0),
  CONSTRAINT shortlist_entries_confidence_bounds CHECK (confidence_score BETWEEN 0 AND 100),
  CONSTRAINT shortlist_entries_band_check
    CHECK (recommendation_band IN ('strong', 'consider', 'insufficient_information')),
  CONSTRAINT shortlist_entries_decision_check
    CHECK (human_decision IN ('unreviewed', 'accepted', 'needs_information', 'overridden')),
  CONSTRAINT shortlist_entries_json_check
    CHECK (
      jsonb_typeof(confidence_breakdown) = 'object'
      AND jsonb_typeof(evidence_snapshot) = 'array'
      AND jsonb_typeof(missing_information) = 'array'
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS shortlist_entries_run_candidate_unique
  ON shortlist_entries(shortlist_run_id, candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS shortlist_entries_run_rank_unique
  ON shortlist_entries(shortlist_run_id, rank);
CREATE INDEX IF NOT EXISTS shortlist_entries_organization_decision_idx
  ON shortlist_entries(organization_id, human_decision);

CREATE TABLE IF NOT EXISTS recommendation_decision_events (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shortlist_entry_id VARCHAR(36) REFERENCES shortlist_entries(id) ON DELETE SET NULL,
  analytics_subject_id VARCHAR(36) NOT NULL,
  job_id_snapshot VARCHAR(36) NOT NULL,
  recruiter_user_id_snapshot VARCHAR(36),
  department_snapshot VARCHAR(100),
  decision VARCHAR(30) NOT NULL,
  previous_decision VARCHAR(30),
  reason_code VARCHAR(100),
  note TEXT,
  client_event_id VARCHAR(36) NOT NULL,
  actor_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT recommendation_decision_events_decision_check
    CHECK (decision IN ('accepted', 'needs_information', 'overridden')),
  CONSTRAINT recommendation_decision_events_previous_check
    CHECK (previous_decision IS NULL OR previous_decision IN ('unreviewed', 'accepted', 'needs_information', 'overridden')),
  CONSTRAINT recommendation_decision_events_override_check
    CHECK (
      decision <> 'overridden'
      OR (
        reason_code IN ('missing_context', 'business_constraint', 'incorrect_evidence', 'stale_data', 'candidate_preference', 'other')
        AND (reason_code <> 'other' OR NULLIF(trim(note), '') IS NOT NULL)
      )
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS recommendation_decision_events_client_unique
  ON recommendation_decision_events(organization_id, client_event_id);
CREATE INDEX IF NOT EXISTS recommendation_decision_events_entry_recorded_idx
  ON recommendation_decision_events(shortlist_entry_id, recorded_at);
CREATE INDEX IF NOT EXISTS recommendation_decision_events_metrics_idx
  ON recommendation_decision_events(organization_id, occurred_at);

CREATE TABLE IF NOT EXISTS recruiting_outcome_events (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id VARCHAR(36) REFERENCES job_requirements(id) ON DELETE SET NULL,
  candidate_id VARCHAR(36) REFERENCES candidates(id) ON DELETE SET NULL,
  match_record_id VARCHAR(36) REFERENCES match_records(id) ON DELETE SET NULL,
  analytics_subject_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  target_stage VARCHAR(20),
  source VARCHAR(30) NOT NULL,
  client_event_id VARCHAR(36),
  integration_id VARCHAR(36) REFERENCES integration_connections(id) ON DELETE SET NULL,
  external_event_id VARCHAR(200),
  supersedes_event_id VARCHAR(36) REFERENCES recruiting_outcome_events(id) ON DELETE RESTRICT,
  reason_code VARCHAR(100),
  note TEXT,
  recruiter_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  recruiter_user_id_snapshot VARCHAR(36),
  department_snapshot VARCHAR(100),
  job_id_snapshot VARCHAR(36) NOT NULL,
  job_title_snapshot VARCHAR(200),
  definition_version VARCHAR(100) NOT NULL DEFAULT 'recruiting-outcome-v1',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT recruiting_outcome_events_type_check
    CHECK (event_type IN (
      'outreach_sent', 'candidate_replied', 'interview_scheduled',
      'interview_completed', 'qualified_interview', 'offer', 'hired',
      'rejected', 'withdrawn', 'complaint', 'stage_corrected'
    )),
  CONSTRAINT recruiting_outcome_events_source_check
    CHECK (source IN ('human', 'authorized_ats', 'import', 'admin_correction')),
  CONSTRAINT recruiting_outcome_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT recruiting_outcome_events_idempotency_check
    CHECK (
      (source IN ('human', 'import', 'admin_correction') AND client_event_id IS NOT NULL)
      OR (source = 'authorized_ats' AND integration_id IS NOT NULL AND external_event_id IS NOT NULL)
    ),
  CONSTRAINT recruiting_outcome_events_correction_check
    CHECK (
      (event_type = 'stage_corrected' AND source = 'admin_correction' AND supersedes_event_id IS NOT NULL AND target_stage IS NOT NULL AND NULLIF(trim(reason_code), '') IS NOT NULL)
      OR (event_type <> 'stage_corrected' AND target_stage IS NULL AND supersedes_event_id IS NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS recruiting_outcome_events_client_unique
  ON recruiting_outcome_events(organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recruiting_outcome_events_external_unique
  ON recruiting_outcome_events(organization_id, integration_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recruiting_outcome_events_supersedes_unique
  ON recruiting_outcome_events(supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS recruiting_outcome_events_metrics_idx
  ON recruiting_outcome_events(organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS recruiting_outcome_events_subject_job_idx
  ON recruiting_outcome_events(organization_id, analytics_subject_id, job_id_snapshot);

CREATE TABLE IF NOT EXISTS candidate_rights_requests (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id VARCHAR(36) REFERENCES candidates(id) ON DELETE SET NULL,
  analytics_subject_id VARCHAR(36) NOT NULL,
  request_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  source_reference VARCHAR(500),
  resolution_reference VARCHAR(500),
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  due_at TIMESTAMP WITH TIME ZONE NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT candidate_rights_requests_type_check
    CHECK (request_type IN ('withdraw', 'delete', 'explain', 'object', 'complaint')),
  CONSTRAINT candidate_rights_requests_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved', 'rejected')),
  CONSTRAINT candidate_rights_requests_resolution_check
    CHECK ((status = 'resolved' AND resolved_at IS NOT NULL) OR status <> 'resolved')
);
CREATE INDEX IF NOT EXISTS candidate_rights_requests_organization_due_idx
  ON candidate_rights_requests(organization_id, due_at);
CREATE INDEX IF NOT EXISTS candidate_rights_requests_candidate_idx
  ON candidate_rights_requests(candidate_id);

CREATE TABLE IF NOT EXISTS communication_briefs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shortlist_entry_id VARCHAR(36) NOT NULL REFERENCES shortlist_entries(id) ON DELETE CASCADE,
  generated_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  prompt_version VARCHAR(100) NOT NULL,
  ai_mode VARCHAR(30) NOT NULL,
  candidate_value_points JSONB NOT NULL DEFAULT '[]'::JSONB,
  facts_to_verify JSONB NOT NULL DEFAULT '[]'::JSONB,
  interview_questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  prohibited_claims JSONB NOT NULL DEFAULT '[]'::JSONB,
  draft_message TEXT NOT NULL,
  review_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  reviewed_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_briefs_ai_mode_check
    CHECK (ai_mode IN ('rules_only', 'private_endpoint', 'approved_cloud')),
  CONSTRAINT communication_briefs_review_status_check
    CHECK (review_status IN ('draft', 'approved', 'rejected')),
  CONSTRAINT communication_briefs_json_check
    CHECK (
      jsonb_typeof(candidate_value_points) = 'array'
      AND jsonb_typeof(facts_to_verify) = 'array'
      AND jsonb_typeof(interview_questions) = 'array'
      AND jsonb_typeof(prohibited_claims) = 'array'
    )
);
CREATE INDEX IF NOT EXISTS communication_briefs_entry_created_idx
  ON communication_briefs(shortlist_entry_id, generated_at);
CREATE INDEX IF NOT EXISTS communication_briefs_organization_review_idx
  ON communication_briefs(organization_id, review_status);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id VARCHAR(36) NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  analytics_subject_id VARCHAR(36),
  outcome_event_id VARCHAR(36) REFERENCES recruiting_outcome_events(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  payload_encrypted TEXT NOT NULL,
  payload_fingerprint VARCHAR(64),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  client_event_id VARCHAR(36) NOT NULL,
  approved_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  external_receipt JSONB,
  worker_id VARCHAR(100),
  lease_until TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_outbox_status_check
    CHECK (status IN ('pending', 'sending', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT integration_outbox_attempt_check CHECK (attempt_count >= 0),
  CONSTRAINT integration_outbox_receipt_check
    CHECK (external_receipt IS NULL OR jsonb_typeof(external_receipt) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_client_unique
  ON integration_outbox(organization_id, client_event_id);
CREATE INDEX IF NOT EXISTS integration_outbox_status_retry_idx
  ON integration_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS integration_outbox_connection_created_idx
  ON integration_outbox(integration_id, created_at);

CREATE TABLE IF NOT EXISTS scoring_weight_versions (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  weights JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'inactive',
  approved_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT scoring_weight_versions_status_check CHECK (status IN ('inactive', 'active')),
  CONSTRAINT scoring_weight_versions_weights_check CHECK (jsonb_typeof(weights) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS scoring_weight_versions_organization_version_unique
  ON scoring_weight_versions(organization_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS scoring_weight_versions_one_active
  ON scoring_weight_versions(organization_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS calibration_proposals (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  reviewed_entries INTEGER NOT NULL,
  outreach_events INTEGER NOT NULL,
  completed_interviews INTEGER NOT NULL,
  metrics_snapshot JSONB NOT NULL,
  proposed_weights JSONB NOT NULL,
  rationale TEXT NOT NULL,
  source_weights_version_id VARCHAR(36) REFERENCES scoring_weight_versions(id) ON DELETE SET NULL,
  approved_weights_version_id VARCHAR(36) REFERENCES scoring_weight_versions(id) ON DELETE SET NULL,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT calibration_proposals_status_check
    CHECK (status IN ('draft', 'approved', 'rejected')),
  CONSTRAINT calibration_proposals_samples_check
    CHECK (reviewed_entries >= 100 AND outreach_events >= 30 AND completed_interviews >= 10),
  CONSTRAINT calibration_proposals_json_check
    CHECK (jsonb_typeof(metrics_snapshot) = 'object' AND jsonb_typeof(proposed_weights) = 'object')
);
CREATE INDEX IF NOT EXISTS calibration_proposals_organization_created_idx
  ON calibration_proposals(organization_id, created_at);
CREATE INDEX IF NOT EXISTS calibration_proposals_status_idx
  ON calibration_proposals(status);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
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
    'calibration_proposals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_select', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (organization_id = current_organization_id())',
      table_name || '_tenant_select',
      table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON
  integration_connections,
  external_entity_links,
  integration_sync_runs,
  shortlist_runs,
  shortlist_entries,
  recommendation_decision_events,
  recruiting_outcome_events,
  candidate_rights_requests,
  communication_briefs,
  integration_outbox,
  scoring_weight_versions,
  calibration_proposals
FROM authenticated;

GRANT SELECT ON
  external_entity_links,
  integration_sync_runs,
  shortlist_runs,
  shortlist_entries,
  recommendation_decision_events,
  recruiting_outcome_events,
  candidate_rights_requests,
  communication_briefs,
  scoring_weight_versions,
  calibration_proposals
TO authenticated;

GRANT SELECT (
  id, organization_id, name, connector_type, status, capabilities,
  data_boundary_mode, model_endpoint_classification, external_processors,
  created_by, last_sync_at, created_at, updated_at
) ON integration_connections TO authenticated;

GRANT SELECT (
  id, organization_id, integration_id, analytics_subject_id, action_type,
  status, client_event_id, approved_by, approved_at, attempt_count,
  next_attempt_at, last_error, external_receipt, completed_at, created_at, updated_at
) ON integration_outbox TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  integration_connections,
  external_entity_links,
  integration_sync_runs,
  shortlist_runs,
  shortlist_entries,
  recommendation_decision_events,
  recruiting_outcome_events,
  candidate_rights_requests,
  communication_briefs,
  integration_outbox,
  scoring_weight_versions,
  calibration_proposals
TO service_role;

-- ============================================
-- 招聘决策副驾驶：事务写入门禁
-- ============================================

CREATE OR REPLACE FUNCTION create_shortlist_batch(
  p_job_id VARCHAR,
  p_candidate_ids JSONB,
  p_top_n INTEGER,
  p_client_event_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_existing shortlist_runs%ROWTYPE;
  v_task match_batch_tasks%ROWTYPE;
  v_run shortlist_runs%ROWTYPE;
  v_candidate_limit INTEGER;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_client_event_id IS NULL OR trim(p_client_event_id) = '' THEN
    RAISE EXCEPTION 'client event id is required' USING ERRCODE = '22023';
  END IF;
  IF p_top_n IS NULL OR p_top_n NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'top_n must be between 1 and 50' USING ERRCODE = '22023';
  END IF;
  IF p_candidate_ids IS NOT NULL AND (
    jsonb_typeof(p_candidate_ids) <> 'array'
    OR jsonb_array_length(p_candidate_ids) NOT BETWEEN 1 AND 100
  ) THEN
    RAISE EXCEPTION 'candidate_ids must contain 1 to 100 ids' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM shortlist_runs
  WHERE organization_id = v_organization_id
    AND request_client_event_id = p_client_event_id;
  IF FOUND THEN
    IF v_existing.job_id <> p_job_id
      OR v_existing.top_n <> p_top_n
      OR (
        SELECT task.candidate_ids
        FROM match_batch_tasks AS task
        WHERE task.id = v_existing.source_match_batch_task_id
      ) IS DISTINCT FROM p_candidate_ids THEN
      RAISE EXCEPTION 'client event id payload conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'shortlist_run_id', v_existing.id,
      'task_id', v_existing.source_match_batch_task_id,
      'status', v_existing.status,
      'idempotent', true
    );
  END IF;

  PERFORM 1 FROM job_requirements
  WHERE id = p_job_id
    AND organization_id = v_organization_id
    AND status = 'active'
    AND activated_at IS NOT NULL
    AND closed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job is not active' USING ERRCODE = 'P0002';
  END IF;

  v_candidate_limit := CASE
    WHEN p_candidate_ids IS NULL THEN 100
    ELSE jsonb_array_length(p_candidate_ids)
  END;

  INSERT INTO match_batch_tasks (
    organization_id, user_id, job_id, candidate_ids,
    candidate_limit, top_n, status
  ) VALUES (
    v_organization_id,
    v_user_id,
    p_job_id,
    p_candidate_ids,
    v_candidate_limit,
    p_top_n,
    'pending'
  ) RETURNING * INTO v_task;

  INSERT INTO shortlist_runs (
    organization_id, job_id, requested_by, request_client_event_id,
    source_match_batch_task_id, status, top_n, confidence_formula_version
  ) VALUES (
    v_organization_id,
    p_job_id,
    v_user_id,
    p_client_event_id,
    v_task.id,
    'pending',
    p_top_n,
    'shortlist-confidence-v1'
  ) RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'shortlist_run_id', v_run.id,
    'task_id', v_task.id,
    'status', v_run.status,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION finalize_shortlist_run(
  p_organization_id VARCHAR,
  p_shortlist_run_id VARCHAR,
  p_entries JSONB,
  p_candidate_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run shortlist_runs%ROWTYPE;
  v_entry JSONB;
  v_evidence JSONB;
  v_candidate candidates%ROWTYPE;
  v_inserted INTEGER := 0;
BEGIN
  IF p_organization_id IS NULL OR p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'organization and entries are required' USING ERRCODE = '22023';
  END IF;
  IF p_candidate_count IS NULL OR p_candidate_count < 0 THEN
    RAISE EXCEPTION 'candidate_count is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM shortlist_runs
  WHERE id = p_shortlist_run_id
    AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shortlist run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status = 'ready' THEN
    RETURN jsonb_build_object('shortlist_run_id', v_run.id, 'status', 'ready', 'idempotent', true);
  END IF;
  IF v_run.status NOT IN ('pending', 'running') THEN
    RAISE EXCEPTION 'shortlist run is not finalizable' USING ERRCODE = '55000';
  END IF;
  IF jsonb_array_length(p_entries) > v_run.top_n THEN
    RAISE EXCEPTION 'entry count exceeds top_n' USING ERRCODE = '22023';
  END IF;

  DELETE FROM shortlist_entries WHERE shortlist_run_id = v_run.id;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    SELECT candidate.* INTO v_candidate
    FROM candidates AS candidate
    JOIN authorization_records AS candidate_authorization
      ON candidate_authorization.candidate_id = candidate.id
     AND candidate_authorization.organization_id = candidate.organization_id
     AND candidate_authorization.is_active = true
     AND candidate_authorization.evidence_status = 'verified'
     AND candidate_authorization.automated_decision_preference = 'assistive'
     AND candidate_authorization.automated_decision_objected_at IS NULL
     AND candidate_authorization.processing_expires_at > NOW()
    WHERE candidate.id = v_entry->>'candidate_id'
      AND candidate.organization_id = p_organization_id
      AND candidate.is_authorized = true;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(COALESCE(v_entry->'evidence_snapshot', '[]'::JSONB)) <> 'array'
      OR jsonb_typeof(COALESCE(v_entry->'missing_information', '[]'::JSONB)) <> 'array'
      OR jsonb_typeof(v_entry->'confidence_breakdown') <> 'object' THEN
      RAISE EXCEPTION 'shortlist entry JSON is invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_evidence IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_entry->'evidence_snapshot', '[]'::JSONB))
    LOOP
      IF char_length(COALESCE(v_evidence->>'candidate_excerpt', '')) > 200
        OR char_length(COALESCE(v_evidence->>'job_excerpt', '')) > 200 THEN
        RAISE EXCEPTION 'evidence excerpt exceeds 200 characters' USING ERRCODE = '22023';
      END IF;
    END LOOP;

    INSERT INTO shortlist_entries (
      organization_id, shortlist_run_id, match_record_id, candidate_id,
      analytics_subject_id, rank, recommendation_band, confidence_score,
      confidence_breakdown, evidence_snapshot, missing_information
    ) VALUES (
      p_organization_id,
      v_run.id,
      NULLIF(v_entry->>'match_record_id', ''),
      v_candidate.id,
      v_candidate.analytics_subject_id,
      (v_entry->>'rank')::INTEGER,
      v_entry->>'recommendation_band',
      (v_entry->>'confidence_score')::INTEGER,
      v_entry->'confidence_breakdown',
      COALESCE(v_entry->'evidence_snapshot', '[]'::JSONB),
      COALESCE(v_entry->'missing_information', '[]'::JSONB)
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE shortlist_runs
  SET
    status = 'ready',
    candidate_count = p_candidate_count,
    completed_at = NOW(),
    updated_at = NOW(),
    error_message = NULL
  WHERE id = v_run.id;

  RETURN jsonb_build_object(
    'shortlist_run_id', v_run.id,
    'status', 'ready',
    'inserted_entries', v_inserted,
    'excluded_after_authorization_recheck', jsonb_array_length(p_entries) - v_inserted,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_shortlist_decision(
  p_shortlist_entry_id VARCHAR,
  p_decision VARCHAR,
  p_reason_code VARCHAR,
  p_note TEXT,
  p_client_event_id VARCHAR,
  p_occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_existing recommendation_decision_events%ROWTYPE;
  v_entry RECORD;
  v_event recommendation_decision_events%ROWTYPE;
  v_latest_event_id VARCHAR(36);
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_client_event_id IS NULL OR trim(p_client_event_id) = '' THEN
    RAISE EXCEPTION 'client event id is required' USING ERRCODE = '22023';
  END IF;
  IF p_decision NOT IN ('accepted', 'needs_information', 'overridden') THEN
    RAISE EXCEPTION 'invalid shortlist decision' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'overridden' AND (
    p_reason_code NOT IN ('missing_context', 'business_constraint', 'incorrect_evidence', 'stale_data', 'candidate_preference', 'other')
    OR (p_reason_code = 'other' AND NULLIF(trim(p_note), '') IS NULL)
  ) THEN
    RAISE EXCEPTION 'override reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM recommendation_decision_events
  WHERE organization_id = v_organization_id
    AND client_event_id = p_client_event_id;
  IF FOUND THEN
    IF v_existing.shortlist_entry_id IS DISTINCT FROM p_shortlist_entry_id
      OR v_existing.decision IS DISTINCT FROM p_decision
      OR v_existing.reason_code IS DISTINCT FROM NULLIF(p_reason_code, '')
      OR v_existing.note IS DISTINCT FROM NULLIF(p_note, '')
      OR v_existing.occurred_at IS DISTINCT FROM COALESCE(p_occurred_at, v_existing.occurred_at) THEN
      RAISE EXCEPTION 'client event id payload conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'event_id', v_existing.id,
      'shortlist_entry_id', v_existing.shortlist_entry_id,
      'decision', v_existing.decision,
      'idempotent', true
    );
  END IF;

  SELECT
    entry.*,
    run.job_id,
    job.owner_user_id,
    job.department
  INTO v_entry
  FROM shortlist_entries AS entry
  JOIN shortlist_runs AS run ON run.id = entry.shortlist_run_id
  JOIN job_requirements AS job ON job.id = run.job_id
  WHERE entry.id = p_shortlist_entry_id
    AND entry.organization_id = v_organization_id
  FOR UPDATE OF entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shortlist entry not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM authorization_records
  WHERE organization_id = v_organization_id
    AND candidate_id = v_entry.candidate_id
    AND is_active = true
    AND evidence_status = 'verified'
    AND authorized_at <= NOW()
    AND processing_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate authorization is no longer processable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO recommendation_decision_events (
    organization_id, shortlist_entry_id, analytics_subject_id,
    job_id_snapshot, recruiter_user_id_snapshot, department_snapshot,
    decision, previous_decision, reason_code, note,
    client_event_id, actor_user_id, occurred_at
  ) VALUES (
    v_organization_id,
    v_entry.id,
    v_entry.analytics_subject_id,
    v_entry.job_id,
    v_entry.owner_user_id,
    v_entry.department,
    p_decision,
    v_entry.human_decision,
    NULLIF(p_reason_code, ''),
    NULLIF(p_note, ''),
    p_client_event_id,
    v_user_id,
    COALESCE(p_occurred_at, NOW())
  ) RETURNING * INTO v_event;

  SELECT id INTO v_latest_event_id
  FROM recommendation_decision_events
  WHERE organization_id = v_organization_id
    AND shortlist_entry_id = v_entry.id
  ORDER BY occurred_at DESC, recorded_at DESC, id DESC
  LIMIT 1;

  IF v_latest_event_id = v_event.id THEN
    UPDATE shortlist_entries
    SET
      human_decision = p_decision,
      override_reason_code = CASE WHEN p_decision = 'overridden' THEN NULLIF(p_reason_code, '') ELSE NULL END,
      override_note = CASE WHEN p_decision = 'overridden' THEN NULLIF(p_note, '') ELSE NULL END,
      reviewed_by = v_user_id,
      reviewed_at = COALESCE(p_occurred_at, NOW()),
      updated_at = NOW()
    WHERE id = v_entry.id;
  END IF;

  UPDATE shortlist_runs
  SET review_started_at = COALESCE(review_started_at, NOW()), updated_at = NOW()
  WHERE id = v_entry.shortlist_run_id;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'shortlist_entry_id', v_entry.id,
    'decision', p_decision,
    'previous_decision', v_entry.human_decision,
    'effective_decision', CASE WHEN v_latest_event_id = v_event.id THEN p_decision ELSE v_entry.human_decision END,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION qualify_shortlist_run(
  p_shortlist_run_id VARCHAR,
  p_client_event_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_run shortlist_runs%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_client_event_id IS NULL OR trim(p_client_event_id) = '' THEN
    RAISE EXCEPTION 'client event id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM shortlist_runs
  WHERE id = p_shortlist_run_id
    AND organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shortlist run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'ready' THEN
    RAISE EXCEPTION 'shortlist run is not ready' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM shortlist_entries
  WHERE shortlist_run_id = v_run.id
    AND organization_id = v_organization_id
    AND human_decision = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a qualified shortlist requires at least one accepted entry' USING ERRCODE = '55000';
  END IF;
  IF v_run.qualified_at IS NOT NULL THEN
    IF v_run.qualification_client_event_id <> p_client_event_id THEN
      RAISE EXCEPTION 'shortlist qualification is write-once' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'shortlist_run_id', v_run.id,
      'qualified_at', v_run.qualified_at,
      'qualified_by', v_run.qualified_by,
      'idempotent', true
    );
  END IF;

  UPDATE shortlist_runs
  SET
    qualified_at = NOW(),
    qualified_by = v_user_id,
    qualification_client_event_id = p_client_event_id,
    review_started_at = COALESCE(review_started_at, NOW()),
    updated_at = NOW()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'shortlist_run_id', v_run.id,
    'qualified_at', v_run.qualified_at,
    'qualified_by', v_run.qualified_by,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_recruiting_outcome(
  p_match_record_id VARCHAR,
  p_event_type VARCHAR,
  p_source VARCHAR,
  p_client_event_id VARCHAR,
  p_occurred_at TIMESTAMP WITH TIME ZONE,
  p_reason_code VARCHAR DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_target_stage VARCHAR DEFAULT NULL,
  p_supersedes_event_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_existing recruiting_outcome_events%ROWTYPE;
  v_match RECORD;
  v_event recruiting_outcome_events%ROWTYPE;
  v_latest_stage_time TIMESTAMP WITH TIME ZONE;
  v_target_stage VARCHAR(20);
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_should_advance BOOLEAN := false;
  v_previous_status VARCHAR(20);
  v_rebuilt_status VARCHAR(20);
  v_rebuild_target VARCHAR(20);
  v_rebuild_event RECORD;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_source NOT IN ('human', 'admin_correction') THEN
    RAISE EXCEPTION 'invalid manual outcome source' USING ERRCODE = '22023';
  END IF;
  IF p_client_event_id IS NULL OR trim(p_client_event_id) = '' THEN
    RAISE EXCEPTION 'client event id is required' USING ERRCODE = '22023';
  END IF;
  IF p_event_type NOT IN (
    'outreach_sent', 'candidate_replied', 'interview_scheduled',
    'interview_completed', 'qualified_interview', 'offer', 'hired',
    'rejected', 'withdrawn', 'complaint', 'stage_corrected'
  ) THEN
    RAISE EXCEPTION 'invalid recruiting outcome event' USING ERRCODE = '22023';
  END IF;
  IF p_event_type IN ('rejected', 'withdrawn') AND NULLIF(trim(p_reason_code), '') IS NULL THEN
    RAISE EXCEPTION 'reason is required for terminal outcome' USING ERRCODE = '22023';
  END IF;
  IF p_event_type = 'stage_corrected' AND (
    v_role <> 'admin'
    OR p_source <> 'admin_correction'
    OR p_supersedes_event_id IS NULL
    OR p_target_stage NOT IN ('pending', 'contacted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn')
    OR NULLIF(trim(p_reason_code), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid stage correction' USING ERRCODE = '22023';
  END IF;
  IF p_event_type <> 'stage_corrected' AND (p_target_stage IS NOT NULL OR p_supersedes_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ordinary outcomes cannot carry correction fields' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM recruiting_outcome_events
  WHERE organization_id = v_organization_id
    AND client_event_id = p_client_event_id;
  IF FOUND THEN
    IF v_existing.match_record_id IS DISTINCT FROM p_match_record_id
      OR v_existing.event_type IS DISTINCT FROM p_event_type
      OR v_existing.source IS DISTINCT FROM p_source
      OR v_existing.occurred_at IS DISTINCT FROM COALESCE(p_occurred_at, v_existing.occurred_at)
      OR v_existing.reason_code IS DISTINCT FROM NULLIF(p_reason_code, '')
      OR v_existing.note IS DISTINCT FROM NULLIF(p_note, '')
      OR v_existing.target_stage IS DISTINCT FROM (CASE WHEN p_event_type = 'stage_corrected' THEN p_target_stage ELSE NULL END)
      OR v_existing.supersedes_event_id IS DISTINCT FROM (CASE WHEN p_event_type = 'stage_corrected' THEN p_supersedes_event_id ELSE NULL END) THEN
      RAISE EXCEPTION 'client event id payload conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'event_id', v_existing.id,
      'match_record_id', v_existing.match_record_id,
      'event_type', v_existing.event_type,
      'idempotent', true
    );
  END IF;

  SELECT
    match_record.*,
    candidate.analytics_subject_id,
    job.title AS job_title,
    job.department AS job_department,
    job.owner_user_id
  INTO v_match
  FROM match_records AS match_record
  JOIN candidates AS candidate
    ON candidate.id = match_record.candidate_id
   AND candidate.organization_id = match_record.organization_id
  JOIN job_requirements AS job
    ON job.id = match_record.job_id
   AND job.organization_id = match_record.organization_id
  WHERE match_record.id = p_match_record_id
    AND match_record.organization_id = v_organization_id
  FOR UPDATE OF match_record;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match record not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM authorization_records
  WHERE organization_id = v_organization_id
    AND candidate_id = v_match.candidate_id
    AND is_active = true
    AND evidence_status = 'verified'
    AND authorized_at <= NOW()
    AND processing_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate authorization is no longer processable' USING ERRCODE = '55000';
  END IF;

  IF p_event_type = 'stage_corrected' THEN
    PERFORM 1
    FROM recruiting_outcome_events
    WHERE id = p_supersedes_event_id
      AND organization_id = v_organization_id
      AND analytics_subject_id = v_match.analytics_subject_id
      AND job_id_snapshot = v_match.job_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'superseded event not found for subject' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO recruiting_outcome_events (
    organization_id, job_id, candidate_id, match_record_id,
    analytics_subject_id, event_type, target_stage, source,
    client_event_id, supersedes_event_id, reason_code, note,
    recruiter_user_id, recruiter_user_id_snapshot, department_snapshot,
    job_id_snapshot, job_title_snapshot, occurred_at
  ) VALUES (
    v_organization_id,
    v_match.job_id,
    v_match.candidate_id,
    v_match.id,
    v_match.analytics_subject_id,
    p_event_type,
    CASE WHEN p_event_type = 'stage_corrected' THEN p_target_stage ELSE NULL END,
    p_source,
    p_client_event_id,
    CASE WHEN p_event_type = 'stage_corrected' THEN p_supersedes_event_id ELSE NULL END,
    NULLIF(p_reason_code, ''),
    NULLIF(p_note, ''),
    v_user_id,
    COALESCE(v_match.owner_user_id, v_user_id),
    v_match.job_department,
    v_match.job_id,
    v_match.job_title,
    COALESCE(p_occurred_at, NOW())
  ) RETURNING * INTO v_event;

  v_target_stage := CASE p_event_type
    WHEN 'outreach_sent' THEN 'contacted'
    WHEN 'interview_scheduled' THEN 'interviewing'
    WHEN 'interview_completed' THEN 'interviewing'
    WHEN 'offer' THEN 'offered'
    WHEN 'hired' THEN 'hired'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'withdrawn' THEN 'withdrawn'
    WHEN 'stage_corrected' THEN p_target_stage
    ELSE NULL
  END;

  SELECT MAX(status_event.occurred_at) INTO v_latest_stage_time
  FROM match_status_events AS status_event
  WHERE status_event.match_record_id = v_match.id
    AND status_event.organization_id = v_organization_id;

  v_previous_status := v_match.status;
  IF p_event_type = 'stage_corrected' THEN
    v_rebuilt_status := 'pending';
    FOR v_rebuild_event IN
      SELECT outcome_event.id, outcome_event.event_type,
             outcome_event.target_stage, outcome_event.occurred_at,
             outcome_event.recorded_at
      FROM recruiting_outcome_events AS outcome_event
      WHERE outcome_event.organization_id = v_organization_id
        AND outcome_event.match_record_id = v_match.id
        AND NOT EXISTS (
          SELECT 1 FROM recruiting_outcome_events AS correction_event
          WHERE correction_event.organization_id = v_organization_id
            AND correction_event.match_record_id = v_match.id
            AND correction_event.event_type = 'stage_corrected'
            AND correction_event.supersedes_event_id = outcome_event.id
        )
      ORDER BY outcome_event.occurred_at, outcome_event.recorded_at, outcome_event.id
    LOOP
      v_rebuild_target := CASE v_rebuild_event.event_type
        WHEN 'outreach_sent' THEN 'contacted'
        WHEN 'interview_scheduled' THEN 'interviewing'
        WHEN 'interview_completed' THEN 'interviewing'
        WHEN 'offer' THEN 'offered'
        WHEN 'hired' THEN 'hired'
        WHEN 'rejected' THEN 'rejected'
        WHEN 'withdrawn' THEN 'withdrawn'
        WHEN 'stage_corrected' THEN v_rebuild_event.target_stage
        ELSE NULL
      END;
      IF v_rebuild_target IS NULL THEN
        CONTINUE;
      END IF;
      IF v_rebuild_event.event_type = 'stage_corrected' THEN
        v_rebuilt_status := v_rebuild_target;
      ELSIF v_rebuilt_status NOT IN ('hired', 'rejected', 'withdrawn') THEN
        IF v_rebuild_target IN ('rejected', 'withdrawn') THEN
          v_rebuilt_status := v_rebuild_target;
        ELSE
          v_current_rank := CASE v_rebuilt_status
            WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'interviewing' THEN 2
            WHEN 'offered' THEN 3 WHEN 'hired' THEN 4 ELSE 0 END;
          v_target_rank := CASE v_rebuild_target
            WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'interviewing' THEN 2
            WHEN 'offered' THEN 3 WHEN 'hired' THEN 4 ELSE 0 END;
          IF v_target_rank > v_current_rank THEN
            v_rebuilt_status := v_rebuild_target;
          END IF;
        END IF;
      END IF;
    END LOOP;
    v_target_stage := v_rebuilt_status;
    v_should_advance := v_target_stage IS DISTINCT FROM v_match.status;
  ELSIF v_target_stage IS NOT NULL
    AND COALESCE(p_occurred_at, NOW()) >= COALESCE(v_latest_stage_time, '-infinity'::TIMESTAMP WITH TIME ZONE)
    AND v_match.status NOT IN ('hired', 'rejected', 'withdrawn') THEN
    IF v_target_stage IN ('rejected', 'withdrawn') THEN
      v_should_advance := true;
    ELSE
      v_current_rank := CASE v_match.status
        WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'interviewing' THEN 2
        WHEN 'offered' THEN 3 WHEN 'hired' THEN 4 ELSE 0 END;
      v_target_rank := CASE v_target_stage
        WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'interviewing' THEN 2
        WHEN 'offered' THEN 3 WHEN 'hired' THEN 4 ELSE 0 END;
      v_should_advance := v_target_rank > v_current_rank;
    END IF;
  END IF;

  IF v_should_advance THEN
    UPDATE match_records
    SET
      status = v_target_stage,
      contact_time = CASE WHEN v_target_stage = 'contacted' THEN COALESCE(contact_time, v_event.occurred_at) ELSE contact_time END,
      interview_time = CASE WHEN v_target_stage = 'interviewing' THEN COALESCE(interview_time, v_event.occurred_at) ELSE interview_time END,
      updated_at = NOW()
    WHERE id = v_match.id;

    INSERT INTO match_status_events (
      organization_id, match_record_id, from_status, status, note,
      decision_source, reason_code, client_event_id, occurred_at, created_by
    ) VALUES (
      v_organization_id,
      v_match.id,
      v_previous_status,
      v_target_stage,
      NULLIF(p_note, ''),
      CASE WHEN p_source = 'admin_correction' THEN 'admin_correction' ELSE 'human' END,
      NULLIF(p_reason_code, ''),
      p_client_event_id,
      v_event.occurred_at,
      v_user_id
    );
  END IF;

  INSERT INTO audit_logs (
    organization_id, user_id, action, target_type, target_id, details
  ) VALUES (
    v_organization_id,
    v_user_id,
    'record_recruiting_outcome',
    'match_record',
    v_match.id,
    jsonb_build_object(
      'event_id', v_event.id,
      'event_type', p_event_type,
      'source', p_source,
      'stage_advanced', v_should_advance,
      'previous_status', v_previous_status,
      'current_status', CASE WHEN v_should_advance THEN v_target_stage ELSE v_previous_status END,
      'personal_identifiers_logged', false
    )
  );

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'match_record_id', v_match.id,
    'event_type', p_event_type,
    'stage_advanced', v_should_advance,
    'previous_status', v_previous_status,
    'current_status', CASE WHEN v_should_advance THEN v_target_stage ELSE v_previous_status END,
    'idempotent', false
  );
END;
$$;

-- 旧三参数入口不再允许绕过来源、原因和幂等门禁。
CREATE OR REPLACE FUNCTION append_match_status_event(
  p_match_record_id VARCHAR,
  p_status VARCHAR,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'use record_recruiting_outcome with source, reason and client event id'
    USING ERRCODE = '0A000';
END;
$$;

REVOKE ALL ON FUNCTION create_shortlist_batch(VARCHAR, JSONB, INTEGER, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_shortlist_run(VARCHAR, VARCHAR, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_shortlist_decision(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
REVOKE ALL ON FUNCTION qualify_shortlist_run(VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_recruiting_outcome(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_match_status_event(VARCHAR, VARCHAR, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_shortlist_batch(VARCHAR, JSONB, INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION finalize_shortlist_run(VARCHAR, VARCHAR, JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION record_shortlist_decision(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION qualify_shortlist_run(VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION record_recruiting_outcome(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT, VARCHAR, VARCHAR) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boss_search_tasks_expected_count_limit'
      AND conrelid = 'boss_search_tasks'::regclass
  ) THEN
    ALTER TABLE boss_search_tasks
      ADD CONSTRAINT boss_search_tasks_expected_count_limit
      CHECK (expected_count BETWEEN 0 AND 40) NOT VALID;
  END IF;
END;
$$;

-- ============================================
-- 招聘决策副驾驶：数据接入、回写、校准与最强清理
-- ============================================
ALTER TABLE integration_outbox ALTER COLUMN payload_encrypted DROP NOT NULL;
ALTER TABLE integration_outbox
  ADD COLUMN IF NOT EXISTS outcome_event_id VARCHAR(36)
  REFERENCES recruiting_outcome_events(id) ON DELETE SET NULL;
ALTER TABLE integration_outbox
  ADD COLUMN IF NOT EXISTS payload_fingerprint VARCHAR(64);
-- 旧版本允许保存任意加密载荷；升级时永久清空，后续只从不可变结果事件与实体映射生成。
UPDATE integration_outbox
SET payload_encrypted = NULL,
    payload_fingerprint = NULL
WHERE payload_encrypted IS NOT NULL OR payload_fingerprint IS NOT NULL;

DROP FUNCTION IF EXISTS approve_integration_writeback(VARCHAR, VARCHAR, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS approve_integration_writeback(VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION import_integration_page(
  p_connection_id VARCHAR,
  p_entity_type VARCHAR,
  p_records JSONB,
  p_cursor_before TEXT,
  p_cursor_after TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_connection integration_connections%ROWTYPE;
  v_last_cursor TEXT;
  v_record JSONB;
  v_local_entity_id VARCHAR(36);
  v_candidate_result JSONB;
  v_candidate_input candidates%ROWTYPE;
  v_job_input job_requirements%ROWTYPE;
  v_processed INTEGER := 0;
  v_sync integration_sync_runs%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'administrator context required' USING ERRCODE = '28000';
  END IF;
  IF p_entity_type NOT IN ('job', 'candidate', 'outcome')
    OR p_records IS NULL OR jsonb_typeof(p_records) <> 'array'
    OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'integration page must contain 1 to 100 valid records' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM integration_connections
  WHERE id = p_connection_id AND organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_connection.status <> 'enabled' THEN
    RAISE EXCEPTION 'enabled integration connection not found' USING ERRCODE = 'P0002';
  END IF;
  IF (p_entity_type = 'job' AND NOT (v_connection.capabilities @> '["inbound_jobs"]'::JSONB))
    OR (p_entity_type = 'candidate' AND NOT (v_connection.capabilities @> '["inbound_candidates"]'::JSONB))
    OR (p_entity_type = 'outcome' AND NOT (v_connection.capabilities @> '["inbound_outcomes"]'::JSONB)) THEN
    RAISE EXCEPTION 'connection does not declare the requested inbound capability' USING ERRCODE = '42501';
  END IF;

  SELECT cursor_after INTO v_last_cursor
  FROM integration_sync_runs
  WHERE integration_id = p_connection_id AND status = 'succeeded'
  ORDER BY finished_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
  IF v_last_cursor IS DISTINCT FROM p_cursor_before THEN
    RAISE EXCEPTION 'integration cursor conflict' USING ERRCODE = '40001';
  END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    IF NULLIF(trim(v_record->>'external_id'), '') IS NULL
      OR ((v_record ? 'local_entity_id') = (v_record ? 'data')) THEN
      RAISE EXCEPTION 'external_id and exactly one of local_entity_id or data are required' USING ERRCODE = '22023';
    END IF;

    v_local_entity_id := NULLIF(trim(v_record->>'local_entity_id'), '');
    IF v_local_entity_id IS NULL THEN
      SELECT local_entity_id INTO v_local_entity_id
      FROM external_entity_links
      WHERE organization_id = v_organization_id
        AND integration_id = p_connection_id
        AND entity_type = p_entity_type
        AND external_id = v_record->>'external_id';
    END IF;

    IF v_local_entity_id IS NULL AND p_entity_type = 'job' THEN
      IF jsonb_typeof(v_record->'data') <> 'object'
        OR NULLIF(trim(v_record->'data'->>'title'), '') IS NULL THEN
        RAISE EXCEPTION 'new job imports require a structured title' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_job_input
      FROM jsonb_populate_record(NULL::job_requirements, v_record->'data');
      INSERT INTO job_requirements (
        organization_id, owner_user_id, title, department, location,
        salary_range, salary_min, salary_max, experience_required,
        education_required, skills_required, responsibilities, benefits,
        raw_jd, status
      ) VALUES (
        v_organization_id, v_user_id, v_job_input.title,
        v_job_input.department, v_job_input.location, v_job_input.salary_range,
        v_job_input.salary_min, v_job_input.salary_max,
        v_job_input.experience_required, v_job_input.education_required,
        COALESCE(v_job_input.skills_required, '[]'::JSONB),
        COALESCE(v_job_input.responsibilities, '[]'::JSONB),
        COALESCE(v_job_input.benefits, '[]'::JSONB),
        v_job_input.raw_jd, 'draft'
      ) RETURNING id INTO v_local_entity_id;
    ELSIF v_local_entity_id IS NULL AND p_entity_type = 'candidate' THEN
      IF jsonb_typeof(v_record->'data') <> 'object'
        OR jsonb_typeof(v_record->'authorization') <> 'object' THEN
        RAISE EXCEPTION 'new candidate imports require encrypted data and authorization evidence' USING ERRCODE = '22023';
      END IF;
      v_candidate_result := create_candidate_with_authorization_and_audit(
        v_record->'data',
        v_record->'authorization'
      );
      v_local_entity_id := v_candidate_result->>'id';
    ELSIF v_local_entity_id IS NULL THEN
      RAISE EXCEPTION 'outcome imports must reference an existing local event' USING ERRCODE = '22023';
    END IF;

    IF v_record ? 'data' AND p_entity_type = 'job' THEN
      SELECT * INTO v_job_input
      FROM jsonb_populate_record(NULL::job_requirements, v_record->'data');
      UPDATE job_requirements
      SET title = COALESCE(v_job_input.title, title),
          department = COALESCE(v_job_input.department, department),
          location = COALESCE(v_job_input.location, location),
          salary_range = COALESCE(v_job_input.salary_range, salary_range),
          salary_min = COALESCE(v_job_input.salary_min, salary_min),
          salary_max = COALESCE(v_job_input.salary_max, salary_max),
          experience_required = COALESCE(v_job_input.experience_required, experience_required),
          education_required = COALESCE(v_job_input.education_required, education_required),
          skills_required = COALESCE(v_job_input.skills_required, skills_required),
          responsibilities = COALESCE(v_job_input.responsibilities, responsibilities),
          benefits = COALESCE(v_job_input.benefits, benefits),
          raw_jd = COALESCE(v_job_input.raw_jd, raw_jd),
          updated_at = NOW()
      WHERE id = v_local_entity_id AND organization_id = v_organization_id;
    ELSIF v_record ? 'data' AND p_entity_type = 'candidate' THEN
      SELECT * INTO v_candidate_input
      FROM jsonb_populate_record(NULL::candidates, v_record->'data');
      UPDATE candidates
      SET name = COALESCE(v_candidate_input.name, name),
          email = COALESCE(v_candidate_input.email, email),
          phone = COALESCE(v_candidate_input.phone, phone),
          email_hmac = COALESCE(v_candidate_input.email_hmac, email_hmac),
          phone_hmac = COALESCE(v_candidate_input.phone_hmac, phone_hmac),
          resume_url = COALESCE(v_candidate_input.resume_url, resume_url),
          skills = COALESCE(v_candidate_input.skills, skills),
          experience_years = COALESCE(v_candidate_input.experience_years, experience_years),
          verified_experience_years = COALESCE(v_candidate_input.verified_experience_years, verified_experience_years),
          experience_years_status = COALESCE(v_candidate_input.experience_years_status, experience_years_status),
          experience_years_evidence = COALESCE(v_candidate_input.experience_years_evidence, experience_years_evidence),
          education = COALESCE(v_candidate_input.education, education),
          current_company = COALESCE(v_candidate_input.current_company, current_company),
          current_position = COALESCE(v_candidate_input.current_position, current_position),
          current_city = COALESCE(v_candidate_input.current_city, current_city),
          preferred_locations = COALESCE(v_candidate_input.preferred_locations, preferred_locations),
          salary_expectation = COALESCE(v_candidate_input.salary_expectation, salary_expectation),
          salary_min = COALESCE(v_candidate_input.salary_min, salary_min),
          salary_max = COALESCE(v_candidate_input.salary_max, salary_max),
          availability = COALESCE(v_candidate_input.availability, availability),
          job_change_frequency = COALESCE(v_candidate_input.job_change_frequency, job_change_frequency),
          work_history = COALESCE(v_candidate_input.work_history, work_history),
          resume_text = COALESCE(v_candidate_input.resume_text, resume_text),
          notes = COALESCE(v_candidate_input.notes, notes),
          updated_at = NOW()
      WHERE id = v_local_entity_id
        AND organization_id = v_organization_id
        AND is_authorized = true;
    END IF;

    IF p_entity_type = 'job' THEN
      PERFORM 1 FROM job_requirements
      WHERE id = v_local_entity_id AND organization_id = v_organization_id;
    ELSIF p_entity_type = 'candidate' THEN
      PERFORM 1 FROM candidates
      WHERE id = v_local_entity_id AND organization_id = v_organization_id AND is_authorized = true;
    ELSE
      PERFORM 1 FROM recruiting_outcome_events
      WHERE id = v_local_entity_id AND organization_id = v_organization_id;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'local entity is outside the connection tenant or unauthorized' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO external_entity_links (
      organization_id, integration_id, entity_type, external_id,
      local_entity_id, source_updated_at, updated_at
    ) VALUES (
      v_organization_id, p_connection_id, p_entity_type,
      v_record->>'external_id', v_local_entity_id,
      NULLIF(v_record->>'source_updated_at', '')::TIMESTAMP WITH TIME ZONE, NOW()
    )
    ON CONFLICT (integration_id, entity_type, external_id)
    DO UPDATE SET
      local_entity_id = EXCLUDED.local_entity_id,
      source_updated_at = EXCLUDED.source_updated_at,
      updated_at = NOW();
    v_processed := v_processed + 1;
  END LOOP;

  INSERT INTO integration_sync_runs (
    organization_id, integration_id, direction, status,
    cursor_before, cursor_after, processed_count, succeeded_count,
    requested_by, started_at, finished_at
  ) VALUES (
    v_organization_id, p_connection_id, 'inbound', 'succeeded',
    p_cursor_before, p_cursor_after, v_processed, v_processed,
    v_user_id, NOW(), NOW()
  ) RETURNING * INTO v_sync;

  UPDATE integration_connections
  SET last_sync_at = NOW(), updated_at = NOW()
  WHERE id = p_connection_id;

  RETURN jsonb_build_object(
    'sync_run_id', v_sync.id,
    'processed_count', v_processed,
    'cursor_after', p_cursor_after
  );
END;
$$;

CREATE OR REPLACE FUNCTION approve_integration_writeback(
  p_connection_id VARCHAR,
  p_outcome_event_id VARCHAR,
  p_client_event_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_connection integration_connections%ROWTYPE;
  v_outcome recruiting_outcome_events%ROWTYPE;
  v_existing integration_outbox%ROWTYPE;
  v_outbox integration_outbox%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF NULLIF(trim(p_client_event_id), '') IS NULL THEN
    RAISE EXCEPTION 'client event id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM integration_outbox
  WHERE organization_id = v_organization_id AND client_event_id = p_client_event_id;
  IF FOUND THEN
    IF v_existing.integration_id IS DISTINCT FROM p_connection_id
      OR v_existing.outcome_event_id IS DISTINCT FROM p_outcome_event_id THEN
      RAISE EXCEPTION 'client event id payload conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('outbox_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  END IF;

  SELECT * INTO v_connection FROM integration_connections
  WHERE id = p_connection_id AND organization_id = v_organization_id;
  IF NOT FOUND OR v_connection.status <> 'enabled'
    OR NOT (v_connection.capabilities @> '["outbound_outcomes"]'::JSONB) THEN
    RAISE EXCEPTION 'connection is not enabled for outcome writeback' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_outcome FROM recruiting_outcome_events
  WHERE id = p_outcome_event_id
    AND organization_id = v_organization_id
    AND source IN ('human', 'admin_correction')
    AND recruiter_user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'writeback must reference an outcome explicitly performed by the approver' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM authorization_records
  WHERE organization_id = v_organization_id
    AND candidate_id = v_outcome.candidate_id
    AND is_active = true
    AND evidence_status = 'verified'
    AND authorized_at <= NOW()
    AND processing_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate authorization is no longer processable for writeback' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM external_entity_links
    WHERE organization_id = v_organization_id
      AND integration_id = p_connection_id
      AND entity_type = 'candidate'
      AND local_entity_id = v_outcome.candidate_id
  ) OR NOT EXISTS (
    SELECT 1 FROM external_entity_links
    WHERE organization_id = v_organization_id
      AND integration_id = p_connection_id
      AND entity_type = 'job'
      AND local_entity_id = v_outcome.job_id
  ) THEN
    RAISE EXCEPTION 'candidate and job must be mapped before ATS writeback' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO integration_outbox (
    organization_id, integration_id, analytics_subject_id, outcome_event_id,
    action_type, payload_encrypted, payload_fingerprint,
    client_event_id, approved_by, approved_at,
    status, next_attempt_at
  ) VALUES (
    v_organization_id, p_connection_id, v_outcome.analytics_subject_id,
    v_outcome.id, v_outcome.event_type, NULL,
    NULL, p_client_event_id,
    v_user_id, NOW(), 'pending', NOW()
  ) RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('outbox_id', v_outbox.id, 'status', v_outbox.status, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION record_recruiting_outcome_with_writeback(
  p_match_record_id VARCHAR,
  p_event_type VARCHAR,
  p_source VARCHAR,
  p_client_event_id VARCHAR,
  p_occurred_at TIMESTAMP WITH TIME ZONE,
  p_reason_code VARCHAR DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_target_stage VARCHAR DEFAULT NULL,
  p_supersedes_event_id VARCHAR DEFAULT NULL,
  p_connection_id VARCHAR DEFAULT NULL,
  p_writeback_client_event_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_outcome JSONB;
  v_writeback JSONB;
BEGIN
  IF p_connection_id IS NULL OR p_writeback_client_event_id IS NULL THEN
    RAISE EXCEPTION 'writeback connection and client event id are required'
      USING ERRCODE = '22023';
  END IF;
  v_outcome := record_recruiting_outcome(
    p_match_record_id, p_event_type, p_source, p_client_event_id,
    p_occurred_at, p_reason_code, p_note, p_target_stage,
    p_supersedes_event_id
  );
  v_writeback := approve_integration_writeback(
    p_connection_id,
    v_outcome->>'event_id',
    p_writeback_client_event_id
  );
  RETURN v_outcome || jsonb_build_object('writeback', v_writeback);
END;
$$;

CREATE OR REPLACE FUNCTION manage_integration_writeback(
  p_outbox_id VARCHAR,
  p_action VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_outbox integration_outbox%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_action NOT IN ('cancel', 'retry') THEN
    RAISE EXCEPTION 'invalid outbox action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_outbox FROM integration_outbox
  WHERE id = p_outbox_id AND organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND OR (v_outbox.approved_by <> v_user_id AND v_role <> 'admin') THEN
    RAISE EXCEPTION 'outbox intent not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_action = 'cancel' AND v_outbox.status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'only pending or failed writebacks can be cancelled' USING ERRCODE = '55000';
  ELSIF p_action = 'retry' AND v_outbox.status <> 'failed' THEN
    RAISE EXCEPTION 'only failed writebacks can be retried' USING ERRCODE = '55000';
  END IF;
  UPDATE integration_outbox
  SET status = CASE WHEN p_action = 'cancel' THEN 'cancelled' ELSE 'pending' END,
      next_attempt_at = CASE WHEN p_action = 'retry' THEN NOW() ELSE NULL END,
      last_error = CASE WHEN p_action = 'retry' THEN NULL ELSE last_error END,
      updated_at = NOW()
  WHERE id = p_outbox_id
  RETURNING * INTO v_outbox;
  RETURN jsonb_build_object('outbox_id', v_outbox.id, 'status', v_outbox.status);
END;
$$;

CREATE OR REPLACE FUNCTION record_authorized_ats_outcome(
  p_organization_id VARCHAR,
  p_connection_id VARCHAR,
  p_match_record_id VARCHAR,
  p_event_type VARCHAR,
  p_external_event_id VARCHAR,
  p_occurred_at TIMESTAMP WITH TIME ZONE,
  p_reason_code VARCHAR DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_connection integration_connections%ROWTYPE;
  v_existing recruiting_outcome_events%ROWTYPE;
  v_match RECORD;
  v_event recruiting_outcome_events%ROWTYPE;
  v_target_stage VARCHAR(20);
  v_previous_status VARCHAR(20);
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_should_advance BOOLEAN := false;
  v_latest_stage_time TIMESTAMP WITH TIME ZONE;
BEGIN
  IF p_event_type NOT IN (
    'outreach_sent', 'candidate_replied', 'interview_scheduled',
    'interview_completed', 'qualified_interview', 'offer', 'hired',
    'rejected', 'withdrawn', 'complaint'
  ) OR NULLIF(trim(p_external_event_id), '') IS NULL THEN
    RAISE EXCEPTION 'invalid ATS outcome' USING ERRCODE = '22023';
  END IF;
  IF p_event_type IN ('rejected', 'withdrawn') AND NULLIF(trim(p_reason_code), '') IS NULL THEN
    RAISE EXCEPTION 'reason is required for terminal outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_connection FROM integration_connections
  WHERE id = p_connection_id AND organization_id = p_organization_id
    AND status = 'enabled' AND capabilities @> '["inbound_outcomes"]'::JSONB;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorized ATS connection not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_existing FROM recruiting_outcome_events
  WHERE organization_id = p_organization_id AND integration_id = p_connection_id
    AND external_event_id = p_external_event_id;
  IF FOUND THEN
    IF v_existing.match_record_id IS DISTINCT FROM p_match_record_id
      OR v_existing.event_type IS DISTINCT FROM p_event_type
      OR v_existing.occurred_at IS DISTINCT FROM p_occurred_at
      OR v_existing.reason_code IS DISTINCT FROM NULLIF(p_reason_code, '')
      OR v_existing.note IS DISTINCT FROM NULLIF(p_note, '') THEN
      RAISE EXCEPTION 'external event id payload conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('event_id', v_existing.id, 'idempotent', true);
  END IF;
  SELECT match_record.*, candidate.analytics_subject_id,
         job.title AS job_title, job.department AS job_department, job.owner_user_id
  INTO v_match
  FROM match_records AS match_record
  JOIN candidates AS candidate
    ON candidate.id = match_record.candidate_id
   AND candidate.organization_id = match_record.organization_id
  JOIN job_requirements AS job
    ON job.id = match_record.job_id
   AND job.organization_id = match_record.organization_id
  WHERE match_record.id = p_match_record_id AND match_record.organization_id = p_organization_id
  FOR UPDATE OF match_record;
  IF NOT FOUND THEN RAISE EXCEPTION 'match record not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO recruiting_outcome_events (
    organization_id, job_id, candidate_id, match_record_id, analytics_subject_id,
    event_type, source, integration_id, external_event_id, reason_code, note,
    recruiter_user_id_snapshot, department_snapshot, job_id_snapshot,
    job_title_snapshot, occurred_at
  ) VALUES (
    p_organization_id, v_match.job_id, v_match.candidate_id, v_match.id,
    v_match.analytics_subject_id, p_event_type, 'authorized_ats', p_connection_id,
    p_external_event_id, NULLIF(p_reason_code, ''), NULLIF(p_note, ''),
    v_match.owner_user_id, v_match.job_department, v_match.job_id,
    v_match.job_title, COALESCE(p_occurred_at, NOW())
  ) RETURNING * INTO v_event;
  v_target_stage := CASE p_event_type
    WHEN 'outreach_sent' THEN 'contacted' WHEN 'interview_scheduled' THEN 'interviewing'
    WHEN 'interview_completed' THEN 'interviewing' WHEN 'offer' THEN 'offered'
    WHEN 'hired' THEN 'hired' WHEN 'rejected' THEN 'rejected'
    WHEN 'withdrawn' THEN 'withdrawn' ELSE NULL END;
  SELECT MAX(occurred_at) INTO v_latest_stage_time FROM match_status_events
  WHERE organization_id = p_organization_id AND match_record_id = v_match.id;
  v_previous_status := v_match.status;
  IF v_target_stage IS NOT NULL
    AND v_event.occurred_at >= COALESCE(v_latest_stage_time, '-infinity'::TIMESTAMP WITH TIME ZONE)
    AND v_match.status NOT IN ('hired', 'rejected', 'withdrawn') THEN
    IF v_target_stage IN ('rejected', 'withdrawn') THEN v_should_advance := true;
    ELSE
      v_current_rank := CASE v_match.status WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'interviewing' THEN 2 WHEN 'offered' THEN 3 WHEN 'hired' THEN 4 ELSE 0 END;
      v_target_rank := CASE v_target_stage WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'interviewing' THEN 2 WHEN 'offered' THEN 3 WHEN 'hired' THEN 4 ELSE 0 END;
      v_should_advance := v_target_rank > v_current_rank;
    END IF;
  END IF;
  IF v_should_advance THEN
    UPDATE match_records SET status = v_target_stage, updated_at = NOW() WHERE id = v_match.id;
    INSERT INTO match_status_events (
      organization_id, match_record_id, from_status, status, note,
      decision_source, reason_code, external_event_id, occurred_at
    ) VALUES (
      p_organization_id, v_match.id, v_previous_status, v_target_stage,
      NULLIF(p_note, ''), 'authorized_ats', NULLIF(p_reason_code, ''),
      p_external_event_id, v_event.occurred_at
    );
  END IF;
  RETURN jsonb_build_object(
    'event_id', v_event.id, 'stage_advanced', v_should_advance,
    'current_status', CASE WHEN v_should_advance THEN v_target_stage ELSE v_previous_status END,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION propose_scoring_calibration(
  p_proposed_weights JSONB,
  p_rationale TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_reviewed INTEGER;
  v_outreach INTEGER;
  v_interviews INTEGER;
  v_sum NUMERIC;
  v_proposal calibration_proposals%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'administrator context required' USING ERRCODE = '28000';
  END IF;
  SELECT COUNT(DISTINCT shortlist_entry_id) INTO v_reviewed
  FROM recommendation_decision_events WHERE organization_id = v_organization_id;
  SELECT COUNT(*) FILTER (WHERE event_type = 'outreach_sent'),
         COUNT(*) FILTER (WHERE event_type = 'interview_completed')
  INTO v_outreach, v_interviews
  FROM recruiting_outcome_events WHERE organization_id = v_organization_id;
  IF v_reviewed < 100 OR v_outreach < 30 OR v_interviews < 10 THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reviewed_entries', v_reviewed,
      'outreach_events', v_outreach, 'completed_interviews', v_interviews
    );
  END IF;
  IF p_proposed_weights IS NULL OR jsonb_typeof(p_proposed_weights) <> 'object'
    OR jsonb_object_length(p_proposed_weights) <> 6
    OR NOT (p_proposed_weights ?& ARRAY['SKILL', 'EXPERIENCE', 'SALARY', 'LOCATION', 'AVAILABILITY', 'STABILITY'])
    OR NULLIF(trim(p_rationale), '') IS NULL THEN
    RAISE EXCEPTION 'weights and rationale are required' USING ERRCODE = '22023';
  END IF;
  SELECT SUM(value::NUMERIC) INTO v_sum FROM jsonb_each_text(p_proposed_weights);
  IF abs(v_sum - 1.0) > 0.000001 THEN
    RAISE EXCEPTION 'scoring weights must sum to 1.0' USING ERRCODE = '22023';
  END IF;
  INSERT INTO calibration_proposals (
    organization_id, reviewed_entries, outreach_events, completed_interviews,
    metrics_snapshot, proposed_weights, rationale, source_weights_version_id, created_by
  ) VALUES (
    v_organization_id, v_reviewed, v_outreach, v_interviews,
    jsonb_build_object('reviewed_entries', v_reviewed, 'outreach_events', v_outreach, 'completed_interviews', v_interviews),
    p_proposed_weights, p_rationale,
    (SELECT id FROM scoring_weight_versions WHERE organization_id = v_organization_id AND status = 'active'),
    v_user_id
  ) RETURNING * INTO v_proposal;
  RETURN jsonb_build_object('eligible', true, 'proposal_id', v_proposal.id, 'status', v_proposal.status);
END;
$$;

CREATE OR REPLACE FUNCTION review_scoring_calibration(
  p_proposal_id VARCHAR,
  p_decision VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_proposal calibration_proposals%ROWTYPE;
  v_version scoring_weight_versions%ROWTYPE;
  v_next_version INTEGER;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'administrator context required' USING ERRCODE = '28000';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid calibration decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_proposal FROM calibration_proposals
  WHERE id = p_proposal_id AND organization_id = v_organization_id FOR UPDATE;
  IF NOT FOUND OR v_proposal.status <> 'draft' THEN
    RAISE EXCEPTION 'draft calibration proposal not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_decision = 'approved' THEN
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM scoring_weight_versions WHERE organization_id = v_organization_id;
    UPDATE scoring_weight_versions SET status = 'inactive'
    WHERE organization_id = v_organization_id AND status = 'active';
    INSERT INTO scoring_weight_versions (
      organization_id, version, weights, status, approved_by, approved_at
    ) VALUES (
      v_organization_id, v_next_version, v_proposal.proposed_weights,
      'active', v_user_id, NOW()
    ) RETURNING * INTO v_version;
  END IF;
  UPDATE calibration_proposals
  SET status = p_decision, reviewed_by = v_user_id, reviewed_at = NOW(),
      approved_weights_version_id = CASE WHEN p_decision = 'approved' THEN v_version.id ELSE NULL END
  WHERE id = p_proposal_id;
  RETURN jsonb_build_object(
    'proposal_id', p_proposal_id, 'status', p_decision,
    'weights_version_id', CASE WHEN p_decision = 'approved' THEN v_version.id ELSE NULL END
  );
END;
$$;

-- 替换旧撤回实现：删除可识别主体，保留仅以随机 analytics_subject_id 关联的不可变统计事实。
CREATE OR REPLACE FUNCTION revoke_candidate_authorization(
  p_candidate_id VARCHAR,
  p_anonymized_candidate JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_candidate candidates%ROWTYPE;
  v_revoked_at TIMESTAMP WITH TIME ZONE := clock_timestamp();
  v_match_count INTEGER := 0;
  v_authorization_count INTEGER := 0;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_candidate FROM candidates
  WHERE id = p_candidate_id AND organization_id = v_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT COALESCE(v_candidate.is_authorized, false) THEN
    RAISE EXCEPTION 'candidate authorization already revoked' USING ERRCODE = 'P0001';
  END IF;

  UPDATE match_batch_tasks SET status = 'error', error_message = 'candidate authorization revoked',
      finished_at = NOW(), lease_until = NULL, updated_at = NOW()
  WHERE organization_id = v_organization_id AND status IN ('pending', 'running')
    AND (candidate_ids IS NULL OR candidate_ids @> to_jsonb(ARRAY[p_candidate_id]::TEXT[]));
  UPDATE shortlist_runs SET status = 'failed', error_message = 'candidate authorization revoked', updated_at = NOW()
  WHERE organization_id = v_organization_id AND status IN ('pending', 'running')
    AND source_match_batch_task_id IN (
      SELECT id FROM match_batch_tasks WHERE organization_id = v_organization_id AND error_message = 'candidate authorization revoked'
    );
  UPDATE integration_outbox SET
      status = CASE
        WHEN status IN ('pending', 'sending', 'failed') THEN 'cancelled'
        ELSE status
      END,
      payload_encrypted = NULL,
      payload_fingerprint = NULL,
      next_attempt_at = NULL,
      lease_until = NULL,
      updated_at = NOW()
  WHERE organization_id = v_organization_id
    AND analytics_subject_id = v_candidate.analytics_subject_id;
  DELETE FROM external_entity_links
  WHERE organization_id = v_organization_id
    AND (
      (entity_type = 'candidate' AND local_entity_id = p_candidate_id)
      OR (
        entity_type = 'outcome'
        AND local_entity_id IN (
          SELECT id FROM recruiting_outcome_events
          WHERE organization_id = v_organization_id
            AND analytics_subject_id = v_candidate.analytics_subject_id
        )
      )
    );
  UPDATE candidate_rights_requests
  SET source_reference = NULL, resolution_reference = NULL, updated_at = NOW()
  WHERE organization_id = v_organization_id AND candidate_id = p_candidate_id;
  UPDATE recruiting_outcome_events SET candidate_id = NULL, match_record_id = NULL, note = NULL, metadata = '{}'::JSONB
  WHERE organization_id = v_organization_id AND analytics_subject_id = v_candidate.analytics_subject_id;
  UPDATE recommendation_decision_events SET shortlist_entry_id = NULL, note = NULL
  WHERE organization_id = v_organization_id AND analytics_subject_id = v_candidate.analytics_subject_id;
  DELETE FROM match_records WHERE organization_id = v_organization_id AND candidate_id = p_candidate_id;
  GET DIAGNOSTICS v_match_count = ROW_COUNT;
  UPDATE authorization_records SET is_active = false, revoked_at = v_revoked_at
  WHERE organization_id = v_organization_id AND candidate_id = p_candidate_id AND is_active = true;
  GET DIAGNOSTICS v_authorization_count = ROW_COUNT;
  DELETE FROM candidates WHERE id = p_candidate_id AND organization_id = v_organization_id;
  INSERT INTO audit_logs (organization_id, user_id, action, target_type, target_id, details)
  VALUES (
    v_organization_id, v_user_id, 'strongest_candidate_cleanup', 'analytics_subject',
    v_candidate.analytics_subject_id,
    jsonb_build_object('revoked_at', v_revoked_at, 'personal_identifiers_logged', false)
  );
  RETURN jsonb_build_object(
    'match_records', v_match_count, 'authorization_records', v_authorization_count,
    'revoked_at', v_revoked_at, 'analytics_subject_id', v_candidate.analytics_subject_id
  );
END;
$$;

REVOKE ALL ON FUNCTION import_integration_page(VARCHAR, VARCHAR, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION approve_integration_writeback(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION manage_integration_writeback(VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_recruiting_outcome_with_writeback(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_authorized_ats_outcome(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION propose_scoring_calibration(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_scoring_calibration(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_integration_page(VARCHAR, VARCHAR, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_integration_writeback(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION manage_integration_writeback(VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION record_recruiting_outcome_with_writeback(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION record_authorized_ats_outcome(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION propose_scoring_calibration(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION review_scoring_calibration(VARCHAR, VARCHAR) TO authenticated;

CREATE OR REPLACE FUNCTION create_communication_brief(
  p_shortlist_entry_id VARCHAR,
  p_prompt_version VARCHAR,
  p_ai_mode VARCHAR,
  p_candidate_value_points JSONB,
  p_facts_to_verify JSONB,
  p_interview_questions JSONB,
  p_prohibited_claims JSONB,
  p_draft_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_entry shortlist_entries%ROWTYPE;
  v_latest_decision VARCHAR(30);
  v_brief communication_briefs%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_ai_mode NOT IN ('rules_only', 'private_endpoint', 'approved_cloud')
    OR NULLIF(trim(p_prompt_version), '') IS NULL
    OR NULLIF(trim(p_draft_message), '') IS NULL
    OR jsonb_typeof(COALESCE(p_candidate_value_points, '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_facts_to_verify, '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_interview_questions, '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_prohibited_claims, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'invalid communication brief' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM shortlist_entries
  WHERE id = p_shortlist_entry_id AND organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shortlist entry not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT decision INTO v_latest_decision
  FROM recommendation_decision_events
  WHERE organization_id = v_organization_id AND shortlist_entry_id = v_entry.id
  ORDER BY occurred_at DESC, recorded_at DESC, id DESC
  LIMIT 1;
  IF v_entry.human_decision <> 'accepted' OR v_latest_decision IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'communication preparation requires the latest accepted human decision' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM authorization_records
  WHERE organization_id = v_organization_id
    AND candidate_id = v_entry.candidate_id
    AND is_active = true
    AND evidence_status = 'verified'
    AND authorized_at <= NOW()
    AND processing_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate authorization is no longer processable' USING ERRCODE = '55000';
  END IF;
  INSERT INTO communication_briefs (
    organization_id, shortlist_entry_id, generated_by, prompt_version, ai_mode,
    candidate_value_points, facts_to_verify, interview_questions,
    prohibited_claims, draft_message
  ) VALUES (
    v_organization_id, v_entry.id, v_user_id, p_prompt_version, p_ai_mode,
    COALESCE(p_candidate_value_points, '[]'::JSONB), COALESCE(p_facts_to_verify, '[]'::JSONB),
    COALESCE(p_interview_questions, '[]'::JSONB), COALESCE(p_prohibited_claims, '[]'::JSONB),
    p_draft_message
  ) RETURNING * INTO v_brief;
  RETURN to_jsonb(v_brief);
END;
$$;

REVOKE ALL ON FUNCTION create_communication_brief(VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_communication_brief(VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION claim_integration_outbox(
  p_worker_id VARCHAR,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF NULLIF(trim(p_worker_id), '') IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'invalid outbox lease request' USING ERRCODE = '22023';
  END IF;
  SELECT
    outbox.*,
    connection.configuration_encrypted,
    jsonb_build_object(
      'schema_version', 'recruiting-outcome-writeback-v1',
      'event_id', outcome.id,
      'event_type', outcome.event_type,
      'occurred_at', outcome.occurred_at,
      'reason_code', outcome.reason_code,
      'target_stage', outcome.target_stage,
      'external_candidate_id', candidate_link.external_id,
      'external_job_id', job_link.external_id
    ) AS generated_payload
  INTO v_item
  FROM integration_outbox AS outbox
  JOIN integration_connections AS connection
    ON connection.id = outbox.integration_id
   AND connection.organization_id = outbox.organization_id
   AND connection.status = 'enabled'
  JOIN recruiting_outcome_events AS outcome
    ON outcome.id = outbox.outcome_event_id
   AND outcome.organization_id = outbox.organization_id
   AND outcome.event_type = outbox.action_type
  JOIN external_entity_links AS candidate_link
    ON candidate_link.organization_id = outbox.organization_id
   AND candidate_link.integration_id = outbox.integration_id
   AND candidate_link.entity_type = 'candidate'
   AND candidate_link.local_entity_id = outcome.candidate_id
  JOIN external_entity_links AS job_link
    ON job_link.organization_id = outbox.organization_id
   AND job_link.integration_id = outbox.integration_id
   AND job_link.entity_type = 'job'
   AND job_link.local_entity_id = outcome.job_id
  WHERE outbox.status IN ('pending', 'failed')
    AND COALESCE(outbox.next_attempt_at, NOW()) <= NOW()
    AND (outbox.lease_until IS NULL OR outbox.lease_until < NOW())
    AND EXISTS (
      SELECT 1
      FROM authorization_records AS authorization_record
      WHERE authorization_record.organization_id = outbox.organization_id
        AND authorization_record.candidate_id = outcome.candidate_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  ORDER BY outbox.created_at
  FOR UPDATE OF outbox SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE integration_outbox
  SET status = 'sending', worker_id = p_worker_id,
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1, updated_at = NOW()
  WHERE id = v_item.id
  RETURNING attempt_count, lease_until INTO v_item.attempt_count, v_item.lease_until;
  RETURN jsonb_build_object(
    'id', v_item.id, 'organization_id', v_item.organization_id,
    'integration_id', v_item.integration_id, 'action_type', v_item.action_type,
    'payload', v_item.generated_payload,
    'configuration_encrypted', v_item.configuration_encrypted,
    'client_event_id', v_item.client_event_id,
    'attempt_count', v_item.attempt_count, 'lease_until', v_item.lease_until
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_integration_outbox(
  p_organization_id VARCHAR,
  p_outbox_id VARCHAR,
  p_worker_id VARCHAR,
  p_succeeded BOOLEAN,
  p_external_receipt JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item integration_outbox%ROWTYPE;
  v_delay_seconds INTEGER;
BEGIN
  SELECT * INTO v_item FROM integration_outbox
  WHERE id = p_outbox_id AND organization_id = p_organization_id
    AND status = 'sending' AND worker_id = p_worker_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leased outbox item not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_succeeded AND (p_external_receipt IS NULL OR jsonb_typeof(p_external_receipt) <> 'object') THEN
    RAISE EXCEPTION 'successful writeback requires an external receipt' USING ERRCODE = '22023';
  END IF;
  v_delay_seconds := LEAST(3600, 30 * (2 ^ LEAST(v_item.attempt_count - 1, 7))::INTEGER);
  UPDATE integration_outbox
  SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
      external_receipt = CASE WHEN p_succeeded THEN p_external_receipt ELSE external_receipt END,
      last_error = CASE WHEN p_succeeded THEN NULL ELSE left(COALESCE(p_error, 'writeback failed'), 2000) END,
      next_attempt_at = CASE WHEN p_succeeded THEN NULL ELSE NOW() + make_interval(secs => v_delay_seconds) END,
      completed_at = CASE WHEN p_succeeded THEN NOW() ELSE NULL END,
      worker_id = NULL, lease_until = NULL, updated_at = NOW()
  WHERE id = v_item.id
  RETURNING * INTO v_item;
  RETURN jsonb_build_object(
    'outbox_id', v_item.id, 'status', v_item.status,
    'attempt_count', v_item.attempt_count, 'next_attempt_at', v_item.next_attempt_at
  );
END;
$$;

REVOKE ALL ON FUNCTION claim_integration_outbox(VARCHAR, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_integration_outbox(VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_integration_outbox(VARCHAR, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_integration_outbox(VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, TEXT) TO service_role;

-- 招聘状态快照与事件只能通过事务 RPC 修改；普通会话仍可写入评分字段。
REVOKE INSERT, UPDATE, DELETE ON match_records FROM authenticated;
GRANT INSERT (
  organization_id, job_id, candidate_id,
  overall_score, skill_score, experience_score, education_score,
  salary_score, location_score, availability_score, stability_score,
  culture_fit_score, scoring_status, scoring_error, scoring_model,
  scoring_prompt_version, scoring_input_snapshot, llm_status, llm_error,
  llm_model, llm_prompt_version, match_details, generated_script, script_type,
  current_run_id, current_run_version, match_schema_version,
  scoring_input_version, weights_version, input_fingerprint, updated_at
) ON match_records TO authenticated;
GRANT UPDATE (
  overall_score, skill_score, experience_score, education_score,
  salary_score, location_score, availability_score, stability_score,
  culture_fit_score, scoring_status, scoring_error, scoring_model,
  scoring_prompt_version, scoring_input_snapshot, llm_status, llm_error,
  llm_model, llm_prompt_version, match_details, generated_script, script_type,
  current_run_id, current_run_version, match_schema_version,
  scoring_input_version, weights_version, input_fingerprint, updated_at
) ON match_records TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON match_status_events FROM authenticated;
GRANT SELECT ON match_status_events TO authenticated;

CREATE OR REPLACE FUNCTION record_candidate_rights_request(
  p_candidate_id VARCHAR,
  p_request_type VARCHAR,
  p_received_at TIMESTAMP WITH TIME ZONE,
  p_due_at TIMESTAMP WITH TIME ZONE,
  p_source_reference VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_candidate candidates%ROWTYPE;
  v_request candidate_rights_requests%ROWTYPE;
  v_received_at TIMESTAMP WITH TIME ZONE := COALESCE(p_received_at, NOW());
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_request_type NOT IN ('withdraw', 'delete', 'explain', 'object', 'complaint')
    OR p_due_at IS NULL OR p_due_at <= v_received_at THEN
    RAISE EXCEPTION 'request type and explicit future due_at are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_candidate FROM candidates
  WHERE id = p_candidate_id AND organization_id = v_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO candidate_rights_requests (
    organization_id, candidate_id, analytics_subject_id, request_type,
    source_reference, received_at, due_at, created_by
  ) VALUES (
    v_organization_id, v_candidate.id, v_candidate.analytics_subject_id,
    p_request_type, NULLIF(p_source_reference, ''), v_received_at, p_due_at, v_user_id
  ) RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END;
$$;

CREATE OR REPLACE FUNCTION resolve_candidate_rights_request(
  p_request_id VARCHAR,
  p_status VARCHAR,
  p_resolution_reference VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_request candidate_rights_requests%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_status NOT IN ('in_progress', 'resolved', 'rejected')
    OR (p_status IN ('resolved', 'rejected') AND NULLIF(trim(p_resolution_reference), '') IS NULL) THEN
    RAISE EXCEPTION 'final rights request status requires a resolution reference' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM candidate_rights_requests
  WHERE id = p_request_id AND organization_id = v_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rights request not found' USING ERRCODE = 'P0002'; END IF;
  IF v_request.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'rights request is already final' USING ERRCODE = '55000';
  END IF;
  UPDATE candidate_rights_requests
  SET status = p_status, resolution_reference = NULLIF(p_resolution_reference, ''),
      resolved_at = CASE WHEN p_status = 'resolved' THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END;
$$;

REVOKE ALL ON FUNCTION record_candidate_rights_request(VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_candidate_rights_request(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_candidate_rights_request(VARCHAR, VARCHAR, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_candidate_rights_request(VARCHAR, VARCHAR, VARCHAR) TO authenticated;

CREATE OR REPLACE FUNCTION set_organization_ai_policy(
  p_mode VARCHAR,
  p_approved_cloud_processors JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_organization organizations%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'administrator context required' USING ERRCODE = '28000';
  END IF;
  IF p_mode NOT IN ('rules_only', 'private_endpoint', 'approved_cloud')
    OR jsonb_typeof(p_approved_cloud_processors) <> 'array'
    OR (p_mode = 'approved_cloud' AND jsonb_array_length(p_approved_cloud_processors) = 0)
    OR (p_mode <> 'approved_cloud' AND jsonb_array_length(p_approved_cloud_processors) <> 0) THEN
    RAISE EXCEPTION 'invalid tenant AI execution policy' USING ERRCODE = '22023';
  END IF;
  UPDATE organizations
  SET ai_execution_mode = p_mode,
      approved_cloud_processors = p_approved_cloud_processors,
      updated_at = NOW()
  WHERE id = v_organization_id
  RETURNING * INTO v_organization;
  INSERT INTO audit_logs (
    organization_id, user_id, action, target_type, target_id, details
  ) VALUES (
    v_organization_id, v_user_id, 'set_organization_ai_policy',
    'organization', v_organization_id,
    jsonb_build_object(
      'mode', p_mode,
      'approved_processor_count', jsonb_array_length(p_approved_cloud_processors),
      'personal_identifiers_logged', false
    )
  );
  RETURN jsonb_build_object(
    'ai_execution_mode', v_organization.ai_execution_mode,
    'approved_cloud_processors', v_organization.approved_cloud_processors
  );
END;
$$;

REVOKE ALL ON FUNCTION set_organization_ai_policy(VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_organization_ai_policy(VARCHAR, JSONB) TO authenticated;

-- Remove the short-lived integer overload before installing the string-versioned worker RPC.
DROP FUNCTION IF EXISTS update_match_batch_task_from_worker(
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, JSONB, TEXT, VARCHAR, INTEGER
);

CREATE OR REPLACE FUNCTION update_match_batch_task_from_worker(
  p_organization_id VARCHAR,
  p_task_id VARCHAR,
  p_worker_id VARCHAR,
  p_action VARCHAR,
  p_candidate_count INTEGER DEFAULT NULL,
  p_result JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_confidence_formula_version VARCHAR DEFAULT NULL,
  p_scoring_weights_version VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_action NOT IN ('start', 'complete', 'fail')
    OR NULLIF(trim(p_organization_id), '') IS NULL
    OR NULLIF(trim(p_task_id), '') IS NULL
    OR NULLIF(trim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'invalid worker task transition' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM match_batch_tasks
  WHERE id = p_task_id
    AND organization_id = p_organization_id
    AND worker_id = p_worker_id
    AND status = 'running'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match task lease is no longer valid' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'start' THEN
    UPDATE shortlist_runs
    SET status = 'running',
        confidence_formula_version = COALESCE(p_confidence_formula_version, confidence_formula_version),
        scoring_weights_version = COALESCE(p_scoring_weights_version, scoring_weights_version),
        error_message = NULL,
        updated_at = NOW()
    WHERE organization_id = p_organization_id
      AND source_match_batch_task_id = p_task_id
      AND status IN ('pending', 'running');
  ELSIF p_action = 'complete' THEN
    IF p_candidate_count IS NULL OR p_candidate_count < 0 OR p_result IS NULL THEN
      RAISE EXCEPTION 'completed task requires count and result' USING ERRCODE = '22023';
    END IF;
    UPDATE match_batch_tasks
    SET status = 'done', candidate_count = p_candidate_count,
        result = p_result, error_message = NULL, worker_id = NULL,
        lease_until = NULL, finished_at = NOW(), updated_at = NOW()
    WHERE id = p_task_id AND organization_id = p_organization_id
      AND worker_id = p_worker_id AND status = 'running';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'match task lease was lost during completion' USING ERRCODE = '55000';
    END IF;
  ELSE
    UPDATE shortlist_runs
    SET status = 'failed', error_message = left(COALESCE(p_error_message, 'worker failed'), 2000),
        completed_at = NOW(), updated_at = NOW()
    WHERE organization_id = p_organization_id
      AND source_match_batch_task_id = p_task_id
      AND status IN ('pending', 'running');
    UPDATE match_batch_tasks
    SET status = 'error', error_message = left(COALESCE(p_error_message, 'worker failed'), 2000),
        worker_id = NULL, lease_until = NULL, finished_at = NOW(), updated_at = NOW()
    WHERE id = p_task_id AND organization_id = p_organization_id
      AND worker_id = p_worker_id AND status = 'running';
  END IF;
  RETURN jsonb_build_object('task_id', p_task_id, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION update_match_batch_task_from_worker(VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, JSONB, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_match_batch_task_from_worker(VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, JSONB, TEXT, VARCHAR, VARCHAR) TO service_role;

-- 授权自然到期同样必须停止普通会话的读取；不能依赖人工另行执行撤回。
DROP POLICY IF EXISTS tenant_isolation ON candidates;
DROP POLICY IF EXISTS candidates_current_authorization_select ON candidates;
CREATE POLICY candidates_current_authorization_select ON candidates
  FOR SELECT TO authenticated
  USING (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1 FROM authorization_records AS authorization_record
      WHERE authorization_record.organization_id = candidates.organization_id
        AND authorization_record.candidate_id = candidates.id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );

DROP POLICY IF EXISTS tenant_isolation ON match_records;
DROP POLICY IF EXISTS match_records_current_authorization_select ON match_records;
CREATE POLICY match_records_current_authorization_select ON match_records
  FOR SELECT TO authenticated
  USING (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1 FROM authorization_records AS authorization_record
      WHERE authorization_record.organization_id = match_records.organization_id
        AND authorization_record.candidate_id = match_records.candidate_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );
DROP POLICY IF EXISTS match_records_current_authorization_insert ON match_records;
CREATE POLICY match_records_current_authorization_insert ON match_records
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1 FROM authorization_records AS authorization_record
      WHERE authorization_record.organization_id = match_records.organization_id
        AND authorization_record.candidate_id = match_records.candidate_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );
DROP POLICY IF EXISTS match_records_current_authorization_update ON match_records;
CREATE POLICY match_records_current_authorization_update ON match_records
  FOR UPDATE TO authenticated
  USING (organization_id = current_organization_id())
  WITH CHECK (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1 FROM authorization_records AS authorization_record
      WHERE authorization_record.organization_id = match_records.organization_id
        AND authorization_record.candidate_id = match_records.candidate_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );
REVOKE DELETE ON match_records FROM authenticated;

DROP POLICY IF EXISTS shortlist_entries_tenant_select ON shortlist_entries;
CREATE POLICY shortlist_entries_tenant_select ON shortlist_entries
  FOR SELECT TO authenticated
  USING (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1 FROM authorization_records AS authorization_record
      WHERE authorization_record.organization_id = shortlist_entries.organization_id
        AND authorization_record.candidate_id = shortlist_entries.candidate_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );

DROP POLICY IF EXISTS communication_briefs_tenant_select ON communication_briefs;
CREATE POLICY communication_briefs_tenant_select ON communication_briefs
  FOR SELECT TO authenticated
  USING (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM shortlist_entries AS shortlist_entry
      JOIN authorization_records AS authorization_record
        ON authorization_record.organization_id = shortlist_entry.organization_id
       AND authorization_record.candidate_id = shortlist_entry.candidate_id
      WHERE shortlist_entry.id = communication_briefs.shortlist_entry_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );

CREATE OR REPLACE FUNCTION count_expired_authorization_active_processing(
  p_as_of TIMESTAMP WITH TIME ZONE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_count INTEGER;
BEGIN
  IF v_organization_id IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context and as-of time required'
      USING ERRCODE = '28000';
  END IF;
  SELECT COUNT(DISTINCT auth_record.candidate_id)::INTEGER INTO v_count
  FROM authorization_records AS auth_record
  JOIN candidates AS candidate
    ON candidate.id = auth_record.candidate_id
   AND candidate.organization_id = auth_record.organization_id
  WHERE auth_record.organization_id = v_organization_id
    AND auth_record.is_active = true
    AND auth_record.processing_expires_at < p_as_of
    AND (
      EXISTS (
        SELECT 1 FROM match_records AS match_record
        WHERE match_record.organization_id = v_organization_id
          AND match_record.candidate_id = auth_record.candidate_id
          AND match_record.status IN ('pending', 'contacted', 'interviewing', 'offered')
      )
      OR EXISTS (
        SELECT 1 FROM shortlist_entries AS entry
        WHERE entry.organization_id = v_organization_id
          AND entry.candidate_id = auth_record.candidate_id
          AND entry.human_decision IN ('unreviewed', 'accepted', 'needs_information')
      )
      OR EXISTS (
        SELECT 1 FROM integration_outbox AS outbox
        WHERE outbox.organization_id = v_organization_id
          AND outbox.analytics_subject_id = candidate.analytics_subject_id
          AND outbox.status IN ('pending', 'sending', 'failed')
      )
    );
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION count_expired_authorization_active_processing(TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_expired_authorization_active_processing(TIMESTAMP WITH TIME ZONE) TO authenticated;

CREATE OR REPLACE FUNCTION set_job_lifecycle(
  p_job_id VARCHAR,
  p_action VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_job job_requirements%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_action NOT IN ('activate', 'close') THEN
    RAISE EXCEPTION 'invalid job lifecycle action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM job_requirements
  WHERE id = p_job_id AND organization_id = v_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE job_requirements
  SET status = CASE WHEN p_action = 'activate' THEN 'active' ELSE 'closed' END,
      activated_at = CASE WHEN p_action = 'activate' THEN COALESCE(activated_at, NOW()) ELSE activated_at END,
      closed_at = CASE WHEN p_action = 'close' THEN NOW() ELSE NULL END,
      owner_user_id = COALESCE(owner_user_id, v_user_id),
      updated_at = NOW()
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

REVOKE ALL ON FUNCTION set_job_lifecycle(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_job_lifecycle(VARCHAR, VARCHAR) TO authenticated;

-- ============================================
-- 招聘决策副驾驶：最终权限与权利清理门禁
-- ============================================
CREATE OR REPLACE FUNCTION enforce_match_record_tenant_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM job_requirements
    WHERE id = NEW.job_id AND organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM candidates
    WHERE id = NEW.candidate_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'match record references must belong to the same organization'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_records_tenant_references ON match_records;
CREATE TRIGGER match_records_tenant_references
BEFORE INSERT OR UPDATE OF organization_id, job_id, candidate_id ON match_records
FOR EACH ROW EXECUTE FUNCTION enforce_match_record_tenant_references();

CREATE OR REPLACE FUNCTION prevent_authorization_reactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NOT OLD.is_active AND NEW.is_active)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
    OR (
      OLD.automated_decision_objected_at IS NOT NULL
      AND NEW.automated_decision_objected_at IS NULL
    ) THEN
    RAISE EXCEPTION 'authorization revocation and objection are irreversible'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS authorization_records_no_reactivation ON authorization_records;
CREATE TRIGGER authorization_records_no_reactivation
BEFORE UPDATE ON authorization_records
FOR EACH ROW EXECUTE FUNCTION prevent_authorization_reactivation();

ALTER FUNCTION create_candidate_with_authorization_and_audit(JSONB, JSONB)
  SECURITY DEFINER;
REVOKE INSERT, UPDATE, DELETE ON candidates FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON authorization_records FROM authenticated;

CREATE OR REPLACE FUNCTION record_automated_decision_objection(
  p_candidate_id VARCHAR,
  p_request_reference VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_subject_id VARCHAR(36);
  v_result JSONB;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '28000';
  END IF;
  IF NULLIF(trim(p_request_reference), '') IS NULL THEN
    RAISE EXCEPTION 'request reference is required' USING ERRCODE = '22023';
  END IF;
  SELECT analytics_subject_id INTO v_subject_id
  FROM candidates
  WHERE id = p_candidate_id AND organization_id = v_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate not found' USING ERRCODE = 'P0002';
  END IF;

  v_result := revoke_candidate_authorization(p_candidate_id, '{}'::JSONB);
  INSERT INTO audit_logs (
    organization_id, user_id, action, target_type, target_id, details
  ) VALUES (
    v_organization_id, v_user_id, 'automated_decision_objection_cleanup',
    'analytics_subject', v_subject_id,
    jsonb_build_object('request_recorded', true, 'personal_identifiers_logged', false)
  );
  RETURN v_result || jsonb_build_object('objected', true);
END;
$$;

CREATE OR REPLACE FUNCTION resolve_candidate_rights_request(
  p_request_id VARCHAR,
  p_status VARCHAR,
  p_resolution_reference VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_request candidate_rights_requests%ROWTYPE;
  v_cleanup_receipt VARCHAR(80);
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_status NOT IN ('in_progress', 'resolved', 'rejected')
    OR (p_status IN ('resolved', 'rejected') AND NULLIF(trim(p_resolution_reference), '') IS NULL) THEN
    RAISE EXCEPTION 'final rights request status requires a resolution reference' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM candidate_rights_requests
  WHERE id = p_request_id AND organization_id = v_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rights request not found' USING ERRCODE = 'P0002'; END IF;
  IF v_request.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'rights request is already final' USING ERRCODE = '55000';
  END IF;

  IF p_status = 'resolved'
    AND v_request.request_type IN ('withdraw', 'delete', 'object') THEN
    IF v_request.candidate_id IS NOT NULL THEN
      PERFORM revoke_candidate_authorization(v_request.candidate_id, '{}'::JSONB);
    END IF;
    v_cleanup_receipt := 'cleanup:' || gen_random_uuid()::TEXT;
  END IF;

  UPDATE candidate_rights_requests
  SET status = p_status,
      resolution_reference = CASE
        WHEN v_cleanup_receipt IS NOT NULL THEN v_cleanup_receipt
        ELSE NULLIF(p_resolution_reference, '')
      END,
      resolved_at = CASE WHEN p_status = 'resolved' THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END;
$$;

REVOKE ALL ON FUNCTION enforce_match_record_tenant_references() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_authorization_reactivation() FROM PUBLIC;
REVOKE ALL ON FUNCTION record_automated_decision_objection(VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_candidate_rights_request(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_automated_decision_objection(VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_candidate_rights_request(VARCHAR, VARCHAR, VARCHAR) TO authenticated;

-- =====================================================================
-- P1 年限区间口径：职位筛选 rubric（经验年限区间 + 能力优先级 + 加分封顶）
-- =====================================================================
ALTER TABLE job_requirements
  ADD COLUMN IF NOT EXISTS screening_rubric JSONB DEFAULT '{}'::jsonb;

-- P2 公共题库 + 个性化面试提纲
-- =====================================================================

-- 公共题只能人工录入（source 用 CHECK 锁死为 'user'）
CREATE TABLE IF NOT EXISTS interview_question_bank (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope VARCHAR(20) NOT NULL,
  job_id VARCHAR(36) REFERENCES job_requirements(id) ON DELETE CASCADE,
  dimension VARCHAR(50) NOT NULL,
  question TEXT NOT NULL,
  probe_followups JSONB NOT NULL DEFAULT '[]'::JSONB,
  expected_signals JSONB NOT NULL DEFAULT '[]'::JSONB,
  scoring_anchors JSONB NOT NULL DEFAULT '[]'::JSONB,
  difficulty VARCHAR(20),
  source VARCHAR(20) NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT interview_question_bank_scope_check
    CHECK (scope IN ('organization', 'job')),
  CONSTRAINT interview_question_bank_scope_job_check
    CHECK ((scope = 'job' AND job_id IS NOT NULL) OR (scope = 'organization' AND job_id IS NULL)),
  CONSTRAINT interview_question_bank_source_check
    CHECK (source = 'user'),
  CONSTRAINT interview_question_bank_json_check
    CHECK (
      jsonb_typeof(probe_followups) = 'array'
      AND jsonb_typeof(expected_signals) = 'array'
      AND jsonb_typeof(scoring_anchors) = 'array'
    )
);

-- 唯一索引防重复录入（同一题目原文在一个组织 + scope + 职位下只允许一条）
CREATE UNIQUE INDEX IF NOT EXISTS interview_question_bank_unique_question_idx
  ON interview_question_bank(
    organization_id,
    scope,
    COALESCE(job_id, '00000000-0000-0000-0000-000000000000'),
    md5(question)
  );
CREATE INDEX IF NOT EXISTS interview_question_bank_organization_scope_idx
  ON interview_question_bank(organization_id, scope, job_id, is_active);

-- 提纲快照（供审计与复用）
CREATE TABLE IF NOT EXISTS interview_guides (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id VARCHAR(36) REFERENCES job_requirements(id) ON DELETE CASCADE,
  candidate_id VARCHAR(36) REFERENCES candidates(id) ON DELETE CASCADE,
  match_record_id VARCHAR(36) REFERENCES match_records(id) ON DELETE CASCADE,
  shortlist_entry_id VARCHAR(36) REFERENCES shortlist_entries(id) ON DELETE CASCADE,
  focus_areas JSONB NOT NULL DEFAULT '[]'::JSONB,
  questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  red_flags JSONB NOT NULL DEFAULT '[]'::JSONB,
  interview_loop JSONB NOT NULL DEFAULT '[]'::JSONB,
  common_question_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  ai_mode VARCHAR(30) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  review_status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT interview_guides_ai_mode_check
    CHECK (ai_mode IN ('rules_only', 'private_endpoint', 'approved_cloud')),
  CONSTRAINT interview_guides_review_status_check
    CHECK (review_status IN ('draft', 'approved', 'rejected')),
  CONSTRAINT interview_guides_json_check
    CHECK (
      jsonb_typeof(focus_areas) = 'array'
      AND jsonb_typeof(questions) = 'object'
      AND jsonb_typeof(red_flags) = 'array'
      AND jsonb_typeof(interview_loop) = 'array'
      AND jsonb_typeof(common_question_ids) = 'array'
    )
);
CREATE INDEX IF NOT EXISTS interview_guides_entry_created_idx
  ON interview_guides(shortlist_entry_id, created_at);
CREATE INDEX IF NOT EXISTS interview_guides_organization_review_idx
  ON interview_guides(organization_id, review_status);

-- RLS：基础租户读取策略（照抄 communication_briefs 写法）
ALTER TABLE interview_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interview_question_bank_tenant_select ON interview_question_bank;
CREATE POLICY interview_question_bank_tenant_select ON interview_question_bank
  FOR SELECT TO authenticated
  USING (organization_id = current_organization_id());

-- 提纲读取受候选人授权有效期约束（照抄 communication_briefs 授权校验）
DROP POLICY IF EXISTS interview_guides_tenant_select ON interview_guides;
CREATE POLICY interview_guides_tenant_select ON interview_guides
  FOR SELECT TO authenticated
  USING (
    organization_id = current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM shortlist_entries AS shortlist_entry
      JOIN authorization_records AS authorization_record
        ON authorization_record.organization_id = shortlist_entry.organization_id
       AND authorization_record.candidate_id = shortlist_entry.candidate_id
      WHERE shortlist_entry.id = interview_guides.shortlist_entry_id
        AND authorization_record.is_active = true
        AND authorization_record.evidence_status = 'verified'
        AND authorization_record.authorized_at <= NOW()
        AND authorization_record.processing_expires_at > NOW()
    )
  );

-- 题库写入由应用层 RLS 客户端直写（照抄 outreach_tasks 模式），删除被禁止
DROP POLICY IF EXISTS interview_question_bank_tenant_insert ON interview_question_bank;
CREATE POLICY interview_question_bank_tenant_insert ON interview_question_bank
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS interview_question_bank_tenant_update ON interview_question_bank;
CREATE POLICY interview_question_bank_tenant_update ON interview_question_bank
  FOR UPDATE TO authenticated
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON interview_question_bank, interview_guides FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON interview_question_bank TO authenticated;
GRANT SELECT ON interview_guides TO authenticated;
REVOKE DELETE ON interview_question_bank FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON interview_guides FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON interview_question_bank, interview_guides TO service_role;

-- 提纲落库走 SECURITY DEFINER RPC（照抄 create_communication_brief：角色 + 决策 + 授权三重门禁）
CREATE OR REPLACE FUNCTION create_interview_guide(
  p_shortlist_entry_id VARCHAR,
  p_prompt_version VARCHAR,
  p_ai_mode VARCHAR,
  p_focus_areas JSONB,
  p_questions JSONB,
  p_red_flags JSONB,
  p_interview_loop JSONB,
  p_common_question_ids JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR(36) := current_organization_id();
  v_user_id VARCHAR(36) := current_app_user_id();
  v_role VARCHAR(20) := current_app_role();
  v_entry shortlist_entries%ROWTYPE;
  v_latest_decision VARCHAR(30);
  v_guide interview_guides%ROWTYPE;
BEGIN
  IF v_organization_id IS NULL OR v_user_id IS NULL OR v_role NOT IN ('hr', 'admin') THEN
    RAISE EXCEPTION 'authenticated recruiter context required' USING ERRCODE = '28000';
  END IF;
  IF p_ai_mode NOT IN ('rules_only', 'private_endpoint', 'approved_cloud')
    OR NULLIF(trim(p_prompt_version), '') IS NULL
    OR jsonb_typeof(COALESCE(p_focus_areas, '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_questions, '{}'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(p_red_flags, '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_interview_loop, '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_common_question_ids, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'invalid interview guide' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM shortlist_entries
  WHERE id = p_shortlist_entry_id AND organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shortlist entry not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT decision INTO v_latest_decision
  FROM recommendation_decision_events
  WHERE organization_id = v_organization_id AND shortlist_entry_id = v_entry.id
  ORDER BY occurred_at DESC, recorded_at DESC, id DESC
  LIMIT 1;
  IF v_entry.human_decision NOT IN ('accepted', 'overridden')
    OR v_latest_decision IS DISTINCT FROM v_entry.human_decision THEN
    RAISE EXCEPTION 'interview guide requires a consistent accepted or overridden human decision' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM authorization_records
  WHERE organization_id = v_organization_id
    AND candidate_id = v_entry.candidate_id
    AND is_active = true
    AND evidence_status = 'verified'
    AND authorized_at <= NOW()
    AND processing_expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate authorization is no longer processable' USING ERRCODE = '55000';
  END IF;
  INSERT INTO interview_guides (
    organization_id, job_id, candidate_id, match_record_id, shortlist_entry_id,
    focus_areas, questions, red_flags, interview_loop, common_question_ids,
    ai_mode, prompt_version, created_by
  ) VALUES (
    v_organization_id,
    (SELECT job_id FROM shortlist_runs WHERE id = v_entry.shortlist_run_id),
    v_entry.candidate_id, v_entry.match_record_id, v_entry.id,
    COALESCE(p_focus_areas, '[]'::JSONB), COALESCE(p_questions, '{}'::JSONB),
    COALESCE(p_red_flags, '[]'::JSONB), COALESCE(p_interview_loop, '[]'::JSONB),
    COALESCE(p_common_question_ids, '[]'::JSONB),
    p_ai_mode, p_prompt_version, v_user_id
  ) RETURNING * INTO v_guide;
  RETURN to_jsonb(v_guide);
END;
$$;

REVOKE ALL ON FUNCTION create_interview_guide(VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_interview_guide(VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- P2 新增速率限制 scope 登记（consume_api_rate_limit 两个 CASE 分支），并修复 jd:generate 漏注册
DROP FUNCTION IF EXISTS consume_api_rate_limit(VARCHAR);

CREATE OR REPLACE FUNCTION consume_api_rate_limit(
  p_scope VARCHAR
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id VARCHAR;
  v_user_id VARCHAR;
  v_now TIMESTAMP WITH TIME ZONE := clock_timestamp();
  v_window_started_at TIMESTAMP WITH TIME ZONE;
  v_request_count INTEGER;
  v_limit INTEGER;
  v_window_seconds INTEGER;
BEGIN
  v_organization_id := current_organization_id();
  v_user_id := current_app_user_id();

  IF v_organization_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated tenant context required' USING ERRCODE = '42501';
  END IF;
  SELECT
    CASE p_scope
      WHEN 'candidates:list' THEN 120
      WHEN 'candidates:search' THEN 120
      WHEN 'jd:parse' THEN 10
      WHEN 'jd:generate' THEN 10
      WHEN 'boss:keywords' THEN 10
      WHEN 'boss:execute' THEN 10
      WHEN 'match:batch:submit' THEN 10
      WHEN 'match:batch:status' THEN 120
      WHEN 'match:single' THEN 10
      WHEN 'dashboard:read' THEN 120
      WHEN 'outcomes:create' THEN 30
      WHEN 'outcomes:read' THEN 120
      WHEN 'communication-briefs:create' THEN 20
      WHEN 'interview:guide' THEN 10
      WHEN 'interview:bank:read' THEN 120
      WHEN 'interview:bank:write' THEN 30
      WHEN 'shortlists:create' THEN 10
      WHEN 'shortlists:read' THEN 120
      WHEN 'shortlists:qualify' THEN 10
      WHEN 'shortlists:decision' THEN 30
      WHEN 'candidates:extract' THEN 10
      WHEN 'outreach:read' THEN 120
      WHEN 'outreach:create' THEN 30
      WHEN 'outreach:update' THEN 60
      WHEN 'talent-pool:read' THEN 120
      WHEN 'job-postings:read' THEN 120
      WHEN 'job-postings:create' THEN 30
      WHEN 'today-todos:read' THEN 120
    END,
    CASE p_scope
      WHEN 'candidates:list' THEN 60
      WHEN 'candidates:search' THEN 60
      WHEN 'jd:parse' THEN 300
      WHEN 'jd:generate' THEN 300
      WHEN 'boss:keywords' THEN 300
      WHEN 'boss:execute' THEN 60
      WHEN 'match:batch:submit' THEN 60
      WHEN 'match:batch:status' THEN 60
      WHEN 'match:single' THEN 60
      WHEN 'dashboard:read' THEN 60
      WHEN 'outcomes:create' THEN 60
      WHEN 'outcomes:read' THEN 60
      WHEN 'communication-briefs:create' THEN 60
      WHEN 'interview:guide' THEN 300
      WHEN 'interview:bank:read' THEN 60
      WHEN 'interview:bank:write' THEN 60
      WHEN 'shortlists:create' THEN 60
      WHEN 'shortlists:read' THEN 60
      WHEN 'shortlists:qualify' THEN 60
      WHEN 'shortlists:decision' THEN 60
      WHEN 'candidates:extract' THEN 300
      WHEN 'outreach:read' THEN 60
      WHEN 'outreach:create' THEN 60
      WHEN 'outreach:update' THEN 60
      WHEN 'talent-pool:read' THEN 60
      WHEN 'job-postings:read' THEN 60
      WHEN 'job-postings:create' THEN 60
      WHEN 'today-todos:read' THEN 60
    END
  INTO v_limit, v_window_seconds;

  IF v_limit IS NULL OR v_window_seconds IS NULL THEN
    RAISE EXCEPTION 'invalid rate limit scope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api_rate_limits (
    organization_id,
    user_id,
    scope,
    window_started_at,
    request_count,
    updated_at
  ) VALUES (
    v_organization_id,
    v_user_id,
    p_scope,
    v_now,
    1,
    v_now
  )
  ON CONFLICT (organization_id, user_id, scope)
  DO UPDATE SET
    window_started_at = CASE
      WHEN api_rate_limits.window_started_at
        <= v_now - make_interval(secs => v_window_seconds)
      THEN v_now
      ELSE api_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN api_rate_limits.window_started_at
        <= v_now - make_interval(secs => v_window_seconds)
      THEN 1
      ELSE api_rate_limits.request_count + 1
    END,
    updated_at = v_now
  RETURNING
    api_rate_limits.window_started_at,
    api_rate_limits.request_count
  INTO v_window_started_at, v_request_count;

  RETURN QUERY SELECT
    v_request_count <= v_limit,
    GREATEST(v_limit - v_request_count, 0),
    CASE
      WHEN v_request_count <= v_limit THEN 0
      ELSE GREATEST(
        CEIL(EXTRACT(EPOCH FROM (
          v_window_started_at
          + make_interval(secs => v_window_seconds)
          - v_now
        )))::INTEGER,
        1
      )
    END;
END;
$$;