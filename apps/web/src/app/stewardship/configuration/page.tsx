"use client";

import Link from "next/link";
import { formatInteger } from "@/lib/format";
import { formatDuration } from "@/lib/time";
import { eligibilityModeLabel, votingWeightModeLabel } from "@/domain/labels";
import { isZeroAddress } from "@/domain/eligibility";
import { useGovernanceConfig } from "@/queries/coreQueries";
import {
  useAdminMembership,
  useAdminSnapshot,
  useDisputeSafetyParams,
  useRateLimitParams,
} from "@/queries/adminQueries";
import { useWallet } from "@/wallet/WalletProvider";
import { ProposeForm, parseIntegerField, parseTextField } from "@/components/stewardship/ProposeForm";
import { ConfigurationIncompleteNotice } from "@/components/shared/Notices";
import { inspectRuntimeConfig } from "@/config/env";
import {
  PageHeader,
  Panel,
  RecordList,
  RecordRow,
  SectionHeading,
} from "@/components/shared/Primitives";

/**
 * Governance configuration (Experience Blueprint section 10.18).
 *
 * Grouped as the Blueprint groups it. Every change here is a protected
 * stewardship action, so nothing on this page presents an edit as immediate.
 */
export default function StewardshipConfigurationPage() {
  const wallet = useWallet();
  const membership = useAdminMembership(wallet.address ?? undefined);
  const snapshot = useAdminSnapshot();
  const config = useGovernanceConfig();
  const rateLimit = useRateLimitParams();
  const disputeSafety = useDisputeSafetyParams();

  const canPropose = membership.data === true;
  const unavailableReason =
    wallet.address === null
      ? "Connect a steward wallet to propose a change. Reading this page needs no wallet."
      : membership.data === undefined
        ? "Checking whether the connected address is a steward…"
        : "Only a current steward can propose a configuration change.";

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Stewardship" title="Governance configuration" />
        <div className="mt-10">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Stewardship"
        title="Governance configuration"
        lede="What this DAO's rules currently are. Changing any of them is a protected stewardship action: approvals, then a timelock, then — for most values — GovLayerCore applying it."
      >
        <p className="text-sm">
          <Link href="/stewardship" className="underline">
            Back to stewardship
          </Link>
        </p>
      </PageHeader>

      {config.data === undefined ? (
        <p className="mt-10 text-sm text-ink-muted">
          Reading the governance configuration…
        </p>
      ) : (
        <div className="mt-10 space-y-12">
          <section aria-labelledby="voting-heading" className="space-y-4">
            <SectionHeading
              id="voting-heading"
              title="Voting"
              description="What a decision needs to pass, and how long voting may run for."
            />
            <Panel tone="sunken">
              <RecordList>
                <RecordRow
                  term="Minimum quorum"
                  value={`${formatInteger(config.data.minQuorum)} ${
                    config.data.votingWeightMode === "token_weighted"
                      ? "voting weight"
                      : "votes"
                  }`}
                />
                <RecordRow
                  term="Approval threshold"
                  value={`${formatInteger(config.data.approvalThresholdPercent)}%`}
                />
                <RecordRow
                  term="Voting duration bounds"
                  value={`${formatDuration(config.data.minVotingDuration)} to ${formatDuration(config.data.maxVotingDuration)}`}
                />
                <RecordRow
                  term="Resubmissions allowed"
                  value={formatInteger(config.data.maxResubmissions)}
                />
                <RecordRow
                  term="Dispute stages"
                  value={`${formatInteger(config.data.maxDisputeStagesCount)}${
                    disputeSafety.data === undefined
                      ? ""
                      : ` · ${formatDuration(disputeSafety.data.disputeCooldownSeconds)} cooldown`
                  }`}
                />
              </RecordList>
            </Panel>
          </section>

          <section aria-labelledby="eligibility-heading" className="space-y-4">
            <SectionHeading
              id="eligibility-heading"
              title="Eligibility"
              description="Who may take part, and what the contract checks before accepting a vote or a submission."
            />
            <Panel tone="sunken">
              <RecordList>
                <RecordRow
                  term="Participation mode"
                  value={eligibilityModeLabel(config.data.eligibilityMode)}
                />
                <RecordRow
                  term="Governance token"
                  value={
                    isZeroAddress(config.data.votingToken)
                      ? "None configured — read as a zero balance"
                      : config.data.votingToken
                  }
                  code={!isZeroAddress(config.data.votingToken)}
                />
                <RecordRow
                  term="Token interface kind"
                  value={
                    config.data.customTokenInterfaceKind === ""
                      ? "Not set"
                      : config.data.customTokenInterfaceKind
                  }
                />
                <RecordRow
                  term="Minimum to vote"
                  value={formatInteger(config.data.minTokensToVote)}
                />
                <RecordRow
                  term="Minimum to propose"
                  value={formatInteger(config.data.minTokensToPropose)}
                />
                <RecordRow
                  term="Voter whitelist"
                  value={config.data.useWhitelistForVoting ? "Required" : "Off"}
                />
                <RecordRow
                  term="Proposer whitelist"
                  value={config.data.useWhitelistForProposing ? "Required" : "Off"}
                />
              </RecordList>
            </Panel>
          </section>

          <section aria-labelledby="weight-heading" className="space-y-4">
            <SectionHeading
              id="weight-heading"
              title="Voting weight"
              description="Whether each participating address counts equally, or by token balance."
            />
            <Panel tone="sunken">
              <RecordList>
                <RecordRow
                  term="Weight mode"
                  value={votingWeightModeLabel(config.data.votingWeightMode)}
                />
                <RecordRow
                  term="Pause state"
                  value={
                    snapshot.data === undefined
                      ? "Reading…"
                      : snapshot.data.paused
                        ? "Submissions paused"
                        : "Submissions open"
                  }
                />
                <RecordRow
                  term="Approvals required"
                  value={
                    snapshot.data === undefined
                      ? "Reading…"
                      : `${snapshot.data.currentThreshold} of ${snapshot.data.activeAdminCount} stewards`
                  }
                />
              </RecordList>
            </Panel>
          </section>

          <section aria-labelledby="controls-heading" className="space-y-4">
            <SectionHeading
              id="controls-heading"
              title="Proposal controls"
              description="How often an address may submit, and the submission pause."
            />
            <Panel tone="sunken">
              <RecordList>
                <RecordRow
                  term="Proposals per window"
                  value={
                    rateLimit.data === undefined
                      ? `${formatInteger(config.data.maxProposalsPerWindow)} (from the governance contract)`
                      : formatInteger(rateLimit.data.maxProposalsPerWindow)
                  }
                />
                <RecordRow
                  term="Window length"
                  value={formatDuration(
                    rateLimit.data?.proposalRateWindowSecs ??
                      config.data.proposalRateWindowSecs,
                  )}
                />
              </RecordList>
              <p className="mt-4 max-w-prose text-xs text-ink-subtle">
                The window is held per address by the governance contract, which
                exposes no view of an address&rsquo;s own usage, so nothing here can
                show how much of a window remains.
              </p>
            </Panel>
          </section>

          <section aria-labelledby="propose-heading" className="space-y-6">
            <SectionHeading
              id="propose-heading"
              title="Propose a change"
              description="Each of these becomes an authorized action: approvals first, then a timelock, then application."
            />

            <ProposeForm
              title="Change voting parameters"
              description="Quorum, the approval threshold, and the voting-duration bounds new proposals must fall inside — core vote-counting parameters, changed together."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[
                { name: "minQuorum", label: "Minimum quorum", kind: "integer", placeholder: "3" },
                { name: "threshold", label: "Approval threshold (%)", kind: "integer", placeholder: "60" },
                { name: "minDuration", label: "Minimum voting duration (seconds)", kind: "integer", placeholder: "3600" },
                { name: "maxDuration", label: "Maximum voting duration (seconds)", kind: "integer", placeholder: "2592000" },
              ]}
              build={(values) => {
                const quorum = parseIntegerField(values, "minQuorum", "Minimum quorum");
                if ("error" in quorum) return { error: quorum.error };
                const threshold = parseIntegerField(values, "threshold", "Approval threshold");
                if ("error" in threshold) return { error: threshold.error };
                const min = parseIntegerField(values, "minDuration", "Minimum duration");
                if ("error" in min) return { error: min.error };
                const max = parseIntegerField(values, "maxDuration", "Maximum duration");
                if ("error" in max) return { error: max.error };

                return {
                  request: {
                    kind: "propose_set_voting_parameters",
                    parameters: {
                      minQuorum: quorum.value,
                      approvalThresholdPercent: threshold.value,
                      minVotingDuration: min.value,
                      maxVotingDuration: max.value,
                    },
                  },
                };
              }}
            />

            <ProposeForm
              title="Change participation mode"
              description="Governs what the contract checks before accepting a vote or a submission."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[
                { name: "mode", label: "Participation mode", kind: "select", options: ["open", "erc20", "nft", "custom"] },
              ]}
              build={(values) => {
                const mode = parseTextField(values, "mode", "Participation mode");
                if ("error" in mode) return { error: mode.error };
                return { request: { kind: "propose_set_eligibility_mode", mode: mode.value } };
              }}
            />

            <ProposeForm
              title="Change voting weight"
              description="Whether every participating address counts once, or in proportion to its token balance."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[
                { name: "mode", label: "Voting weight mode", kind: "select", options: ["equal", "token_weighted"] },
              ]}
              build={(values) => {
                const mode = parseTextField(values, "mode", "Voting weight mode");
                if ("error" in mode) return { error: mode.error };
                return { request: { kind: "propose_set_voting_weight_mode", mode: mode.value } };
              }}
            />

            <ProposeForm
              title="Turn a whitelist on or off"
              description="Whitelist gating is independent of the participation mode: a DAO may combine both."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[
                { name: "target", label: "Whitelist", kind: "select", options: ["voter", "proposer"] },
                { name: "enabled", label: "Required", kind: "checkbox", hint: "Leave unchecked to turn the requirement off." },
              ]}
              build={(values) => {
                const target = parseTextField(values, "target", "Whitelist");
                if ("error" in target) return { error: target.error };
                return {
                  request: {
                    kind: "propose_set_whitelist_enabled",
                    target: target.value,
                    enabled: values.enabled === "true",
                  },
                };
              }}
            />
            <ProposeForm
              title="Change token rules"
              description="The token used for eligibility and voting weight, the minimum holdings required, and the interface kind used to read it."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[
                { name: "token", label: "Governance token address", kind: "text", placeholder: "0x…" },
                { name: "minVote", label: "Minimum to vote", kind: "integer", placeholder: "0" },
                { name: "minPropose", label: "Minimum to propose", kind: "integer", placeholder: "0" },
                { name: "kind", label: "Custom interface kind", kind: "select", options: ["erc20"], hint: "The contract implements exactly one custom kind today." },
              ]}
              build={(values) => {
                const token = parseTextField(values, "token", "Token address");
                if ("error" in token) return { error: token.error };
                const minVote = parseIntegerField(values, "minVote", "Minimum to vote");
                if ("error" in minVote) return { error: minVote.error };
                const minPropose = parseIntegerField(values, "minPropose", "Minimum to propose");
                if ("error" in minPropose) return { error: minPropose.error };

                return {
                  request: {
                    kind: "propose_set_token_rules",
                    rules: {
                      votingToken: token.value,
                      minTokensToVote: minVote.value,
                      minTokensToPropose: minPropose.value,
                      customTokenInterfaceKind: (values.kind ?? "").trim(),
                    },
                  },
                };
              }}
            />

            <ProposeForm
              title="Change proposal rate limits"
              description="How many proposals one address may submit, and over what window."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[
                { name: "max", label: "Proposals per window", kind: "integer", placeholder: "7" },
                { name: "window", label: "Window length (seconds)", kind: "integer", placeholder: "604800" },
              ]}
              build={(values) => {
                const max = parseIntegerField(values, "max", "Proposals per window");
                if ("error" in max) return { error: max.error };
                const window = parseIntegerField(values, "window", "Window length");
                if ("error" in window) return { error: window.error };
                return {
                  request: {
                    kind: "propose_set_rate_limit_params",
                    maxProposalsPerWindow: max.value,
                    proposalRateWindowSecs: window.value,
                  },
                };
              }}
            />

            <ProposeForm
              title={snapshot.data?.paused === true ? "Propose lifting the pause" : "Propose pausing submissions"}
              description="The pause blocks new proposal submissions only. Voting, disputing, finalizing, resubmitting and cancelling all continue, and the governance contract reads the flag live."
              canPropose={canPropose}
              unavailableReason={unavailableReason}
              fields={[]}
              build={() => ({
                request:
                  snapshot.data?.paused === true
                    ? { kind: "propose_unpause" }
                    : { kind: "propose_pause" },
              })}
            />
          </section>
        </div>
      )}
    </main>
  );
}
