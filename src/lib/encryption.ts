/**
 * AES-256-GCM 字段级加密工具
 * 
 * 加密策略：
 * - 存储加密：敏感字段写入数据库前使用 AES-256-GCM 加密
 * - 读取解密：从数据库读取后解密还原明文
 * - 可检索：对需要精确查找的字段（email/phone）额外存储 HMAC-SHA256 签名
 * - 撤回脱敏：直接用明文脱敏值覆盖密文，无需特殊处理
 * 
 * 数据格式（加密字段）：
 *   "enc:v1:aes256gcm:<base64(iv):base64(ciphertext):base64(authTag)>"
 * 
 * 密钥管理：
 *   - 主密钥通过环境变量 ENCRYPTION_KEY 提供（32字节 hex 字符串）
 *   - 密钥缺失或格式错误时拒绝执行，避免生成不可恢复的临时密钥
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { getRequiredHexKey } from '@/lib/security';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 12 字节
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:aes256gcm:';

// 单例密钥
let _encryptionKey: Buffer | null = null;
let _hmacKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey;
  
  _encryptionKey = getRequiredHexKey('ENCRYPTION_KEY');
  return _encryptionKey;
}

function getHmacKey(): Buffer {
  if (_hmacKey) return _hmacKey;
  _hmacKey = getRequiredHexKey('HMAC_KEY');
  return _hmacKey;
}

/**
 * AES-256-GCM 加密
 * @param plaintext 明文
 * @returns 密文字符串 "enc:v1:aes256gcm:<base64(iv):base64(ciphertext):base64(authTag)>" 或 null
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext ?? null;
  
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  
  // 格式: base64(iv):base64(ciphertext):base64(authTag)
  const payload = [
    iv.toString('base64'),
    encrypted.toString('base64'),
    authTag.toString('base64'),
  ].join(':');
  
  return PREFIX + payload;
}

/**
 * AES-256-GCM 解密
 * @param ciphertext 密文字符串
 * @returns 明文或 null
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined || ciphertext === '') return ciphertext ?? null;
  
  // 非加密字段直接返回（如撤回脱敏后的 "***" 等）
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;
  
  const payload = ciphertext.slice(PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    console.error('[ENCRYPTION] 密文格式错误，无法解密');
    return '[解密失败]';
  }
  
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('[ENCRYPTION] 解密失败:', error instanceof Error ? error.message : String(error));
    return '[解密失败]';
  }
}

/**
 * HMAC-SHA256 签名（用于可检索字段的精确匹配）
 * @param value 原始值
 * @returns HMAC 签名的 hex 字符串或 null
 */
export function hmacSign(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  
  const key = getHmacKey();
  return createHmac('sha256', key).update(value).digest('hex');
}

/**
 * 判断值是否为加密格式
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * 候选人敏感字段定义
 */
export const SENSITIVE_FIELDS = ['name', 'email', 'phone'] as const;
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

/**
 * 需要存储 HMAC 签名的字段（用于精确检索）
 */
export const SEARCHABLE_FIELDS = ['email', 'phone'] as const;
export type SearchableField = (typeof SEARCHABLE_FIELDS)[number];

/**
 * HMAC 字段名映射：email → email_hmac, phone → phone_hmac
 */
export function getHmacFieldName(field: SearchableField): string {
  return `${field}_hmac`;
}

/**
 * 解密候选人对象中的加密字段
 * 返回新的候选人对象，敏感字段已解密
 */
export function decryptCandidate<T extends Record<string, unknown>>(candidate: T): T {
  const result = { ...candidate };
  for (const field of SENSITIVE_FIELDS) {
    const key = field as string;
    if (key in result && typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = decrypt(result[key] as string);
    }
  }
  return result;
}

/**
 * 加密候选人对象中的敏感字段
 * 返回新的对象，敏感字段已加密
 */
export function encryptCandidate<T extends Record<string, unknown>>(candidate: T): T {
  const result = { ...candidate };
  for (const field of SENSITIVE_FIELDS) {
    const key = field as string;
    if (key in result && typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = encrypt(result[key] as string);
    }
  }
  return result;
}

// 别名导出，兼容其他文件中的 import 名称
export { decrypt as decryptField, encrypt as encryptField, hmacSign as generateHmac };
