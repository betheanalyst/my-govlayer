import type { GovernanceConfig } from "./types";

/**
 * Proposal drafting and its client-side validation.
 *
 * These rules mirror the contract's own checks in `submit_proposal` exactly
 * (non-empty title and description, lengths, a non-zero voting duration inside
 * the configured bounds, and constitution text required for a constitution-type
 * proposal). They exist to catch mistakes before a wallet is asked to sign --
 * they are not the authority. The contract revalidates everything, and the
 * interface says so rather than implying a client-side check is a guarantee.
 */

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;

export type DraftProposalType = "standard" | "constitution";

export interface ProposalDraft {
  readonly title: string;
  readonly description: string;
  readonly proposalType: DraftProposalType;
  readonly proposedConstitution: string;
  /** Seconds, as the contract expects. */
  readonly votingDurationSeconds: string;
}

export interface DraftIssue {
  readonly field: keyof ProposalDraft;
  readonly message: string;
}

export function emptyDraft(): ProposalDraft {
  return {
    title: "",
    description: "",
    proposalType: "standard",
    proposedConstitution: "",
    votingDurationSeconds: "",
  };
}

export function validateProposalDraft(
  draft: ProposalDraft,
  config: GovernanceConfig,
): readonly DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (draft.title.trim() === "") {
    issues.push({ field: "title", message: "A proposal needs a title." });
  } else if (draft.title.length > TITLE_MAX_LENGTH) {
    issues.push({
      field: "title",
      message: `The title is longer than the contract accepts (maximum ${TITLE_MAX_LENGTH} characters).`,
    });
  }

  if (draft.description.trim() === "") {
    issues.push({
      field: "description",
      message:
        "A proposal needs a description: the constitutional review reads it as the substance of the proposal.",
    });
  } else if (draft.description.length > DESCRIPTION_MAX_LENGTH) {
    issues.push({
      field: "description",
      message: `The description is longer than the contract accepts (maximum ${DESCRIPTION_MAX_LENGTH} characters).`,
    });
  }

  if (draft.proposalType === "constitution" && draft.proposedConstitution.trim() === "") {
    issues.push({
      field: "proposedConstitution",
      message:
        "A constitution amendment must contain the text being proposed; the contract refuses an empty amendment.",
    });
  }

  const duration = parseVotingDuration(draft.votingDurationSeconds);
  if (duration === null) {
    issues.push({
      field: "votingDurationSeconds",
      message: "A voting length is required, expressed in whole seconds.",
    });
  } else if (duration <= 0n) {
    issues.push({
      field: "votingDurationSeconds",
      message: "The voting length cannot be zero.",
    });
  } else if (
    duration < BigInt(config.minVotingDuration) ||
    duration > BigInt(config.maxVotingDuration)
  ) {
    issues.push({
      field: "votingDurationSeconds",
      message: `This DAO accepts a voting length between ${config.minVotingDuration} and ${config.maxVotingDuration} seconds.`,
    });
  }

  return issues;
}

/** Whole seconds only; anything else is rejected rather than rounded. */
export function parseVotingDuration(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** Converts a validated draft into the adapter's input shape. */
export function toSubmitInput(draft: ProposalDraft) {
  const duration = parseVotingDuration(draft.votingDurationSeconds);
  if (duration === null) {
    throw new RangeError("voting duration is not a whole number of seconds");
  }

  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    votingDuration: duration,
    proposalType: draft.proposalType,
    ...(draft.proposalType === "constitution"
      ? { proposedConstitution: draft.proposedConstitution.trim() }
      : {}),
  } as const;
}

/** Human phrasing of a duration in seconds, used beside the bound inputs. */
export function describeSeconds(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds / 86400 === 1 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds / 3600 === 1 ? "" : "s"}`;
  return `${seconds} seconds`;
}
