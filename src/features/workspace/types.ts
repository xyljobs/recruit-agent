export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: string;
  company?: string;
  must_change_password: boolean;
}

export interface Job {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  salary_range: string | null;
  experience_required: string | null;
  education_required: string | null;
  skills_required: string[] | null;
  bonus_skills: string[] | null;
  responsibilities: string[] | null;
  benefits: string[] | null;
  urgency: string | null;
  implicit_requirements: string[] | null;
  completeness: number | null;
  missing_fields: string[] | null;
  status: string;
  created_at: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  current_company: string | null;
  current_position: string | null;
  experience_years: number | null;
  education: string | null;
  skills: string[] | null;
  resume_text: string | null;
  created_at: string;
  authorization: CandidateAuthorizationEvidence | null;
}

export interface CandidateAuthorizationEvidence {
  id: string;
  authorized_at: string;
  revoked_at: string | null;
  purpose: string;
  processing_expires_at: string | null;
  source_type: string | null;
  source_reference: string | null;
  proof_type: string | null;
  proof_reference: string | null;
  proof_sha256: string | null;
  notice_version: string | null;
  external_processors: string[] | null;
  automated_decision_preference: string | null;
  automated_decision_objected_at: string | null;
  impact_assessment_reference: string | null;
  impact_assessment_completed_at: string | null;
  evidence_sha256: string | null;
  evidence_status: string;
  is_active: boolean;
}

export interface MatchRecord {
  id: string;
  job_id: string;
  candidate_id: string;
  overall_score: number | null;
  skill_score: number | null;
  experience_score: number | null;
  education_score: number | null;
  salary_score: number | null;
  location_score: number | null;
  availability_score: number | null;
  stability_score: number | null;
  culture_fit_score: number | null;
  scoring_status: 'pending' | 'succeeded' | 'failed';
  scoring_model: string | null;
  scoring_prompt_version: string | null;
  llm_status: 'not_requested' | 'succeeded' | 'failed';
  llm_error: string | null;
  llm_model: string | null;
  llm_prompt_version: string | null;
  supplement_status?: 'succeeded' | 'unavailable';
  match_details: {
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
  } | null;
  status: string;
  generated_script: string | null;
  created_at: string;
  job: { id: string; title: string } | null;
  candidate: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

export interface DashboardStats {
  totalJobs: number;
  totalCandidates: number;
  totalMatches: number;
  pending: number;
  contacted: number;
  interviewing: number;
  offered: number;
  hired: number;
  rejected: number;
  withdrawn: number;
}

export interface EfficiencyComparison {
  screening_time: { manual: string; agent: string; improvement: string };
  daily_positions: { manual: string; agent: string; improvement: string };
  match_accuracy: { manual: string; agent: string; improvement: string };
  cost_per_position: { manual: string; agent: string; improvement: string };
  response_rate: { manual: string; agent: string; improvement: string };
}

export interface FunnelData {
  stage: string;
  count: number;
  rate: number;
  fill?: string;
}

export interface CandidateForm {
  name: string;
  email: string;
  phone: string;
  current_company: string;
  current_position: string;
  experience_years: number;
  education: string;
  skills: string[];
  resume_text: string;
  current_city: string;
  preferred_locations: string[];
  salary_expectation: string;
  salary_min: number;
  salary_max: number;
  availability: string;
  job_change_frequency: number | null;
  authorization: CandidateAuthorizationForm;
}

export interface CandidateAuthorizationForm {
  confirmed: boolean;
  source_type: string;
  source_reference: string;
  proof_type: string;
  proof_reference: string;
  proof_sha256: string;
  controller_name: string;
  controller_contact: string;
  authorized_at: string;
  processing_expires_at: string;
  external_processors_text: string;
  automated_decision_preference: string;
  impact_assessment_reference: string;
  impact_assessment_completed_at: string;
}
