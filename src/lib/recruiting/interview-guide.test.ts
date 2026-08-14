import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoProhibitedTopic,
  buildRulesOnlyInterviewGuide,
  canPrepareInterviewGuide,
  interviewGuideContentSchema,
  parseBankBulkText,
  parseModelInterviewGuide,
  PROHIBITED_INTERVIEW_TOPICS,
  type CommonBankQuestion,
  type InterviewGuideSourceInput,
} from './interview-guide';

const commonQuestions: CommonBankQuestion[] = [
  { id: 'bank-1', question: '请做一个不超过三分钟的自我介绍，重点介绍与岗位相关的经历。', dimension: '自我介绍' },
  { id: 'bank-2', question: '你未来三年的职业规划是什么？', dimension: '职业规划' },
  { id: 'bank-3', question: '你离开上一家公司的原因是什么？', dimension: '离职原因' },
  { id: 'bank-4', question: '你的期望薪资范围是多少？', dimension: '薪酬期望' },
];

const baseInput: InterviewGuideSourceInput = {
  evidence: [
    { finding: '团队管理年限尚不明确', support_level: 'partial', dimension: '管理经验' },
    { finding: '具备 React 项目经验', support_level: 'supported', dimension: '前端技能' },
  ],
  gaps: ['未提供到岗时间'],
  missing_information: ['期望薪资结构'],
  boundary_flags: [],
  resume_text: null,
};

// 1. 禁问词拦截：每一类禁止话题都必须被拦下
test('prohibited topics are rejected one by one', () => {
  for (const topic of PROHIBITED_INTERVIEW_TOPICS) {
    assert.throws(
      () => assertNoProhibitedTopic(`请问你的${topic}情况如何？`),
      /禁止询问/,
      `话题「${topic}」应被拦截`,
    );
  }
  // 与禁问词无关的普通题目放行
  assertNoProhibitedTopic('请介绍你负责过的核心项目');
});

// 2. 四来源专项题：各自触发与不触发
test('targeted question sources trigger per evidence type', () => {
  const output = buildRulesOnlyInterviewGuide(commonQuestions, baseInput);
  const questions = output.targeted_questions.map(item => item.question);

  // depth_check：partial/conflicting 触发，supported 不触发
  assert.ok(questions.some(question => question.includes('团队管理年限尚不明确')));
  assert.ok(questions.every(question => !question.includes('React 项目经验')));

  // evidence_gap：gaps 与 missing_information 都触发
  assert.ok(questions.some(question => question.includes('未提供到岗时间')));
  assert.ok(questions.some(question => question.includes('期望薪资结构')));

  // boundary_risk：三条模板按 code 命中
  const boundaryOutput = buildRulesOnlyInterviewGuide(commonQuestions, {
    ...baseInput,
    evidence: [],
    gaps: [],
    missing_information: [],
    boundary_flags: [
      { code: 'experience_boundary', label: '年限边界' },
      { code: 'frequent_job_change', label: '频繁跳槽' },
      { code: 'cross_city', label: '跨城' },
    ],
  });
  const boundaryQuestions = boundaryOutput.targeted_questions.map(item => item.question);
  assert.ok(boundaryQuestions.some(question => question.includes('年限与岗位定位存在差异')));
  assert.ok(boundaryQuestions.some(question => question.includes('近两次变动的原因')));
  assert.ok(boundaryQuestions.some(question => question.includes('到岗时间与长期工作地')));
  assert.ok(boundaryOutput.targeted_questions.some(item => item.origin === 'boundary_risk'));

  // 空边界输入不产出 boundary_risk 题
  assert.ok(output.targeted_questions.every(item => item.origin !== 'boundary_risk'));

  // resume_probe：rules_only 不产出该 origin
  assert.ok(output.targeted_questions.every(item => item.origin !== 'resume_probe'));
});

// 3. 公共题原文严格相等（防改写回归）：生成结果与题库原文逐字一致
test('common questions keep the exact bank wording without AI rewriting', () => {
  const output = buildRulesOnlyInterviewGuide(commonQuestions, baseInput);
  assert.equal(output.common_questions.length, commonQuestions.length);
  output.common_questions.forEach((item, index) => {
    assert.strictEqual(item.question, commonQuestions[index].question);
    assert.strictEqual(item.bank_id, commonQuestions[index].id);
    assert.strictEqual(item.dimension, commonQuestions[index].dimension);
  });
});

// 4. rules_only 输出通过 schema 且专项题不少于 6 条
test('rules-only output satisfies the content schema with at least 6 targeted questions', () => {
  const withEvidence = buildRulesOnlyInterviewGuide(commonQuestions, baseInput);
  assert.doesNotThrow(() => interviewGuideContentSchema.parse(withEvidence));
  assert.ok(withEvidence.targeted_questions.length >= 6);
  assert.ok(withEvidence.targeted_questions.length <= 10);
  assert.ok(withEvidence.common_questions.length <= 4);
  assert.ok(withEvidence.focus_areas.length <= 6);

  // 无证据、无缺口、无边界时仍用兜底题补齐到 6 条
  const emptyInput: InterviewGuideSourceInput = {
    evidence: [],
    gaps: [],
    missing_information: [],
    boundary_flags: [],
    resume_text: null,
  };
  const fallback = buildRulesOnlyInterviewGuide(commonQuestions, emptyInput);
  assert.doesNotThrow(() => interviewGuideContentSchema.parse(fallback));
  assert.equal(fallback.targeted_questions.length, 6);
  // 兜底题序号递增，互相不重复
  const unique = new Set(fallback.targeted_questions.map(item => item.question));
  assert.equal(unique.size, 6);
});

// 5. bulk_text 解析：正常行、缺字段行、超长行、重复行
test('bulk text parser handles valid, malformed, oversized, and duplicate lines', () => {
  const longQuestion = '题'.repeat(501);
  const text = [
    '请描述你主导过的最复杂项目 | 项目经验 | 主导角色；量化结果',
    '你如何与跨部门团队协作解决冲突｜协作能力｜冲突处理实例',
    '这一行没有分隔符',
    `${longQuestion} | 项目经验`,
    '请描述你主导过的最复杂项目 | 项目经验',
    '',
  ].join('\n');

  const lines = parseBankBulkText(text);
  assert.equal(lines.length, 5);

  const first = lines[0];
  assert.equal(first.error, null);
  assert.equal(first.question, '请描述你主导过的最复杂项目');
  assert.equal(first.dimension, '项目经验');
  assert.deepEqual(first.expected_signals, ['主导角色', '量化结果']);

  // 全角分隔符同样解析
  const second = lines[1];
  assert.equal(second.error, null);
  assert.equal(second.dimension, '协作能力');

  const missing = lines[2];
  assert.notEqual(missing.error, null);
  assert.match(missing.error ?? '', /字段不足/);

  const oversized = lines[3];
  assert.match(oversized.error ?? '', /500 字上限/);

  // 与第 1 行题目重复，本批次内拦截
  const duplicate = lines[4];
  assert.match(duplicate.error ?? '', /重复/);
});

// 6. canPrepareInterviewGuide 四种决策状态：接受与覆盖均可推进，且需快照与最新事件一致
test('interview guide requires the snapshot and latest event to agree on accepted or overridden', () => {
  assert.equal(canPrepareInterviewGuide('accepted', 'accepted'), true);
  assert.equal(canPrepareInterviewGuide('overridden', 'overridden'), true);
  assert.equal(canPrepareInterviewGuide('accepted', 'overridden'), false);
  assert.equal(canPrepareInterviewGuide('overridden', 'accepted'), false);
  assert.equal(canPrepareInterviewGuide('accepted', null), false);
  assert.equal(canPrepareInterviewGuide('needs_information', 'needs_information'), false);
  assert.equal(canPrepareInterviewGuide('unreviewed', undefined), false);
});

test('model guide parser accepts strict JSON without common questions and rejects extra fields', () => {
  const result = parseModelInterviewGuide(`\`\`\`json
  {
    "focus_areas": [{ "dimension": "管理经验", "why": "证据冲突", "must_verify": true }],
    "common_questions": [],
    "targeted_questions": [
      { "question": "请介绍项目", "dimension": "项目经验", "origin": "depth_check", "expected_signals": [], "probe_followups": [], "scoring_anchors": [] },
      { "question": "请说明缺口", "dimension": "到岗时间", "origin": "evidence_gap", "expected_signals": [], "probe_followups": [], "scoring_anchors": [] },
      { "question": "简历追问", "dimension": "项目经验", "origin": "resume_probe", "expected_signals": [], "probe_followups": [], "scoring_anchors": [] },
      { "question": "边界说明", "dimension": "年限", "origin": "boundary_risk", "expected_signals": [], "probe_followups": [], "scoring_anchors": [] },
      { "question": "兜底一", "dimension": "综合", "origin": "depth_check", "expected_signals": [], "probe_followups": [], "scoring_anchors": [] },
      { "question": "兜底二", "dimension": "综合", "origin": "depth_check", "expected_signals": [], "probe_followups": [], "scoring_anchors": [] }
    ],
    "red_flags_to_check": ["核实管理年限"],
    "interview_loop": [{ "round": 1, "focus": "初面", "minutes": 45, "interviewer_role": "HR" }],
    "prohibited_topics": ["婚姻与生育计划"]
  }
  \`\`\``);
  assert.equal(result.common_questions.length, 0);
  assert.equal(result.targeted_questions.length, 6);

  assert.throws(() => parseModelInterviewGuide(JSON.stringify({
    focus_areas: [],
    common_questions: [],
    targeted_questions: [],
    red_flags_to_check: [],
    interview_loop: [],
    prohibited_topics: [],
    score: 99,
  })));
});
