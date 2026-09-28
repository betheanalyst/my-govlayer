"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { formatUtcTimestamp } from "@/lib/time";
import { isAppError } from "@/lib/errors";
import {
  useGovernanceConfig,
  useProposal,
  useProposalRevisions,
} from "@/queries/coreQueries";
import { useResubmitProposal } from "@/queries/writeHooks";
import { useWallet } from "@/wallet/WalletProvider";
import { WalletRequirementNotice } from "@/wallet/ConnectWallet";
import { PageHeader, Panel, SectionHeading } from "@/components/shared/Primitives";
import { WriteResultPanel } from "@/components/participation/WriteResultPanel";
import { DESCRIPTION_MAX_LENGTH } from "@/domain/proposalDraft";

/**
 * Revise a proposal (Experience Blueprint section 10.6).
 *
 * Revision is a constructive continuation, so this surface states why revision is
 * needed, what the review objected to, how the snapshot is used, and what happens
 * after resubmission -- all before offering the editor.
 */
export default function ReviseProposalPage() {
  const params = useParams<{ id: string }>();
  const wallet = useWallet();
  const proposalId = /^\d+$/.test(params.id) ? BigInt(params.id) : null;
  const proposal = useProposal(proposalId ?? 0n);
  const config = useGovernanceConfig();
  const revisions = useProposalRevisions(proposalId ?? 0n);
  const resubmit = useResubmitProposal();
  const [description, setDescription] = useState<string | null>(null);

  if (proposalId === null) return <NotFoundPanel />;

  if (proposal.isLoading) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Revise" title="Loading the record…" />
      </main>
    );
  }

  if (proposal.isError || proposal.data === undefined) {
    if (isAppError(proposal.error) && proposal.error.kind === "not_found") {
      return <NotFoundPanel />;
    }
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Revise" title="This record could not be read" />
        <p className="mt-6 max-w-prose text-sm text-ink-muted">
          The proposal could not be verified right now. This is not a statement
          about the proposal itself. Retry in a moment.
        </p>
      </main>
    );
  }

  const record = proposal.data;
  const governance = config.data;
  const isProposer =
    wallet.address !== null &&
    record.proposer.toLowerCase() === wallet.address.toLowerCase();

  const draft = description ?? record.description;
  const trimmed = draft.trim();
  const draftIssue =
    trimmed === ""
      ? "A revised description cannot be empty."
      : trimmed.length > DESCRIPTION_MAX_LENGTH
        ? `The description is longer than the contract accepts (maximum ${DESCRIPTION_MAX_LENGTH} characters).`
        : null;

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow={`Revise · proposal #${record.proposalId.toString()}`}
        title={record.title}
        lede="A revision replaces the description and sends it for a fresh constitutional review. The original review and every earlier revision stay in the record."
      >
        <p className="text-sm">
          <Link
            href={`/proposals/${record.proposalId.toString()}`}
            className="underline"
          >
            Back to the record
          </Link>
        </p>
      </PageHeader>

      {record.status !== "needs_revision" ? (
        <Panel tone="sunken" className="mt-10">
          <p className="max-w-prose text-sm text-ink">
            This proposal is recorded as{" "}
            <span className="code-value">{record.rawStatus}</span>, so revision is
            not available. Only a proposal that needs revision can be resubmitted.
          </p>
        </Panel>
      ) : null}

      {record.status === "needs_revision" && !isProposer ? (
        <Panel tone="sunken" className="mt-10">
          <p className="text-sm text-ink">
            Only the address that submitted this proposal can revise it.
          </p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            {wallet.address === null
              ? "Connect the wallet that submitted it to continue."
              : "The connected address did not submit this proposal."}
          </p>
        </Panel>
      ) : null}
      {record.status === "needs_revision" && isProposer ? (
        <div className="mt-10 space-y-14">
          {wallet.writeBlockedReason === null ? null : (
            <WalletRequirementNotice action="revise this proposal" />
          )}

          <section aria-labelledby="why-heading" className="space-y-4">
            <SectionHeading
              id="why-heading"
              title="Why revision is needed"
              description="The review found the proposal fundamentally sound but unclear. This is what it recorded."
            />
            <Panel tone="sunken">
              <p className="text-sm text-ink">
                Review outcome:{" "}
                <span className="code-value">{record.aiAuditDecision}</span>
              </p>
              <p className="mt-3 max-w-prose whitespace-pre-wrap text-sm text-ink-muted">
                {record.aiAuditReasoning.trim() === ""
                  ? "No reasoning is recorded."
                  : record.aiAuditReasoning}
              </p>

              {record.conflicts.length === 0 ? null : (
                <>
                  <p className="mt-5 text-sm font-medium text-ink">Affected areas</p>
                  <ul className="mt-2 space-y-2 text-sm text-ink-muted">
                    {record.conflicts.map((conflict, index) => (
                      <li key={`${index}-${conflict.description}`}>
                        {conflict.description}
                        {conflict.severity.trim() === "" ? null : (
                          <span className="text-xs text-ink-subtle">
                            {" "}
                            · severity: {conflict.severity}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="mt-5 max-w-prose text-xs text-ink-subtle">
                Revisions used: {record.resubmissionCount.toString()}
                {governance === undefined
                  ? ""
                  : ` of ${governance.maxResubmissions.toString()}`}
                . The fresh review uses the constitution snapshot captured at first
                submission, not the live constitution.
              </p>
            </Panel>
          </section>

          <section aria-labelledby="snapshot-heading" className="space-y-4">
            <SectionHeading
              id="snapshot-heading"
              title="The rules this review will use"
              description="Captured when the proposal was submitted. It does not move with later amendments."
            />
            <Panel tone="sunken">
              {record.constitutionSnapshot.trim() === "" ? (
                <p className="text-sm text-ink-muted">No snapshot text is recorded.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
                  {record.constitutionSnapshot}
                </div>
              )}
            </Panel>
          </section>

          <section aria-labelledby="edit-heading" className="space-y-4">
            <SectionHeading
              id="edit-heading"
              title="Revise the description"
              description="This becomes the proposal's new description. Earlier versions stay in the revision history."
            />
            <Panel>
              <label htmlFor="revision" className="text-sm font-medium text-ink">
                Revised description
              </label>
              <textarea
                id="revision"
                value={draft}
                onChange={(event) => setDescription(event.target.value)}
                rows={12}
                className="mt-2 w-full rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink-subtle">
                {draft.length} of {DESCRIPTION_MAX_LENGTH} characters.
                {draftIssue === null ? null : (
                  <span className="block text-state-review-rejected">
                    {draftIssue}
                  </span>
                )}
              </p>

              {revisions.data === undefined || revisions.data.length === 0 ? null : (
                <div className="mt-6 border-t border-line pt-5">
                  <p className="text-sm font-medium text-ink">Earlier revisions</p>
                  <ul className="mt-2 space-y-2 text-xs text-ink-muted">
                    {revisions.data.map((revision) => (
                      <li key={revision.resubmitNumber.toString()}>
                        Revision #{revision.resubmitNumber.toString()} ·{" "}
                        {formatUtcTimestamp(revision.revisedAt)} UTC · review outcome{" "}
                        <span className="code-value">{revision.priorAiDecision}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                disabled={
                  draftIssue !== null ||
                  resubmit.isPending ||
                  wallet.writeBlockedReason !== null
                }
                onClick={() => {
                  void resubmit
                    .mutateAsync({
                      proposalId: record.proposalId,
                      newDescription: trimmed,
                    })
                    .catch(() => undefined);
                }}
                className="mt-5 rounded-card bg-accent px-6 py-3 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resubmit.isPending
                  ? "Waiting for the network…"
                  : "Resubmit for constitutional review"}
              </button>
              {resubmit.isPending ? (
                <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                  The fresh review runs inside this transaction, so it takes as long
                  as the network takes.
                </p>
              ) : null}

              <div className="mt-5">
                <WriteResultPanel
                  pending={resubmit.isPending}
                  report={resubmit.data ?? null}
                  error={resubmit.error ?? null}
                />
              </div>
            </Panel>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function NotFoundPanel() {
  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Revise"
        title="No record here"
        lede="Nothing on chain matches that proposal number, so there is nothing to revise."
      />
      <p className="mt-6 text-sm">
        <Link href="/explore" className="underline">
          Browse the governance record
        </Link>
      </p>
    </main>
  );
}
