import crypto from 'crypto';
import pool from '../config/database';
import { generateText } from './client';

export interface TemporalQueryResult {
  answer: string;
  navigateToVersion?: number;
}

type QueryType =
  | 'find_first_occurrence'
  | 'find_user_activity'
  | 'list_changes_between'
  | 'reconstruct_at_time'
  | 'find_version_by_description'
  | 'unanswerable';

interface QueryPlan {
  type: QueryType;
  params: Record<string, any>;
  confidence: number;
}

interface QueryResult {
  plan: QueryPlan;
  rows: any[];
  navigateToVersion?: number;
}

// ─── File metadata for context window ────────────────────────────────────────

async function getFileContext(fileId: number) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       MIN(fv.version_number) AS min_ver,
       MAX(fv.version_number) AS max_ver,
       MIN(fv.created_at) AS earliest,
       MAX(fv.created_at) AS latest,
       ARRAY_AGG(DISTINCT u.username) AS contributors
     FROM file_versions fv
     JOIN users u ON fv.created_by = u.id
     WHERE fv.file_id = $1`,
    [fileId]
  );
  if (!rows[0] || rows[0].total === 0) return null;
  return {
    totalVersions: rows[0].total as number,
    minVersion: rows[0].min_ver as number,
    maxVersion: rows[0].max_ver as number,
    contributors: rows[0].contributors as string[],
    earliest: rows[0].earliest as string,
    latest: rows[0].latest as string,
  };
}

// ─── Plan parsing ─────────────────────────────────────────────────────────────

const TYPE_ALIASES: Record<string, QueryType> = {
  find_changes_between:    'list_changes_between',
  list_changes:            'list_changes_between',
  find_changes:            'list_changes_between',
  get_changes_between:     'list_changes_between',
  find_occurrence:         'find_first_occurrence',
  find_in_content:         'find_first_occurrence',
  search_content:          'find_first_occurrence',
  find_by_description:     'find_version_by_description',
  search_commit_messages:  'find_version_by_description',
  find_by_user:            'find_user_activity',
  get_user_activity:       'find_user_activity',
};

function normalizeType(raw: string): QueryType {
  if (TYPE_ALIASES[raw]) return TYPE_ALIASES[raw];
  if (/user.*activ|activ.*user/.test(raw)) return 'find_user_activity';
  return raw as QueryType;
}

function normalizePlan(raw: any): QueryPlan | null {
  if (!raw || !raw.type) return null;
  const plan = raw as QueryPlan;
  plan.type = normalizeType(plan.type);
  plan.confidence = parseFloat(String(plan.confidence ?? '0.8'));
  if (isNaN(plan.confidence)) plan.confidence = 0.8;
  // Reclassify list_changes_between + contributor → find_user_activity
  if (
    plan.type === 'list_changes_between' &&
    (plan.params?.contributor || plan.params?.username)
  ) {
    plan.type = 'find_user_activity';
    plan.params = { username: plan.params.contributor ?? plan.params.username };
  }
  return plan;
}

function extractAndParsePlans(raw: string): QueryPlan[] | null {
  // Strip markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Try array output first: [{...}, {...}]
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const json = arrayMatch[0].replace(/,\s*([}\]])/g, '$1');
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const plans = parsed
          .slice(0, 3)
          .map(normalizePlan)
          .filter((p): p is QueryPlan => p !== null);
        if (plans.length > 0) return plans;
      }
    } catch {}
  }

  // Fall back to single object: {...}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const json = objMatch[0].replace(/,\s*([}\]])/g, '$1');
    try {
      const plan = normalizePlan(JSON.parse(json));
      return plan ? [plan] : null;
    } catch {}
  }

  return null;
}

// ─── Call 1: Parse question → query plan(s) ──────────────────────────────────

async function parseQuestion(
  question: string,
  ctx: NonNullable<Awaited<ReturnType<typeof getFileContext>>>
): Promise<QueryPlan[]> {
  const systemPrompt =
    'You are a query planner for a code version history database. Output ONLY JSON, no other text.\n' +
    '\n' +
    'OUTPUT FORMAT:\n' +
    '- Single intent question → one JSON object: {"type":"...","params":{...},"confidence":0.9}\n' +
    '- Comparison or multi-step question → JSON array: [{"type":"...","params":{...},"confidence":0.9}, {...}]\n' +
    '\n' +
    'DECISION RULES (apply in order, stop at first match):\n' +
    '1. camelCase/snake_case word, function name, or code syntax → find_first_occurrence, searchTerm = that text\n' +
    '2. Specific person\'s name or username → find_user_activity\n' +
    '3. Calendar date, month name, or year → reconstruct_at_time\n' +
    '4. Question about commit message descriptions → find_version_by_description\n' +
    '5. Version number range → list_changes_between\n' +
    '6. None of the above → unanswerable\n' +
    '\n' +
    'SINGLE EXAMPLES:\n' +
    '  "when was getUserById added" → {"type":"find_first_occurrence","params":{"searchTerm":"getUserById"},"confidence":0.9}\n' +
    '  "what did Alice change" → {"type":"find_user_activity","params":{"username":"Alice"},"confidence":0.9}\n' +
    '  "find versions about error handling" → {"type":"find_version_by_description","params":{"keywords":["error handling"]},"confidence":0.9}\n' +
    '\n' +
    'MULTI-STEP EXAMPLES (use array when comparing two things):\n' +
    '  "was getUserById added before validateToken" → [{"type":"find_first_occurrence","params":{"searchTerm":"getUserById"},"confidence":0.9},{"type":"find_first_occurrence","params":{"searchTerm":"validateToken"},"confidence":0.9}]\n' +
    '  "who added error handling and did they also add validateToken" → [{"type":"find_version_by_description","params":{"keywords":["error handling"]},"confidence":0.9},{"type":"find_first_occurrence","params":{"searchTerm":"validateToken"},"confidence":0.9}]\n' +
    '\n' +
    'Types: find_first_occurrence{"searchTerm":"str"} | find_user_activity{"username":"str"} | list_changes_between{"fromVersion":n,"toVersion":n} | reconstruct_at_time{"timestamp":"ISO8601"} | find_version_by_description{"keywords":["str"]} | unanswerable{}';

  const userPrompt =
    `Question: "${question}"\n` +
    `Versions: v${ctx.minVersion}–v${ctx.maxVersion} (${ctx.totalVersions} total)\n` +
    `Contributors: ${ctx.contributors.join(', ')}\n` +
    `Dates: ${new Date(ctx.earliest).toLocaleDateString()} – ${new Date(ctx.latest).toLocaleDateString()}`;

  let raw: string;
  try {
    raw = await generateText(systemPrompt, userPrompt, 400);
  } catch {
    return [{ type: 'unanswerable', params: {}, confidence: 0 }];
  }

  console.log('[AI:temporal-query] raw plan response:', raw);

  const plans = extractAndParsePlans(raw);
  if (!plans) {
    console.warn('[AI:temporal-query] failed to parse plans from response:', raw);
    return [{ type: 'unanswerable', params: {}, confidence: 0 }];
  }

  console.log('[AI:temporal-query] parsed plans:', plans);
  return plans;
}

// ─── Timestamp normalizer ─────────────────────────────────────────────────────

function normalizeTimestamp(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const dmyMatch = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`;
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  return raw;
}

// ─── Execute single query plan ────────────────────────────────────────────────

async function executeQuery(
  fileId: number,
  plan: QueryPlan
): Promise<{ rows: any[]; navigateToVersion?: number }> {
  const { type, params } = plan;

  switch (type) {
    case 'find_first_occurrence': {
      const { rows: raw } = await pool.query(
        `WITH ordered AS (
           SELECT
             fv.version_number,
             fv.created_at,
             fv.content,
             u.username,
             LAG(fv.content) OVER (ORDER BY fv.version_number) AS prev_content
           FROM file_versions fv
           JOIN users u ON fv.created_by = u.id
           WHERE fv.file_id = $1
         )
         SELECT version_number, created_at, username, content
         FROM ordered
         WHERE content ILIKE $2
           AND (prev_content IS NULL OR prev_content NOT ILIKE $2)
         ORDER BY version_number ASC LIMIT 1`,
        [fileId, `%${params.searchTerm}%`]
      );
      const rows = raw.map(r => {
        const matchingLine = (r.content as string)
          ?.split('\n')
          .find((line: string) => line.toLowerCase().includes(params.searchTerm.toLowerCase()))
          ?.trim();
        return {
          version_number: r.version_number,
          created_at: r.created_at,
          username: r.username,
          searched_for: params.searchTerm,
          found_in_line: matchingLine ?? `(contains "${params.searchTerm}")`,
        };
      });
      console.log(`[AI:temporal-query] find_first_occurrence searchTerm="${params.searchTerm}" → ${rows.length} row(s)`, rows[0] ?? '');
      return { rows, navigateToVersion: raw[0]?.version_number };
    }

    case 'find_user_activity': {
      const { rows } = await pool.query(
        `SELECT fv.version_number, fv.created_at, fv.commit_message, u.username
         FROM file_versions fv
         JOIN users u ON fv.created_by = u.id
         WHERE fv.file_id = $1 AND u.username ILIKE $2
         ORDER BY fv.version_number ASC`,
        [fileId, `%${params.username}%`]
      );
      return { rows };
    }

    case 'list_changes_between': {
      const { rows } = await pool.query(
        `SELECT fv.version_number, fv.created_at, fv.commit_message, u.username,
                length(fv.content) AS content_length
         FROM file_versions fv
         JOIN users u ON fv.created_by = u.id
         WHERE fv.file_id = $1 AND fv.version_number BETWEEN $2 AND $3
         ORDER BY fv.version_number ASC`,
        [fileId, params.fromVersion ?? 1, params.toVersion ?? 9999]
      );
      return { rows, navigateToVersion: rows[0]?.version_number };
    }

    case 'reconstruct_at_time': {
      const ts = normalizeTimestamp(String(params.timestamp ?? ''));
      const { rows } = await pool.query(
        `SELECT fv.version_number, fv.created_at, u.username
         FROM file_versions fv
         JOIN users u ON fv.created_by = u.id
         WHERE fv.file_id = $1
         ORDER BY ABS(EXTRACT(EPOCH FROM (fv.created_at - $2::timestamptz))) ASC
         LIMIT 1`,
        [fileId, ts]
      );
      return { rows, navigateToVersion: rows[0]?.version_number };
    }

    case 'find_version_by_description': {
      const keywords: string[] = Array.isArray(params.keywords)
        ? params.keywords
        : [String(params.keywords ?? '')];
      const conditions = keywords.map((_, i) => `fv.commit_message ILIKE $${i + 2}`).join(' OR ');
      const values: any[] = [fileId, ...keywords.map(k => `%${k}%`)];
      const { rows } = await pool.query(
        `SELECT fv.version_number, fv.created_at, fv.commit_message, u.username
         FROM file_versions fv
         JOIN users u ON fv.created_by = u.id
         WHERE fv.file_id = $1 AND (${conditions})
         ORDER BY fv.version_number ASC`,
        values
      );
      return { rows, navigateToVersion: rows[0]?.version_number };
    }

    default:
      return { rows: [] };
  }
}

// ─── Execute all plans in sequence ────────────────────────────────────────────

async function executeAllPlans(fileId: number, plans: QueryPlan[]): Promise<QueryResult[]> {
  const results: QueryResult[] = [];
  for (const plan of plans) {
    if (plan.confidence < 0.3 || plan.type === 'unanswerable') continue;
    const { rows, navigateToVersion } = await executeQuery(fileId, plan);
    results.push({ plan, rows, navigateToVersion });
  }
  return results;
}

// ─── Call 2: DB results → natural language ────────────────────────────────────

function buildEmptyMessage(results: QueryResult[]): string | null {
  const allEmpty = results.every(r => r.rows.length === 0);
  if (!allEmpty) return null;

  // Use the first plan's type for the most relevant empty message
  const plan = results[0]?.plan;
  if (!plan) return 'No matching data was found in the version history for that question.';

  if (plan.type === 'find_first_occurrence') {
    return `The text "${plan.params.searchTerm}" wasn't found in any version of this file's content. ` +
      `Search for the exact code text as it appears in the file — e.g. "when was getUserById added?" or "when did try { appear?".`;
  }
  if (plan.type === 'find_user_activity') {
    return `No versions were found for contributor "${plan.params.username}". Check the username spelling — available contributors are listed in the version history sidebar.`;
  }
  if (plan.type === 'find_version_by_description') {
    return `No commit messages matched the keywords "${(plan.params.keywords as string[]).join('", "')}". Try different keywords, or ask about specific code text instead.`;
  }
  return 'No matching data was found in the version history for that question.';
}

async function narrateResults(question: string, results: QueryResult[]): Promise<string> {
  const emptyMsg = buildEmptyMessage(results);
  if (emptyMsg) return emptyMsg;

  // Build labeled result sets for the narrator so it can reason across multiple queries
  const dataForNarrator = results
    .filter(r => r.rows.length > 0)
    .map((r, i) => ({
      query: i + 1,
      intent: r.plan.type === 'find_first_occurrence'
        ? `first introduction of "${r.plan.params.searchTerm}"`
        : r.plan.type === 'find_user_activity'
        ? `activity by "${r.plan.params.username}"`
        : r.plan.type === 'find_version_by_description'
        ? `commit messages matching "${(r.plan.params.keywords as string[]).join(', ')}"`
        : r.plan.type,
      results: r.rows,
    }));

  const systemPrompt = [
    'You are a code historian for a collaborative editor.',
    'Answer the question in 2–5 sentences using only the data provided.',
    'When multiple query results are given, reason across all of them to give a complete answer.',
    'Be specific: use version numbers, usernames, and dates from the data.',
    'For comparison questions ("before or after", "who added X first"), explicitly compare the version numbers.',
    'Do not speculate beyond the data. Do not add a preamble or sign-off.',
  ].join(' ');

  const userPrompt = `Question: "${question}"\n\nVersion history data:\n${JSON.stringify(dataForNarrator, null, 2)}`;

  try {
    return await generateText(systemPrompt, userPrompt, 500);
  } catch (err: any) {
    return `AI unavailable — ${err.message}`;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function answerTemporalQuestion(
  fileId: number,
  question: string
): Promise<TemporalQueryResult> {
  const cacheKey = crypto.createHash('md5').update(`${fileId}:${question}`).digest('hex');

  const cached = await pool.query<{ result: TemporalQueryResult }>(
    `SELECT result FROM agent_insights
     WHERE file_id = $1 AND insight_type = 'temporal_query' AND cache_key = $2
       AND created_at > NOW() - INTERVAL '1 hour'
     LIMIT 1`,
    [fileId, cacheKey]
  );
  if (cached.rows.length > 0) {
    console.log(`[AI:temporal-query] cache hit for fileId=${fileId}`);
    return cached.rows[0].result;
  }

  const ctx = await getFileContext(fileId);
  if (!ctx || ctx.totalVersions < 2) {
    return { answer: 'Not enough version history yet to answer questions. History builds as the file is edited and checkpoints are saved.' };
  }

  const plans = await parseQuestion(question, ctx);

  // If all plans are unanswerable or low-confidence, return fallback
  const actionable = plans.filter(p => p.confidence >= 0.3 && p.type !== 'unanswerable');
  if (actionable.length === 0) {
    return {
      answer: 'I can answer questions about when code was added, what contributors changed, comparisons like "was X added before Y", and what commit messages describe. Try something like "Was getUserById added before validateToken?" or "Who added the error handling?"',
    };
  }

  const queryResults = await executeAllPlans(fileId, actionable);
  const answer = await narrateResults(question, queryResults);

  // navigateToVersion: use the first result that has one
  const navigateToVersion = queryResults.find(r => r.navigateToVersion)?.navigateToVersion;
  const result: TemporalQueryResult = { answer, ...(navigateToVersion ? { navigateToVersion } : {}) };

  await pool.query(
    `INSERT INTO agent_insights (file_id, insight_type, cache_key, result)
     VALUES ($1, 'temporal_query', $2, $3)
     ON CONFLICT (file_id, insight_type, cache_key)
     DO UPDATE SET result = EXCLUDED.result, created_at = NOW()`,
    [fileId, cacheKey, JSON.stringify(result)]
  );

  return result;
}