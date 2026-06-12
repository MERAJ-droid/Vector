import pool from '../config/database';
import * as diffLib from 'diff';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VersionSummary {
  versionNumber: number;
  username: string;
  createdAt: string;
  commitMessage: string | null;
  linesAdded: number;
  linesRemoved: number;
  addedSnippet: string[];   // up to 3 representative added lines
  removedSnippet: string[]; // up to 2 representative removed lines
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Pick up to `max` lines that look like real code (not blank, not just punctuation)
function pickMeaningfulLines(lines: string[], max: number): string[] {
  return lines
    .map(l => l.trim())
    .filter(l => l.length > 8 && !/^[{}()\[\];,]+$/.test(l))
    .slice(0, max);
}

// ─── Version data fetching ────────────────────────────────────────────────────

export async function getVersionSummaries(fileId: number): Promise<{
  summaries: VersionSummary[];
  minVersion: number;
  maxVersion: number;
}> {
  const result = await pool.query(
    `SELECT fv.version_number, fv.content, fv.commit_message, fv.created_at,
            u.username
     FROM file_versions fv
     JOIN users u ON fv.created_by = u.id
     WHERE fv.file_id = $1
     ORDER BY fv.version_number ASC`,
    [fileId]
  );

  const rows = result.rows;
  if (rows.length === 0) {
    return { summaries: [], minVersion: 0, maxVersion: 0 };
  }

  const summaries: VersionSummary[] = rows.map((row: any, i: number) => {
    const prevContent: string = i > 0 ? rows[i - 1].content : '';
    const currContent: string = row.content || '';
    const diff = diffLib.diffLines(prevContent, currContent);

    let linesAdded = 0;
    let linesRemoved = 0;
    const rawAdded: string[] = [];
    const rawRemoved: string[] = [];

    for (const part of diff) {
      if (part.added) {
        linesAdded += part.count ?? 0;
        rawAdded.push(...part.value.split('\n'));
      }
      if (part.removed) {
        linesRemoved += part.count ?? 0;
        rawRemoved.push(...part.value.split('\n'));
      }
    }

    return {
      versionNumber: row.version_number,
      username: row.username,
      createdAt: row.created_at,
      commitMessage: row.commit_message,
      linesAdded,
      linesRemoved,
      addedSnippet: pickMeaningfulLines(rawAdded, 3),
      removedSnippet: pickMeaningfulLines(rawRemoved, 2),
    };
  });

  return {
    summaries,
    minVersion: rows[0].version_number,
    maxVersion: rows[rows.length - 1].version_number,
  };
}

// Commit messages that indicate auto-generated noise versions (no human intent)
const NOISE_PATTERNS = [
  'guardian-checkpoint',
  'session end',
  'session checkpoint',
  'auto-checkpoint',
  'auto-save',
];

function isNoise(commitMessage: string | null): boolean {
  if (!commitMessage) return false;
  const msg = commitMessage.toLowerCase();
  return NOISE_PATTERNS.some(p => msg.includes(p));
}

// ─── Narration prompt ─────────────────────────────────────────────────────────

export function buildNarrationPrompt(summaries: VersionSummary[]): string {
  // Only include meaningful versions in the narration context — auto-saves and
  // guardian checkpoints add noise without telling the human story of the file.
  const meaningful = summaries.filter(s => !isNoise(s.commitMessage));

  // If filtering removed everything, fall back to the full list so the narration
  // isn't completely empty (e.g. a file with only auto-saves).
  const forPrompt = meaningful.length >= 2 ? meaningful : summaries;

  const lines = forPrompt.map(s => {
    const date = new Date(s.createdAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const label = s.commitMessage ? `"${s.commitMessage}"` : 'unlabeled checkpoint';
    const changes = s.linesAdded === 0 && s.linesRemoved === 0
      ? 'baseline'
      : `+${s.linesAdded} lines, -${s.linesRemoved} lines`;

    let snippetNote = '';
    if (s.addedSnippet.length > 0) {
      snippetNote += `\n  added: ${s.addedSnippet.join(' | ')}`;
    }
    if (s.removedSnippet.length > 0) {
      snippetNote += `\n  removed: ${s.removedSnippet.join(' | ')}`;
    }

    return `v${s.versionNumber} (${s.username}, ${date}): ${label} — ${changes}${snippetNote}`;
  });

  const totalVersions = summaries.length;
  const shownVersions = forPrompt.length;
  const skippedNote = totalVersions > shownVersions
    ? ` (${totalVersions - shownVersions} auto-saved checkpoints not shown)`
    : '';

  return (
    `Code file version history${skippedNote}:\n\n` +
    lines.join('\n') +
    `\n\nWrite 2-3 sentences narrating the CODE STORY of this file — what was built and how it evolved. ` +
    `Lead with the code: name the actual functions, features, or logic that was added or removed. ` +
    `Mention contributors and dates only if they add meaningful context. ` +
    `If there was a revert, say what was tried and abandoned. ` +
    `Do not narrate auto-saves or checkpoint mechanics — only the code that matters. ` +
    `Good example: "This file grew from a basic user lookup into a full data processing module. testuser2 added processUserData and an isActive status check across two sessions. A mapping approach was tried in v4 and rolled back, landing on the simpler structure in the final version."` +
    `\n\nNarration:`
  );
}

export const NARRATION_SYSTEM_PROMPT =
  `You narrate the CODE STORY of a file's development in 2-3 plain sentences. ` +
  `Focus on what was built — functions, features, logic. ` +
  `Do not describe checkpoints, saves, or operational metadata. ` +
  `No metaphors. No bullet points. No markdown.`;

// ─── Cache helpers ────────────────────────────────────────────────────────────

export async function getCachedNarration(
  fileId: number,
  minVersion: number,
  maxVersion: number
): Promise<string | null> {
  const result = await pool.query(
    `SELECT narration FROM session_narrations
     WHERE file_id = $1 AND version_range_start = $2 AND version_range_end = $3
     LIMIT 1`,
    [fileId, minVersion, maxVersion]
  );
  return result.rows[0]?.narration ?? null;
}

export async function cacheNarration(
  fileId: number,
  minVersion: number,
  maxVersion: number,
  narration: string
): Promise<void> {
  await pool.query(
    `INSERT INTO session_narrations (file_id, version_range_start, version_range_end, narration)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (file_id, version_range_start, version_range_end) DO UPDATE
       SET narration = EXCLUDED.narration, created_at = NOW()`,
    [fileId, minVersion, maxVersion, narration]
  );
}