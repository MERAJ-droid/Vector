import { Router, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireViewer, PermissionRequest } from '../middleware/permissions';
import { computeProvenance } from '../ai/provenance';

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

// Feature routes to be added here in Phases 2–4:
//   POST /files/:fileId/temporal-query    (Phase 2 — Temporal Code Questions)
//   GET  /files/:fileId/replay-narration  (Phase 4 — Session Replay Narration, SSE)

export default router;