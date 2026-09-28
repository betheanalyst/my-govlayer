import type { Proposal, ProposalRevision } from "@/domain/types";
import { StateBadge } from "@/components/shared/StateBadge";
import {
  Panel,
  Prose,
  RecordedText,
  SectionHeading,
} from "@/components/shared/Primitives";
import type { Tone } from "@/domain/labels";
import { formatUtcTimestamp } from "@/lib/time";

/**
 * Constitutional review and revision history (Experience Blueprint sections
 * 10.5, 10.6, 10.7).
 *
 * Review is presented as a formal constitutional record, never as a chat
 * transcript: the decision is separated from its explanation, because the
 * contract's consensus check compares only the decision field -- the reasoning
 * and conflict list are recorded alongside it but are not consensus-critical.
 */

const DECISION_LABELS: Record<string, string> = {
  accept: "Accepted — constitutionally compliant",
  revise: "Needs revision",
  reject: "Rejected — does not comply",
};

const DECISION_TONES: Record<string, Tone> = {
  accept: "positive",
  revise: "caution",
  reject: "review-negative",
};

function decisionLabel(decision: string): string {
  if (decision === "") return "No review decision recorded";
  return DECISION_LABELS[decision] ?? `Unrecognized decision: ${decision}`;
}

function decisionTone(decision: string): Tone {
  return DECISION_TONES[decision] ?? "unknown";
}

export function ReviewRecord({ proposal }: { proposal: Proposal }) {
  const lastDispute = proposal.disputeHistory.at(-1);
  const decisionWasSuperseded =
    lastDispute !== undefined && proposal.disputeStage > 0;

  return (
    <section aria-labelledby="review-heading" className="space-y-6">
      <SectionHeading
        id="review-heading"
        title="Constitutional review"
        description="Review answers one question: does this proposal comply with the constitution? It is not a vote on whether the proposal should pass."
      />

      <Panel>
        <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
          Decision
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StateBadge
            label={decisionLabel(proposal.aiAuditDecision)}
            tone={decisionTone(proposal.aiAuditDecision)}
          />
          <span className="text-xs text-ink-subtle">
            This is the value consensus agreed on.
          </span>
        </div>

        {decisionWasSuperseded ? (
          <p className="mt-4 text-sm text-ink-muted">
            A dispute has since reevaluated the original review. The decision above
            is the most recent dispute outcome (stage {lastDispute?.stage}), which
            supersedes the original review.
          </p>
        ) : null}
      </Panel>

      <div>
        <h3 className="text-sm font-medium text-ink">Recorded explanation</h3>
        <p className="mt-1 text-xs text-ink-subtle">
          Recorded with the decision. The review&rsquo;s consensus check compares
          the decision itself, not this wording.
        </p>
        <div className="mt-4">
          {proposal.aiAuditReasoning.trim() === "" ? (
            <p className="text-sm text-ink-muted">No explanation was recorded.</p>
          ) : (
            <Prose>{proposal.aiAuditReasoning}</Prose>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink">
          Constitutional conflicts ({proposal.conflicts.length})
        </h3>
        {proposal.conflicts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No constitutional conflicts were recorded for this proposal.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {proposal.conflicts.map((conflict, index) => (
              <li
                key={`${conflict.severity}-${index}`}
                className="rounded-card border border-line bg-surface-raised p-4"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
                  Severity:{" "}
                  {conflict.severity === "" ? "not recorded" : conflict.severity}
                </p>
                <p className="mt-2 text-sm text-ink">{conflict.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
/** Parses a recorded conflicts snapshot, returning null when unreadable. */
function parseRecordedConflicts(json: string): string[] | null {
  if (json.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) =>
      typeof entry === "object" && entry !== null
        ? `${String((entry as { severity?: unknown }).severity ?? "")} — ${String(
            (entry as { description?: unknown }).description ?? "",
          )}`
        : String(entry),
    );
  } catch {
    return null;
  }
}

export function RevisionHistory({
  proposal,
  revisions,
}: {
  proposal: Proposal;
  revisions: readonly ProposalRevision[];
}) {
  if (revisions.length === 0) {
    return (
      <section aria-labelledby="revisions-heading">
        <SectionHeading
          id="revisions-heading"
          title="Revision history"
          description="Resubmission is constructive: a proposal that needs revision can be improved and reviewed again."
        />
        <p className="mt-4 text-sm text-ink-muted">
          This proposal has not been resubmitted. A revision is recorded when a
          proposer revises a proposal whose review asked for clarification.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="revisions-heading" className="space-y-6">
      <SectionHeading
        id="revisions-heading"
        title="Revision history"
        description="Each resubmission evaluates the revised text against the constitution snapshot captured at the proposal's original submission."
      />

      <ol className="space-y-6">
        {revisions.map((revision) => {
          const conflicts = parseRecordedConflicts(revision.priorConflictsJson);

          return (
            <li key={revision.resubmitNumber.toString()}>
              <Panel tone="sunken">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-ink">
                    Revision {revision.resubmitNumber.toString()}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {formatUtcTimestamp(revision.revisedAt)} UTC
                  </p>
                </div>

                <dl className="mt-4 space-y-4 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
                      Previous review outcome
                    </dt>
                    <dd className="mt-1 text-ink">
                      {decisionLabel(revision.priorAiDecision)}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
                      Previous explanation
                    </dt>
                    <dd className="mt-1 text-ink-muted">
                      {revision.priorAiReasoning.trim() === ""
                        ? "None recorded."
                        : revision.priorAiReasoning}
                    </dd>
                  </div>

                  {conflicts === null ? (
                    <div>
                      <dt className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
                        Previously recorded conflicts
                      </dt>
                      <dd className="mt-2">
                        <RecordedText value={revision.priorConflictsJson} />
                      </dd>
                    </div>
                  ) : null}

                  {conflicts !== null && conflicts.length > 0 ? (
                    <div>
                      <dt className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
                        Previously recorded conflicts
                      </dt>
                      <dd className="mt-2">
                        <ul className="list-inside list-disc space-y-1 text-ink-muted">
                          {conflicts.map((conflict, index) => (
                            <li key={index}>{conflict}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </Panel>
            </li>
          );
        })}
      </ol>

      {proposal.status === "needs_revision" ? (
        <p className="text-xs text-ink-subtle">
          This proposal currently needs revision, so the proposer may revise it and
          resubmit for a fresh constitutional review.
        </p>
      ) : proposal.status === "rejected" ? (
        <p className="text-xs text-ink-subtle">
          This proposal was rejected in review and cannot be resubmitted; only a
          dispute can challenge a rejection.
        </p>
      ) : null}
    </section>
  );
}

