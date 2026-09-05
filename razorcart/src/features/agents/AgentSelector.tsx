import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, UserRoundCog } from 'lucide-react';
import { useAgents } from './AgentProvider';

export function AgentSelector({ compact = false }: { compact?: boolean }) {
  const { agents, activeAgentId, setActiveAgentId, loading } = useAgents();
  if (loading) return <span className="agent-selector__loading">Loading agents…</span>;
  if (!agents.length)
    return <span className="agent-selector__empty">No buying agent configured</span>;
  return (
    <div className={`agent-selector ${compact ? 'agent-selector--compact' : ''}`}>
      {!compact ? <span className="agent-selector__label">Shopping as</span> : null}
      <Select.Root value={activeAgentId} onValueChange={setActiveAgentId}>
        <Select.Trigger className="agent-selector__trigger" aria-label="Active buying agent">
          <UserRoundCog size={15} aria-hidden="true" />
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={14} aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={8}>
            <Select.Viewport>
              {agents.map((agent) => (
                <Select.Item key={agent.agentId} value={agent.agentId} className="select-item">
                  <Select.ItemText>{agent.name}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
