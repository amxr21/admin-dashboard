import { Router } from 'express';
import { healthRouter } from './health.route.js';
import { authRouter } from './auth.route.js';
import { rolesRouter } from './roles.route.js';
import { ordersRouter } from './orders.route.js';
import { inventoryRouter } from './inventory.route.js';
import { resourceRouter } from './resource.route.js';

/**
 * The v1 API surface. app.ts mounts this at '/api/v1'.
 *
 * Adding a route: create `<name>.route.ts` in this folder, export its Router,
 * and register it here. One line per feature — this file stays a table of
 * contents for the whole API.
 */

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(authRouter);
v1Router.use(rolesRouter);
v1Router.use(ordersRouter);
v1Router.use(inventoryRouter);
// LAST: /r/:resource is a catch-all shape, so it must not shadow a named route.
v1Router.use(resourceRouter);
