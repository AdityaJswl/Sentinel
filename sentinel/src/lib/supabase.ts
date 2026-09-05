import { createClient, type User } from '@supabase/supabase-js';
import type { SessionUser } from './types';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured.');
}

export const supabase = createClient(url, publishableKey);

export function sessionUser(user: User): SessionUser {
  const role = user.app_metadata.sentinel_role === 'admin' ? 'admin' : 'standard';
  const configuredAgentId = user.app_metadata.sentinel_agent_id;
  return {
    username: user.email || user.id,
    role,
    // An unassigned user receives an impossible-to-guess, user-specific scope and therefore no agent data.
    agentId:
      role === 'standard'
        ? typeof configuredAgentId === 'string' && configuredAgentId
          ? configuredAgentId
          : user.id
        : undefined,
  };
}
