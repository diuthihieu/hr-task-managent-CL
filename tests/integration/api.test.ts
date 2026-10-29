// End-to-end API tests against a running server and a real (throwaway)
// PostgreSQL database. Run with `npm run test:integration`, which creates the
// database, applies migrations, bootstraps the admin and starts the server.
// Tests run in order and share state (one scenario, many assertions): each file
// in ./api is one chapter of the scenario, imported here in the order it runs.
// Shared clients, ids and helpers live in ./api/context.ts.

import { test } from "node:test";
import { prisma } from "./api/context";
import "./api/01-auth-workspaces";
import "./api/02-tasks";
import "./api/03-okrs-pages";
import "./api/04-reminders-visibility";
import "./api/05-ai-wikis";
import "./api/06-collaboration";
import "./api/07-ai-reports-approvals";
import "./api/08-okr-scope-brain";
import "./api/09-recognition-notifications";
import "./api/10-workspaces-projects";
import "./api/11-platform-security";
import "./api/12-permission-matrix";
import "./api/13-maintenance";
import "./api/14-csp";
import "./api/15-origin";
import "./api/16-signup";

test.after(async () => {
  await prisma.$disconnect();
});
