"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDuration, formatUtcTimestamp } from "@/lib/time";
import {
  canCancel,
  canFinalize,
  canResubmit,
  deriveProposalStage,
  disputeEligibility,
  isProposer,
} from "@/domain/state";
import type { GovernanceConfig, Proposal } from "@/domain/types";
import { useCancelProposal, useFinalizeDecision } from "@/queries/writeHooks";
import { useStewardshipAction } from "@/queries/stewardshipWriteHooks";
import { useAdminMembership } from "@/queries/adminQueries";
import { WalletRequirementNotice } from "@/wallet/ConnectWallet";
import { useWallet } from "@/wallet/WalletProvider";
import { Panel } from "@/components/shared/Primitives";
import { VotePanel } from "./VotePanel";
import { WriteResultPanel } from "./WriteResultPanel";

/**
 * Participation: what this proposal needs from the connected address
 * (Blueprint sections 10.6, 10.8, 10.9, 10.10 and 11).
 *
 * Every stage answers the same question the record's current-state panel asks --
 * what can I do here, and do I need to do anything? Actions that the contract
 * restricts (proposer-only revision, rejected-only dispute) are stated as
 * restrictions rather than hidden, and an action the protocol does not require is
 * never invented.
 */
export function ParticipationPanel({
  proposal,
  config,
  now,
}: {
  readonly proposal: Proposal;
  readonly config: GovernanceConfig;
  readonly now: number;
}) {
  const stage = deriveProposalStage(proposal, now);
  const wallet = useWallet();
  const address = wallet.address;

  const finalizable = canFinalize(proposal, now);
  const cancellable = canCancel(proposal) && address !== null && isProposer(proposal, address);
  const revisit = canResubmit(proposal, config) && address !== null && isProposer(proposal, address);
  const dispute = disputeEligibility(proposal, config, address ?? "", now);

  const needsSomeone =
    stage === "voting_open" ||
    stage === "voting_closed_awaiting_finalization" ||
    stage === "needs_revision" ||
    stage === "review_rejected" ||
    stage === "awaiting_stewardship_confirmation";

  return (
    <section aria-labelledby="participation-heading" className="space-y-4">
      <h2
        id="participation-heading"
        className="text-xs uppercase tracking-[0.18em] text-ink-subtle"
      >
        Taking part
      </h2>

      {wallet.writeBlockedReason !== null && needsSomeone ? (
        <WalletRequirementNotice
          action={
            stage === "voting_open"
              ? "vote on this proposal"
              : stage === "voting_closed_awaiting_finalization"
                ? "finalize this decision"
                : stage === "needs_revision"
                  ? "revise this proposal"
                  : "raise a dispute"
          }
        />
      ) : null}

      {stage === "voting_open" ? (
        <VotePanel proposal={proposal} config={config} now={now} />
      ) : null}

      {finalizable ? (
        <FinalizePanel proposal={proposal} />
      ) : null}

      {stage === "awaiting_stewardship_confirmation" ? (
        <ConfirmationPanel proposal={proposal} />
      ) : null}

      {revisit ? (
        <Panel tone="sunken">
          <p className="text-sm font-medium text-ink">This proposal needs revision</p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            You submitted this proposal, so you can revise its description and send
            it for a fresh constitutional review. Review uses the constitution
            snapshot captured at first submission, not the live constitution.
          </p>
          <p className="mt-4 text-sm">
            <Link
              href={`/proposals/${proposal.proposalId.toString()}/revise`}
              className="underline"
            >
              Revise this proposal
            </Link>
          </p>
        </Panel>
      ) : null}

      {proposal.status === "rejected" ? (
        <DisputeAvailabilityPanel
          proposal={proposal}
          config={config}
          dispute={dispute}
        />
      ) : null}

      {cancellable ? <CancelPanel proposal={proposal} /> : null}
    </section>
  );
}

/**
 * Finalization. Permissionless by design: anyone may record the determination
 * once the voting window has closed, and nothing finalizes itself.
 */
function FinalizePanel({ proposal }: { readonly proposal: Proposal }) {
  const router = useRouter();
  const wallet = useWallet();
  const finalize = useFinalizeDecision();

  return (
    <Panel tone="sunken">
      <p className="text-sm font-medium text-ink">
        This decision is waiting to be finalized
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        The voting window has closed. Finalization is permissionless: it records
        the outcome the contract can already determine, and it creates closure for
        the record. Nothing is finalized automatically, and finalizing does not
        change how anyone voted.
      </p>
      <div className="mt-4">
        <button
          type="button"
          disabled={finalize.isPending || wallet.writeBlockedReason !== null}
          onClick={() => {
            void finalize
              .mutateAsync({ proposalId: proposal.proposalId })
              .then(() => router.refresh())
              .catch(() => undefined);
          }}
          className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {finalize.isPending ? "Waiting for the network…" : "Finalize this decision"}
        </button>
      </div>
      {wallet.writeBlockedReason === null ? null : (
        <p className="mt-3 max-w-prose text-xs text-ink-subtle">
          {wallet.writeBlockedReason}
        </p>
      )}
      <div className="mt-4">
        <WriteResultPanel
          pending={finalize.isPending}
          report={finalize.data ?? null}
          error={finalize.error ?? null}
        />
      </div>
    </Panel>
  );
}


/**
 * Dispute availability. A dispute is a narrow constitutional reevaluation of an
 * AI-rejected proposal, so this panel says what stays the same, what changes,
 * and what a dispute does not do (Blueprint section 10.8).
 */
function DisputeAvailabilityPanel({
  proposal,
  config,
  dispute,
}: {
  readonly proposal: Proposal;
  readonly config: GovernanceConfig;
  readonly dispute: ReturnType<typeof disputeEligibility>;
}) {
  const href = `/proposals/${proposal.proposalId.toString()}/dispute`;

  return (
    <Panel tone="sunken">
      <p className="text-sm font-medium text-ink">
        This proposal was rejected in constitutional review
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Rejection is a review outcome, not a community vote against the proposal. A
        dispute asks for a fresh reevaluation against the constitution snapshot
        captured at submission. It never approves a proposal by itself: if the
        dispute is accepted, a genuine voting window opens.
      </p>

      {dispute.state === "eligible_proposer" ? (
        <p className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Link href={href} className="underline">
            Raise a dispute
          </Link>
          <span className="text-xs text-ink-subtle">
            Dispute stages used: {proposal.disputeStage} of{" "}
            {config.maxDisputeStagesCount.toString()}.
          </span>
        </p>
      ) : null}

      {dispute.state === "undetermined_voter" ? (
        <p className="mt-4 max-w-prose text-sm text-ink-muted">
          You did not submit this proposal, so the protocol would have to find a
          recorded vote from your address. GovLayerCore keeps the tally rather than
          the voter, so this interface cannot tell whether an address voted — and it
          will not guess. If your address did vote here, you can{" "}
          <Link href={href} className="underline">
            attempt a dispute
          </Link>
          ; the contract will accept or refuse it.
        </p>
      ) : null}

      {dispute.state === "cooldown" ? (
        <p className="mt-4 max-w-prose text-sm text-ink-muted">
          A dispute cooldown is active. The next dispute on this proposal becomes
          available {formatUtcTimestamp(dispute.nextAllowedAt)} UTC (in{" "}
          {formatDuration(dispute.remainingSeconds)}). Stages used:{" "}
          {proposal.disputeStage} of {config.maxDisputeStagesCount.toString()}.
        </p>
      ) : null}

      {dispute.state === "stages_exhausted" ? (
        <p className="mt-4 max-w-prose text-sm text-ink-muted">
          All {config.maxDisputeStagesCount.toString()} dispute stages for this
          proposal have been used, so no further dispute is possible. The record is
          final.
        </p>
      ) : null}
    </Panel>
  );
}



/**
 * The stewardship confirmation of a passed constitution amendment.
 *
 * GovLayerCore moves a passed amendment to `pending_constitution_confirm`; the
 * constitution changes only once stewardship authorizes the application and Core
 * pulls it. This is that authorization: it needs steward approvals, then a
 * timelock, and finally Core applying it — three separate recorded steps.
 */
function ConfirmationPanel({ proposal }: { readonly proposal: Proposal }) {
  const router = useRouter();
  const wallet = useWallet();
  const membership = useAdminMembership(wallet.address ?? undefined);
  const stewardship = useStewardshipAction();

  const isSteward = membership.data === true;

  return (
    <Panel tone="sunken">
      <p className="text-sm font-medium text-ink">
        This amendment passed and awaits stewardship confirmation
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        The vote accepted this constitution amendment. The constitution changes
        only when stewardship authorizes the application and GovLayerCore
        independently validates and applies it — so passing a vote is not the same
        as amending the constitution. Until then, this version is not in force.
      </p>

      {membership.isPending ? (
        <p className="mt-4 text-sm text-ink-muted">
          Checking whether the connected address is a steward…
        </p>
      ) : isSteward ? (
        <button
          type="button"
          disabled={stewardship.isPending || wallet.writeBlockedReason !== null}
          onClick={() => {
            void stewardship
              .mutateAsync({
                kind: "propose_constitution_update",
                proposalId: proposal.proposalId,
              })
              .then(() => router.refresh())
              .catch(() => undefined);
          }}
          className="mt-4 rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {stewardship.isPending
            ? "Waiting for the network…"
            : "Propose the stewardship confirmation"}
        </button>
      ) : (
        <p className="mt-4 max-w-prose text-sm text-ink-muted">
          Only a current steward can propose this confirmation.{" "}
          {wallet.address === null
            ? "Connect a steward wallet to act; reading the record needs no wallet."
            : "The connected address is not a steward."}{" "}
          <Link href="/stewardship" className="underline">
            Open stewardship
          </Link>
        </p>
      )}

      <div className="mt-4">
        <WriteResultPanel
          pending={stewardship.isPending}
          report={stewardship.data ?? null}
          error={stewardship.error ?? null}
        />
      </div>
    </Panel>
  );
}

/** Cancellation. Proposer-only, and only while the proposal is still open. */
function CancelPanel({ proposal }: { readonly proposal: Proposal }) {
  const router = useRouter();
  const wallet = useWallet();
  const cancel = useCancelProposal();
  const [confirming, setConfirming] = useState(false);

  return (
    <Panel tone="sunken">
      <p className="text-sm font-medium text-ink">Withdraw this proposal</p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        You submitted this proposal, so you can cancel it while it is still open.
        The record and its constitutional review are preserved: cancellation is not
        deletion.
      </p>

      {confirming ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={cancel.isPending || wallet.writeBlockedReason !== null}
            onClick={() => {
              void cancel
                .mutateAsync({ proposalId: proposal.proposalId })
                .then(() => router.refresh())
                .catch(() => undefined);
            }}
            className="rounded-card border border-line-control px-5 py-2.5 text-sm text-ink hover:border-ink-muted"
          >
            {cancel.isPending ? "Waiting for the network…" : "Confirm cancellation"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={cancel.isPending}
            className="rounded-card border border-line-control px-5 py-2.5 text-sm text-ink hover:border-ink-muted"
          >
            Keep the proposal
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="underline"
          >
            Cancel this proposal
          </button>
        </p>
      )}

      <div className="mt-4">
        <WriteResultPanel
          pending={cancel.isPending}
          report={cancel.data ?? null}
          error={cancel.error ?? null}
        />
      </div>
    </Panel>
  );
}

