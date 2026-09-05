import { useEffect, useRef, useState } from 'react';
import { Check as CheckIcon, X, ArrowLeft } from 'lucide-react';
import { api, dateTime, label, money } from '../../lib/api';
import type { DecisionDetail as Detail } from '../../lib/types';
import { ErrorNotice, JsonDetails, LoadingRows, VerdictBadge } from '../../components/Primitives';

export function DecisionDetail({ id, close }: { id: string; close: () => void }) {
  const [decision, setDecision] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let active = true;
    api<{ decision: Detail }>(`/api/decisions/${encodeURIComponent(id)}`)
      .then((result) => {
        if (active) setDecision(result.decision);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'This decision could not be loaded.');
      });
    return () => {
      active = false;
      element?.close();
    };
  }, [id]);

  return (
    <dialog
      ref={dialog}
      className="decision-dialog"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      aria-labelledby="decision-heading"
    >
      <div className="decision-sheet">
        <div className="sheet-toolbar">
          <span className="eyebrow">Decision record</span>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close decision detail"
          >
            <X size={20} />
          </button>
        </div>
        {!decision && !error && <LoadingRows />}
        {error && <ErrorNotice message={error} />}
        {decision && (
          <>
            <div className="decision-heading">
              <VerdictBadge verdict={decision.verdict} />
              <h2 id="decision-heading">{money(decision.amount, decision.currency)}</h2>
              <p>
                {decision.agentName || decision.agentId} <span className="muted">→</span>{' '}
                {decision.merchant}
              </p>
            </div>
            <div className={`decision-reason decision-reason--${decision.verdict.toLowerCase()}`}>
              <span className="code-label">{decision.reason_code}</span>
              <p>{decision.reason_text}</p>
            </div>
            <dl className="record-metadata">
              <div>
                <dt>Request</dt>
                <dd className="mono">{decision.requestId}</dd>
              </div>
              <div>
                <dt>Decided at</dt>
                <dd>{dateTime(decision.createdAt)}</dd>
              </div>
              <div>
                <dt>Agent ID</dt>
                <dd className="mono">{decision.agentId}</dd>
              </div>
            </dl>
            <section className="detail-section">
              <div className="section-label">
                <span>01</span>
                <h3>Hard controls</h3>
              </div>
              <p className="section-caption">
                Evaluated before risk reasoning. A failed control blocks approval.
              </p>
              <div className="check-list">
                {decision.checks.length ? (
                  decision.checks.map((check, index) => (
                    <div className="check-item" key={`${check.rule}-${index}`}>
                      <span
                        className={`check-indicator ${check.passed ? 'check-indicator--pass' : 'check-indicator--fail'}`}
                      >
                        {check.passed ? <CheckIcon size={14} /> : <X size={14} />}
                      </span>
                      <div>
                        <h4>{label(check.rule)}</h4>
                        <p>{check.reason_text}</p>
                        {(check.actual !== undefined || check.limit !== undefined) && (
                          <JsonDetails
                            title="Check evidence"
                            value={{
                              reason_code: check.reason_code,
                              actual: check.actual,
                              limit: check.limit,
                            }}
                          />
                        )}
                      </div>
                      <span className="check-status">{check.passed ? 'Pass' : 'Fail'}</span>
                    </div>
                  ))
                ) : (
                  <p className="muted">No control details were recorded for this request.</p>
                )}
              </div>
            </section>
            <section className="detail-section">
              <div className="section-label">
                <span>02</span>
                <h3>Risk reasoning</h3>
              </div>
              {decision.risk ? (
                <>
                  <p className="risk-text">
                    {String(
                      decision.risk.reason_text ||
                        decision.risk.reason ||
                        decision.risk.summary ||
                        'Risk assessment completed. Review the recorded output below.',
                    )}
                  </p>
                  <JsonDetails title="Risk assessment output" value={decision.risk} />
                </>
              ) : (
                <div className="skipped-note">
                  No risk assessment was run. Hard controls may have stopped this request before the
                  reasoning layer.
                </div>
              )}
            </section>
            <section className="detail-section">
              <div className="section-label">
                <span>03</span>
                <h3>Authorization artifact</h3>
              </div>
              {decision.artifact ? (
                <>
                  <p className="section-caption">
                    Bound to this approval, with expiry and single-use status enforced by Sentinel.
                  </p>
                  <JsonDetails title="Artifact metadata" value={decision.artifact} />
                </>
              ) : (
                <p className="muted">No authorization artifact was issued for this decision.</p>
              )}
            </section>
            <section className="detail-section">
              <h3>Evidence trail</h3>
              <JsonDetails title="Purchase proposal" value={decision.proposal} />
              <JsonDetails title="Collected evidence" value={decision.evidence} />
            </section>
          </>
        )}
        <button type="button" className="button button--quiet sheet-close" onClick={close}>
          <ArrowLeft size={16} />
          Back to the feed
        </button>
      </div>
    </dialog>
  );
}
