import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../../lib/api';
import type { AgentDelegation } from '../../lib/types';

type AgentContextValue = {
  agents: AgentDelegation[];
  activeAgent: AgentDelegation | null;
  activeAgentId: string;
  setActiveAgentId: (agentId: string) => void;
  loading: boolean;
  refreshAgents: () => Promise<void>;
};

const AgentContext = createContext<AgentContextValue | null>(null);
const storageKey = 'razorcart-active-agent';

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentDelegation[]>([]);
  const [activeAgentId, setActiveAgentIdState] = useState(
    () => localStorage.getItem(storageKey) || '',
  );
  const [loading, setLoading] = useState(true);

  const refreshAgents = useCallback(async () => {
    try {
      const response = await api<{ agents: AgentDelegation[] }>('/api/agents');
      setAgents(response.agents);
      setActiveAgentIdState((current) => {
        const next = response.agents.some((agent) => agent.agentId === current)
          ? current
          : response.agents[0]?.agentId || '';
        if (next) localStorage.setItem(storageKey, next);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  const setActiveAgentId = useCallback((agentId: string) => {
    localStorage.setItem(storageKey, agentId);
    setActiveAgentIdState(agentId);
  }, []);
  const activeAgent = agents.find((agent) => agent.agentId === activeAgentId) ?? null;
  const value = useMemo(
    () => ({ agents, activeAgent, activeAgentId, setActiveAgentId, loading, refreshAgents }),
    [agents, activeAgent, activeAgentId, setActiveAgentId, loading, refreshAgents],
  );
  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgents() {
  const context = useContext(AgentContext);
  if (!context) throw new Error('useAgents must be used inside AgentProvider');
  return context;
}

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: object;
          annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
          execute: (input: unknown) => unknown | Promise<unknown>;
        },
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}
