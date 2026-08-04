import type { IntegrationPageRecord } from './adapter';

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(value.trim());
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  cells.push(value.trim());
  return cells;
}

export function parseIntegrationCsv(content: string): IntegrationPageRecord[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const headers = parseCsvLine(lines[0]);
  if (!headers.includes('external_id')) throw new Error('CSV 缺少 external_id 列');
  if (!headers.includes('local_entity_id') && !headers.includes('data_json')) {
    throw new Error('CSV 必须包含 local_entity_id 或 data_json 列');
  }
  if (lines.length - 1 > 100) throw new Error('单页最多导入 100 条记录');
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
    if (!record.external_id) throw new Error('CSV 外部 ID 不能为空');
    if (!record.local_entity_id && !record.data_json) {
      throw new Error('CSV 每行必须提供本地实体 ID 或实体 data_json');
    }
    let data: Readonly<Record<string, unknown>> | undefined;
    let authorization: Readonly<Record<string, unknown>> | undefined;
    try {
      data = record.data_json ? JSON.parse(record.data_json) as Record<string, unknown> : undefined;
      authorization = record.authorization_json
        ? JSON.parse(record.authorization_json) as Record<string, unknown>
        : undefined;
    } catch {
      throw new Error('CSV 的 data_json 或 authorization_json 不是有效 JSON');
    }
    return {
      external_id: record.external_id,
      ...(record.local_entity_id ? { local_entity_id: record.local_entity_id } : {}),
      ...(record.source_updated_at ? { source_updated_at: record.source_updated_at } : {}),
      ...(data ? { data } : {}),
      ...(authorization ? { authorization } : {}),
    };
  });
}
