import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/AppError.js';

/**
 * Reference implementation of the /api/v1/ routing convention.
 *
 * Delete this file once real routes exist — but copy its shape.
 *
 * Rules it demonstrates:
 * 1. Every route file lives under src/routes/v1/ (then v2/, etc.).
 * 2. Mounted in routes/v1/index.ts, which app.ts mounts at '/api/v1'.
 * 3. Validate input with Zod at the boundary — before any logic runs. Never
 *    trust req.params / req.query / req.body to be the shape you expect.
 * 4. Handlers stay THIN: parse input → call a service → shape response → log.
 *    Business logic belongs in src/services/, not here.
 * 5. Use `req.log`, never the global logger — requestId is attached for free.
 * 6. Never build an error response inline. Throw an AppError (expected) or let
 *    it bubble (unexpected); errorHandler owns the response shape.
 *
 * Why version from day one:
 * When a client is pinned to v1 and you need to change a response shape, you
 * add /v2/ and break nobody. Retrofitting versioning onto a live unversioned
 * API means either breaking clients or a painful multi-month migration.
 */

export const exampleRouter = Router();

const paramsSchema = z.object({
  id: z.string().cuid('Not a valid id'),
});

// GET /api/v1/example/:id
exampleRouter.get('/example/:id', async (req, res) => {
  const parsed = paramsSchema.safeParse(req.params);

  if (!parsed.success) {
    // 400, not 500 — the caller sent something wrong, nothing is broken here.
    throw AppError.badRequest('Invalid request parameters', parsed.error.flatten());
  }

  const { id } = parsed.data;

  req.log.info({ event: 'example.fetch.started', exampleId: id });

  try {
    // In a real route, call a service:
    //   const example = await exampleService.getById(id);
    //   if (!example) throw AppError.notFound(`No example with id ${id}`);
    const example = await Promise.resolve({ id, name: 'placeholder' });

    req.log.info({ event: 'example.fetch.succeeded', exampleId: id });
    res.status(200).json({ data: example });
  } catch (err) {
    // Express 5 forwards rejected promises to the error handler on its own, so
    // this catch exists only to attach route-specific context to the log line.
    // Re-throw — errorHandler still decides the response.
    req.log.error({
      event: 'example.fetch.failed',
      exampleId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});
