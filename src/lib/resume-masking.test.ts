import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maskCandidateName,
  maskCompanyName,
  maskResumeText,
} from './resume-masking';

test('maskCandidateName keeps only the first character', () => {
  assert.equal(maskCandidateName('张三'), '张*');
  assert.equal(maskCandidateName('李小龙'), '李**');
  assert.equal(maskCandidateName('John'), 'J***');
  assert.equal(maskCandidateName(null), '候选人');
  assert.equal(maskCandidateName('  '), '候选人');
});

test('maskCompanyName keeps first and last characters', () => {
  assert.equal(maskCompanyName('北京字节跳动科技'), '北******技');
  assert.equal(maskCompanyName('华为'), '**');
  assert.equal(maskCompanyName(null), '');
});

test('maskResumeText masks phone numbers keeping first 3 and last 4 digits', () => {
  assert.equal(
    maskResumeText('联系电话：13812345678'),
    '联系电话：138****5678',
  );
  assert.equal(
    maskResumeText('电话 +86 138-1234-5678 备用'),
    '电话 +86 138-1234-5678 备用',
  );
  assert.equal(
    maskResumeText('座机 010-12345678 不应被误伤'),
    '座机 010-12345678 不应被误伤',
  );
});

test('maskResumeText masks email addresses keeping domain', () => {
  assert.equal(
    maskResumeText('邮箱 zhangsan@qq.com'),
    '邮箱 z***@qq.com',
  );
  assert.equal(
    maskResumeText('联系 li.wei@company.cn'),
    '联系 l***@company.cn',
  );
});

test('maskResumeText masks 18-digit ID card numbers keeping first 6 and last 4', () => {
  assert.equal(
    maskResumeText('证件号 110101199001011234'),
    '证件号 110101********1234',
  );
  assert.equal(
    maskResumeText('证件号 11010119900101123X'),
    '证件号 110101********123X',
  );
});

test('maskResumeText replaces known name and company identifiers', () => {
  const text = '张三，男，曾任职于北京字节跳动科技，负责 PLC 电控。';
  const masked = maskResumeText(text, {
    names: ['张三'],
    companies: ['北京字节跳动科技'],
  });
  assert.equal(
    masked,
    '张*，男，曾任职于北******技，负责 PLC 电控。',
  );
});

test('maskResumeText replaces longer identifiers before shorter ones', () => {
  const text = '张三与张三丰是同事';
  assert.equal(
    maskResumeText(text, { names: ['张三', '张三丰'] }),
    '张*与张**是同事',
  );
});

test('maskResumeText leaves unrelated text untouched', () => {
  assert.equal(
    maskResumeText('5 年 PLC 编程经验，熟悉西门子 S7-1500'),
    '5 年 PLC 编程经验，熟悉西门子 S7-1500',
  );
  assert.equal(maskResumeText(''), '');
});
