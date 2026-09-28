/**
 * Typed application errors and the contract-error registry.
 *
 * Experience Blueprint section 12 requires distinct handling for:
 *   - user/action restriction      ("You are not eligible to vote on this proposal.")
 *   - protocol state restriction   ("Voting has already closed.")
 *   - verification uncertainty     ("Eligibility could not be verified right now.")
 *   - transaction failure          (action attempted / wallet result / did state change)
 *   - cross-contract failure       (Admin/Core trust boundary)
 *
 * Raw revert strings must never be the primary user experience, but they are
 * preserved on every error so the technical layer can show the recorded truth.
 * A verification failure is never reported as "ineligible".
 */

export type AppErrorKind =
  | "configuration"
  | "validation"
  | "not_found"
  | "user_restriction"
  | "protocol_state"
  | "verification_uncertainty"
  | "transaction_failure"
  | "cross_contract"
  | "wallet"
  | "unknown";

export interface AppErrorInit {
  kind: AppErrorKind;
  /** Human-readable, non-technical explanation. */
  message: string;
  /** What the user can do next, when there is something they can do. */
  nextStep?: string;
  /** Whether retrying the same action could plausibly succeed later. */
  recoverable?: boolean;
  /** The raw recorded message (contract revert text, RPC/SDK error, etc). */
  raw?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly nextStep: string | undefined;
  readonly recoverable: boolean;
  readonly raw: string | undefined;

  constructor(init: AppErrorInit) {
    super(
      init.message,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = "AppError";
    this.kind = init.kind;
    this.nextStep = init.nextStep;
    this.recoverable = init.recoverable ?? false;
    this.raw = init.raw;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function extractMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value !== null && typeof value === "object") {
    const candidate = value as { message?: unknown; shortMessage?: unknown };
    if (typeof candidate.shortMessage === "string") return candidate.shortMessage;
    if (typeof candidate.message === "string") return candidate.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Converts any thrown value into an AppError, preserving the recorded message. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;

  return new AppError({
    kind: "unknown",
    message: "Something went wrong while talking to the protocol.",
    nextStep:
      "Retry the action. If it keeps failing, inspect the technical details below.",
    recoverable: true,
    raw: extractMessage(value),
    cause: value,
  });
}
interface RegistryRule {
  readonly pattern: RegExp;
  readonly kind: AppErrorKind;
  readonly message: string;
  readonly nextStep?: string;
  readonly recoverable?: boolean;
}

/**
 * Ordered registry of GovLayerCore / GovLayerAdmin revert messages.
 *
 * Messages are matched by pattern because several of them embed values
 * (required token amounts, Unix timestamps, statuses, limits). The first
 * matching rule wins. Anything unmatched keeps its raw message and is surfaced
 * as a generic, honest failure -- never as a fabricated success or a
 * misleading classification.
 */
const REGISTRY: readonly RegistryRule[] = [
  // -- Infrastructure: never a protocol answer -------------------------------
  {
    /**
     * The GenLayer RPC endpoint rate-limits this deployment (the public Studio
     * endpoint allows 30 requests per minute). That is an infrastructure
     * condition, so it must never be classified as a protocol-state rejection:
     * doing so would present a failed read as a governance answer.
     *
     * GovLayerCore's own rate limit reads differently -- "Rate limit exceeded:
     * at most N proposals ..." -- so the two rules are deliberately distinct,
     * and this one is evaluated first.
     */
    pattern: /\brequests per minute\b/i,
    kind: "verification_uncertainty",
    message:
      "The GenLayer RPC endpoint is limiting how many requests this deployment can make, so this could not be read.",
    nextStep: "This is a request limit, not a protocol answer. Retry in a moment.",
    recoverable: true,
  },

  // -- GovLayerCore: eligibility (user/action restriction) ------------------
  {
    pattern: /not on the voter whitelist/i,
    kind: "user_restriction",
    message: "This address is not on the voter whitelist for this DAO.",
    nextStep: "Participation requires whitelist approval from protocol stewardship.",
  },
  {
    pattern: /not on the proposer whitelist/i,
    kind: "user_restriction",
    message: "This address is not on the proposer whitelist for this DAO.",
    nextStep: "Participation requires whitelist approval from protocol stewardship.",
  },
  {
    pattern: /must hold the governance nft to vote/i,
    kind: "user_restriction",
    message: "Voting requires holding the governance NFT.",
  },
  {
    pattern: /must hold the governance nft to propose/i,
    kind: "user_restriction",
    message: "Proposing requires holding the governance NFT.",
  },
  {
    pattern: /insufficient tokens to vote\. required:\s*\d+/i,
    kind: "user_restriction",
    message: "This address does not hold enough tokens to vote on this DAO.",
  },
  {
    pattern: /insufficient tokens to propose\. required:\s*\d+/i,
    kind: "user_restriction",
    message: "This address does not hold enough tokens to propose on this DAO.",
  },
  // -- GovLayerCore: voting (protocol state) --------------------------------
  {
    pattern: /already voted on this proposal/i,
    kind: "protocol_state",
    message:
      "A vote from this address is already recorded on this proposal. Votes are immutable and cannot be changed, withdrawn, or recast.",
    nextStep: "No further action is available on this proposal.",
  },
  {
    pattern: /voting period has closed/i,
    kind: "protocol_state",
    message: "The voting period for this proposal has closed.",
    nextStep: "The proposal can now be finalized if it has not been already.",
  },
  {
    pattern: /voting period has not yet closed/i,
    kind: "protocol_state",
    message: "The voting period for this proposal has not closed yet.",
    nextStep: "Finalization becomes available once the voting deadline passes.",
  },
  {
    pattern: /voting is not open for proposals with status/i,
    kind: "protocol_state",
    message: "Voting is not open for this proposal in its current state.",
  },
  {
    pattern: /proposal is not in a finalizable state/i,
    kind: "protocol_state",
    message: "This proposal is not in a state that can be finalized.",
  },
  {
    pattern: /disputes can only be raised on ai-rejected proposals/i,
    kind: "protocol_state",
    message:
      "Only proposals rejected by constitutional review can be disputed. A post-vote failure is a governance outcome, not an AI judgment.",
  },
  {
    pattern: /maximum dispute stages/i,
    kind: "protocol_state",
    message: "The maximum number of dispute stages has already been reached.",
  },
  {
    pattern: /dispute cooldown active/i,
    kind: "protocol_state",
    message: "A dispute cooldown is active for this proposal.",
    recoverable: true,
  },
  {
    // GovLayerCore's submit-time rate limit, worded as
    // "Rate limit exceeded: at most N proposals per window" (see
    // submit_proposal). Matched on the contract's own phrasing so the
    // RPC-level limit above is never mistaken for it.
    pattern: /rate limit exceeded: at most/i,
    kind: "protocol_state",
    message: "The proposal rate limit for this address has been reached.",
    recoverable: true,
  },
  {
    pattern: /submission is currently paused/i,
    kind: "protocol_state",
    message:
      "New proposal submission is currently paused. Voting, disputing, finalizing, resubmitting, and cancelling are unaffected.",
    nextStep: "Proposal submission resumes once stewardship lifts the pause.",
    recoverable: true,
  },
  {
    pattern: /maximum resubmissions/i,
    kind: "protocol_state",
    message:
      "The maximum number of resubmissions has been reached for this proposal.",
  },
  {
    pattern: /only 'needs_revision' proposals can be resubmitted/i,
    kind: "protocol_state",
    message: "Only a proposal that needs revision can be resubmitted.",
  },
  {
    pattern: /only 'pending' or 'needs_revision' proposals can be cancelled/i,
    kind: "protocol_state",
    message: "This proposal can no longer be cancelled in its current state.",
  },
  // -- GovLayerCore: ownership -----------------------------------------------
  {
    pattern: /only the original proposer can (cancel|resubmit)/i,
    kind: "user_restriction",
    message:
      "Only the address that submitted this proposal can perform that action.",
  },
  {
    pattern: /only the proposer or a voter on this proposal can raise a dispute/i,
    kind: "user_restriction",
    message:
      "A dispute can be raised only by the proposer or by an address that recorded a vote on this proposal.",
  },
  // -- GovLayerCore: stewardship pull (cross-contract / state) ---------------
  {
    pattern: /unable to reach govlayeradmin/i,
    kind: "cross_contract",
    message:
      "GovLayerCore could not reach GovLayerAdmin to pull this authorized action.",
    nextStep: "Retry once the Admin contract is reachable.",
    recoverable: true,
  },
  {
    pattern: /admin contract not configured/i,
    kind: "configuration",
    message:
      "GovLayerCore has no GovLayerAdmin address configured, so authorized actions cannot be applied.",
    nextStep:
      "While Admin is unconfigured, new proposal submission is also refused.",
  },
  {
    pattern: /does not exist on govlayeradmin/i,
    kind: "not_found",
    message: "No such authorized action exists on GovLayerAdmin.",
  },
  {
    pattern: /action is not yet executed on govlayeradmin/i,
    kind: "protocol_state",
    message:
      "This action has not finished its approval and timelock stages, so there is nothing for GovLayerCore to pull yet.",
    recoverable: true,
  },
  {
    pattern: /action already applied/i,
    kind: "protocol_state",
    message: "This authorized action has already been applied to GovLayerCore.",
  },
  {
    pattern: /pull was already rejected/i,
    kind: "protocol_state",
    message:
      "GovLayerCore already rejected this authorization, because its own state changed after authorization. That outcome is permanent for this action.",
    nextStep:
      "A fresh stewardship authorization would be required if the change is still wanted.",
  },
  // -- GovLayerAdmin: authorization ------------------------------------------
  {
    pattern: /not admin: only a current admin/i,
    kind: "user_restriction",
    message: "Only a current steward (admin) can perform that action.",
  },
  {
    pattern: /proposer cannot approve own action/i,
    kind: "user_restriction",
    message:
      "The steward who proposed this action already counts as its first approval, and cannot approve it again.",
  },
  {
    pattern: /already approved: this admin has already approved/i,
    kind: "protocol_state",
    message:
      "This steward has already approved this action during their current tenure.",
  },
  // -- GovLayerAdmin: lifecycle ----------------------------------------------
  {
    pattern: /threshold not reached/i,
    kind: "protocol_state",
    message:
      "This action has not gathered enough approvals to enter its timelock.",
    recoverable: true,
  },
  {
    pattern: /timelock active: not executable until/i,
    kind: "protocol_state",
    message: "This action is timelocked and cannot be executed yet.",
    recoverable: true,
  },
  {
    pattern: /action already finalized/i,
    kind: "protocol_state",
    message: "This action has already reached a terminal state.",
  },
  {
    pattern: /approvals closed/i,
    kind: "protocol_state",
    message: "The approval window for this action has closed.",
  },
  {
    pattern: /bootstrap (already complete|not complete)/i,
    kind: "protocol_state",
    message: "This action is not available in the current bootstrap stage.",
  },
  // -- Shared input validation -----------------------------------------------
  {
    pattern: /title cannot be empty|description cannot be empty/i,
    kind: "validation",
    message: "A required field was left empty.",
  },
  {
    pattern: /reason cannot be empty/i,
    kind: "validation",
    message: "A required field was left empty.",
  },
  {
    pattern: /too long \(max:/i,
    kind: "validation",
    message: "A submitted field exceeds its maximum length.",
  },
  {
    pattern: /cannot be empty for constitution-type proposals/i,
    kind: "validation",
    message:
      "A constitution-type proposal requires the proposed constitution text.",
  },
  {
    pattern: /voting_duration must be between/i,
    kind: "validation",
    message: "The requested voting duration is outside the configured bounds.",
  },
  {
    pattern: /invalid proposal_type/i,
    kind: "validation",
    message: "Unsupported proposal type.",
  },
  {
    pattern: /not a valid address|cannot be the zero address/i,
    kind: "validation",
    message: "An address supplied to the contract was not valid.",
  },
  {
    pattern: /whitelist batch/i,
    kind: "validation",
    message: "The whitelist change exceeded the maximum batch size.",
  },
  // -- Lookups (must stay last: these are the most generic patterns) ---------
  {
    pattern: /proposal does not exist|action not found/i,
    kind: "not_found",
    message: "The requested record does not exist on chain.",
  },
];

/**
 * Classifies a raw error/revert message into a typed AppError.
 * The recorded raw message is always preserved on the result.
 */
export function classifyContractMessage(raw: string): AppError {
  for (const rule of REGISTRY) {
    if (rule.pattern.test(raw)) {
      return new AppError({
        kind: rule.kind,
        message: rule.message,
        nextStep: rule.nextStep,
        recoverable: rule.recoverable ?? false,
        raw,
      });
    }
  }

  return new AppError({
    kind: "unknown",
    message: "The protocol rejected this action.",
    nextStep: "Review the technical details below before retrying.",
    raw,
  });
}

/** Classifies a thrown value, falling back to the registry on its message. */
export function classifyError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return classifyContractMessage(extractMessage(value));
}

/**
 * Verification uncertainty: a read that could not be completed.
 * Deliberately distinct from a negative answer (Blueprint section 12).
 */
export function verificationUncertainty(
  subject: string,
  cause?: unknown,
): AppError {
  return new AppError({
    kind: "verification_uncertainty",
    message: `${subject} could not be verified right now.`,
    nextStep: "This is not a negative result. Retry in a moment.",
    recoverable: true,
    raw: cause === undefined ? undefined : extractMessage(cause),
    cause,
  });
}

// __NEXT_PART__

