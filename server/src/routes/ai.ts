import { Router, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireViewer, PermissionRequest } from '../middleware/permissions';
import { computeProvenance } from '../ai/provenance';
import { answerTemporalQuestion } from '../ai/temporalQuery';
import {
  getVersionSummaries,
  buildNarrationPrompt,
  NARRATION_SYSTEM_PROMPT,
  getCachedNarration,
  cacheNarration,
} from '../ai/replayNarration';
import { streamText } from '../ai/client';

const router = Router();

// All routes under /api/ai require authentication
router.use(authenticateToken);

// ─── Feature 1: Operation Provenance ─────────────────────────────────────────

router.post('/files/:fileId/provenance', requireViewer, async (req: PermissionRequest, res: Response) => {
  const fileId = parseInt(req.params.fileId);
  const { lineContent } = req.body;

  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' }) as any;
  if (!lineContent || typeof lineContent !== 'string' || !lineContent.trim()) {
    return res.status(400).json({ error: 'lineContent is required and must be non-empty' }) as any;
  }

  try {
    const result = await computeProvenance(fileId, lineContent);
    res.json(result);
  } catch (err: any) {
    console.error('[AI:provenance] error:', err.message);
    res.status(500).json({
      error: err.message?.includes('Ollama')
        ? err.message
        : 'Internal server error',
    });
  }
});

// ─── Feature 2: Temporal Code Questions ──────────────────────────────────────

router.post('/files/:fileId/temporal-query', requireViewer, async (req: PermissionRequest, res: Response) => {
  const fileId = parseInt(req.params.fileId);
  const { question } = req.body;

  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' }) as any;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required and must be non-empty' }) as any;
  }

  try {
    const result = await answerTemporalQuestion(fileId, question.trim());
    res.json(result);
  } catch (err: any) {
    console.error('[AI:temporal-query] error:', err.message);
    res.status(500).json({
      error: err.message?.includes('Ollama')
        ? err.message
        : 'Internal server error',
    });
  }
});

// ─── Feature 4: Session Replay Narration (SSE) ───────────────────────────────

router.get('/files/:fileId/replay-narration', requireViewer, async (req: PermissionRequest, res: Response) => {
  const fileId = parseInt(req.params.fileId);
  if (isNaN(fileId)) {
    res.status(400).json({ error: 'Invalid file ID' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const { summaries, minVersion, maxVersion } = await getVersionSummaries(fileId);

    if (summaries.length < 2) {
      sendEvent({ type: 'error', message: 'Not enough version history for replay. Create at least 2 checkpoints first.' });
      res.end();
      return;
    }

    // Return version summaries so client can display them
    sendEvent({ type: 'summaries', summaries });

    // Check cache first
    const cached = await getCachedNarration(fileId, minVersion, maxVersion);
    if (cached) {
      sendEvent({ type: 'cached', narration: cached });
      res.end();
      return;
    }

    // Stream narration from AI
    const userPrompt = buildNarrationPrompt(summaries);

    const fullNarration = await streamText(
      NARRATION_SYSTEM_PROMPT,
      userPrompt,
      (token) => sendEvent({ type: 'token', token }),
      400
    );

    // Persist to cache and signal completion
    if (fullNarration.trim()) {
      await cacheNarration(fileId, minVersion, maxVersion, fullNarration.trim());
    }
    sendEvent({ type: 'done' });
    res.end();

  } catch (err: any) {
    console.error('[AI:replay-narration] error:', err.message);
    sendEvent({
      type: 'error',
      message: err.message?.includes('Ollama')
        ? err.message
        : 'Failed to generate narration. Check that Ollama is running.',
    });
    res.end();
  }
});

export default router;