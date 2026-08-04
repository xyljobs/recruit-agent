import { readFileSync } from 'fs';
import { join } from 'path';

interface KnowledgeChunk {
  content: string;
  score: number;
}

interface SearchResponse {
  code: number;
  msg: string;
  chunks: KnowledgeChunk[];
}

const KNOWLEDGE_FILES: Record<string, string> = {
  zhipin_it_skills: '知识库-IT技能图谱.md',
  zhipin_communication_templates: '知识库-沟通话术模板库.md',
};

const documentCache = new Map<string, string[]>();

function splitMarkdown(content: string): string[] {
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (current && (current.length + block.length > 900 || /^#{1,6}\s/.test(block))) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${block}` : block;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function loadTable(tableName: string): string[] {
  const cached = documentCache.get(tableName);
  if (cached) {
    return cached;
  }

  const filename = KNOWLEDGE_FILES[tableName];
  if (!filename) {
    return [];
  }

  const content = readFileSync(join(process.cwd(), 'assets', filename), 'utf8');
  const chunks = splitMarkdown(content);
  documentCache.set(tableName, chunks);
  return chunks;
}

function tokenize(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const tokens = new Set<string>();

  for (const token of normalized.match(/[a-z0-9][a-z0-9+.#/-]*/g) ?? []) {
    tokens.add(token);
  }

  for (const sequence of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (sequence.length <= 12) {
      tokens.add(sequence);
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }

  return [...tokens];
}

function scoreChunk(queryTokens: string[], chunk: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const normalizedChunk = chunk.normalize('NFKC').toLowerCase();
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const token of queryTokens) {
    const weight = token.length >= 3 ? 2 : 1;
    totalWeight += weight;
    if (normalizedChunk.includes(token)) {
      matchedWeight += weight;
    }
  }

  const coverage = totalWeight === 0 ? 0 : matchedWeight / totalWeight;
  return Math.min(1, coverage * 2.5);
}

export class KnowledgeClient {
  constructor(_config?: unknown, _customHeaders?: Record<string, string>) {}

  async search(
    query: string,
    tableNames: string[] = Object.keys(KNOWLEDGE_FILES),
    topK = 5,
    minScore = 0,
  ): Promise<SearchResponse> {
    try {
      const queryTokens = tokenize(query);
      const chunks = tableNames
        .flatMap(tableName => loadTable(tableName))
        .map(content => ({ content, score: scoreChunk(queryTokens, content) }))
        .filter(chunk => chunk.score >= minScore && chunk.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(0, topK));

      return { code: 0, msg: 'success', chunks };
    } catch (error) {
      return {
        code: 1,
        msg: error instanceof Error ? error.message : String(error),
        chunks: [],
      };
    }
  }
}
