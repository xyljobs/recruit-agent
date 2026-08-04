const MIN_PASSWORD_LENGTH = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;
const COMMON_PASSWORD_FRAGMENTS = [
  'password',
  'qwerty',
  '123456',
  'admin',
  'letmein',
  'welcome',
];

export function getPasswordValidationError(password: unknown): string | null {
  if (typeof password !== 'string') {
    return '密码格式无效';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码至少需要 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (new TextEncoder().encode(password).length > MAX_BCRYPT_PASSWORD_BYTES) {
    return '密码过长';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return '密码必须同时包含大写和小写字母';
  }
  if (!/\d/.test(password)) {
    return '密码必须包含数字';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return '密码必须包含特殊字符';
  }
  const normalized = password.toLowerCase();
  if (COMMON_PASSWORD_FRAGMENTS.some(fragment => normalized.includes(fragment))) {
    return '密码包含常见弱密码片段，请更换更难猜的密码';
  }
  if (/(.)\1{3,}/.test(password)) {
    return '密码不能包含连续重复字符';
  }
  return null;
}
