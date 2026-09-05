import type { Prisma } from '@prisma/client';
// Application code exposes append only. SQLite migration also blocks UPDATE and DELETE.
export async function appendAudit(
  db: Prisma.TransactionClient,
  eventType: string,
  actor: string,
  context: unknown,
  agentId?: string,
  verdict?: string,
) {
  return db.auditEvent.create({
    data: { eventType, actor, agentId, verdict, contextJson: JSON.stringify(context) },
  });
}
