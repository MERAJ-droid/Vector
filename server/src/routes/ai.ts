import { Router, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireViewer, PermissionRequest } from '../middleware/permissions';
import { computeProvenance } from '../ai/provenance';
import { answerTemporalQuestion } from '../ai/temporalQuery';

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

// Feature routes to be added in Phases 3–4:
//   GET /files/:fileId/replay-narration  (Phase 4 — Session Replay Narration, SSE)

export default router;