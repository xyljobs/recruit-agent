import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateManufacturingMatchScore } from './manufacturing-scorer';

const plcJob = {
  title: 'PLC/电气自动化工程师',
  raw_jd: '工业产线PLC编程、电气设计、现场调试与客户验收。',
  experience_required: '3年以上',
  location: '杭州',
  salary_min: 15,
  salary_max: 22,
};

test('missing manufacturing evidence remains UNKNOWN instead of becoming a hard fail', () => {
  const score = calculateManufacturingMatchScore(
    plcJob,
    { resume_text: '自动化相关工作，具体项目内容未提供。' },
  );

  assert.ok(score?.match_details.manufacturing_analysis);
  assert.equal(score.match_details.manufacturing_analysis.hard_fail, false);
  assert.equal(
    score.match_details.manufacturing_analysis.hard_gates.find(gate => gate.code === 'H2')?.result,
    'UNKNOWN',
  );
  assert.equal(score.overall_score, score.skill_score);
});

test('a manufacturing job with no resume text stays in an insufficient evidence state', () => {
  const score = calculateManufacturingMatchScore(plcJob, {});

  assert.ok(score?.match_details.manufacturing_analysis);
  assert.equal(score.match_details.manufacturing_analysis.hard_fail, false);
  assert.equal(score.match_details.manufacturing_analysis.hard_gates.every(gate => gate.result === 'UNKNOWN'), true);
  assert.equal(score.overall_score, 0);
  assert.equal(score.experience_score, 50);
});

test('an explicit PLC role boundary is a supported hard fail', () => {
  const score = calculateManufacturingMatchScore(
    plcJob,
    {
      resume_text: '负责工业产线控制柜接线和通电检查，PLC程序由软件工程师负责。',
    },
  );

  assert.equal(score?.match_details.manufacturing_analysis?.hard_fail, true);
  assert.equal(
    score?.match_details.manufacturing_analysis?.hard_gates.find(gate => gate.code === 'H2')?.result,
    'FAIL',
  );
  assert.equal(score?.overall_score, 0);
});

test('robot scoring separately captures programming, calibration, PLC integration, process, and delivery', () => {
  const score = calculateManufacturingMatchScore(
    {
      title: '工业机器人应用/调试工程师',
      raw_jd: '工业机器人工作站应用调试与交付',
      experience_required: '2年以上',
    },
    {
      resume_text: [
        '上海发那科工业机器人应用工程师，负责机器人程序编写与现场调试。',
        '完成Roboguide仿真、工具坐标和视觉零位标定、轨迹优化。',
        '配置Profinet通讯、DCS安全信号和双机干涉区，配合集成商完成PLC联调。',
        '覆盖搬运、码垛、点焊、弧焊、涂胶和视觉应用。',
        '作为现场经理完成730台机器人上电、客户培训和问题处理。',
      ].join('\n'),
      experience_years: 2.4,
    },
  );

  const analysis = score?.match_details.manufacturing_analysis;
  assert.ok(analysis);
  assert.equal(analysis.role_id, 'MFG-ROB-V1');
  assert.equal(analysis.hard_fail, false);
  assert.equal(analysis.hard_gates.every(gate => gate.result !== 'FAIL'), true);
  assert.ok((analysis.criteria.find(row => row.code === 'C1')?.score ?? 0) >= 20);
  assert.ok((analysis.criteria.find(row => row.code === 'C2')?.score ?? 0) >= 10);
  assert.ok((analysis.criteria.find(row => row.code === 'C3')?.score ?? 0) >= 10);
  assert.ok((analysis.criteria.find(row => row.code === 'C4')?.score ?? 0) >= 10);
  assert.ok((analysis.criteria.find(row => row.code === 'C5')?.score ?? 0) >= 10);
});

test('HR partial or unknown experience is neutral and never converted to zero years', () => {
  const score = calculateManufacturingMatchScore(
    plcJob,
    {
      resume_text: '负责S7-1500 PLC程序开发、HMI、现场调试和FAT/SAT验收。',
      experience_years: 8,
    },
    {
      verified_experience_years: 0.4,
      experience_years_status: '部分确认',
      experience_years_evidence: '一段经历有日期，其他经历未标日期。',
    },
  );

  assert.equal(score?.experience_score, 50);
  assert.equal(score?.match_details.manufacturing_analysis?.experience_review.status, 'partial');
  assert.equal(score?.match_details.manufacturing_analysis?.experience_review.years, null);
  assert.ok(score?.match_details.gaps.includes('工作年限无法完整确认，不按0年惩罚'));
});

test('maintenance administrative evidence cannot masquerade as independent troubleshooting', () => {
  const score = calculateManufacturingMatchScore(
    {
      title: '设备维护工程师',
      raw_jd: '生产设备维护、独立故障诊断、预防性维护和倒班。',
      experience_required: '3年以上',
    },
    {
      resume_text: [
        '机械设备工程师，负责设备投资预算编制、采购立项和寻价采购。',
        '负责固定资产、计量仪器、量检具计量和设备体系审核。',
        '编制设备维护保养规程并进行备件库管理。',
      ].join('\n'),
      experience_years: 3.8,
    },
  );

  const analysis = score?.match_details.manufacturing_analysis;
  assert.ok(analysis);
  assert.equal(analysis.hard_gates.find(gate => gate.code === 'H2')?.result, 'FAIL');
  assert.equal(analysis.hard_fail, true);
  assert.equal(score?.overall_score, 0);
});

test('location, salary, travel or shift, and availability stay pending when absent', () => {
  const score = calculateManufacturingMatchScore(
    {
      title: '设备维护工程师',
      raw_jd: '生产设备维修和倒班。',
      location: '杭州',
      salary_min: 10,
      salary_max: 16,
    },
    {
      resume_text: '负责工厂生产设备故障排查、抢修、巡检和预防性维护。',
    },
  );

  const analysis = score?.match_details.manufacturing_analysis;
  assert.ok(analysis);
  assert.equal(analysis.hard_fail, false);
  assert.equal(analysis.hard_gates.find(gate => gate.code === 'H4')?.result, 'UNKNOWN');
  assert.deepEqual(analysis.pending_business_checks, ['工作地点', '薪资期望', '倒班接受性', '到岗时间']);
  assert.equal(score?.salary_score, 50);
  assert.equal(score?.location_score, 50);
  assert.equal(score?.availability_score, 50);
});
