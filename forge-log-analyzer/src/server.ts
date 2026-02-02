/**
 * =============================================================================
 * Forge Log Analyzer - HTTP Server
 * =============================================================================
 *
 * Express-based REST API for the Forge Log Analyzer service.
 *
 * ## Endpoints
 *
 * POST /jobs/:jobId/logs               - Ingest raw logs for a job
 * GET  /jobs/:jobId/logs/raw           - Get raw logs
 * GET  /jobs/:jobId/logs/condensed     - Get condensed logs (for AI)
 * GET  /jobs/:jobId/logs/structured    - Get structured logs (for 4-deck view)
 * GET  /jobs/:jobId/logs/analyze-payload - Get pre-computed payload for Analysis Service
 * POST /jobs/:jobId/analyze            - Forward pre-computed payload to Analysis Service
 * GET  /health                         - Health check
 *
 * =============================================================================
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  storeJobLogs,
  getRawLogs,
  getCondensedLogs,
  getStructuredLogs,
  getDeckNames,
  hasJobLogs,
  invalidateCache,
  getAnalyzePayload,
} from './store.js';
import { buildPromptPreview } from './prompt-preview.js';
import type {
  IngestLogsRequest,
  RawLogsResponse,
  CondensedLogsResponse,
  StructuredLogsResponse,
  AnalyzeRequest,
  AnalyzeResponse,
} from './types.js';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const ANALYSIS_SERVICE_URL = process.env.ANALYSIS_SERVICE_URL ?? 'http://localhost:8000';

// -----------------------------------------------------------------------------
// Express App Setup
// -----------------------------------------------------------------------------

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' })); // Large logs
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// -----------------------------------------------------------------------------
// Health Check
// -----------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'forge-log-analyzer' });
});

// -----------------------------------------------------------------------------
// POST /jobs/:jobId/logs - Ingest raw logs
// -----------------------------------------------------------------------------

app.post('/jobs/:jobId/logs', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const body = req.body as IngestLogsRequest;

  // Validate request
  if (!body.gameLogs || !Array.isArray(body.gameLogs)) {
    res.status(400).json({ error: 'gameLogs array is required' });
    return;
  }

  if (body.gameLogs.length === 0) {
    res.status(400).json({ error: 'gameLogs array cannot be empty' });
    return;
  }

  try {
    storeJobLogs(jobId, body.gameLogs, body.deckNames, body.deckLists);
    console.log(`[Ingest] Stored ${body.gameLogs.length} logs for job ${jobId} (deckLists: ${body.deckLists ? 'yes' : 'no'})`);
    res.status(201).json({
      message: 'Logs ingested successfully',
      jobId,
      gameCount: body.gameLogs.length,
    });
  } catch (error) {
    console.error(`[Ingest] Error storing logs for job ${jobId}:`, error);
    res.status(500).json({ error: 'Failed to store logs' });
  }
});

// -----------------------------------------------------------------------------
// GET /jobs/:jobId/logs/raw - Get raw logs
// -----------------------------------------------------------------------------

app.get('/jobs/:jobId/logs/raw', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const gameLogs = getRawLogs(jobId);
  if (gameLogs === null) {
    res.status(404).json({ error: 'Logs not found for this job' });
    return;
  }

  const response: RawLogsResponse = { gameLogs };
  res.json(response);
});

// -----------------------------------------------------------------------------
// GET /jobs/:jobId/logs/condensed - Get condensed logs
// -----------------------------------------------------------------------------

app.get('/jobs/:jobId/logs/condensed', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const condensed = getCondensedLogs(jobId);
  if (condensed === null) {
    res.status(404).json({ error: 'Logs not found for this job' });
    return;
  }

  const response: CondensedLogsResponse = { condensed };
  res.json(response);
});

// -----------------------------------------------------------------------------
// GET /jobs/:jobId/logs/structured - Get structured logs for visualization
// -----------------------------------------------------------------------------

app.get('/jobs/:jobId/logs/structured', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const structured = getStructuredLogs(jobId);
  if (structured === null) {
    res.status(404).json({ error: 'Logs not found for this job' });
    return;
  }

  const deckNames = getDeckNames(jobId);
  const response: StructuredLogsResponse = {
    games: structured,
    deckNames,
  };
  res.json(response);
});

// -----------------------------------------------------------------------------
// DELETE /jobs/:jobId/cache - Invalidate cached condensed/structured data
// -----------------------------------------------------------------------------

app.delete('/jobs/:jobId/cache', (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!hasJobLogs(jobId)) {
    res.status(404).json({ error: 'Logs not found for this job' });
    return;
  }

  invalidateCache(jobId);
  res.json({ message: 'Cache invalidated', jobId });
});

// -----------------------------------------------------------------------------
// GET /jobs/:jobId/logs/analyze-payload - Get pre-computed payload for Analysis Service
// -----------------------------------------------------------------------------

app.get('/jobs/:jobId/logs/analyze-payload', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const payload = getAnalyzePayload(jobId);
  if (payload === null) {
    res.status(404).json({ error: 'Analyze payload not found for this job' });
    return;
  }

  res.json(payload);
});

// -----------------------------------------------------------------------------
// GET /jobs/:jobId/logs/analyze-prompt-preview - Get exact prompts sent to Gemini
// -----------------------------------------------------------------------------

app.get('/jobs/:jobId/logs/analyze-prompt-preview', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  const payload = getAnalyzePayload(jobId);
  if (payload === null) {
    res.status(404).json({ error: 'Analyze payload not found for this job' });
    return;
  }

  // Try Analysis Service first (authoritative prompt when running)
  try {
    const previewResponse = await fetch(`${ANALYSIS_SERVICE_URL}/analyze/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (previewResponse.ok) {
      const preview = (await previewResponse.json()) as { system_prompt: string; user_prompt: string };
      return res.json(preview);
    }
    // Non-ok (e.g. 500): fall through to local build
  } catch (error) {
    // ECONNREFUSED, network error, etc. — build prompt locally so UI still shows preview
    const cause = error instanceof Error ? error.cause ?? error : error;
    const msg = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[Preview] Analysis Service unreachable (${msg}); using local prompt build for job ${jobId}`);
  }

  // Fallback: build prompt locally (same format as Analysis Service)
  const preview = buildPromptPreview(payload as Parameters<typeof buildPromptPreview>[0]);
  res.json(preview);
});

// -----------------------------------------------------------------------------
// POST /jobs/:jobId/analyze - Forward pre-computed payload to Analysis Service
// -----------------------------------------------------------------------------

app.post('/jobs/:jobId/analyze', async (req: Request, res: Response) => {
  const { jobId } = req.params;
  // Request body is accepted for backward compatibility but we use pre-computed payload
  const _body = req.body as AnalyzeRequest;

  // Get pre-computed payload (no computation here)
  const payload = getAnalyzePayload(jobId);
  if (payload === null) {
    res.status(404).json({ error: 'Analyze payload not found for this job' });
    return;
  }

  try {
    // Forward the exact pre-computed payload to Analysis Service
    console.log(`[Analyze] Calling Analysis Service for job ${jobId}`);
    const analysisResponse = await fetch(`${ANALYSIS_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      console.error(
        `[Analyze] Analysis Service error: ${analysisResponse.status} ${errorText}`
      );
      res.status(502).json({
        error: 'Analysis Service error',
        details: errorText,
      });
      return;
    }

    const result = (await analysisResponse.json()) as AnalyzeResponse;
    // Log summary of results (new format has results array)
    if (result.results && Array.isArray(result.results)) {
      const summary = result.results.map(r => `${r.deck_name}: B${r.bracket}`).join(', ');
      console.log(`[Analyze] Job ${jobId} results: ${summary}`);
    } else {
      console.log(`[Analyze] Job ${jobId} result received`);
    }
    res.json(result);
  } catch (error) {
    console.error(`[Analyze] Error for job ${jobId}:`, error);
    res.status(502).json({
      error: 'Failed to call Analysis Service',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// -----------------------------------------------------------------------------
// Legacy endpoint: GET /jobs/:jobId/logs (for compatibility with current frontend)
// Returns raw logs in the format the frontend expects
// -----------------------------------------------------------------------------

app.get('/jobs/:jobId/logs', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const gameLogs = getRawLogs(jobId);
  if (gameLogs === null) {
    res.status(404).json({ error: 'Logs not found for this job' });
    return;
  }

  // Frontend expects { logs: string[] }
  res.json({ logs: gameLogs });
});

// -----------------------------------------------------------------------------
// Error Handling
// -----------------------------------------------------------------------------

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  Forge Log Analyzer Service');
  console.log('='.repeat(60));
  console.log(`  Port:             ${PORT}`);
  console.log(`  Analysis Service: ${ANALYSIS_SERVICE_URL}`);
  console.log('='.repeat(60));
  console.log('');
  console.log('Endpoints:');
  console.log(`  POST /jobs/:jobId/logs               - Ingest raw logs`);
  console.log(`  GET  /jobs/:jobId/logs/raw           - Get raw logs`);
  console.log(`  GET  /jobs/:jobId/logs/condensed     - Get condensed logs`);
  console.log(`  GET  /jobs/:jobId/logs/structured    - Get structured logs`);
  console.log(`  GET  /jobs/:jobId/logs/analyze-payload        - Get pre-computed payload`);
  console.log(`  GET  /jobs/:jobId/logs/analyze-prompt-preview - Get exact prompts sent to Gemini`);
  console.log(`  POST /jobs/:jobId/analyze                    - Run analysis`);
  console.log(`  GET  /health                         - Health check`);
  console.log('');
});
