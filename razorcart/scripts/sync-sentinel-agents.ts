import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  registerWithSentinel,
  registrationFromDelegation,
  validateBridgeConfiguration,
} from '../server/lib/sentinel-client.js';

// Run deliberately as the owner. Checkout never copies or enlarges delegation limits.
const prisma = new PrismaClient();
try {
  validateBridgeConfiguration();
  const requestedAgentId = process.argv[2];
  const agents = await prisma.agentDelegation.findMany({
    where: requestedAgentId ? { agentId: requestedAgentId } : {},
    orderBy: { createdAt: 'asc' },
  });
  if (!agents.length) throw new Error('No matching RazorCart delegations were found.');
  for (const agent of agents) {
    if (agent.expiresAt <= new Date()) {
      console.log(`Skipped expired delegation ${agent.agentId}; update it from agent setup first.`);
      continue;
    }
    const sentinelSecretEncrypted = await registerWithSentinel(
      registrationFromDelegation(agent),
      agent.sentinelSecretEncrypted,
    );
    await prisma.agentDelegation.update({
      where: { agentId: agent.agentId },
      data: { sentinelSecretEncrypted },
    });
    console.log(`Synchronized ${agent.agentId}. Signing credential stored encrypted.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Agent synchronization failed.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
