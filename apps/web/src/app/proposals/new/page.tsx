"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { formatInteger } from "@/lib/format";
import { inspectRuntimeConfig } from "@/config/env";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  describeSeconds,
  emptyDraft,
  toSubmitInput,
  validateProposalDraft,
  type ProposalDraft,
} from "@/domain/proposalDraft";
import { constitutionVersionQuery, useGovernanceConfig } from "@/queries/coreQueries";
import { useAdminSnapshot } from "@/queries/adminQueries";
import { useEligibility } from "@/queries/eligibilityQueries";
import { useSubmitProposal } from "@/queries/writeHooks";
import { useWallet } from "@/wallet/WalletProvider";
import { WalletRequirementNotice } from "@/wallet/ConnectWallet";
import { PageHeader, Panel, Prose, SectionHeading } from "@/components/shared/Primitives";
import { WriteResultPanel } from "@/components/participation/WriteResultPanel";
import {
  ConfigurationIncompleteNotice,
  UnverifiedNotice,
} from "@/components/shared/Notices";

/**
 * Create Proposal (Experience Blueprint section 10.15).
 *
 * A staged workflow: Define -> Constitutional context -> Review -> Submit, with
 * the wallet transaction prominent only at the final step. Everything the
 * contract will check is stated before it is attempted, and anything this
 * interface cannot check is named as such rather than implied.
 */
export default function NewProposalPage() {
  const inspected = inspectRuntimeConfig();

  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Create" title="Submit a proposal" />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  return <NewProposalForm />;
}

function NewProposalForm() {
  const router = useRouter();
  const wallet = useWallet();
  const config = useGovernanceConfig();
  const snapshot = useAdminSnapshot();
  const eligibility = useEligibility("propose");
  const submit = useSubmitProposal();

  const [draft, setDraft] = useState<ProposalDraft>(emptyDraft);
  const constitution = useQuery({
    ...constitutionVersionQuery(config.data?.constitutionVersion ?? 1n),
    enabled: config.data !== undefined,
  });

  /**
   * The header, the stage list and the wallet requirement are stated before any
   * data is read, so a person always sees what this page is for and why they can
   * or cannot proceed — even while the contract reads are still in flight, and
   * even if they fail.
   */
  const shell = (
    <>
      <PageHeader
        eyebrow="Create"
        title="Submit a proposal"
        lede="A proposal is reviewed against the constitution before anyone votes on it. That review runs inside the submission transaction, so what gets recorded is the review's outcome, not an assumption."
      />

      <nav aria-label="Submission stages" className="mt-8">
        <ol className="flex flex-wrap gap-x-6 gap-y-2 text-xs uppercase tracking-[0.14em] text-ink-subtle">
          <li className="text-ink">1. Define</li>
          <li>2. Constitutional context</li>
          <li>3. Review</li>
          <li>4. Submit</li>
        </ol>
      </nav>

      {wallet.writeBlockedReason === null ? null : (
        <div className="mt-8">
          <WalletRequirementNotice action="submit a proposal" />
        </div>
      )}
    </>
  );

  if (config.isError) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        {shell}
        <div className="mt-8">
          <UnverifiedNotice subject="This DAO's configuration" error={config.error} />
        </div>
      </main>
    );
  }

  if (config.data === undefined) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        {shell}
        <p className="mt-8 text-sm text-ink-muted">
          Reading this DAO&rsquo;s proposal rules…
        </p>
      </main>
    );
  }

  const governance = config.data;
  const issues = validateProposalDraft(draft, governance);
  const issueFor = (field: keyof ProposalDraft) =>
    issues.find((issue) => issue.field === field)?.message;
  const paused = snapshot.data?.paused ?? null;

  async function onSubmit() {
    try {
      await submit.mutateAsync(toSubmitInput(draft));
      router.refresh();
    } catch {
      // Rendered from the mutation's error state below.
    }
  }

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      {shell}

      {paused === true ? (
        <Panel tone="sunken" className="mt-8">
          <p className="text-sm font-medium text-ink">New submissions are paused</p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            Protocol stewardship has paused new submissions. This is a containment
            measure: voting, disputing, finalizing, resubmitting, and cancelling
            all remain available. The contract reads the pause live, so this state
            is exact — and submissions resume when stewardship lifts it.
          </p>
        </Panel>
      ) : null}

      <div className="mt-10 space-y-14">
        <section aria-labelledby="define-heading" className="space-y-4">
          <SectionHeading
            id="define-heading"
            title="1. Define the proposal"
            description="The title and description are what constitutional review reads, so write the substance rather than a summary of an intention."
          />

          <Panel>
            <label htmlFor="title" className="text-sm font-medium text-ink">
              Title
            </label>
            <input
              id="title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              className="mt-2 w-full rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-ink-subtle">
              {draft.title.length} of {TITLE_MAX_LENGTH} characters the contract
              accepts.
              {issueFor("title") === undefined ? null : (
                <span className="block text-state-review-rejected">
                  {issueFor("title")}
                </span>
              )}
            </p>

            <label
              htmlFor="description"
              className="mt-6 block text-sm font-medium text-ink"
            >
              Description
            </label>
            <textarea
              id="description"
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              rows={8}
              className="mt-2 w-full rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-ink-subtle">
              {draft.description.length} of {DESCRIPTION_MAX_LENGTH} characters.
              {issueFor("description") === undefined ? null : (
                <span className="block text-state-review-rejected">
                  {issueFor("description")}
                </span>
              )}
            </p>

            <fieldset className="mt-6">
              <legend className="text-sm font-medium text-ink">
                What kind of proposal is this?
              </legend>
              <div className="mt-2 flex flex-wrap gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="proposalType"
                    checked={draft.proposalType === "standard"}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        proposalType: "standard",
                        proposedConstitution: "",
                      })
                    }
                  />
                  Standard proposal
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="proposalType"
                    checked={draft.proposalType === "constitution"}
                    onChange={() =>
                      setDraft({ ...draft, proposalType: "constitution" })
                    }
                  />
                  Constitution amendment
                </label>
              </div>
            </fieldset>

            {draft.proposalType === "constitution" ? (
              <div className="mt-6">
                <label
                  htmlFor="proposedConstitution"
                  className="text-sm font-medium text-ink"
                >
                  Proposed constitution text
                </label>
                <textarea
                  id="proposedConstitution"
                  value={draft.proposedConstitution}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      proposedConstitution: event.target.value,
                    })
                  }
                  rows={8}
                  className="mt-2 w-full rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink"
                />
                <p className="mt-1 text-xs text-ink-subtle">
                  A passed amendment still requires an authorized confirmation
                  before the constitution changes.
                  {issueFor("proposedConstitution") === undefined ? null : (
                    <span className="block text-state-review-rejected">
                      {issueFor("proposedConstitution")}
                    </span>
                  )}
                </p>
              </div>
            ) : null}

            <div className="mt-6">
              <label
                htmlFor="votingDurationSeconds"
                className="text-sm font-medium text-ink"
              >
                Voting length, in seconds
              </label>
              <input
                id="votingDurationSeconds"
                inputMode="numeric"
                value={draft.votingDurationSeconds}
                onChange={(event) =>
                  setDraft({ ...draft, votingDurationSeconds: event.target.value })
                }
                className="mt-2 w-48 rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink-subtle">
                This DAO accepts between{" "}
                {formatInteger(BigInt(governance.minVotingDuration))} and{" "}
                {formatInteger(BigInt(governance.maxVotingDuration))} seconds (
                {describeSeconds(governance.minVotingDuration)} to{" "}
                {describeSeconds(governance.maxVotingDuration)}).
                {issueFor("votingDurationSeconds") === undefined ? null : (
                  <span className="block text-state-review-rejected">
                    {issueFor("votingDurationSeconds")}
                  </span>
                )}
              </p>
            </div>
          </Panel>
        </section>

        <section aria-labelledby="context-heading" className="space-y-4">
          <SectionHeading
            id="context-heading"
            title="2. Constitutional context"
            description="This is the constitution your proposal will be measured against. The text is captured at submission and travels with the proposal, so later amendments never change how this proposal was judged."
          />

          <Panel tone="sunken">
            {constitution.data === undefined ? (
              <p className="text-sm text-ink-muted">
                Reading the constitution in force…
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-ink">
                  Version {formatInteger(constitution.data.version)} — in force
                </p>
                <div className="mt-3 max-h-80 overflow-y-auto">
                  <Prose>{constitution.data.text}</Prose>
                </div>
              </>
            )}
          </Panel>
        </section>

        <section aria-labelledby="review-heading" className="space-y-4">
          <SectionHeading
            id="review-heading"
            title="3. Review: what happens when you submit"
            description="Submission is not a vote. The contract runs a constitutional review inside the transaction and records one of three outcomes."
          />

          <Panel>
            <ul className="space-y-3 text-sm text-ink-muted">
              <li>
                <span className="text-ink">Accepted</span> — the proposal complies
                and a voting window opens immediately for the length you chose.
              </li>
              <li>
                <span className="text-ink">Needs revision</span> — the proposal is
                fundamentally sound but unclear. You can revise and resubmit it for
                a fresh review, up to{" "}
                {formatInteger(governance.maxResubmissions)} times.
              </li>
              <li>
                <span className="text-ink">Rejected</span> — it conflicts with the
                constitution or introduces risks. You may dispute that assessment
                up to {formatInteger(governance.maxDisputeStagesCount)}{" "}
                times.
              </li>
            </ul>

            <div className="mt-5 border-t border-line pt-5">
              <p className="text-sm font-medium text-ink">
                What this interface will check, and what it cannot
              </p>
              <p className="mt-2 max-w-prose text-sm text-ink-muted">
                {eligibility.result === null
                  ? wallet.address === null
                    ? "Eligibility is evaluated against a connected address, so connect a wallet to see what this DAO requires."
                    : "Reading this DAO's submission requirements…"
                  : eligibility.result.summary}
              </p>
              {eligibility.result === null ? null : (
                <ul className="mt-2 space-y-1 text-xs text-ink-subtle">
                  {eligibility.result.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                  {eligibility.result.unreadRequirements.map((requirement) => (
                    <li key={requirement}>Could not be read: {requirement}</li>
                  ))}
                </ul>
              )}
              <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                This DAO limits submissions to{" "}
                {formatInteger(governance.maxProposalsPerWindow)} per{" "}
                {describeSeconds(governance.proposalRateWindowSecs)} window. The
                contract holds that window per address, and it exposes no view of
                your own usage — so this interface cannot check it in advance. If
                the limit is reached, the contract refuses the submission and says
                when the next one is allowed.
              </p>
            </div>
          </Panel>
        </section>



        <section aria-labelledby="submit-heading" className="space-y-4">
          <SectionHeading
            id="submit-heading"
            title="4. Submit"
            description="This is the step that asks your wallet to sign. Nothing is sent until you confirm, and the network decides the outcome."
          />

          <Panel>
            {issues.length > 0 ? (
              <ul className="mb-4 space-y-1 text-sm text-state-review-rejected">
                {issues.map((issue) => (
                  <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 max-w-prose text-sm text-ink-muted">
                Everything this interface can check is satisfied. The contract
                revalidates it all, including checks this interface cannot make.
              </p>
            )}

            <button
              type="button"
              disabled={
                issues.length > 0 ||
                submit.isPending ||
                wallet.writeBlockedReason !== null ||
                paused === true
              }
              onClick={() => void onSubmit()}
              className="rounded-card bg-accent px-6 py-3 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submit.isPending
                ? "Waiting for the network…"
                : "Submit proposal"}
            </button>

            {submit.isPending ? (
              <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                The constitutional review runs inside this transaction, so it takes
                as long as the network takes. This screen will not claim an outcome
                before the network records one.
              </p>
            ) : null}

            {wallet.writeBlockedReason === null ? null : (
              <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                {wallet.writeBlockedReason}
              </p>
            )}

            <div className="mt-5">
              <WriteResultPanel
                pending={submit.isPending}
                report={submit.data ?? null}
                error={submit.error ?? null}
              />
            </div>

            {submit.data?.newProposalId === null ||
            submit.data?.newProposalId === undefined ? null : (
              <div className="mt-4 text-sm">
                <p className="font-medium text-ink">Submitted</p>
                <p className="mt-1 max-w-prose text-ink-muted">
                  Next: constitutional review. The review has already run as part of
                  this submission, so the outcome is recorded on the proposal.
                </p>
                <p className="mt-3">
                  <Link
                    href={`/proposals/${submit.data.newProposalId}`}
                    className="underline"
                  >
                    Open proposal #{submit.data.newProposalId}
                  </Link>
                </p>
              </div>
            )}
          </Panel>
        </section>
      </div>
    </main>
  );
}

