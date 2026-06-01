import crypto from 'crypto';
import pool from '../config/database';
import { generateText } from './client';

export interface ProvenanceEvent {
  versionNumber: number;
  action: 'added' | 'removed' | 're-added';
  by: string;
  at: string;
}

export interface ProvenanceResult {
  narrative: string;
  history: ProvenanceEvent[];
}

function lineMatches(candidate: string, needle: string): boolean {
  const c = candidate.trim();
  const n = needle.trim();
  if (!n) return false;
  // Short lines (under 15 chars) require exact match to avoid false positives on braces etc.
  if (n.length < 15) return c === n;
  return c === n || c.includes(n);
}

export async function computeProvenance(fileId: number, lineContent: string): Promise<ProvenanceResult> {
  const cacheKey = crypto.createHash('md5').update(`${fileId}:${lineContent}`).digest('hex');

  // Cache check — 1-hour TTL
  const cached = await pool.query<{ result: ProvenanceResult }>(
    `SELECT result FROM agent_insights
     WHERE file_id = $1 AND insight_type = 'provenance' AND cache_key = $2
       AND created_at > NOW() - INTERVAL '1 hour'
     LIMIT 1`,
    [fileId, cacheKey]
  );
  if (cached.rows.length > 0) return cached.rows[0].result;

  // Fetch all versions (ascending) with content
  const { rows: versions } = await pool.query<{
    version_number: number;
    content: string;
    created_at: string;
    commit_message: string | null;
    username: string;
  }>(
    `SELECT fv.version_number, fv.content, fv.created_at, fv.commit_message, u.username
     FROM file_versions fv
     JOIN users u ON fv.created_by = u.id
     WHERE fv.file_id = $1
     ORDER BY fv.version_number ASC`,
    [fileId]
  );

  if (versions.length < 2) {
    return {
      narrative: 'Not enough version history yet to trace this line\'s origin.',
      history: [],
    };
  }

  // Diff each version's line list to track when the line appears/disappears
  const history: ProvenanceEvent[] = [];
  let wasPresent = false;

  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const lines = (v.content || '').split('\n');
    const isPresent = lines.some(l => lineMatches(l, lineContent));

    if (i === 0) {
      if (isPresent) {
        history.push({ versionNumber: v.version_number, action: 'added', by: v.username, at: v.created_at });
      }
    } else {
      if (!wasPresent && isPresent) {
        const action = history.length > 0 ? 're-added' : 'added';
        history.push({ versionNumber: v.version_number, action, by: v.username, at: v.created_at });
      } else if (wasPresent && !isPresent) {
        history.push({ versionNumber: v.version_number, action: 'removed', by: v.username, at: v.created_at });
      }
    }
    wasPresent = isPresent;
  }

  if (history.length === 0) {
    return {
      narrative: 'This exact line was not found in any saved version checkpoint.',
      history: [],
    };
  }

  // Build AI narrative
  const historyText = history
    .map(e => {
      const date = new Date(e.at).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      });
      return `Version ${e.versionNumber}: ${e.action} by ${e.by} on ${date}`;
    })
    .join('\n');

  const systemPrompt = [
    'You are a code historian for a collaborative editor.',
    'Given a line of code and its version history, write exactly 2-3 sentences narrating the line\'s history.',
    'Be specific: name the person, version number, and date.',
    'Do not explain what the code does — only narrate its history.',
    'Do not add any preamble or sign-off.',
  ].join(' ');

  const userPrompt = `Line: "${lineContent.trim()}"\n\nEdit history:\n${historyText}\n\nWrite the 2-3 sentence history narrative.`;

  let narrative: string;
  try {
    narrative = await generateText(systemPrompt, userPrompt, 300);
  } catch (err: any) {
    narrative = `AI unavailable — ${err.message}`;
  }

  const result: ProvenanceResult = { narrative, history };

  // Write to cache (upsert so concurrent requests don't conflict)
  await pool.query(
    `INSERT INTO agent_insights (file_id, insight_type, cache_key, result)
     VALUES ($1, 'provenance', $2, $3)
     ON CONFLICT (file_id, insight_type, cache_key)
     DO UPDATE SET result = EXCLUDED.result, created_at = NOW()`,
    [fileId, cacheKey, JSON.stringify(result)]
  );

  return result;
}