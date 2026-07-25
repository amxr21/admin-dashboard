import { Router } from 'express';
import { healthRouter } from './health.route.js';
import { exampleRouter } from './example.route.js';

/**
 * The v1 API surface. app.ts mounts this at '/api/v1'.
 *
 * Adding a route: create `<name>.route.ts` in this folder, export its Router,
 * and register it here. One line per feature — this file stays a table of
 * contents for the whole API.
 */

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(exampleRouter);
