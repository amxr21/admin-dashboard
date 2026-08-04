import { Router } from 'express';
import { healthRouter } from './health.route.js';
import { authRouter } from './auth.route.js';
import { rolesRouter } from './roles.route.js';
import { ordersRouter } from './orders.route.js';
import { returnsRouter } from './returns.route.js';
import { inventoryRouter } from './inventory.route.js';
import { couriersRouter } from './couriers.route.js';
import { courierRouter } from './courier.route.js';
import { staffRouter } from './staff.route.js';
import { settingsRouter } from './settings.route.js';
import { diagnosticsRouter } from './diagnostics.route.js';
import { reportsRouter } from './reports.route.js';
import { auditRouter } from './audit.route.js';
import { notificationsRouter } from './notifications.route.js';
import { uploadRouter } from './upload.route.js';
import { variantsRouter } from './variants.route.js';
import { productImagesRouter } from './product-images.route.js';
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
v1Router.use(returnsRouter);
v1Router.use(inventoryRouter);
v1Router.use(couriersRouter);
v1Router.use(courierRouter);
v1Router.use(staffRouter);
v1Router.use(settingsRouter);
v1Router.use(diagnosticsRouter);
v1Router.use(reportsRouter);
v1Router.use(auditRouter);
v1Router.use(notificationsRouter);
v1Router.use(uploadRouter);
v1Router.use(variantsRouter);
v1Router.use(productImagesRouter);
// LAST: /r/:resource is a catch-all shape, so it must not shadow a named route.
v1Router.use(resourceRouter);
