# ADR 0002: Every notification row is also sent as Web Push, from one Prisma hook

- Status: accepted (2026-10-28).
- Context: notifications are written from many places: about 20 routes and helpers call `notification.create` or `createMany`, often inside transactions. Web Push (phone and desktop notifications while woli is closed) must cover all of them. If each call site had to remember to send a push, some would be forgotten.

## Decision

- `src/lib/prisma.ts` wraps the Prisma client with a query-only `$extends` hook on `notification.create` and `notification.createMany`. After the row is written, the hook queues it in `src/lib/push.ts` (`queuePush`). No call site knows about push.
- The hook loads `./push` with a dynamic import, so `web-push` stays out of every bundle that only reads data.
- Push is sent after the response through `after()`, or immediately outside a request (scripts, tests). Before sending, the sender checks that the row really exists. A rolled-back transaction or a skipped duplicate therefore sends nothing.
- The extended client is exported with the base client's type (`makeClient() as unknown as Client`). A query-only extension leaves every model's shape unchanged, so the app keeps `Prisma.TransactionClient` and the other plain types assignable. **Do not add result or model extensions to this client.** They would make that cast unsound. Write a separate client for them instead.
- Endpoints are accepted only from the browsers' own push services (`PUSH_HOSTS` in `src/lib/push.ts`). The server never sends to an arbitrary host. Subscriptions that come back 404 or 410 are deleted.

## Consequences

- A new notification type gets Web Push for free. Its pushed body text comes from `describe()` in `src/lib/push.ts`, which falls back to the row's `body`.
- Notifications written with raw SQL bypass the hook and are not pushed. Write them through Prisma.
- With no VAPID keys configured, the hook does nothing and the app works exactly as before.
