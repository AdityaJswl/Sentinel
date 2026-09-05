import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [authorizations, nonces, actions, cartItems, carts] = await prisma.$transaction([
    prisma.sentinelAuthorization.deleteMany(),
    prisma.requestNonce.deleteMany(),
    prisma.aiAction.deleteMany(),
    prisma.cartItem.deleteMany(),
    prisma.cartSession.deleteMany(),
  ]);
  console.log(
    `[demo:reset] Cleared ${authorizations.count} authorizations, ${nonces.count} replay nonces, ${actions.count} AI actions, ${cartItems.count} cart lines, and ${carts.count} carts. Products and agent delegations were preserved.`,
  );
}

main()
  .catch((error) => {
    console.error('[demo:reset] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
