import { pgTable, serial, varchar, text, timestamp, integer, jsonb, index, boolean, numeric, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

// ============================================
// 组织（租户）
// ============================================
export const organizations = pgTable(
  "organizations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    is_active: boolean("is_active").notNull().default(true),
    timezone: varchar("timezone", { length: 100 }).notNull().default("Asia/Shanghai"),
    metrics_enabled_at: timestamp("metrics_enabled_at", { withTimezone: true }).defaultNow().notNull(),
    ai_execution_mode: varchar("ai_execution_mode", { length: 30 }).notNull().default("rules_only"),
    approved_cloud_processors: jsonb("approved_cloud_processors").$type<string[]>().notNull().default([]),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("organizations_slug_idx").on(table.slug),
  ]
);

// ============================================
// 用户表
// ============================================
export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password_hash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("hr"), // hr/admin
    company: varchar("company", { length: 200 }),
    avatar_url: varchar("avatar_url", { length: 500 }),
    is_active: boolean("is_active").default(true),
    must_change_password: boolean("must_change_password").notNull().default(false),
    auth_version: integer("auth_version").notNull().default(1),
    failed_login_attempts: integer("failed_login_attempts").notNull().default(0),
    locked_until: timestamp("locked_until", { withTimezone: true }),
    mfa_enabled: boolean("mfa_enabled").notNull().default(false),
    mfa_secret_encrypted: text("mfa_secret_encrypted"),
    mfa_pending_secret_encrypted: text("mfa_pending_secret_encrypted"),
    mfa_recovery_codes: jsonb("mfa_recovery_codes").$type<string[]>().notNull().default([]),
    mfa_last_used_step: integer("mfa_last_used_step").notNull().default(-1),
    last_login_at: timestamp("last_login_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("users_email_idx").on(table.email),
    index("users_organization_id_idx").on(table.organization_id),
  ]
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("hr"),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_members_user_unique").on(table.user_id),
    index("organization_members_organization_idx").on(table.organization_id),
  ]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    auth_version: integer("auth_version").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.user_id),
    index("auth_sessions_expires_idx").on(table.expires_at),
  ]
);

export const authLoginAttempts = pgTable(
  "auth_login_attempts",
  {
    id: serial("id").primaryKey(),
    identifier_hash: varchar("identifier_hash", { length: 64 }).notNull(),
    ip_hash: varchar("ip_hash", { length: 64 }).notNull(),
    succeeded: boolean("succeeded").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auth_login_attempts_identifier_created_idx").on(table.identifier_hash, table.created_at),
    index("auth_login_attempts_ip_created_idx").on(table.ip_hash, table.created_at),
  ]
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("hr"),
    token_hash: varchar("token_hash", { length: 64 }).notNull().unique(),
    invited_by: varchar("invited_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("organization_invitations_organization_idx").on(table.organization_id),
    index("organization_invitations_email_idx").on(table.email),
  ]
);

// ============================================
// JD需求卡片表
// ============================================
export const jobRequirements = pgTable(
  "job_requirements",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    department: varchar("department", { length: 100 }),
    location: varchar("location", { length: 100 }),
    salary_range: varchar("salary_range", { length: 50 }),
    salary_min: integer("salary_min"), // 薪资下限(K)
    salary_max: integer("salary_max"), // 薪资上限(K)
    experience_required: varchar("experience_required", { length: 50 }),
    education_required: varchar("education_required", { length: 100 }),
    skills_required: jsonb("skills_required").$type<string[]>(),
    bonus_skills: jsonb("bonus_skills").$type<string[]>(), // 加分技能
    responsibilities: jsonb("responsibilities").$type<string[]>(),
    benefits: jsonb("benefits").$type<string[]>(),
    urgency: varchar("urgency", { length: 20 }).default("normal"), // 紧急程度: urgent/normal
    implicit_requirements: jsonb("implicit_requirements").$type<string[]>(), // 隐含需求（AI识别）
    completeness: integer("completeness"), // JD完整度评分 0-100
    missing_fields: jsonb("missing_fields").$type<string[]>(), // 缺失字段
    raw_jd: text("raw_jd").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    activated_at: timestamp("activated_at", { withTimezone: true }),
    closed_at: timestamp("closed_at", { withTimezone: true }),
    owner_user_id: varchar("owner_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    external_status: varchar("external_status", { length: 100 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("job_requirements_organization_idx").on(table.organization_id),
    index("job_requirements_status_idx").on(table.status),
    index("job_requirements_created_at_idx").on(table.created_at),
    index("job_requirements_location_idx").on(table.location),
  ]
);

// ============================================
// 候选人表
// ============================================
export const candidates = pgTable(
  "candidates",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(), // AES encrypted, needs longer field
    email: varchar("email", { length: 255 }), // AES encrypted
    phone: varchar("phone", { length: 255 }), // AES encrypted
    resume_url: varchar("resume_url", { length: 500 }),
    skills: jsonb("skills").$type<string[]>(),
    experience_years: integer("experience_years"),
    verified_experience_years: numeric("verified_experience_years", { precision: 4, scale: 1 }),
    experience_years_status: varchar("experience_years_status", { length: 30 }),
    experience_years_evidence: text("experience_years_evidence"),
    education: varchar("education", { length: 100 }),
    current_company: varchar("current_company", { length: 255 }), // AES encrypted
    current_position: varchar("current_position", { length: 255 }), // AES encrypted
    current_city: varchar("current_city", { length: 100 }), // 当前城市
    preferred_locations: jsonb("preferred_locations").$type<string[]>(), // 意向城市
    salary_expectation: varchar("salary_expectation", { length: 50 }), // 期望薪资范围
    salary_min: integer("salary_min"), // 期望薪资下限(K)
    salary_max: integer("salary_max"), // 期望薪资上限(K)
    availability: varchar("availability", { length: 50 }), // 到岗时间: immediately/1week/2weeks/1month/negotiable
    job_change_frequency: numeric("job_change_frequency", { precision: 3, scale: 1 }), // 年均跳槽频率
    work_history: jsonb("work_history").$type<Array<{
      company: string;
      position: string;
      duration_months: number;
    }>>(), // 工作经历
    resume_text: text("resume_text"),
    notes: text("notes"),
    // HMAC 签名字段（用于加密字段的精确检索）
    email_hmac: varchar("email_hmac", { length: 64 }), // HMAC-SHA256 of email
    phone_hmac: varchar("phone_hmac", { length: 64 }), // HMAC-SHA256 of phone
    data_source: varchar("data_source", { length: 50 }).default("manual"), // 数据来源: manual/api/import
    is_authorized: boolean("is_authorized").default(false), // 仅在证据链核验通过后置为 true
    analytics_subject_id: varchar("analytics_subject_id", { length: 36 }).notNull().default(sql`gen_random_uuid()`),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("candidates_organization_idx").on(table.organization_id),
    index("candidates_email_idx").on(table.email),
    index("candidates_created_at_idx").on(table.created_at),
    index("candidates_current_city_idx").on(table.current_city),
    index("candidates_email_hmac_idx").on(table.email_hmac),
    index("candidates_phone_hmac_idx").on(table.phone_hmac),
    uniqueIndex("candidates_organization_analytics_subject_unique").on(table.organization_id, table.analytics_subject_id),
  ]
);

// ============================================
// 匹配记录表
// ============================================
export const matchRecords = pgTable(
  "match_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    job_id: varchar("job_id", { length: 36 }).notNull().references(() => jobRequirements.id, { onDelete: "cascade" }),
    candidate_id: varchar("candidate_id", { length: 36 }).notNull().references(() => candidates.id, { onDelete: "cascade" }),
    current_run_id: varchar("current_run_id", { length: 36 }),
    current_run_version: integer("current_run_version"),
    match_schema_version: integer("match_schema_version"),
    scoring_input_version: varchar("scoring_input_version", { length: 100 }),
    weights_version: varchar("weights_version", { length: 100 }),
    input_fingerprint: varchar("input_fingerprint", { length: 64 }),
    // 综合评分
    overall_score: integer("overall_score"),
    // 6维度评分（按方案权重）
    skill_score: integer("skill_score"), // 技术栈匹配 35%
    experience_score: integer("experience_score"), // 经验匹配 25%
    salary_score: integer("salary_score"), // 薪资匹配 15%
    location_score: integer("location_score"), // 地域匹配 10%
    availability_score: integer("availability_score"), // 到岗时间 10%
    stability_score: integer("stability_score"), // 稳定性评估 5%
    education_score: integer("education_score"), // 学历（归入经验维度）
    // 评分可信度与审计信息
    scoring_status: varchar("scoring_status", { length: 20 }).notNull().default("pending"),
    scoring_error: text("scoring_error"),
    scoring_model: varchar("scoring_model", { length: 200 }),
    scoring_prompt_version: varchar("scoring_prompt_version", { length: 100 }),
    scoring_input_snapshot: jsonb("scoring_input_snapshot"),
    llm_status: varchar("llm_status", { length: 20 }).notNull().default("not_requested"),
    llm_error: text("llm_error"),
    llm_model: varchar("llm_model", { length: 200 }),
    llm_prompt_version: varchar("llm_prompt_version", { length: 100 }),
    // 匹配详情
    match_details: jsonb("match_details").$type<{
      strengths: string[];
      gaps: string[];
      recommendations: string;
      skill_analysis?: {
        matched: string[];
        missing: string[];
        bonus_matched: string[];
      };
      salary_analysis?: {
        candidate_expectation: string;
        job_range: string;
        overlap: string;
      };
      location_analysis?: {
        candidate_city: string;
        job_city: string;
        match: boolean;
      };
      llm_supplement?: {
        summary?: string;
        evidence: Array<{
          dimension: string;
          finding: string;
          source: string;
        }>;
      };
    }>(),
    // 状态管理
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    status_history: jsonb("status_history").$type<Array<{
      status: string;
      time: string;
      note?: string;
    }>>(),
    // 话术相关
    generated_script: text("generated_script"),
    script_type: varchar("script_type", { length: 50 }), // 话术类型
    // 时间节点
    contact_time: timestamp("contact_time", { withTimezone: true }),
    interview_time: timestamp("interview_time", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("match_records_organization_idx").on(table.organization_id),
    index("match_records_job_id_idx").on(table.job_id),
    index("match_records_candidate_id_idx").on(table.candidate_id),
    index("match_records_status_idx").on(table.status),
    index("match_records_scoring_status_idx").on(table.scoring_status),
    index("match_records_llm_status_idx").on(table.llm_status),
    index("match_records_overall_score_idx").on(table.overall_score),
    index("match_records_created_at_idx").on(table.created_at),
    uniqueIndex("match_records_job_candidate_unique").on(table.job_id, table.candidate_id),
    check(
      "match_records_score_bounds",
      sql`(${table.overall_score} IS NULL OR ${table.overall_score} BETWEEN 0 AND 100)
        AND (${table.skill_score} IS NULL OR ${table.skill_score} BETWEEN 0 AND 100)
        AND (${table.experience_score} IS NULL OR ${table.experience_score} BETWEEN 0 AND 100)
        AND (${table.education_score} IS NULL OR ${table.education_score} BETWEEN 0 AND 100)
        AND (${table.salary_score} IS NULL OR ${table.salary_score} BETWEEN 0 AND 100)
        AND (${table.location_score} IS NULL OR ${table.location_score} BETWEEN 0 AND 100)
        AND (${table.availability_score} IS NULL OR ${table.availability_score} BETWEEN 0 AND 100)
        AND (${table.stability_score} IS NULL OR ${table.stability_score} BETWEEN 0 AND 100)`,
    ),
  ]
);

// ============================================
// 匹配运行表（每次实际计算一条，缓存命中不新增）
// ============================================
export const matchRuns = pgTable(
  "match_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    version: serial("version").notNull(),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    job_id: varchar("job_id", { length: 36 }).notNull().references(() => jobRequirements.id, { onDelete: "cascade" }),
    candidate_id: varchar("candidate_id", { length: 36 }).notNull().references(() => candidates.id, { onDelete: "cascade" }),
    match_record_id: varchar("match_record_id", { length: 36 }).references(() => matchRecords.id, { onDelete: "set null" }),
    execution_mode: varchar("execution_mode", { length: 20 }).notNull(),
    trigger: varchar("trigger", { length: 30 }).notNull(),
    force_recalculate: boolean("force_recalculate").notNull().default(false),
    schema_version: integer("schema_version").notNull(),
    input_version: varchar("input_version", { length: 100 }).notNull(),
    scoring_model: varchar("scoring_model", { length: 200 }).notNull(),
    weights_version: varchar("weights_version", { length: 100 }).notNull(),
    score_weights: jsonb("score_weights").$type<Record<string, number>>().notNull(),
    llm_model: varchar("llm_model", { length: 200 }),
    llm_prompt_version: varchar("llm_prompt_version", { length: 100 }),
    job_fingerprint: varchar("job_fingerprint", { length: 64 }).notNull(),
    candidate_fingerprint: varchar("candidate_fingerprint", { length: 64 }).notNull(),
    input_fingerprint: varchar("input_fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("running"),
    ai_mode: varchar("ai_mode", { length: 30 }).notNull().default("rules_only"),
    error: text("error"),
    result_snapshot: jsonb("result_snapshot"),
    started_at: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("match_runs_version_unique").on(table.version),
    index("match_runs_organization_idx").on(table.organization_id),
    index("match_runs_job_candidate_idx").on(table.job_id, table.candidate_id),
    index("match_runs_input_fingerprint_idx").on(table.input_fingerprint),
    index("match_runs_status_idx").on(table.status),
    index("match_runs_started_at_idx").on(table.started_at),
  ]
);

// ============================================
// 匹配状态事件表（追加式历史，避免并发覆盖）
// ============================================
export const matchStatusEvents = pgTable(
  "match_status_events",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    match_record_id: varchar("match_record_id", { length: 36 }).notNull().references(() => matchRecords.id, { onDelete: "cascade" }),
    from_status: varchar("from_status", { length: 20 }),
    status: varchar("status", { length: 20 }).notNull(),
    note: text("note"),
    decision_source: varchar("decision_source", { length: 30 }).notNull().default("human"),
    reason_code: varchar("reason_code", { length: 100 }),
    external_event_id: varchar("external_event_id", { length: 200 }),
    client_event_id: varchar("client_event_id", { length: 36 }),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("match_status_events_organization_idx").on(table.organization_id),
    index("match_status_events_record_created_idx").on(table.match_record_id, table.created_at),
    uniqueIndex("match_status_events_organization_client_event_unique").on(table.organization_id, table.client_event_id),
  ]
);

// ============================================
// 批量匹配任务（数据库队列 + 独立 Worker）
// ============================================
export const matchBatchTasks = pgTable(
  "match_batch_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    job_id: varchar("job_id", { length: 36 }).notNull().references(() => jobRequirements.id, { onDelete: "cascade" }),
    candidate_ids: jsonb("candidate_ids").$type<string[] | null>(),
    candidate_limit: integer("candidate_limit").notNull().default(100),
    top_n: integer("top_n").notNull().default(10),
    candidate_count: integer("candidate_count").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    result: jsonb("result"),
    error_message: text("error_message"),
    worker_id: varchar("worker_id", { length: 100 }),
    lease_until: timestamp("lease_until", { withTimezone: true }),
    attempt_count: integer("attempt_count").notNull().default(0),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("match_batch_tasks_organization_idx").on(table.organization_id),
    index("match_batch_tasks_status_created_idx").on(table.status, table.created_at),
    index("match_batch_tasks_lease_until_idx").on(table.lease_until),
    check(
      "match_batch_tasks_limits",
      sql`${table.candidate_limit} BETWEEN 1 AND 100
        AND ${table.top_n} BETWEEN 1 AND 50
        AND ${table.candidate_count} BETWEEN 0 AND 100
        AND (${table.candidate_ids} IS NULL OR (
          jsonb_typeof(${table.candidate_ids}) = 'array'
          AND jsonb_array_length(${table.candidate_ids}) BETWEEN 1 AND 100
        ))`,
    ),
  ]
);

// ============================================
// 招聘数据源连接
// ============================================
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    connector_type: varchar("connector_type", { length: 50 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("disabled"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    data_boundary_mode: varchar("data_boundary_mode", { length: 30 }).notNull().default("tenant_private"),
    model_endpoint_classification: varchar("model_endpoint_classification", { length: 30 }).notNull().default("none"),
    external_processors: jsonb("external_processors").$type<string[]>().notNull().default([]),
    configuration_encrypted: text("configuration_encrypted"),
    webhook_secret_encrypted: text("webhook_secret_encrypted"),
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_connections_organization_idx").on(table.organization_id),
    uniqueIndex("integration_connections_organization_name_unique").on(table.organization_id, table.name),
  ],
);

export const externalEntityLinks = pgTable(
  "external_entity_links",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    integration_id: varchar("integration_id", { length: 36 }).notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    entity_type: varchar("entity_type", { length: 30 }).notNull(),
    external_id: varchar("external_id", { length: 500 }).notNull(),
    local_entity_id: varchar("local_entity_id", { length: 36 }).notNull(),
    source_updated_at: timestamp("source_updated_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("external_entity_links_source_unique").on(table.integration_id, table.entity_type, table.external_id),
    index("external_entity_links_local_idx").on(table.organization_id, table.entity_type, table.local_entity_id),
  ],
);

export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    integration_id: varchar("integration_id", { length: 36 }).notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 20 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    cursor_before: text("cursor_before"),
    cursor_after: text("cursor_after"),
    processed_count: integer("processed_count").notNull().default(0),
    succeeded_count: integer("succeeded_count").notNull().default(0),
    skipped_count: integer("skipped_count").notNull().default(0),
    failed_count: integer("failed_count").notNull().default(0),
    error_summary: text("error_summary"),
    requested_by: varchar("requested_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_sync_runs_connection_created_idx").on(table.integration_id, table.created_at),
    index("integration_sync_runs_organization_status_idx").on(table.organization_id, table.status),
  ],
);

// ============================================
// 可解释短名单
// ============================================
export const shortlistRuns = pgTable(
  "shortlist_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    job_id: varchar("job_id", { length: 36 }).notNull().references(() => jobRequirements.id, { onDelete: "cascade" }),
    requested_by: varchar("requested_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    request_client_event_id: varchar("request_client_event_id", { length: 36 }).notNull(),
    source_match_batch_task_id: varchar("source_match_batch_task_id", { length: 36 }).references(() => matchBatchTasks.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    candidate_count: integer("candidate_count").notNull().default(0),
    top_n: integer("top_n").notNull().default(10),
    scoring_schema_version: integer("scoring_schema_version").notNull().default(1),
    scoring_weights_version: varchar("scoring_weights_version", { length: 100 }).notNull().default("match-weights-v1"),
    confidence_formula_version: varchar("confidence_formula_version", { length: 100 }).notNull(),
    requested_at: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    review_started_at: timestamp("review_started_at", { withTimezone: true }),
    qualified_at: timestamp("qualified_at", { withTimezone: true }),
    qualified_by: varchar("qualified_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    qualification_client_event_id: varchar("qualification_client_event_id", { length: 36 }),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("shortlist_runs_organization_job_created_idx").on(table.organization_id, table.job_id, table.created_at),
    index("shortlist_runs_status_idx").on(table.status),
    uniqueIndex("shortlist_runs_source_batch_unique").on(table.source_match_batch_task_id),
    uniqueIndex("shortlist_runs_request_client_event_unique").on(table.organization_id, table.request_client_event_id),
    uniqueIndex("shortlist_runs_qualification_client_event_unique").on(table.organization_id, table.qualification_client_event_id),
  ],
);

export const shortlistEntries = pgTable(
  "shortlist_entries",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    shortlist_run_id: varchar("shortlist_run_id", { length: 36 }).notNull().references(() => shortlistRuns.id, { onDelete: "cascade" }),
    match_record_id: varchar("match_record_id", { length: 36 }).references(() => matchRecords.id, { onDelete: "set null" }),
    candidate_id: varchar("candidate_id", { length: 36 }).notNull().references(() => candidates.id, { onDelete: "cascade" }),
    analytics_subject_id: varchar("analytics_subject_id", { length: 36 }).notNull(),
    rank: integer("rank").notNull(),
    recommendation_band: varchar("recommendation_band", { length: 40 }).notNull(),
    confidence_score: integer("confidence_score").notNull(),
    confidence_breakdown: jsonb("confidence_breakdown").$type<{
      jd_completeness: number;
      candidate_completeness: number;
      evidence_coverage: number;
      data_freshness: number;
    }>().notNull(),
    evidence_snapshot: jsonb("evidence_snapshot").$type<Array<{
      criterion_id: string;
      dimension: string;
      finding: string;
      support_level: "supported" | "partial" | "missing" | "conflicting";
      candidate_source_path: string | null;
      candidate_excerpt: string | null;
      job_source_path: string | null;
      job_excerpt: string | null;
    }>>().notNull().default([]),
    missing_information: jsonb("missing_information").$type<string[]>().notNull().default([]),
    human_decision: varchar("human_decision", { length: 30 }).notNull().default("unreviewed"),
    override_reason_code: varchar("override_reason_code", { length: 100 }),
    override_note: text("override_note"),
    reviewed_by: varchar("reviewed_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shortlist_entries_run_candidate_unique").on(table.shortlist_run_id, table.candidate_id),
    uniqueIndex("shortlist_entries_run_rank_unique").on(table.shortlist_run_id, table.rank),
    index("shortlist_entries_organization_decision_idx").on(table.organization_id, table.human_decision),
    check("shortlist_entries_rank_positive", sql`${table.rank} > 0`),
    check("shortlist_entries_confidence_bounds", sql`${table.confidence_score} BETWEEN 0 AND 100`),
  ],
);

export const recommendationDecisionEvents = pgTable(
  "recommendation_decision_events",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    shortlist_entry_id: varchar("shortlist_entry_id", { length: 36 }).references(() => shortlistEntries.id, { onDelete: "set null" }),
    analytics_subject_id: varchar("analytics_subject_id", { length: 36 }).notNull(),
    job_id_snapshot: varchar("job_id_snapshot", { length: 36 }).notNull(),
    recruiter_user_id_snapshot: varchar("recruiter_user_id_snapshot", { length: 36 }),
    department_snapshot: varchar("department_snapshot", { length: 100 }),
    decision: varchar("decision", { length: 30 }).notNull(),
    previous_decision: varchar("previous_decision", { length: 30 }),
    reason_code: varchar("reason_code", { length: 100 }),
    note: text("note"),
    client_event_id: varchar("client_event_id", { length: 36 }).notNull(),
    actor_user_id: varchar("actor_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    recorded_at: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("recommendation_decision_events_client_unique").on(table.organization_id, table.client_event_id),
    index("recommendation_decision_events_entry_recorded_idx").on(table.shortlist_entry_id, table.recorded_at),
    index("recommendation_decision_events_metrics_idx").on(table.organization_id, table.occurred_at),
  ],
);

// ============================================
// 招聘真实结果与候选人权利请求
// ============================================
export const recruitingOutcomeEvents = pgTable(
  "recruiting_outcome_events",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    job_id: varchar("job_id", { length: 36 }).references(() => jobRequirements.id, { onDelete: "set null" }),
    candidate_id: varchar("candidate_id", { length: 36 }).references(() => candidates.id, { onDelete: "set null" }),
    match_record_id: varchar("match_record_id", { length: 36 }).references(() => matchRecords.id, { onDelete: "set null" }),
    analytics_subject_id: varchar("analytics_subject_id", { length: 36 }).notNull(),
    event_type: varchar("event_type", { length: 40 }).notNull(),
    target_stage: varchar("target_stage", { length: 20 }),
    source: varchar("source", { length: 30 }).notNull(),
    client_event_id: varchar("client_event_id", { length: 36 }),
    integration_id: varchar("integration_id", { length: 36 }).references(() => integrationConnections.id, { onDelete: "set null" }),
    external_event_id: varchar("external_event_id", { length: 200 }),
    supersedes_event_id: varchar("supersedes_event_id", { length: 36 }),
    reason_code: varchar("reason_code", { length: 100 }),
    note: text("note"),
    recruiter_user_id: varchar("recruiter_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    recruiter_user_id_snapshot: varchar("recruiter_user_id_snapshot", { length: 36 }),
    department_snapshot: varchar("department_snapshot", { length: 100 }),
    job_id_snapshot: varchar("job_id_snapshot", { length: 36 }).notNull(),
    job_title_snapshot: varchar("job_title_snapshot", { length: 200 }),
    definition_version: varchar("definition_version", { length: 100 }).notNull().default("recruiting-outcome-v1"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recorded_at: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("recruiting_outcome_events_client_unique").on(table.organization_id, table.client_event_id),
    uniqueIndex("recruiting_outcome_events_external_unique").on(table.organization_id, table.integration_id, table.external_event_id),
    uniqueIndex("recruiting_outcome_events_supersedes_unique").on(table.supersedes_event_id),
    index("recruiting_outcome_events_metrics_idx").on(table.organization_id, table.occurred_at),
    index("recruiting_outcome_events_subject_job_idx").on(table.organization_id, table.analytics_subject_id, table.job_id_snapshot),
  ],
);

export const candidateRightsRequests = pgTable(
  "candidate_rights_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    candidate_id: varchar("candidate_id", { length: 36 }).references(() => candidates.id, { onDelete: "set null" }),
    analytics_subject_id: varchar("analytics_subject_id", { length: 36 }).notNull(),
    request_type: varchar("request_type", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    source_reference: varchar("source_reference", { length: 500 }),
    resolution_reference: varchar("resolution_reference", { length: 500 }),
    received_at: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    due_at: timestamp("due_at", { withTimezone: true }).notNull(),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("candidate_rights_requests_organization_due_idx").on(table.organization_id, table.due_at),
    index("candidate_rights_requests_candidate_idx").on(table.candidate_id),
  ],
);

export const communicationBriefs = pgTable(
  "communication_briefs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    shortlist_entry_id: varchar("shortlist_entry_id", { length: 36 }).notNull().references(() => shortlistEntries.id, { onDelete: "cascade" }),
    generated_by: varchar("generated_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    prompt_version: varchar("prompt_version", { length: 100 }).notNull(),
    ai_mode: varchar("ai_mode", { length: 30 }).notNull(),
    candidate_value_points: jsonb("candidate_value_points").$type<string[]>().notNull().default([]),
    facts_to_verify: jsonb("facts_to_verify").$type<string[]>().notNull().default([]),
    interview_questions: jsonb("interview_questions").$type<string[]>().notNull().default([]),
    prohibited_claims: jsonb("prohibited_claims").$type<string[]>().notNull().default([]),
    draft_message: text("draft_message").notNull(),
    review_status: varchar("review_status", { length: 30 }).notNull().default("draft"),
    reviewed_by: varchar("reviewed_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    generated_at: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("communication_briefs_entry_created_idx").on(table.shortlist_entry_id, table.generated_at),
    index("communication_briefs_organization_review_idx").on(table.organization_id, table.review_status),
  ],
);

export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    integration_id: varchar("integration_id", { length: 36 }).notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    analytics_subject_id: varchar("analytics_subject_id", { length: 36 }),
    outcome_event_id: varchar("outcome_event_id", { length: 36 }).references(
      () => recruitingOutcomeEvents.id,
      { onDelete: "set null" },
    ),
    action_type: varchar("action_type", { length: 50 }).notNull(),
    payload_encrypted: text("payload_encrypted"),
    payload_fingerprint: varchar("payload_fingerprint", { length: 64 }),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    client_event_id: varchar("client_event_id", { length: 36 }).notNull(),
    approved_by: varchar("approved_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    approved_at: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
    attempt_count: integer("attempt_count").notNull().default(0),
    next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }),
    last_error: text("last_error"),
    external_receipt: jsonb("external_receipt").$type<Record<string, unknown>>(),
    worker_id: varchar("worker_id", { length: 100 }),
    lease_until: timestamp("lease_until", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("integration_outbox_client_unique").on(table.organization_id, table.client_event_id),
    index("integration_outbox_status_retry_idx").on(table.status, table.next_attempt_at),
    index("integration_outbox_connection_created_idx").on(table.integration_id, table.created_at),
  ],
);

export const scoringWeightVersions = pgTable(
  "scoring_weight_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    weights: jsonb("weights").$type<Record<string, number>>().notNull(),
    status: varchar("status", { length: 20 }).notNull().default("inactive"),
    approved_by: varchar("approved_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("scoring_weight_versions_organization_version_unique").on(table.organization_id, table.version),
    index("scoring_weight_versions_organization_status_idx").on(table.organization_id, table.status),
  ],
);

export const calibrationProposals = pgTable(
  "calibration_proposals",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    reviewed_entries: integer("reviewed_entries").notNull(),
    outreach_events: integer("outreach_events").notNull(),
    completed_interviews: integer("completed_interviews").notNull(),
    metrics_snapshot: jsonb("metrics_snapshot").$type<Record<string, unknown>>().notNull(),
    proposed_weights: jsonb("proposed_weights").$type<Record<string, number>>().notNull(),
    rationale: text("rationale").notNull(),
    source_weights_version_id: varchar("source_weights_version_id", { length: 36 }).references(() => scoringWeightVersions.id, { onDelete: "set null" }),
    approved_weights_version_id: varchar("approved_weights_version_id", { length: 36 }).references(() => scoringWeightVersions.id, { onDelete: "set null" }),
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    reviewed_by: varchar("reviewed_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("calibration_proposals_organization_created_idx").on(table.organization_id, table.created_at),
    index("calibration_proposals_status_idx").on(table.status),
  ],
);

// ============================================
// API 速率限制计数（跨进程、跨实例共享）
// ============================================
export const apiRateLimits = pgTable(
  "api_rate_limits",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 100 }).notNull(),
    window_started_at: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
    request_count: integer("request_count").notNull().default(0),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_rate_limits_subject_scope_unique").on(
      table.organization_id,
      table.user_id,
      table.scope,
    ),
    index("api_rate_limits_updated_at_idx").on(table.updated_at),
  ]
);

// ============================================
// 简历搜索记录表（模拟招聘平台搜索）
// ============================================
export const searchRecords = pgTable(
  "search_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    job_id: varchar("job_id", { length: 36 }).notNull().references(() => jobRequirements.id, { onDelete: "cascade" }),
    search_query: jsonb("search_query").$type<{
      keywords: string[];
      skills: string[];
      location?: string;
      salary_range?: string;
      experience_range?: string;
    }>(),
    results_count: integer("results_count"),
    candidates_found: jsonb("candidates_found").$type<string[]>(), // 候选人ID列表
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("search_records_organization_idx").on(table.organization_id),
    index("search_records_job_id_idx").on(table.job_id),
    index("search_records_created_at_idx").on(table.created_at),
  ]
);

// ============================================
// 授权记录表（合规）
// ============================================
export const authorizationRecords = pgTable(
  "authorization_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    candidate_id: varchar("candidate_id", { length: 36 }).notNull().references(() => candidates.id, { onDelete: "cascade" }),
    authorized_at: timestamp("authorized_at", { withTimezone: true }).defaultNow().notNull(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    purpose: varchar("purpose", { length: 500 }).notNull().default("招聘匹配与沟通"),
    processing_expires_at: timestamp("processing_expires_at", { withTimezone: true }),
    source_type: varchar("source_type", { length: 50 }),
    source_reference: varchar("source_reference", { length: 500 }),
    proof_type: varchar("proof_type", { length: 50 }),
    proof_reference: varchar("proof_reference", { length: 1000 }),
    proof_sha256: varchar("proof_sha256", { length: 64 }),
    notice_version: varchar("notice_version", { length: 100 }),
    notice_snapshot: jsonb("notice_snapshot").$type<Record<string, unknown>>(),
    notice_text_sha256: varchar("notice_text_sha256", { length: 64 }),
    external_processors: jsonb("external_processors").$type<string[]>(),
    automated_decision_disclosed: boolean("automated_decision_disclosed").default(false),
    automated_decision_preference: varchar("automated_decision_preference", { length: 30 }),
    automated_decision_objected_at: timestamp("automated_decision_objected_at", { withTimezone: true }),
    automated_decision_objection_reference: varchar("automated_decision_objection_reference", { length: 500 }),
    automated_decision_objected_by_user_id: varchar("automated_decision_objected_by_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    impact_assessment_reference: varchar("impact_assessment_reference", { length: 500 }),
    impact_assessment_completed_at: timestamp("impact_assessment_completed_at", { withTimezone: true }),
    collected_by_user_id: varchar("collected_by_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    collection_context_sha256: varchar("collection_context_sha256", { length: 64 }),
    evidence_sha256: varchar("evidence_sha256", { length: 64 }),
    evidence_status: varchar("evidence_status", { length: 30 }).notNull().default("legacy_unverified"),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("authorization_records_organization_idx").on(table.organization_id),
    index("authorization_records_candidate_id_idx").on(table.candidate_id),
    uniqueIndex("authorization_records_candidate_active_unique")
      .on(table.candidate_id)
      .where(sql`${table.is_active} = true`),
    index("authorization_records_expiry_idx").on(table.processing_expires_at),
    index("authorization_records_evidence_status_idx").on(table.evidence_status),
  ]
);

// ============================================
// 审计日志表（合规）
// ============================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }),
    action: varchar("action", { length: 100 }).notNull(),
    target_type: varchar("target_type", { length: 50 }).notNull(),
    target_id: varchar("target_id", { length: 36 }),
    details: jsonb("details"),
    ip_address: varchar("ip_address", { length: 50 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_organization_idx").on(table.organization_id),
    index("audit_logs_user_id_idx").on(table.user_id),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_at_idx").on(table.created_at),
  ]
);

// ============================================
// Boss直聘搜索任务表（云端任务队列 + 本地Worker执行）
// ============================================
export const bossSearchTasks = pgTable(
  "boss_search_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    jd_content: text("jd_content").notNull(),
    city: varchar("city", { length: 100 }),
    keywords: jsonb("keywords").notNull().$type<Array<{ keyword: string; count: number }>>(),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    expected_count: integer("expected_count").default(0),
    total_candidates: integer("total_candidates").default(0),
    invalid_count: integer("invalid_count").default(0),
    task_dir: varchar("task_dir", { length: 500 }),
    manifest: jsonb("manifest"),
    result_summary: jsonb("result_summary"),
    report_requested: boolean("report_requested").default(false),
    report_status: varchar("report_status", { length: 50 }),
    error_message: text("error_message"),
    worker_id: varchar("worker_id", { length: 100 }),
    lease_until: timestamp("lease_until", { withTimezone: true }),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("boss_search_tasks_organization_idx").on(table.organization_id),
    index("boss_search_tasks_status_created_idx").on(table.status, table.created_at),
    index("boss_search_tasks_user_created_idx").on(table.user_id, table.created_at),
    index("boss_search_tasks_lease_until_idx").on(table.lease_until),
  ]
);

// ============================================
// Boss候选人联系请求表（网页请求，本地Worker打开Boss候选人）
// ============================================
export const bossContactRequests = pgTable(
  "boss_contact_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    task_id: varchar("task_id", { length: 36 }).notNull().references(() => bossSearchTasks.id, { onDelete: "cascade" }),
    candidate_index: integer("candidate_index").notNull(),
    requested_by: varchar("requested_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 50 }).notNull().default("requested"),
    error_message: text("error_message"),
    opened_at: timestamp("opened_at", { withTimezone: true }),
    closed_at: timestamp("closed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("boss_contact_requests_organization_idx").on(table.organization_id),
    index("boss_contact_requests_status_created_idx").on(table.status, table.created_at),
    index("boss_contact_requests_task_candidate_idx").on(table.task_id, table.candidate_index, table.created_at),
  ]
);

// ============================================
// 简历批处理：钉钉 MCP 凭证
// ============================================
export const resumeBatchCredentials = pgTable(
  "resume_batch_credentials",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    mcp_url_encrypted: text("mcp_url_encrypted").notNull(),
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("resume_batch_credentials_organization_name_unique").on(table.organization_id, table.name),
    index("resume_batch_credentials_organization_idx").on(table.organization_id),
    index("resume_batch_credentials_created_at_idx").on(table.created_at),
  ]
);

// ============================================
// 简历批处理：租户级模型与文案配置
// ============================================
export const resumeBatchSettings = pgTable(
  "resume_batch_settings",
  {
    organization_id: varchar("organization_id", { length: 36 })
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    llm_api_key_encrypted: text("llm_api_key_encrypted"),
    llm_base_url: varchar("llm_base_url", { length: 500 }),
    text_model: varchar("text_model", { length: 200 }),
    vision_model: varchar("vision_model", { length: 200 }),
    workers: integer("workers"),
    style_sample: text("style_sample"),
    updated_by: varchar("updated_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("resume_batch_settings_workers_check", sql`${table.workers} IS NULL OR (${table.workers} >= 1 AND ${table.workers} <= 32)`),
  ]
);

// ============================================
// 简历批处理：钉钉表格预设
// ============================================
export const resumeBatchSheets = pgTable(
  "resume_batch_sheets",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    sheet_url: text("sheet_url").notNull(),
    worksheet_id: varchar("worksheet_id", { length: 200 }),
    credential_id: varchar("credential_id", { length: 36 })
      .notNull()
      .references(() => resumeBatchCredentials.id, { onDelete: "restrict" }),
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("resume_batch_sheets_organization_idx").on(table.organization_id),
    index("resume_batch_sheets_credential_idx").on(table.credential_id),
    index("resume_batch_sheets_created_at_idx").on(table.created_at),
  ]
);

// ============================================
// 简历批处理任务（云端队列 + 本地 Worker）
// ============================================
export const resumeBatchTasks = pgTable(
  "resume_batch_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    organization_id: varchar("organization_id", { length: 36 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    sheet_preset_id: varchar("sheet_preset_id", { length: 36 }).references(() => resumeBatchSheets.id, { onDelete: "set null" }),
    credential_id: varchar("credential_id", { length: 36 }).references(() => resumeBatchCredentials.id, { onDelete: "set null" }),
    sheet_name: varchar("sheet_name", { length: 200 }).notNull(),
    sheet_url: text("sheet_url").notNull(),
    worksheet_id: varchar("worksheet_id", { length: 200 }),
    files: jsonb("files").notNull().$type<Array<{
      name: string;
      storage_path: string;
      size: number;
    }>>(),
    overwrite: boolean("overwrite").notNull().default(false),
    dry_run: boolean("dry_run").notNull().default(false),
    status: varchar("status", { length: 50 }).notNull().default("uploading"),
    logs: jsonb("logs").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    result: jsonb("result"),
    error_message: text("error_message"),
    worker_id: varchar("worker_id", { length: 100 }),
    lease_until: timestamp("lease_until", { withTimezone: true }),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("resume_batch_tasks_organization_idx").on(table.organization_id),
    index("resume_batch_tasks_status_created_idx").on(table.status, table.created_at),
    index("resume_batch_tasks_user_created_idx").on(table.user_id, table.created_at),
    index("resume_batch_tasks_lease_until_idx").on(table.lease_until),
  ]
);

// ============================================
// Zod Schemas
// ============================================
const { createInsertSchema: createCoercedInsertSchema } = createSchemaFactory({ coerce: { date: true } });

export const insertJobRequirementSchema = createCoercedInsertSchema(jobRequirements).pick({
  title: true,
  department: true,
  location: true,
  salary_range: true,
  experience_required: true,
  education_required: true,
  skills_required: true,
  bonus_skills: true,
  responsibilities: true,
  benefits: true,
  urgency: true,
  raw_jd: true,
});

export const insertCandidateSchema = createCoercedInsertSchema(candidates).pick({
  name: true,
  email: true,
  phone: true,
  resume_url: true,
  skills: true,
  experience_years: true,
  verified_experience_years: true,
  experience_years_status: true,
  experience_years_evidence: true,
  education: true,
  current_company: true,
  current_position: true,
  current_city: true,
  preferred_locations: true,
  salary_expectation: true,
  salary_min: true,
  salary_max: true,
  availability: true,
  job_change_frequency: true,
  work_history: true,
  resume_text: true,
  notes: true,
  data_source: true,
  is_authorized: true,
});

export const insertMatchRecordSchema = createCoercedInsertSchema(matchRecords).pick({
  job_id: true,
  candidate_id: true,
  status: true,
});

export const insertSearchRecordSchema = createCoercedInsertSchema(searchRecords).pick({
  job_id: true,
  search_query: true,
  results_count: true,
  candidates_found: true,
});

export const insertAuthorizationRecordSchema = createCoercedInsertSchema(authorizationRecords).pick({
  candidate_id: true,
  purpose: true,
  processing_expires_at: true,
  source_type: true,
  source_reference: true,
  proof_type: true,
  proof_reference: true,
  proof_sha256: true,
  notice_version: true,
  notice_snapshot: true,
  notice_text_sha256: true,
  external_processors: true,
  automated_decision_disclosed: true,
  automated_decision_preference: true,
  impact_assessment_reference: true,
  impact_assessment_completed_at: true,
  collected_by_user_id: true,
  collection_context_sha256: true,
  evidence_sha256: true,
  evidence_status: true,
});

export const insertAuditLogSchema = createCoercedInsertSchema(auditLogs).pick({
  user_id: true,
  action: true,
  target_type: true,
  target_id: true,
  details: true,
  ip_address: true,
});

// ============================================
// Type Exports
// ============================================
export type JobRequirement = typeof jobRequirements.$inferSelect;
export type InsertJobRequirement = z.infer<typeof insertJobRequirementSchema>;

export type Candidate = typeof candidates.$inferSelect;
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;

export type MatchRecord = typeof matchRecords.$inferSelect;
export type InsertMatchRecord = z.infer<typeof insertMatchRecordSchema>;
export type MatchStatusEvent = typeof matchStatusEvents.$inferSelect;
export type MatchBatchTask = typeof matchBatchTasks.$inferSelect;

export type MatchRun = typeof matchRuns.$inferSelect;
export type ShortlistRun = typeof shortlistRuns.$inferSelect;
export type ShortlistEntry = typeof shortlistEntries.$inferSelect;
export type RecommendationDecisionEvent = typeof recommendationDecisionEvents.$inferSelect;
export type RecruitingOutcomeEvent = typeof recruitingOutcomeEvents.$inferSelect;
export type CandidateRightsRequest = typeof candidateRightsRequests.$inferSelect;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type IntegrationSyncRun = typeof integrationSyncRuns.$inferSelect;
export type IntegrationOutboxItem = typeof integrationOutbox.$inferSelect;
export type CommunicationBrief = typeof communicationBriefs.$inferSelect;
export type ScoringWeightVersion = typeof scoringWeightVersions.$inferSelect;
export type CalibrationProposal = typeof calibrationProposals.$inferSelect;

export type SearchRecord = typeof searchRecords.$inferSelect;
export type InsertSearchRecord = z.infer<typeof insertSearchRecordSchema>;

// ============================================
// Status Enums
// ============================================
export const JOB_STATUS = {
  ACTIVE: "active",
  CLOSED: "closed",
  DRAFT: "draft",
} as const;

export const MATCH_STATUS = {
  PENDING: "pending",          // 待接触
  CONTACTED: "contacted",      // 已联系
  INTERVIEWING: "interviewing", // 面试中
  OFFERED: "offered",          // 已发offer
  HIRED: "hired",              // 已录用
  REJECTED: "rejected",        // 已拒绝
  WITHDRAWN: "withdrawn",      // 候选人撤回
} as const;

export const AVAILABILITY_OPTIONS = {
  IMMEDIATELY: "immediately",  // 随时到岗
  ONE_WEEK: "1week",          // 1周内
  TWO_WEEKS: "2weeks",        // 2周内
  ONE_MONTH: "1month",        // 1个月内
  NEGOTIABLE: "negotiable",   // 面议
} as const;

export const URGENCY_OPTIONS = {
  URGENT: "urgent",   // 紧急
  NORMAL: "normal",   // 常规
} as const;

// ============================================
// 评分权重配置（按方案文档）
// ============================================
export const SCORE_WEIGHTS = {
  SKILL: 0.35,        // 技术栈匹配 35%
  EXPERIENCE: 0.25,   // 经验匹配 25%
  SALARY: 0.15,       // 薪资匹配 15%
  LOCATION: 0.10,     // 地域匹配 10%
  AVAILABILITY: 0.10, // 到岗时间 10%
  STABILITY: 0.05,    // 稳定性评估 5%
} as const;

// 保留系统表（禁止删除）
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow(),
});
