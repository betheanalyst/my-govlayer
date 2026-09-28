# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import typing
from dataclasses import dataclass
from datetime import datetime, timezone
from genlayer import *


# -----------------------------------------------------------------------------
# GovLayerCore -- GovLayer V2
# -----------------------------------------------------------------------------
#
# Owns proposals, voting, disputes, the constitution and its version
# history, proposal revision history, governance history, rate limiting,
# and eligibility/whitelist configuration -- plus the Core-side half of the
# Admin-authorizes/Core-pulls-and-validates mechanism (apply_admin_action)
# that mutates all of the above post-genesis.
#
# This file makes exactly two cross-contract reads into GovLayerAdmin, both
# fail-closed by design, each in its own appropriate direction:
#   1. The pause check inside submit_proposal, via _is_admin_contract_paused
#      -- a live read on every proposal submission. An unreachable or
#      erroring Admin is treated as paused (refuse new submissions).
#   2. apply_admin_action's own pull read (admin.view().get_action(action_id))
#      -- made only when a caller explicitly invokes apply_admin_action.
#      An unreachable or erroring Admin here raises instead: silently
#      treating an unreachable Admin as "nothing to apply yet" would be
#      indistinguishable from a legitimate not-yet-executed action, whereas
#      raising tells the caller the pull itself could not be attempted.
# Rate-limit parameters are deliberately NOT a third cross-contract read:
# Core holds its own locally-synced copy (seeded at genesis, kept in sync
# thereafter only via apply_admin_action's set_rate_limit_params branch),
# never read live from Admin -- see __init__ and the class docstring.
#
# All configuration values below (eligibility_mode, voting_token,
# min_tokens_to_vote, min_tokens_to_propose, custom_token_interface_kind,
# voting_weight_mode, both whitelist toggles, both whitelist memberships)
# are mutable post-genesis exclusively via apply_admin_action's per-action-
# type branches, each pulled from an Admin-authorized, executed AdminAction
# and independently re-validated against current Core state before being
# applied -- see apply_admin_action's own docstring for the full sequence.
# No direct setter and no other authorization check for any of these fields
# exists anywhere else in this file. custom_token_interface_kind carries one
# additional, permanent restriction beyond ordinary governance mutability:
# the value set via set_token_rules must always belong to the closed,
# code-defined set VALID_CUSTOM_TOKEN_INTERFACE_KINDS -- governance selects
# among supported interface kinds, it cannot invent one at runtime. Adding a
# new kind requires a code change (a new @gl.evm.contract_interface
# declaration and matching dispatch branch), never a governance action.


# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

MIN_VALID_TIMESTAMP: int = 1700000000

ZERO_ADDRESS_HEX: str = "0x0000000000000000000000000000000000000000"

# Genesis defaults for governance parameters.
DEFAULT_MIN_QUORUM: int = 3
DEFAULT_APPROVAL_THRESHOLD_PERCENT: int = 60
DEFAULT_MIN_VOTING_DURATION: int = 3600      # 1 hour
DEFAULT_MAX_VOTING_DURATION: int = 2592000   # 30 days

# Hardcoded, never governance-adjustable. Applied at the point AI output is
# first written to storage (submit_proposal / resubmit_proposal), before any
# snapshot into revision history.
MAX_CONFLICTS_PER_AUDIT: int = 10

TITLE_MAX_LENGTH: int = 200
DESCRIPTION_MAX_LENGTH: int = 5000

PROPOSAL_TYPE_STANDARD:     str = "standard"
PROPOSAL_TYPE_CONSTITUTION: str = "constitution"

# Proposal status vocabulary. "rejected" is exclusively an AI-audit-stage
# value; "failed" is exclusively a post-vote value -- the two are never
# used interchangeably anywhere in this file.
STATUS_PENDING:                     str = "pending"
STATUS_REJECTED:                    str = "rejected"
STATUS_NEEDS_REVISION:              str = "needs_revision"
STATUS_UNDER_REVIEW:                str = "under_review"
STATUS_PASSED:                      str = "passed"
STATUS_FAILED:                      str = "failed"
STATUS_PENDING_CONSTITUTION_CONFIRM: str = "pending_constitution_confirm"
STATUS_CANCELLED:                   str = "cancelled"

# Diagnostic-only: failure_reason never gates appeal eligibility. There is
# no "audit_mismatch" value -- see finalize_decision's own docstring for why
# that outcome is structurally unreachable rather than a third status here.
FAILURE_REASON_NONE:            str = ""
FAILURE_REASON_QUORUM_NOT_MET:  str = "quorum_not_met"
FAILURE_REASON_THRESHOLD_NOT_MET: str = "threshold_not_met"

ELIGIBILITY_MODE_OPEN:   str = "open"
ELIGIBILITY_MODE_ERC20:  str = "erc20"
ELIGIBILITY_MODE_NFT:    str = "nft"
ELIGIBILITY_MODE_CUSTOM: str = "custom"
VALID_ELIGIBILITY_MODES = (
    ELIGIBILITY_MODE_OPEN, ELIGIBILITY_MODE_ERC20,
    ELIGIBILITY_MODE_NFT, ELIGIBILITY_MODE_CUSTOM,
)

VOTING_WEIGHT_MODE_EQUAL:          str = "equal"
VOTING_WEIGHT_MODE_TOKEN_WEIGHTED: str = "token_weighted"
VALID_VOTING_WEIGHT_MODES = (VOTING_WEIGHT_MODE_EQUAL, VOTING_WEIGHT_MODE_TOKEN_WEIGHTED)

# Closed enum for "custom" eligibility mode's balance interface (used via
# @gl.evm.contract_interface, never a free-text method name). Only "erc20"
# is implemented: it reuses ERC20BalanceInterface's standard
# balance_of(owner) call, giving a DAO a way to mark a token as "custom"
# (e.g. for semantic/operational reasons) while still resolving its
# balance through the one interface shape actually implemented.
#
# ERC1155 is deliberately NOT implemented: its balance-query semantics are
# fundamentally different (per-token-ID balanceOf(owner, id), or a batch
# variant), and it would need additional configuration this enum has no
# schema for (which token ID(s) confer eligibility, and under what rule --
# own >=1 of a specific ID? any ID from a set?). Implementing a guess at
# this now would be a half-specified feature. An unrecognized/unset
# interface kind (including any future "erc1155_*" value set before real
# support exists) fails closed to zero balance (_get_token_balance), never
# silently open.
#
# Extending this enum with a real second kind requires adding a new
# @gl.evm.contract_interface declaration and a matching branch in
# _get_token_balance -- a deliberate, reviewable code change, not a
# silently growing free-text field.
CUSTOM_TOKEN_INTERFACE_KIND_ERC20: str = "erc20"
VALID_CUSTOM_TOKEN_INTERFACE_KINDS = (CUSTOM_TOKEN_INTERFACE_KIND_ERC20,)


# Genesis-only sentinel for ConstitutionVersion.adopted_by. Used exactly
# once, for constitution_history[1] at deployment. Every other entry is an
# admin's lowercased hex address.
CONSTITUTION_ADOPTED_BY_GENESIS: str = "genesis"

# Event-type string constants for GovernanceChange.event_type, used
# consistently instead of ad hoc inline literals so "rejected" vs "failed"
# terminology can never drift between an event's status field and its
# event_type/details string.
EVENT_CONTRACT_INITIALIZED:               str = "contract_initialized"
EVENT_PROPOSAL_CREATED:                   str = "proposal_created"
EVENT_PROPOSAL_CANCELLED:                 str = "proposal_cancelled"
EVENT_PROPOSAL_RESUBMITTED:               str = "proposal_resubmitted"
EVENT_PROPOSAL_PASSED:                    str = "proposal_passed"
EVENT_PROPOSAL_FAILED:                    str = "proposal_failed"
EVENT_CONSTITUTION_UPDATE_PENDING_CONFIRM: str = "constitution_update_pending_confirm"
EVENT_DISPUTE_RESOLVED_REOPENED:          str = "dispute_resolved_reopened"
EVENT_DISPUTE_RESOLVED_FAILED:            str = "dispute_resolved_failed"
# EVENT_CONSTITUTION_UPDATE_APPLIED is a dedicated event constant used only
# by the constitution_update_propose branch of apply_admin_action; every
# other action type shares the one generic EVENT_ADMIN_ACTION_APPLIED
# below, distinguished only by an embedded "type:<action_type>" field in
# the logged details string. This is intentional, not an oversight: a
# constitution update is Core's highest-consequence, hardest-to-recover
# mutation, which is why it alone gets a named event distinct from the
# generic bucket. No information is lost for the other action types (the
# action_type is always present in the logged details), so no per-type
# event constants are introduced solely for naming symmetry.
EVENT_CONSTITUTION_UPDATE_APPLIED:        str = "constitution_update_applied"
EVENT_ADMIN_ACTION_APPLIED:               str = "admin_action_applied"
EVENT_ADMIN_ACTION_PULL_REJECTED:         str = "admin_action_pull_rejected"

# -----------------------------------------------------------------------------
# Admin-authorized action types
# -----------------------------------------------------------------------------
#
# These string values MUST match GovLayerAdmin.py's own action_type
# constants exactly -- Core reads action.action_type as a plain string from
# Admin's get_action() view() call. This is a cross-contract boundary, so
# there is no shared Python constant to import; the two files' constants
# are independently declared and must be kept in lockstep by convention,
# the same as every other cross-contract string convention in this project
# (e.g. the status vocabulary).
ACTION_CONSTITUTION_UPDATE_PROPOSE: str = "constitution_update_propose"
ACTION_SET_RATE_LIMIT_PARAMS:       str = "set_rate_limit_params"
ACTION_SET_ELIGIBILITY_MODE:        str = "set_eligibility_mode"
ACTION_SET_TOKEN_RULES:             str = "set_token_rules"
ACTION_SET_VOTING_WEIGHT_MODE:      str = "set_voting_weight_mode"
ACTION_SET_WHITELIST_ENABLED:       str = "set_whitelist_enabled"
ACTION_UPDATE_WHITELIST:            str = "update_whitelist"
ACTION_SET_VOTING_PARAMETERS:       str = "set_voting_parameters"

ADMIN_ACTION_STATUS_EXECUTED: str = "executed"

# Core's own independent copy of the rate-limit structural bounds, matching
# GovLayerAdmin.py's MIN/MAX_PROPOSALS_PER_WINDOW / MIN/MAX_RATE_WINDOW_SECS
# exactly. Duplicated deliberately, not imported (no cross-contract import
# mechanism exists on this platform) -- Core never trusts Admin's
# structural check alone and re-validates independently at pull time,
# matching every other action type's discipline.
MIN_PROPOSALS_PER_WINDOW: int = 1
MAX_PROPOSALS_PER_WINDOW: int = 1000
MIN_RATE_WINDOW_SECS:     int = 3600      # 1 hour
MAX_RATE_WINDOW_SECS:     int = 2592000   # 30 days

# Core's own independent copy of the set_voting_parameters structural
# bounds, matching GovLayerAdmin.py's MIN_QUORUM_FLOOR /
# MIN_APPROVAL_THRESHOLD_PERCENT / MAX_APPROVAL_THRESHOLD_PERCENT /
# MIN_VOTING_DURATION_FLOOR / MAX_VOTING_DURATION_CEILING exactly, for the
# same reason as above. MIN_QUORUM_FLOOR and the voting-duration bounds
# mirror this file's own present defaults (DEFAULT_MIN_QUORUM,
# DEFAULT_MIN/MAX_VOTING_DURATION) -- used here as hard bounds, not just
# defaults; governance may move within this window, never outside it.
MIN_QUORUM_FLOOR:               int = 3
MIN_APPROVAL_THRESHOLD_PERCENT: int = 50
MAX_APPROVAL_THRESHOLD_PERCENT: int = 100
MIN_VOTING_DURATION_FLOOR:      int = 3600      # 1 hour
MAX_VOTING_DURATION_CEILING:    int = 2592000   # 30 days

WHITELIST_TARGET_VOTER:    str = "voter"
WHITELIST_TARGET_PROPOSER: str = "proposer"
WHITELIST_TOGGLE_TARGET_VOTING:    str = "voting"
WHITELIST_TOGGLE_TARGET_PROPOSING: str = "proposing"

# Defensive bound on update_whitelist's combined add+remove batch size per
# action, matching GovLayerAdmin.py's own MAX_WHITELIST_BATCH_SIZE exactly
# (duplicated for the same independent-re-validation reason as the
# rate-limit bounds above): an unbounded batch would let a single
# AdminAction carry an arbitrarily large payload, and Core independently
# enforces the same limit Admin already enforces at propose time, rather
# than trusting Admin's own bound alone.
MAX_WHITELIST_BATCH_SIZE: int = 50


# -----------------------------------------------------------------------------
# EVM Interfaces
# -----------------------------------------------------------------------------

@gl.evm.contract_interface
class ERC20BalanceInterface:
    """
    Minimal read-only interface for external ERC20-shaped governance
    tokens. Used for eligibility_mode == "erc20", for "custom" mode when
    custom_token_interface_kind == "erc20", and as the default balance
    source for voting_weight_mode == "token_weighted" when eligibility_mode
    is neither "nft" nor "custom" (see _get_token_balance). This is the
    sole ERC20 balance-reading mechanism in this contract.
    """

    class View:
        def balance_of(self, owner: Address, /) -> u256: ...

    class Write:
        pass


@gl.evm.contract_interface
class ERC721OwnershipInterface:
    """
    Standard ERC721 ownership-count interface: balanceOf(owner) returns
    the number of tokens owned by owner. This is byte-identical in ABI
    shape to ERC20BalanceInterface.balance_of -- both are
    balanceOf(address) -> uint256 -- but is declared as its own, separate,
    explicitly-named interface class so that NFT eligibility is a real,
    explicit feature rather than an implicit reuse of the ERC20 interface
    that could read as treating "nft" as an undefined umbrella mode. Used
    exclusively for eligibility_mode == "nft", including when combined
    with voting_weight_mode == "token_weighted" (see _get_token_balance's
    branch ordering).

    ERC1155 and other non-ERC721 NFT/token shapes are explicitly NOT
    covered by this interface or by eligibility_mode == "nft" at all --
    see custom_token_interface_kind's own comment for why ERC1155 support
    is deliberately not implemented rather than half-specified.
    """

    class View:
        def balance_of(self, owner: Address, /) -> u256: ...

    class Write:
        pass


# -----------------------------------------------------------------------------
# Storage Dataclasses
# -----------------------------------------------------------------------------

@allow_storage
@dataclass
class Proposal:
    proposal_id:           u256
    proposer:                str            # hex, lowercased
    proposal_type:            str           # "standard" | "constitution"
    title:                     str
    description:                str
    proposed_constitution:       str         # "" unless proposal_type == "constitution"
    constitution_snapshot:         str       # constitution text at ORIGINAL submission time;
                                               # never re-captured on resubmission -- see
                                               # submit_proposal / resubmit_proposal / raise_dispute
                                               # docstrings
    status:                       str        # see status vocabulary constants above
    failure_reason:                str       # "" | "quorum_not_met" | "threshold_not_met"
    ai_audit_decision:              str      # "accept" | "reject" | "revise"
    ai_audit_reasoning:               str
    resubmission_count:                 u256
    votes_yes:                            u256   # weighted sum if token_weighted, else count
    votes_no:                               u256
    created_at:                               u64
    voting_closes_at:                           u64
    # Proposer's originally-requested voting_duration at submit_proposal
    # time. Set once and never re-captured afterward, same treatment as
    # constitution_snapshot and for the same reason: a proposer's own
    # stated intent about deliberation length must not be silently
    # overridden by the protocol's max_voting_duration ceiling whenever
    # resubmit_proposal or raise_dispute later reopens voting with a fresh
    # window. Distinct from voting_closes_at, which is the computed
    # absolute deadline of whichever window is currently open; this field
    # is the durable duration choice a fresh window is always recomputed
    # from.
    voting_duration:                              u64
    dispute_stage:                                u256


@allow_storage
@dataclass
class VoteRecord:
    """
    Once written, a VoteRecord is never mutated or overwritten -- see
    vote()'s own docstring (INV-V1).
    """
    support:  bool
    weight:    u256   # weight at the single cast moment
    cast_at:    u64


@allow_storage
@dataclass
class ConstitutionalConflict:
    description: str
    severity:      str   # "low" | "medium" | "high" -- see _audit_proposal_logic's
                           # docstring for why the AI prompt's requested JSON shape
                           # was adapted to populate this field


@allow_storage
@dataclass
class DisputeRecord:
    stage:       u256
    raised_by:     str
    raised_at:       u64
    resolution:        str   # "accept" | "reject" -- the dispute panel's decision
    reasoning:            str


@allow_storage
@dataclass
class ConstitutionVersion:
    version:                 u256
    text:                      str
    adopted_at:                  u64
    adopted_via_proposal_id:       u256
    adopted_by:                       str   # admin hex, or "genesis" (see CONSTITUTION_ADOPTED_BY_GENESIS)


@allow_storage
@dataclass
class ProposalRevision:
    resubmit_number:      u256
    prior_description:      str
    prior_ai_decision:        str
    prior_ai_reasoning:         str
    prior_conflicts_json:         str
    revised_at:                     u64


@allow_storage
@dataclass
class GovernanceChange:
    event_type:  str
    proposal_id:   u256
    actor:           str
    timestamp:         u64
    details:              str


@allow_storage
@dataclass
class RateLimitEntry:
    window_start: u64
    count:          u32


# -----------------------------------------------------------------------------
# AI Output Normalizer
# -----------------------------------------------------------------------------

def normalize_ai_output(data_input, context: str = "audit") -> dict:
    """
    Parses/validates raw AI output into a plain dict, defaulting safely to
    a rejecting decision on malformed input rather than raising, so a
    single bad AI response degrades to the safest outcome instead of
    reverting the whole transaction. A module-level function, not a
    method, since it is called from inside nondet closures in both
    _audit_proposal_logic and raise_dispute and must not reference
    self/storage.
    """
    if isinstance(data_input, str):
        try:
            data = json.loads(data_input)
        except json.JSONDecodeError:
            if context == "dispute":
                return {"decision": "reject", "reasoning": "AI returned malformed output; defaulting to reject."}
            return {"decision": "reject", "reasoning": "AI returned malformed output; defaulting to reject.", "constitutional_conflicts": []}
    elif isinstance(data_input, dict):
        data = data_input
    else:
        if context == "dispute":
            return {"decision": "reject", "reasoning": "Unexpected AI output type."}
        return {"decision": "reject", "reasoning": "Unexpected AI output type.", "constitutional_conflicts": []}

    if "constitutional_conflicts" in data and isinstance(data["constitutional_conflicts"], list):
        for conflict in data["constitutional_conflicts"]:
            if isinstance(conflict, dict):
                if "description" in conflict:
                    conflict["description"] = str(conflict["description"]).strip()
                if "severity" in conflict:
                    conflict["severity"] = str(conflict["severity"]).strip().lower()

    if "decision" in data:
        data["decision"] = str(data["decision"]).lower().strip()
    if "reasoning" in data:
        data["reasoning"] = str(data["reasoning"]).strip()

    return data


def _normalize_hex_address_string(value: str) -> str:
    """
    Deployment-tooling compatibility fix. Some deployment paths strip the
    "0x" prefix from a str-typed constructor argument before it ever
    reaches contract code -- a bare 40-character hex string then fails
    Address()'s hex-detection branch and falls through to its
    base64-decode fallback, which correctly rejects it (40 hex chars is
    not valid base64). This adds the prefix back ONLY when the value is
    otherwise exactly a bare 40-character hex string with no prefix; a
    value that already starts with "0x" is returned unchanged. This never
    changes what address results -- "0x" + 40 hex chars and the same 40
    hex chars alone denote the identical 20-byte address -- it only
    tolerates this one input variant, without weakening validation.
    """
    if not value.startswith("0x") and len(value) == 40 \
            and all(c in "0123456789abcdefABCDEF" for c in value):
        return "0x" + value
    return value


# -----------------------------------------------------------------------------
# Contract
# -----------------------------------------------------------------------------

class GovLayerCore(gl.Contract):
    """
    GovLayer V2 -- Core contract. Owns governance state and applies
    governance outcomes: proposals, voting, disputes, the constitution and
    its version history, proposal revision history, governance history,
    eligibility/weight/whitelist configuration, and rate limiting. Never
    owns admin membership or the multisig/timelock action state machine --
    those are GovLayerAdmin's exclusive domain. Also owns the Core-side
    half of the Admin-authorizes/Core-pulls-and-validates mechanism
    (apply_admin_action) that mutates all of the configuration fields
    above post-genesis.

    is_admin_contract_configured() is a pure local check
    (admin_contract_address != zero address), not itself a cross-contract
    call. See this file's own module-level comment for the full
    disposition of this contract's two actual cross-contract reads into
    GovLayerAdmin, why rate-limit parameters are deliberately not a third,
    and which capabilities remain out of scope.
    """

    # Deployment-tooling compatibility (see set_admin_contract_address's
    # docstring for the full history): stored as str, not Address.
    # Converted to Address on demand at each actual use site (matching
    # the same pattern applied to voting_token by set_token_rules
    # elsewhere in this file). "" denotes not-yet-configured.
    admin_contract_address: str
    # Captured natively from gl.message.sender_address in __init__ --
    # never a constructor argument, so this value never touches the
    # broken constructor-argument address-parsing path at all. Used
    # solely to gate set_admin_contract_address to the original deployer.
    deployer:                Address
    constitution:            str
    constitution_version:      u256

    eligibility_mode:            str
    voting_weight_mode:            str
    voting_token:                    Address
    custom_token_interface_kind:        str
    min_tokens_to_vote:                    u256
    min_tokens_to_propose:                    u256

    # Whitelist eligibility. Independent of eligibility_mode -- combined
    # with AND semantics wherever both are active (see
    # _check_voting_eligibility / _check_proposal_eligibility). Toggles
    # default to False and both lists default empty at genesis. Mutated
    # exclusively via apply_admin_action's set_whitelist_enabled and
    # update_whitelist branches (INV-P3) -- no direct setter exists
    # anywhere else in this file.
    use_whitelist_for_voting:      bool
    use_whitelist_for_proposing:     bool
    voter_whitelist:                   TreeMap[str, bool]
    voter_whitelist_list:                DynArray[str]   # append-only, for pagination
    proposer_whitelist:                    TreeMap[str, bool]
    proposer_whitelist_list:                 DynArray[str]   # append-only, for pagination

    min_quorum:                                  u256
    approval_threshold_percent:                     u256
    min_voting_duration:                               u64
    max_voting_duration:                                  u64

    max_resubmissions:        u256
    dispute_cooldown_seconds:   u64
    max_dispute_stages_count:     u256

    proposals:      TreeMap[str, Proposal]
    proposal_count:   u256

    votes: TreeMap[str, TreeMap[str, VoteRecord]]

    proposal_conflicts: TreeMap[str, DynArray[ConstitutionalConflict]]
    proposal_disputes:    TreeMap[str, DynArray[DisputeRecord]]

    constitution_history: TreeMap[u256, ConstitutionVersion]

    proposal_revisions: TreeMap[str, DynArray[ProposalRevision]]

    governance_history:        DynArray[GovernanceChange]
    governance_history_count:    u256

    proposer_rate_limit:           TreeMap[str, RateLimitEntry]
    max_proposals_per_window:        u256
    proposal_rate_window_secs:         u64

    applied_admin_action_ids: TreeMap[str, bool]

    # Without this, a stale-at-pull-time action_id could be re-submitted
    # to apply_admin_action() an unbounded number of times by any caller
    # (the method is permissionless and carries no rate limit), each call
    # re-failing the same independent re-validation and appending another
    # EVENT_ADMIN_ACTION_PULL_REJECTED entry to governance_history with no
    # cap. Once _reject_pull has recorded a rejection for a given
    # action_id, that action_id is permanently barred from any further
    # apply_admin_action() attempt, bounding this call path to at most one
    # rejection entry per action_id. Deliberately a separate map from
    # applied_admin_action_ids (which means something different --
    # successfully applied, not merely attempted) rather than overloading
    # either map's meaning.
    rejected_admin_action_ids: TreeMap[str, bool]

    def __init__(
        self,
        genesis_constitution_text: str,
        eligibility_mode: str,
        min_tokens_to_vote: u256,
        min_tokens_to_propose: u256,
        voting_weight_mode: str,
    ) -> None:
        # Deployment-tooling compatibility: constructor-argument address
        # values cannot currently be reliably turned into an Address
        # object by the deployment path on this platform, so
        # admin_contract_address is not a constructor argument. It
        # defaults to "" (unconfigured) here and is set exactly once,
        # post-deployment, via set_admin_contract_address below --
        # callable only by the original deployer, and only once, ever.
        # self.deployer is captured here from gl.message.sender_address,
        # which GenVM supplies directly from the transaction context, so
        # it never touches the broken constructor-argument path either.
        # This preserves the same security property a constructor-argument
        # design would have had (nobody but the legitimate deployer can
        # ever set this value, and it becomes permanent once set) -- it
        # only moves when that value is supplied, not who controls it.
        #
        # voting_token remains a genuine Address-typed field but is not
        # accepted as a constructor argument either, for the same reason.
        # It defaults to the zero address here, constructed from a
        # hardcoded 20-byte buffer rather than any user-supplied string,
        # so this construction never goes near the broken path at all. A
        # DAO wanting a real voting_token from day one sets it via the
        # already-existing set_token_rules Admin action shortly after
        # deployment.
        self.deployer = gl.message.sender_address
        self._require(
            eligibility_mode in VALID_ELIGIBILITY_MODES,
            f"Invalid eligibility_mode: must be one of {VALID_ELIGIBILITY_MODES}"
        )
        self._require(
            voting_weight_mode in VALID_VOTING_WEIGHT_MODES,
            f"Invalid voting_weight_mode: must be one of {VALID_VOTING_WEIGHT_MODES}"
        )
        self._require(
            genesis_constitution_text.strip() != "",
            "genesis_constitution_text cannot be empty"
        )

        self.admin_contract_address = ""
        self.constitution = genesis_constitution_text
        self.constitution_version = u256(1)

        self.eligibility_mode = eligibility_mode
        # Genesis-time DAO choice, not hardcoded to "equal". A DAO wanting
        # token_weighted voting from day one may request it here; either
        # value is subsequently mutable post-genesis via the
        # Admin-authorized set_voting_weight_mode action, same lifecycle
        # as eligibility_mode and every other field in this block.
        self.voting_weight_mode = voting_weight_mode
        self.voting_token = Address(bytes(20))
        self.custom_token_interface_kind = ""
        self.min_tokens_to_vote = min_tokens_to_vote
        self.min_tokens_to_propose = min_tokens_to_propose

        # Whitelist eligibility: disabled and empty at genesis. No
        # constructor parameter -- unlike voting_weight_mode, a whitelist
        # toggle has no meaningful "choose it at genesis" case distinct
        # from "enable it later" (the DAO's actual membership list cannot
        # be known or usefully populated via constructor args either
        # way), so both the toggle and membership are deployment-default-
        # only here. Both remain fully post-deployment mutable via the
        # Admin-authorized set_whitelist_enabled / update_whitelist
        # actions -- a deployment default, not a permanent restriction.
        self.use_whitelist_for_voting = False
        self.use_whitelist_for_proposing = False

        self.min_quorum = u256(DEFAULT_MIN_QUORUM)
        self.approval_threshold_percent = u256(DEFAULT_APPROVAL_THRESHOLD_PERCENT)
        self.min_voting_duration = u64(DEFAULT_MIN_VOTING_DURATION)
        self.max_voting_duration = u64(DEFAULT_MAX_VOTING_DURATION)

        self.max_resubmissions = u256(3)
        self.dispute_cooldown_seconds = u64(3600)
        self.max_dispute_stages_count = u256(3)

        self.proposal_count = u256(0)
        self.governance_history_count = u256(0)

        # Genesis-only, direct seed of Core's local rate-limit copy. Not a
        # cross-contract read (Admin's own copy of these same defaults is
        # seeded independently, in GovLayerAdmin's own __init__) -- the
        # two are only kept in sync going forward via apply_admin_action's
        # pull mechanism, not by reading each other at genesis.
        self.max_proposals_per_window = u256(7)
        self.proposal_rate_window_secs = u64(604800)

        now = self._get_now()
        genesis_version = ConstitutionVersion(
            version=u256(1),
            text=genesis_constitution_text,
            adopted_at=now,
            adopted_via_proposal_id=u256(0),
            adopted_by=CONSTITUTION_ADOPTED_BY_GENESIS,
        )
        self.constitution_history[u256(1)] = genesis_version

        self._log_governance_change(
            EVENT_CONTRACT_INITIALIZED,
            gl.message.sender_address.as_hex.lower(),
            "GovLayerCore deployed (V2, clean-slate genesis, no V1 migration)"
        )

    # -- Internal Utilities --------------------------------------------------

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(message)

    def _get_now(self) -> u64:
        """
        Identical implementation to GovLayerAdmin.py's own _get_now() --
        duplicated verbatim since this helper cannot be shared across
        contracts on this platform.
        """
        try:
            raw: str = gl.message_raw["datetime"]
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            ts = int(dt.timestamp())
            if ts < MIN_VALID_TIMESTAMP:
                raise gl.vm.UserError(
                    f"Timestamp {ts} is below minimum valid value "
                    f"{MIN_VALID_TIMESTAMP}. The runtime datetime field "
                    f"appears malformed."
                )
            return u64(ts)
        except gl.vm.UserError:
            raise
        except Exception:
            raise gl.vm.UserError(
                "Unable to read transaction timestamp from runtime. "
                "gl.message_raw['datetime'] is missing or unparseable."
            )

    def _log_governance_change(self, event_type: str, actor: str, details: str) -> None:
        self.governance_history.append(GovernanceChange(
            event_type=event_type,
            proposal_id=u256(0),
            actor=actor,
            timestamp=self._get_now(),
            details=details,
        ))
        self.governance_history_count = u256(int(self.governance_history_count) + 1)

    def _log_proposal_change(self, event_type: str, proposal_id: u256, actor: str, details: str) -> None:
        """
        Same as _log_governance_change but records the associated
        proposal_id -- used by every proposal-lifecycle transition so
        governance history entries are queryable per-proposal, not just a
        flat log. _log_governance_change itself (proposal_id=0) is
        reserved for contract-level events with no single associated
        proposal (currently only genesis).
        """
        self.governance_history.append(GovernanceChange(
            event_type=event_type,
            proposal_id=proposal_id,
            actor=actor,
            timestamp=self._get_now(),
            details=details,
        ))
        self.governance_history_count = u256(int(self.governance_history_count) + 1)

    def _get_token_balance_or_raise(self, token: Address, user: Address) -> u256:
        """
        Same branch-dispatch logic as _get_token_balance below -- nft ->
        custom -> erc20/token-weighted -> else 1 -- but does NOT swallow a
        failed cross-contract read into 0. A genuinely configured zero
        token address still legitimately short-circuits to 0 here (a
        real, deterministic "no token configured" answer, never an
        external call, so there is nothing untrustworthy about it) --
        only actual external-call failures (unreachable contract,
        reverting balance_of, malformed/undecodable ABI return) propagate
        as an exception out of this method.

        This exists so a caller about to commit the result as PERMANENT,
        IMMUTABLE state (_vote_weight, below) can tell "successfully read
        a balance of zero" apart from "the read itself failed and
        produced no trustworthy value at all." _get_token_balance's own
        blanket try/except collapses that distinction into the same 0,
        which is correct for a fail-closed ELIGIBILITY denial (see that
        method's docstring) but unsafe when the same 0 would become a
        permanently-recorded VoteRecord.weight instead of a revert. Do
        not add a swallowing try/except to this method -- that would
        reintroduce exactly the defect this split exists to prevent.
        """
        if token.as_hex.lower() == ZERO_ADDRESS_HEX:
            return u256(0)
        if self.eligibility_mode == ELIGIBILITY_MODE_NFT:
            return u256(ERC721OwnershipInterface(token).view().balance_of(user))
        elif self.eligibility_mode == ELIGIBILITY_MODE_CUSTOM:
            if self.custom_token_interface_kind not in VALID_CUSTOM_TOKEN_INTERFACE_KINDS:
                # Unrecognized/unset interface kind fails closed, not
                # open. This also correctly rejects "" (the genesis
                # default before any Admin-authorized set_token_rules
                # action has run). This is a deterministic configuration
                # check, not an external-call failure, so returning 0
                # here (rather than raising) is still correct even in
                # the raising variant of this method.
                return u256(0)
            # VALID_CUSTOM_TOKEN_INTERFACE_KINDS currently contains
            # exactly one value (CUSTOM_TOKEN_INTERFACE_KIND_ERC20);
            # the membership check above is the real validation gate,
            # this line dispatches to the one implemented interface.
            # Adding a second real kind requires adding both a new
            # tuple entry AND a new dispatch branch here together --
            # governance selects among code-defined mechanisms, it
            # cannot invent one at runtime.
            return u256(ERC20BalanceInterface(token).view().balance_of(user))
        elif self.eligibility_mode == ELIGIBILITY_MODE_ERC20 \
                or self.voting_weight_mode == VOTING_WEIGHT_MODE_TOKEN_WEIGHTED:
            return u256(ERC20BalanceInterface(token).view().balance_of(user))
        else:
            return u256(1)

    def _get_token_balance(self, token: Address, user: Address) -> u256:
        """
        gl.call()-free by design, using a distinct, explicitly-named
        interface for NFT eligibility (ERC721OwnershipInterface) rather
        than silently reusing the ERC20 interface. Fails closed to 0 on
        any error -- an unreachable, reverting, or malformed token
        contract yields zero balance rather than propagating the
        failure.

        Branch ordering, and why it matters: eligibility_mode == "nft" is
        checked FIRST and unconditionally routes to the ERC721 interface,
        including when combined with voting_weight_mode == "token_weighted"
        -- an NFT-gated DAO that also wants weighted voting should weigh
        by the SAME NFT holding, not silently fall through to an ERC20
        call against what is (by configuration) an NFT contract. "custom"
        mode is checked next, using whichever interface
        custom_token_interface_kind selects (currently only "erc20";
        unrecognized/unset kinds fail closed to 0 -- see that constant's
        own comment for the ERC1155 non-implementation). Only after both
        of those does the method fall through to the ERC20 interface,
        covering eligibility_mode == "erc20" directly, and covering
        eligibility_mode == "open" combined with voting_weight_mode ==
        "token_weighted" as a sensible default (no separate token-kind
        field exists for that combination, and ERC20 is the natural
        default balance shape for a plain governance token). Any other
        combination (eligibility_mode == "open" with voting_weight_mode
        == "equal") never reaches a real balance call at all -- see
        _vote_weight and _check_voting_eligibility /
        _check_proposal_eligibility, which do not invoke this method
        under those conditions.

        This method's fail-closed-to-0 behavior is correct for its actual
        callers, _check_voting_eligibility and _check_proposal_eligibility
        -- a failed read denying eligibility only ever causes a safe,
        retryable transaction revert, never a permanent write. This
        method is deliberately NOT used by _vote_weight, which instead
        calls _get_token_balance_or_raise directly, above -- see that
        method's docstring and _vote_weight's own docstring for why.
        """
        try:
            return self._get_token_balance_or_raise(token, user)
        except Exception:
            return u256(0)

    def _check_voting_eligibility(self, user: Address) -> None:
        """
        Two independent gates, both enforced with AND semantics when both
        are active -- an address must satisfy both configured
        requirements; whitelist eligibility does not bypass token
        eligibility, or vice versa. Each gate is a separate top-level
        check; a DAO running eligibility_mode == "open" with
        use_whitelist_for_voting == True still correctly enforces
        whitelist-only gating, since the token-eligibility block below is
        skipped entirely for "open" mode (an always-true condition on
        that side of the AND).
        """
        if self.use_whitelist_for_voting:
            user_hex = user.as_hex.lower()
            self._require(
                self.voter_whitelist.get(user_hex, False),
                "Address is not on the voter whitelist"
            )
        if self.eligibility_mode != ELIGIBILITY_MODE_OPEN:
            balance = self._get_token_balance(self.voting_token, user)
            if self.eligibility_mode == ELIGIBILITY_MODE_NFT:
                self._require(int(balance) > 0, "Must hold the governance NFT to vote")
            elif self.eligibility_mode in (ELIGIBILITY_MODE_ERC20, ELIGIBILITY_MODE_CUSTOM):
                self._require(
                    int(balance) >= int(self.min_tokens_to_vote),
                    f"Insufficient tokens to vote. Required: {int(self.min_tokens_to_vote)}"
                )

    def _check_proposal_eligibility(self, user: Address) -> None:
        """Same AND-composition as _check_voting_eligibility, against the
        proposer whitelist / min_tokens_to_propose instead."""
        if self.use_whitelist_for_proposing:
            user_hex = user.as_hex.lower()
            self._require(
                self.proposer_whitelist.get(user_hex, False),
                "Address is not on the proposer whitelist"
            )
        if self.eligibility_mode != ELIGIBILITY_MODE_OPEN:
            balance = self._get_token_balance(self.voting_token, user)
            if self.eligibility_mode == ELIGIBILITY_MODE_NFT:
                self._require(int(balance) > 0, "Must hold the governance NFT to propose")
            elif self.eligibility_mode in (ELIGIBILITY_MODE_ERC20, ELIGIBILITY_MODE_CUSTOM):
                self._require(
                    int(balance) >= int(self.min_tokens_to_propose),
                    f"Insufficient tokens to propose. Required: {int(self.min_tokens_to_propose)}"
                )

    def _vote_weight(self, user: Address) -> u256:
        """
        Weight assigned to a single vote cast by user, right now. "equal"
        mode always weighs 1, independent of any token balance. This is
        deliberately independent of eligibility_mode -- eligibility gates
        WHETHER a vote is accepted at all (via _check_voting_eligibility);
        this method determines HOW MUCH a successfully-cast vote counts,
        an orthogonal question.

        Calls _get_token_balance_or_raise, NOT _get_token_balance. This
        value is about to be written into VoteRecord.weight, which is
        permanent and immutable (INV-V1: no recast, no correction, ever).
        _get_token_balance's fail-closed-to-0 convenience is exactly
        wrong here -- it would make "the read failed" indistinguishable
        from "the read succeeded and returned a genuine zero balance",
        silently converting a transient token-contract outage into a
        permanently-recorded zero-weight vote the voter can never fix.
        Letting the exception propagate instead means vote() (the sole
        caller, see below) reverts the ENTIRE transaction before writing
        anything -- no VoteRecord, no vote-tally mutation -- exactly the
        same safe, retryable failure shape _check_voting_eligibility
        already had for this same underlying call. A genuine, ordinary
        zero balance is unaffected: it is still a normal return value
        here (not an exception) and still produces a legitimate
        weight=0 vote exactly as before.
        """
        if self.voting_weight_mode == VOTING_WEIGHT_MODE_TOKEN_WEIGHTED:
            return self._get_token_balance_or_raise(self.voting_token, user)
        return u256(1)

    def _is_admin_contract_paused(self) -> bool:
        """
        Live cross-contract read of GovLayerAdmin's pause flag. Fails
        closed: if the Admin contract is unreachable, misconfigured, or
        the call otherwise errors, this returns True (treat as paused)
        rather than False (treat as open) -- do not assume open on
        failure. This is one of the two cross-contract call sites in this
        file -- the other is apply_admin_action's own pull read, below,
        which applies the same fail-closed discipline in its own
        appropriate form (refuse to apply rather than silently succeed).
        """
        if not self.is_admin_contract_configured():
            return True
        try:
            admin = gl.get_contract_at(Address(self.admin_contract_address))
            return bool(admin.view().is_paused())
        except Exception:
            return True

    def _apply_constitution_update(self, new_text: str, proposal_id: u256,
                                    adopted_by_hex: str, now: u64) -> None:
        """
        Shared helper applying a real, post-genesis constitution mutation.
        Called exclusively from apply_admin_action's
        constitution_update_propose branch. Not called anywhere else --
        there is no other code path in this file that may assign
        self.constitution or append to constitution_history outside of
        __init__'s one genesis entry.

        adopted_by_hex is the admin who originally proposed the Admin-side
        multisig action (action["proposer"] from GovLayerAdmin's own
        get_action() record) -- a specific, auditable admin address, not a
        generic "system" sentinel, matching ConstitutionVersion.adopted_by's
        documented meaning ("admin hex, or 'genesis'").

        Increments constitution_version and appends a new ConstitutionVersion
        entry BEFORE overwriting self.constitution, so a reader who observes
        the version counter having advanced can always find the corresponding
        history entry already present.
        """
        new_version = u256(int(self.constitution_version) + 1)
        self.constitution_history[new_version] = ConstitutionVersion(
            version=new_version,
            text=new_text,
            adopted_at=now,
            adopted_via_proposal_id=proposal_id,
            adopted_by=adopted_by_hex,
        )
        self.constitution_version = new_version
        self.constitution = new_text

    def _decode_json_payload(self, params_json: str):
        """
        Shared, minimal JSON-decode wrapper used by every apply_admin_action
        branch below that needs to parse action.params. Returns the decoded
        object on success, or None on any decode failure -- callers treat
        None as "malformed payload, refuse to apply" uniformly, matching
        the same fail-closed-on-malformed-input discipline used throughout
        this file (e.g. normalize_ai_output's own defaulting behavior).
        This is intentionally a thin wrapper: Core's own independent
        re-validation of EACH field's value happens in each branch below,
        after this shared decode step, never trusting decode success alone
        as validity.
        """
        try:
            return json.loads(params_json)
        except Exception:
            return None

    @gl.public.write
    def apply_admin_action(self, action_id: str) -> None:
        """
        The Core-side half of the Admin-authorizes / Core-pulls-and-
        validates pattern. Permissionless -- any address may call this,
        not only admins, matching Admin's own execute_admin_action()
        liveness reasoning: liveness must never depend on a particular
        caller remembering to submit the final transaction.

        Sequence, uniform across every action type:
          1. Pull the executed AdminAction record from GovLayerAdmin via a
             live cross-contract view() call.
          2. Verify Admin has actually finished its side (status ==
             "executed") and that this action_id has never been applied
             before (replay protection) -- raise otherwise. These are
             "not ready yet" / caller-error conditions, not state-drift
             conditions, so they revert the transaction rather than
             silently logging a rejection -- matching Admin's own
             execute_admin_action's identical two-tier discipline (hard
             raises for "not found"/"already finalized"/"timelock not
             reached", vs. a graceful no-revert expire-and-return for
             genuine revalidation failure -- the same two-tier split
             applies here).
          3. Dispatch on action_type. Each branch independently re-decodes
             and re-validates its own payload against CURRENT Core-side
             state -- never trusting that Admin's own structural check at
             propose/execute time still holds, since state can drift
             between Admin authorizing an action and this method actually
             pulling it.
          4. If re-validation fails (state has genuinely drifted since
             authorization): do NOT apply, do NOT mark
             applied_admin_action_ids, log a rejection event via
             _reject_pull, and return normally (no revert) -- this is a
             terminal, non-retryable-into-success outcome for this
             action_id: a fresh Admin authorization is required if the
             DAO still wants the change. Uniform across every action type
             below, not only the constitution-update case that originally
             established it.
          5. If re-validation passes: apply the change to Core's own
             storage, record the governance-history event, and mark
             applied_admin_action_ids -- all in the same write
             transaction.

        Every branch decodes its payload via _decode_json_payload (shared,
        thin wrapper) and independently validates against THIS file's own
        enum/bound constants -- never against Admin's copies, which this
        contract has no access to and must not pretend to trust. Admin
        never mutates Core-owned state; Core never trusts Admin's own
        structural check alone.
        """
        self._require(
            self.is_admin_contract_configured(),
            "Admin contract not configured; cannot pull authorized actions"
        )
        self._require(
            action_id not in self.applied_admin_action_ids,
            "Action already applied: replay protection (INV-A5)"
        )
        self._require(
            action_id not in self.rejected_admin_action_ids,
            "Action's pull was already rejected due to stale Core-side "
            "state at a prior attempt: this is terminal for this "
            "action_id. A fresh Admin "
            "authorization is required if the DAO still wants this "
            "change."
        )

        try:
            admin = gl.get_contract_at(Address(self.admin_contract_address))
            action = admin.view().get_action(action_id)
        except gl.vm.UserError as e:
            # A reachable, functioning Admin contract legitimately raises
            # "Action not found" for any action_id it never created (typo,
            # garbage input, or an action_id that genuinely does not
            # exist). That is a distinct failure mode from Admin being
            # unreachable, and reporting it as "unreachable, try again
            # later" would be misleading -- retrying can never fix a
            # nonexistent action_id. Only THIS specific, known Admin-side
            # rejection is reported accurately; any other UserError content
            # (or any non-UserError exception, see the bare except below)
            # still falls back to the fail-closed "unreachable" message --
            # this does not weaken the fail-closed discipline for genuine
            # unreachability/read failures.
            if str(e) == "Action not found":
                raise gl.vm.UserError(
                    f"Action '{action_id}' does not exist on GovLayerAdmin. "
                    f"Nothing to pull -- check the action_id."
                )
            raise gl.vm.UserError(
                "Unable to reach GovLayerAdmin to pull this action. Try "
                "again once the Admin contract is reachable."
            )
        except Exception:
            raise gl.vm.UserError(
                "Unable to reach GovLayerAdmin to pull this action. Try "
                "again once the Admin contract is reachable."
            )

        self._require(
            action.get("status") == ADMIN_ACTION_STATUS_EXECUTED,
            f"Action is not yet executed on GovLayerAdmin (status: "
            f"{action.get('status')}). Nothing to pull."
        )

        action_type = action.get("action_type", "")
        proposer_hex = action.get("proposer", "")
        now = self._get_now()

        if action_type == ACTION_CONSTITUTION_UPDATE_PROPOSE:
            decoded = self._decode_json_payload(action.get("params", ""))
            proposal_id = u256(0)
            if isinstance(decoded, dict):
                try:
                    raw_id = int(decoded.get("proposal_id", 0))
                    if raw_id > 0:
                        proposal_id = u256(raw_id)
                except Exception:
                    proposal_id = u256(0)
            proposal_id_str = str(int(proposal_id))
            proposal = self.proposals.get(proposal_id_str) if int(proposal_id) > 0 else None
            # This re-validation is a pull-time invariant guard, retained
            # defensively per the general requirement that every branch
            # independently re-validate current Core-side state before
            # applying, regardless of whether a live drift path is known
            # to exist for that specific branch today. Under the CURRENT
            # code, no other method that touches Proposal.status
            # (cancel_proposal, resubmit_proposal, vote, finalize_decision,
            # raise_dispute) can act on a proposal once it reaches
            # pending_constitution_confirm -- every one of their own
            # status gates excludes that value -- so this specific stale-
            # state condition is not reachable today through any natural
            # transaction sequence; it is reachable only by artificially
            # forcing proposal.status via direct storage manipulation
            # (e.g. in a test harness), not by any real caller-initiated
            # sequence of contract calls. This is intentionally NOT
            # removed: it is the reference implementation this generic
            # dispatch mechanism's fail-closed discipline is built around,
            # and a future change elsewhere in this file could reintroduce
            # a live path to this condition without this guard being
            # revisited.
            if proposal is None or proposal.proposal_type != PROPOSAL_TYPE_CONSTITUTION \
                    or proposal.status != STATUS_PENDING_CONSTITUTION_CONFIRM:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "proposal missing, not constitution-type, or no longer "
                                   "pending_constitution_confirm")
                return
            self._apply_constitution_update(
                proposal.proposed_constitution, proposal_id, proposer_hex, now
            )
            proposal.status = STATUS_PASSED
            proposal.failure_reason = FAILURE_REASON_NONE
            self.proposals[proposal_id_str] = proposal
            self.applied_admin_action_ids[action_id] = True
            self._log_proposal_change(
                EVENT_CONSTITUTION_UPDATE_APPLIED, proposal_id, proposer_hex,
                f"Constitution updated to version {int(self.constitution_version)} "
                f"via action {action_id}, proposal #{int(proposal_id)}"
            )

        elif action_type == ACTION_SET_RATE_LIMIT_PARAMS:
            decoded = self._decode_json_payload(action.get("params", ""))
            valid = isinstance(decoded, dict)
            max_per_window = 0
            window_secs = 0
            if valid:
                try:
                    max_per_window = int(decoded["max_proposals_per_window"])
                    window_secs = int(decoded["proposal_rate_window_secs"])
                except Exception:
                    valid = False
            if valid:
                valid = (
                    MIN_PROPOSALS_PER_WINDOW <= max_per_window <= MAX_PROPOSALS_PER_WINDOW
                    and MIN_RATE_WINDOW_SECS <= window_secs <= MAX_RATE_WINDOW_SECS
                )
            if not valid:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "malformed or out-of-range rate-limit payload")
                return
            self.max_proposals_per_window = u256(max_per_window)
            self.proposal_rate_window_secs = u64(window_secs)
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|"
                f"max_proposals_per_window={max_per_window},"
                f"proposal_rate_window_secs={window_secs}"
            )

        elif action_type == ACTION_SET_ELIGIBILITY_MODE:
            decoded = self._decode_json_payload(action.get("params", ""))
            new_mode = decoded.get("eligibility_mode", "") if isinstance(decoded, dict) else ""
            if new_mode not in VALID_ELIGIBILITY_MODES:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "invalid or unrecognized eligibility_mode value")
                return
            self.eligibility_mode = new_mode
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|eligibility_mode={new_mode}"
            )

        elif action_type == ACTION_SET_TOKEN_RULES:
            decoded = self._decode_json_payload(action.get("params", ""))
            valid = isinstance(decoded, dict)
            new_token = None
            new_min_vote = -1
            new_min_propose = -1
            new_custom_kind = ""
            if valid:
                try:
                    new_token = Address(decoded.get("voting_token", ""))
                    new_min_vote = int(decoded.get("min_tokens_to_vote", -1))
                    new_min_propose = int(decoded.get("min_tokens_to_propose", -1))
                    new_custom_kind = str(decoded.get("custom_token_interface_kind", ""))
                except Exception:
                    valid = False
            if valid and (new_min_vote < 0 or new_min_propose < 0):
                valid = False
            if valid and new_custom_kind != "" and new_custom_kind not in VALID_CUSTOM_TOKEN_INTERFACE_KINDS:
                valid = False
            if not valid:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "malformed or invalid token-rules payload")
                return
            self.voting_token = new_token
            self.min_tokens_to_vote = u256(new_min_vote)
            self.min_tokens_to_propose = u256(new_min_propose)
            self.custom_token_interface_kind = new_custom_kind
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|voting_token={new_token.as_hex},"
                f"min_tokens_to_vote={new_min_vote},min_tokens_to_propose={new_min_propose},"
                f"custom_token_interface_kind={new_custom_kind}"
            )

        elif action_type == ACTION_SET_VOTING_WEIGHT_MODE:
            decoded = self._decode_json_payload(action.get("params", ""))
            new_mode = decoded.get("voting_weight_mode", "") if isinstance(decoded, dict) else ""
            if new_mode not in VALID_VOTING_WEIGHT_MODES:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "invalid or unrecognized voting_weight_mode value")
                return
            self.voting_weight_mode = new_mode
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|voting_weight_mode={new_mode}"
            )

        elif action_type == ACTION_SET_WHITELIST_ENABLED:
            decoded = self._decode_json_payload(action.get("params", ""))
            valid = (
                isinstance(decoded, dict)
                and decoded.get("target") in (WHITELIST_TOGGLE_TARGET_VOTING, WHITELIST_TOGGLE_TARGET_PROPOSING)
                and isinstance(decoded.get("enabled"), bool)
            )
            if not valid:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "malformed whitelist-toggle payload")
                return
            target = decoded["target"]
            enabled = bool(decoded["enabled"])
            if target == WHITELIST_TOGGLE_TARGET_VOTING:
                self.use_whitelist_for_voting = enabled
            else:
                self.use_whitelist_for_proposing = enabled
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|target={target},enabled={enabled}"
            )

        elif action_type == ACTION_UPDATE_WHITELIST:
            decoded = self._decode_json_payload(action.get("params", ""))
            valid = isinstance(decoded, dict) and decoded.get("target") in (WHITELIST_TARGET_VOTER, WHITELIST_TARGET_PROPOSER)
            add_raw = decoded.get("add", []) if valid else []
            remove_raw = decoded.get("remove", []) if valid else []
            if valid:
                valid = isinstance(add_raw, list) and isinstance(remove_raw, list)
            if valid and (len(add_raw) + len(remove_raw)) > MAX_WHITELIST_BATCH_SIZE:
                valid = False
            parsed_add = []
            parsed_remove = []
            if valid:
                try:
                    for a in add_raw:
                        parsed_add.append(Address(a).as_hex.lower())
                    for r in remove_raw:
                        parsed_remove.append(Address(r).as_hex.lower())
                except Exception:
                    valid = False
            if not valid:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "malformed whitelist-update payload")
                return
            target = decoded["target"]
            target_map = self.voter_whitelist if target == WHITELIST_TARGET_VOTER else self.proposer_whitelist
            target_list = self.voter_whitelist_list if target == WHITELIST_TARGET_VOTER else self.proposer_whitelist_list
            # Adds applied first, then removes -- if the same address
            # appears in both lists (a malformed but not-invalid-enough-
            # to-reject payload), remove wins. This is a documented
            # precedence choice: the safer default for a whitelist
            # (opt-in access control) is to end ambiguous instructions
            # un-granted rather than granted.
            for addr_hex in parsed_add:
                if addr_hex not in target_map:
                    target_list.append(addr_hex)
                target_map[addr_hex] = True
            for addr_hex in parsed_remove:
                if addr_hex not in target_map:
                    target_list.append(addr_hex)
                target_map[addr_hex] = False
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|target={target},"
                f"added={len(parsed_add)},removed={len(parsed_remove)}"
            )

        elif action_type == ACTION_SET_VOTING_PARAMETERS:
            # Bundles four related fields as one action, mirroring
            # set_rate_limit_params/set_token_rules' own combined-field
            # precedent, rather than four separate actions. Independent
            # re-validation here, never trusting Admin's own structural
            # check alone, exactly matching every other action type's
            # discipline -- including the cross-field max_voting_duration
            # >= min_voting_duration check, which mirrors the identical
            # ordering check submit_proposal's own voting_duration bounds
            # check already enforces.
            decoded = self._decode_json_payload(action.get("params", ""))
            valid = isinstance(decoded, dict)
            new_min_quorum = 0
            new_threshold_pct = 0
            new_min_duration = 0
            new_max_duration = 0
            if valid:
                try:
                    new_min_quorum = int(decoded["min_quorum"])
                    new_threshold_pct = int(decoded["approval_threshold_percent"])
                    new_min_duration = int(decoded["min_voting_duration"])
                    new_max_duration = int(decoded["max_voting_duration"])
                except Exception:
                    valid = False
            if valid:
                valid = (
                    new_min_quorum >= MIN_QUORUM_FLOOR
                    and MIN_APPROVAL_THRESHOLD_PERCENT <= new_threshold_pct <= MAX_APPROVAL_THRESHOLD_PERCENT
                    and new_min_duration >= MIN_VOTING_DURATION_FLOOR
                    and new_max_duration <= MAX_VOTING_DURATION_CEILING
                    and new_max_duration >= new_min_duration
                )
            if not valid:
                self._reject_pull(action_id, action_type, proposer_hex,
                                   "malformed or out-of-range voting-parameters payload")
                return
            self.min_quorum = u256(new_min_quorum)
            self.approval_threshold_percent = u256(new_threshold_pct)
            self.min_voting_duration = u64(new_min_duration)
            self.max_voting_duration = u64(new_max_duration)
            self.applied_admin_action_ids[action_id] = True
            self._log_governance_change(
                EVENT_ADMIN_ACTION_APPLIED, proposer_hex,
                f"action:{action_id}|type:{action_type}|"
                f"min_quorum={new_min_quorum},"
                f"approval_threshold_percent={new_threshold_pct},"
                f"min_voting_duration={new_min_duration},"
                f"max_voting_duration={new_max_duration}"
            )

        else:
            # Structurally unreachable under normal operation -- every
            # action_type GovLayerAdmin can ever produce is one of the
            # eight handled above (Admin's own _validate_action_now()
            # else-branch returns False, blocking creation, for anything
            # else at propose time). Raise rather than silently ignore --
            # this represents a genuine cross-contract version mismatch
            # (Admin producing an action_type Core doesn't know), not an
            # ordinary, expected staleness case.
            raise gl.vm.UserError(f"Unknown action_type: {action_type}")

    def _reject_pull(self, action_id: str, action_type: str, proposer_hex: str, reason: str) -> None:
        """
        Shared terminal-rejection path for apply_admin_action's failed-
        revalidation case. Logs the rejection to governance_history
        exactly once and marks rejected_admin_action_ids so this
        action_id can never be resubmitted to apply_admin_action() again
        -- this action_id remains permanently unresolved for this outcome
        (not retryable into success later); a fresh Admin authorization
        is required if the DAO still wants the change. Shared across
        every action-type branch in apply_admin_action so this discipline
        can never drift between them.

        Marking rejected_admin_action_ids here, in the one shared
        rejection path, is what bounds this call path's governance_history
        growth to at most one EVENT_ADMIN_ACTION_PULL_REJECTED entry per
        action_id -- without it, apply_admin_action's permissionless,
        rate-limit-free nature would let any caller re-invoke this path
        against the same stale action_id without limit.
        """
        self.rejected_admin_action_ids[action_id] = True
        self._log_governance_change(
            EVENT_ADMIN_ACTION_PULL_REJECTED,
            proposer_hex,
            f"action_id:{action_id}|action_type:{action_type}|reason:{reason}"
        )

    def _check_rate_limit(self, proposer_hex: str) -> None:
        """
        Fixed-window rate limiting against Core's own locally-synced copy
        of max_proposals_per_window / proposal_rate_window_secs -- never a
        live Admin read. The known boundary-burst property of fixed-window
        limiting (up to 2x the configured maximum across an adjacent-
        window boundary) is an accepted trade-off, not a defect.
        """
        now = self._get_now()
        window_secs = int(self.proposal_rate_window_secs)
        max_per_window = int(self.max_proposals_per_window)

        if proposer_hex in self.proposer_rate_limit:
            entry = self.proposer_rate_limit[proposer_hex]
            if int(now) - int(entry.window_start) >= window_secs:
                entry = RateLimitEntry(window_start=now, count=u32(1))
            else:
                self._require(
                    int(entry.count) < max_per_window,
                    f"Rate limit exceeded: at most {max_per_window} proposals "
                    f"per {window_secs}s window. Try again after the current "
                    f"window resets."
                )
                entry = RateLimitEntry(window_start=entry.window_start, count=u32(int(entry.count) + 1))
        else:
            entry = RateLimitEntry(window_start=now, count=u32(1))

        self.proposer_rate_limit[proposer_hex] = entry

    def _serialize_conflicts(self, conflicts) -> str:
        """
        JSON-string serialization of a ConstitutionalConflict DynArray, for
        ProposalRevision.prior_conflicts_json -- a deliberate choice over a
        structured array field, since revision history is an immutable
        historical record rather than an actively iterated collection,
        and this gives historical records schema independence from any
        future change to ConstitutionalConflict's live shape.
        """
        return json.dumps([
            {"description": c.description, "severity": c.severity}
            for c in conflicts
        ])

    def _write_conflicts(self, proposal_id_str: str, raw_conflicts: list) -> None:
        """
        Shared write path for populating proposal_conflicts from raw AI
        output, used identically by submit_proposal (fresh conflicts array)
        and resubmit_proposal (cleared and rewritten). Applies
        MAX_CONFLICTS_PER_AUDIT truncation here, at the point AI output is
        first written to storage -- this is the single, authoritative cap
        point; resubmit_proposal's revision snapshot reads FROM this
        already-capped array, never applying its own separate cap.

        Truncation safety note: the AI-decision consensus check in
        _audit_proposal_logic compares only the "decision" field between
        leader and validator, never "constitutional_conflicts" -- so this
        list's content, ordering, and this truncation are not part of the
        nondet consensus-critical path, and applying a deterministic cap
        here, once, on the single already-agreed result, introduces no new
        leader/validator mismatch risk.
        """
        conflict_arr = self.proposal_conflicts.get_or_insert_default(proposal_id_str)
        while len(conflict_arr) > 0:
            conflict_arr.pop()
        capped = raw_conflicts[:MAX_CONFLICTS_PER_AUDIT]
        for c in capped:
            if isinstance(c, dict):
                conflict_arr.append(ConstitutionalConflict(
                    description=str(c.get("description", "")),
                    severity=str(c.get("severity", "")),
                ))

    def _audit_proposal_logic(
        self,
        title: str,
        description: str,
        constitution: str,
        proposal_type: str = PROPOSAL_TYPE_STANDARD,
        proposed_constitution: str = "",
    ) -> dict:
        """
        Nondet AI audit. Custom run_nondet_unsafe validator pattern,
        strict decision-field match between leader and validator: GenVM's
        nondeterministic execution requires leader and validator outputs
        to agree on the fields that drive consensus-critical state
        changes, so only the "decision" field is compared -- see
        _write_conflicts' own docstring for why the conflict list itself
        is deliberately excluded from that comparison.

        The requested JSON shape's conflict-entry fields are
        "description"/"severity", matching ConstitutionalConflict's own
        declared field names -- the prompt must ask the AI to produce a
        severity level, not a free-text violation explanation, or the
        field could never be populated with data matching its own
        declared meaning.
        """
        def audit_nondet() -> dict:
            if proposal_type == PROPOSAL_TYPE_CONSTITUTION:
                task = f"""
            AUDIT CONSTITUTION AMENDMENT

            You are auditing a proposed amendment to an existing governance constitution.
            Your task is to evaluate whether the proposed amendment is valid, coherent,
            and compatible with the spirit of the current constitution.
            Base your analysis ONLY on the content inside the XML tags.

            <title>{title}</title>
            <rationale>{description}</rationale>
            <current_constitution>{constitution}</current_constitution>
            <proposed_amendment>{proposed_constitution}</proposed_amendment>

            Evaluate the amendment on these criteria:
            1. Is the proposed amendment clearly defined and unambiguous?
            2. Does it conflict with or undermine other clauses in the current constitution?
            3. Is there a reasonable governance rationale provided?
            4. Does it introduce security, fairness, or integrity risks?

            If the amendment is clear, coherent, and does not create contradictions: decision = "accept"
            If it needs minor clarification but is fundamentally sound: decision = "revise"
            If it introduces conflicts, risks, or is fundamentally unsound: decision = "reject"

            Respond ONLY with valid JSON in this exact structure:
            {{
                "decision": "accept" | "reject" | "revise",
                "reasoning": "explanation",
                "constitutional_conflicts": [
                    {{"description": "what the conflict is", "severity": "low" | "medium" | "high"}}
                ]
            }}
            """
            else:
                task = f"""
            AUDIT PROPOSAL

            Analyze whether the proposal below violates any clauses of the constitution.
            Base your analysis ONLY on the content inside the XML tags.

            <title>{title}</title>
            <description>{description}</description>
            <constitution>{constitution}</constitution>

            Respond ONLY with valid JSON in this exact structure:
            {{
                "decision": "accept" | "reject" | "revise",
                "reasoning": "explanation",
                "constitutional_conflicts": [
                    {{"description": "what the conflict is", "severity": "low" | "medium" | "high"}}
                ]
            }}
            """
            result = gl.nondet.exec_prompt(task, response_format="json")
            return normalize_ai_output(result, context="audit")

        def validate_audit(leader_result: gl.vm.Result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                leader_data = leader_result.calldata
                validator_data = audit_nondet()
                valid_decisions = {"accept", "reject", "revise"}
                return (
                    leader_data.get("decision") in valid_decisions
                    and validator_data.get("decision") in valid_decisions
                    and leader_data["decision"] == validator_data["decision"]
                )
            except Exception:
                return False

        return gl.vm.run_nondet_unsafe(audit_nondet, validate_audit)

    # -- Public Views: Infrastructure -----------------------------------------

    @gl.public.view
    def is_admin_action_applied(self, action_id: str) -> bool:
        """
        Read-only observability method exposing whether a given action_id
        is already present in applied_admin_action_ids -- i.e. whether it
        has already been successfully pulled and applied. Lets a caller
        check this before spending a transaction on apply_admin_action(),
        rather than discovering a replay-protection revert as the only
        way to find out. This is purely additive: it does not replace,
        weaken, or bypass the actual replay-protection check inside
        apply_admin_action(), which remains the sole authoritative
        enforcement point.
        """
        return self.applied_admin_action_ids.get(action_id, False)

    @gl.public.view
    def is_admin_contract_configured(self) -> bool:
        """
        Returns True iff admin_contract_address has been set via
        set_admin_contract_address (below). Does NOT verify the address
        is reachable or actually a valid GovLayerAdmin instance -- that
        is handled by the fail-closed try/except at each individual
        cross-contract call site (_is_admin_contract_paused, above), not
        here.

        Deployment-tooling compatibility fix (see set_admin_contract_address's
        docstring): admin_contract_address is no longer set by the
        genesis constructor, so this method's False branch is now a
        genuinely reachable, expected state -- immediately after
        deployment, before the one-time setter has been called -- rather
        than the purely defensive, expected-unreachable guard it was
        before this field had no setter at all.
        """
        return len(self.admin_contract_address) >= 10

    @gl.public.write
    def set_admin_contract_address(self, new_admin_contract_address: str) -> None:
        """
        Deployment-tooling compatibility fix: admin_contract_address cannot
        currently be reliably supplied as a genesis constructor argument on
        this deployment path, so it is instead wired here, in a dedicated
        call made once, after deployment.

        Security property, preserved exactly rather than weakened: this
        is callable only by self.deployer (captured natively from
        gl.message.sender_address in __init__, never a constructor
        argument, so it never touches the broken path either) AND only
        once, ever -- is_admin_contract_configured() becoming True is
        permanent and irreversible, identical in effect to a genesis-
        constructor-set, no-setter-exists design. A re-callable setter
        would give the deployer a standing, unilateral ability to repoint
        admin_contract_address at a different contract at any later time
        -- including one the deployer fully controlled -- silently
        bypassing every admin-authorized action this whole protocol's
        authorization model depends on. That is exactly the outcome both
        gates below exist to prevent; neither gate is optional, and their
        relative order (one-time check first, then caller check) means a
        stranger's call fails on the correct, first-checked reason
        regardless of who they are.
        """
        self._require(
            not self.is_admin_contract_configured(),
            "admin_contract_address is already configured: "
            "set_admin_contract_address is a one-time-only wiring call "
            "and is no longer available; the admin contract address is "
            "now permanent"
        )
        self._require(
            gl.message.sender_address == self.deployer,
            "Only the original deployer may call set_admin_contract_address"
        )
        normalized = _normalize_hex_address_string(new_admin_contract_address)
        self._require(
            normalized.lower() != ZERO_ADDRESS_HEX,
            "admin_contract_address cannot be the zero address"
        )
        # Validate it actually parses as a real Address before committing
        # it to storage as a string -- fail fast with a clear error here
        # rather than storing unparseable garbage that would only surface
        # as a raw traceback later, at the first cross-contract call site
        # that tries to use it.
        Address(normalized)
        self.admin_contract_address = normalized

    # -- Proposal Lifecycle ----------------------------------------------------

    @gl.public.write
    def submit_proposal(
        self,
        title: str,
        description: str,
        voting_duration: u64,
        proposal_type: str = PROPOSAL_TYPE_STANDARD,
        proposed_constitution: str = "",
    ) -> None:
        """
        Submits a new proposal for AI audit and, if accepted, voting.

        Constitution-type submission authorization: any address may
        currently submit a constitution-type proposal -- Admin-only
        gating for this is a formally deferred requirement, not a
        discarded one; see this file's module-level comment for why.
        """
        sender = gl.message.sender_address
        sender_hex = sender.as_hex.lower()

        self._require(
            not self._is_admin_contract_paused(),
            "Proposal submission is currently paused by Admin-authorized "
            "action. This is an abuse-containment pause, not an emergency "
            "affecting other governance activity -- voting, disputing, "
            "finalizing, resubmitting, and cancelling remain unaffected."
        )

        self._require(title.strip() != "", "Title cannot be empty")
        self._require(description.strip() != "", "Description cannot be empty")
        self._require(int(voting_duration) != 0, "voting_duration cannot be zero")
        self._require(
            len(title) <= TITLE_MAX_LENGTH and len(description) <= DESCRIPTION_MAX_LENGTH,
            f"Title or description too long (max: {TITLE_MAX_LENGTH} / {DESCRIPTION_MAX_LENGTH} characters)"
        )
        self._require(
            proposal_type in (PROPOSAL_TYPE_STANDARD, PROPOSAL_TYPE_CONSTITUTION),
            f"Invalid proposal_type. Use '{PROPOSAL_TYPE_STANDARD}' or '{PROPOSAL_TYPE_CONSTITUTION}'"
        )
        self._require(
            proposal_type != PROPOSAL_TYPE_CONSTITUTION or proposed_constitution.strip() != "",
            "proposed_constitution cannot be empty for constitution-type proposals"
        )
        self._require(
            int(self.min_voting_duration) <= int(voting_duration) <= int(self.max_voting_duration),
            f"voting_duration must be between {int(self.min_voting_duration)}s "
            f"and {int(self.max_voting_duration)}s "
            f"({int(self.min_voting_duration) // 3600}h - "
            f"{int(self.max_voting_duration) // 86400}d)"
        )

        self._check_proposal_eligibility(sender)
        self._check_rate_limit(sender_hex)

        constitution_snapshot = self.constitution
        audit_result = self._audit_proposal_logic(
            title, description, constitution_snapshot,
            proposal_type, proposed_constitution
        )
        decision = audit_result.get("decision", "reject")

        self.proposal_count = u256(int(self.proposal_count) + 1)
        proposal_id = self.proposal_count
        proposal_id_str = str(proposal_id)

        if decision == "accept":
            initial_status = STATUS_PENDING
        elif decision == "reject":
            initial_status = STATUS_REJECTED
        else:
            initial_status = STATUS_NEEDS_REVISION

        now = self._get_now()
        voting_closes_at = u64(int(now) + int(voting_duration))

        proposal = Proposal(
            proposal_id=proposal_id,
            proposer=sender_hex,
            proposal_type=proposal_type,
            title=title,
            description=description,
            proposed_constitution=proposed_constitution,
            constitution_snapshot=constitution_snapshot,
            status=initial_status,
            failure_reason=FAILURE_REASON_NONE,
            ai_audit_decision=decision,
            ai_audit_reasoning=audit_result.get("reasoning", ""),
            resubmission_count=u256(0),
            votes_yes=u256(0),
            votes_no=u256(0),
            created_at=now,
            voting_closes_at=voting_closes_at,
            voting_duration=voting_duration,
            dispute_stage=u256(0),
        )

        self.proposals[proposal_id_str] = proposal
        self.votes[proposal_id_str] = gl.storage.inmem_allocate(TreeMap[str, VoteRecord])

        self._write_conflicts(proposal_id_str, audit_result.get("constitutional_conflicts", []))

        self._log_proposal_change(
            EVENT_PROPOSAL_CREATED, proposal_id, sender_hex,
            f"Proposal #{proposal_id} (type:{proposal_type} ai:{decision} "
            f"status:{initial_status} closes:{int(voting_closes_at)})"
        )

    @gl.public.write
    def cancel_proposal(self, proposal_id: u256) -> None:
        """
        Cancel a proposal before its voting window closes.

        Proposer-only. There is no Admin unilateral cancellation path --
        this docstring describes only the capability this contract
        actually has.

        A stuck or bad-faith proposal that the proposer will not cancel
        has no forced-resolution path either: the emergency pause
        (is_admin_contract_configured / _is_admin_contract_paused) is
        submission-only and does not act on any already-existing
        proposal, by design -- it is not a remedy for this situation, and
        this docstring does not claim it is.
        """
        sender = gl.message.sender_address
        sender_hex = sender.as_hex.lower()
        proposal_id_str = str(proposal_id)

        self._require(proposal_id_str in self.proposals, "Proposal does not exist")
        proposal = self.proposals[proposal_id_str]

        self._require(
            proposal.status in (STATUS_PENDING, STATUS_NEEDS_REVISION),
            f"Only 'pending' or 'needs_revision' proposals can be cancelled. "
            f"Current status: {proposal.status}"
        )
        self._require(
            proposal.proposer == sender_hex,
            "Only the original proposer can cancel their own proposal"
        )

        proposal.status = STATUS_CANCELLED
        self.proposals[proposal_id_str] = proposal

        self._log_proposal_change(
            EVENT_PROPOSAL_CANCELLED, proposal_id, sender_hex,
            f"Proposal #{proposal_id} cancelled by {sender_hex}"
        )

    @gl.public.write
    def resubmit_proposal(self, proposal_id: u256, new_description: str) -> None:
        """
        Resubmits a 'needs_revision' proposal for a fresh AI audit.

        The re-audit is evaluated against proposal.constitution_snapshot --
        the constitution text captured at the proposal's ORIGINAL
        submission -- not against the live self.constitution. This is
        deliberate: a proposal's constitutional context must not silently
        drift if the constitution is amended while the proposal is still
        mid-lifecycle. This method never re-captures or overwrites
        constitution_snapshot; it is set exactly once, at submit_proposal,
        and carried unchanged through every resubmission and dispute stage
        (see raise_dispute's own docstring for the same treatment there).

        On acceptance, a fresh voting window is opened using the
        proposer's original voting_duration -- see Proposal.voting_duration's
        own field comment for why, and raise_dispute's docstring for the
        identical rule applied there.
        """
        sender = gl.message.sender_address
        sender_hex = sender.as_hex.lower()
        proposal_id_str = str(proposal_id)

        self._require(proposal_id_str in self.proposals, "Proposal does not exist")
        proposal = self.proposals[proposal_id_str]

        self._require(
            proposal.proposer == sender_hex,
            "Only the original proposer can resubmit this proposal"
        )
        self._require(
            proposal.status == STATUS_NEEDS_REVISION,
            f"Only 'needs_revision' proposals can be resubmitted. "
            f"Current status: {proposal.status}"
        )
        self._require(new_description.strip() != "", "New description cannot be empty")
        self._require(
            len(new_description) <= DESCRIPTION_MAX_LENGTH,
            f"Description too long (max: {DESCRIPTION_MAX_LENGTH} characters)"
        )
        self._require(
            int(proposal.resubmission_count) < int(self.max_resubmissions),
            f"Maximum resubmissions ({int(self.max_resubmissions)}) reached for this proposal."
        )
        now = self._get_now()

        # Snapshot BEFORE mutating -- prior_conflicts_json reads the
        # CURRENT proposal_conflicts entry, which was already capped at
        # MAX_CONFLICTS_PER_AUDIT when it was originally written (by
        # submit_proposal or a prior resubmit_proposal call, both of
        # which route through the same _write_conflicts helper) -- the cap
        # is never reapplied here, only read.
        revision = ProposalRevision(
            resubmit_number=proposal.resubmission_count,
            prior_description=proposal.description,
            prior_ai_decision=proposal.ai_audit_decision,
            prior_ai_reasoning=proposal.ai_audit_reasoning,
            prior_conflicts_json=self._serialize_conflicts(
                self.proposal_conflicts.get_or_insert_default(proposal_id_str)
            ),
            revised_at=now,
        )
        self.proposal_revisions.get_or_insert_default(proposal_id_str).append(revision)

        # THEN apply the new state.
        audit_result = self._audit_proposal_logic(
            proposal.title, new_description, proposal.constitution_snapshot, proposal.proposal_type
        )
        decision = audit_result.get("decision", "reject")

        proposal.description = new_description
        proposal.ai_audit_decision = decision
        proposal.ai_audit_reasoning = audit_result.get("reasoning", "")
        proposal.resubmission_count = u256(int(proposal.resubmission_count) + 1)

        self._write_conflicts(proposal_id_str, audit_result.get("constitutional_conflicts", []))

        if decision == "accept":
            # Fresh voting window, using the proposer's own original
            # voting_duration (never max_voting_duration) -- see
            # Proposal.voting_duration's own field comment for why, and
            # raise_dispute's docstring for the identical rule applied
            # there.
            proposal.status = STATUS_PENDING
            proposal.voting_closes_at = u64(int(now) + int(proposal.voting_duration))
        elif decision == "reject":
            proposal.status = STATUS_REJECTED
        else:
            proposal.status = STATUS_NEEDS_REVISION

        self.proposals[proposal_id_str] = proposal

        self._log_proposal_change(
            EVENT_PROPOSAL_RESUBMITTED, proposal_id, sender_hex,
            f"Proposal #{proposal_id} resubmitted (attempt "
            f"{int(proposal.resubmission_count)} of {int(self.max_resubmissions)}, "
            f"ai:{decision}"
            + (f", closes:{int(proposal.voting_closes_at)})" if decision == "accept" else ")")
        )

    # -- Voting ------------------------------------------------------------------

    @gl.public.write
    def vote(self, proposal_id: u256, support: bool) -> None:
        """
        Casts exactly one vote, immutably (INV-V1): one address may cast
        one vote on a proposal; votes cannot be changed, overwritten,
        withdrawn, or recast. A second call from the same address on the
        same proposal is REJECTED, not silently overwritten -- this
        rejects even if the proposal is still open and even if the second
        call's support value matches the first, since the rule is about
        the number of casts, not about whether the outcome would differ.

        Weight is fixed at the single cast moment (VoteRecord.weight) and
        is never recomputed later -- a subsequent balance change does not
        create another opportunity to vote or alter an already-cast vote's
        weight.
        """
        sender = gl.message.sender_address
        sender_hex = sender.as_hex.lower()
        proposal_id_str = str(proposal_id)

        self._require(proposal_id_str in self.proposals, "Proposal does not exist")
        self._check_voting_eligibility(sender)

        proposal = self.proposals[proposal_id_str]
        self._require(
            proposal.status == STATUS_PENDING,
            f"Voting is not open for proposals with status: {proposal.status}"
        )
        now = self._get_now()
        self._require(
            int(now) <= int(proposal.voting_closes_at),
            f"Voting period has closed (closed at Unix {int(proposal.voting_closes_at)})"
        )
        self._require(
            sender_hex not in self.votes[proposal_id_str],
            "Already voted on this proposal. Votes are immutable once cast "
            "and cannot be changed, overwritten, withdrawn, or recast."
        )

        weight = self._vote_weight(sender)
        self.votes[proposal_id_str][sender_hex] = VoteRecord(
            support=support, weight=weight, cast_at=now,
        )
        if support:
            proposal.votes_yes = u256(int(proposal.votes_yes) + int(weight))
        else:
            proposal.votes_no = u256(int(proposal.votes_no) + int(weight))
        self.proposals[proposal_id_str] = proposal

    @gl.public.write
    def finalize_decision(self, proposal_id: u256) -> None:
        """
        Sets status and failure_reason per a fixed precedence: quorum is
        checked first, then threshold, then (defensively) audit-mismatch.
        Only one failure_reason is ever recorded even if a proposal would
        fail more than one check simultaneously -- this ordering is
        low-stakes to decide because failure_reason is diagnostic only
        and does not gate appealability at all.

        There is no "audit_mismatch" status value: every code path that
        can set status to STATUS_PENDING -- submit_proposal,
        resubmit_proposal, and raise_dispute's accept branch -- also sets
        ai_audit_decision to "accept" in that same call. A proposal can
        only ever reach finalize_decision (which requires status ==
        STATUS_PENDING) with ai_audit_decision already equal to "accept",
        regardless of which of these three paths put it there. This is
        therefore enforced as a hard defensive assertion rather than a
        soft status branch: if this invariant is ever violated by a
        future change elsewhere in this file, this raises loudly rather
        than silently producing a result that would misrepresent a
        genuine state-machine corruption as an ordinary governance
        outcome.
        """
        proposal_id_str = str(proposal_id)
        self._require(proposal_id_str in self.proposals, "Proposal does not exist")

        proposal = self.proposals[proposal_id_str]
        self._require(
            proposal.status == STATUS_PENDING,
            "Proposal is not in a finalizable state"
        )
        now = self._get_now()
        self._require(
            int(now) > int(proposal.voting_closes_at),
            f"Voting period has not yet closed (closes at Unix {int(proposal.voting_closes_at)})"
        )

        total_votes = int(proposal.votes_yes) + int(proposal.votes_no)
        quorum_met = total_votes >= int(self.min_quorum)

        if not quorum_met:
            proposal.status = STATUS_FAILED
            proposal.failure_reason = FAILURE_REASON_QUORUM_NOT_MET
            self.proposals[proposal_id_str] = proposal
            self._log_proposal_change(
                EVENT_PROPOSAL_FAILED, proposal_id, proposal.proposer,
                f"Proposal #{proposal_id} failed: quorum not met "
                f"({total_votes} votes, required {int(self.min_quorum)})"
            )
            return

        approval_ratio = (int(proposal.votes_yes) * 100) // total_votes
        threshold_met = approval_ratio >= int(self.approval_threshold_percent)

        if not threshold_met:
            proposal.status = STATUS_FAILED
            proposal.failure_reason = FAILURE_REASON_THRESHOLD_NOT_MET
            self.proposals[proposal_id_str] = proposal
            self._log_proposal_change(
                EVENT_PROPOSAL_FAILED, proposal_id, proposal.proposer,
                f"Proposal #{proposal_id} failed: approval threshold not met "
                f"({approval_ratio}% < {int(self.approval_threshold_percent)}%)"
            )
            return

        # Defensive invariant assertion -- see this method's own docstring
        # for why this is structurally unreachable rather than a soft
        # audit_mismatch status assignment.
        if proposal.ai_audit_decision != "accept":
            raise gl.vm.UserError(
                "Internal invariant violated: a proposal reached "
                "finalize_decision with ai_audit_decision != 'accept'. "
                "This should be structurally impossible -- see "
                "finalize_decision's docstring."
            )

        if proposal.proposal_type == PROPOSAL_TYPE_CONSTITUTION:
            proposal.status = STATUS_PENDING_CONSTITUTION_CONFIRM
            self.proposals[proposal_id_str] = proposal
            self._log_proposal_change(
                EVENT_CONSTITUTION_UPDATE_PENDING_CONFIRM, proposal_id, proposal.proposer,
                f"Proposal #{proposal_id} vote-accepted; awaiting Admin-authorized confirmation"
            )
        else:
            proposal.status = STATUS_PASSED
            proposal.failure_reason = FAILURE_REASON_NONE
            self.proposals[proposal_id_str] = proposal
            self._log_proposal_change(
                EVENT_PROPOSAL_PASSED, proposal_id, proposal.proposer,
                f"Proposal #{proposal_id} passed ({approval_ratio}% approval)"
            )

    # -- Dispute Resolution --------------------------------------------------------

    @gl.public.write
    def raise_dispute(self, proposal_id: u256, reason: str) -> None:
        """
        Appeal-eligibility gate: status == "rejected" ONLY. AI-rejected
        proposals remain appealable (the proposer is challenging the
        AI's judgment); a post-vote "failed" proposal is never
        appealable, regardless of failure_reason -- that is a
        governance-process outcome, not an AI decision, and there is
        nothing to appeal. failure_reason exists purely as a diagnostic
        explanation of a failure, never as an eligibility signal.

        Caller eligibility: proposer or a voter on this proposal.
        Admin-initiated disputes are a formally deferred capability, not
        a discarded one -- see this file's module-level comment.
        """
        sender = gl.message.sender_address
        sender_hex = sender.as_hex.lower()
        proposal_id_str = str(proposal_id)

        self._require(proposal_id_str in self.proposals, "Proposal does not exist")
        proposal = self.proposals[proposal_id_str]

        is_proposer = proposal.proposer == sender_hex
        is_voter = sender_hex in self.votes[proposal_id_str]
        self._require(
            is_proposer or is_voter,
            "Only the proposer or a voter on this proposal can raise a dispute"
        )
        self._require(
            proposal.status == STATUS_REJECTED,
            f"Disputes can only be raised on AI-rejected proposals. "
            f"Current status: {proposal.status}. A post-vote 'failed' "
            f"proposal is a governance-process outcome, not an AI "
            f"judgment, and is not disputable."
        )
        self._require(
            int(proposal.dispute_stage) < int(self.max_dispute_stages_count),
            f"Maximum dispute stages ({int(self.max_dispute_stages_count)}) "
            f"already reached for this proposal"
        )
        self._require(reason.strip() != "", "Dispute reason cannot be empty")

        now = self._get_now()
        cooldown = int(self.dispute_cooldown_seconds)
        existing_disputes = self.proposal_disputes.get_or_insert_default(proposal_id_str)
        if len(existing_disputes) > 0:
            last_dispute_at = int(existing_disputes[len(existing_disputes) - 1].raised_at)
            self._require(
                int(now) - last_dispute_at >= cooldown,
                f"Dispute cooldown active. Next dispute allowed after Unix "
                f"{last_dispute_at + cooldown} ({cooldown // 3600}h cooldown "
                f"between stages)."
            )

        proposal.status = STATUS_UNDER_REVIEW
        proposal.dispute_stage = u256(int(proposal.dispute_stage) + 1)
        stage = int(proposal.dispute_stage)
        self.proposals[proposal_id_str] = proposal

        title_mem = proposal.title
        description_mem = proposal.description
        # Evaluated against the proposal's ORIGINAL constitution_snapshot,
        # not the live self.constitution -- same "no silent constitutional
        # drift mid-lifecycle" rationale as resubmit_proposal. A dispute
        # is a re-evaluation of the ORIGINAL audit's correctness; it must
        # judge against the same constitutional context that audit
        # actually used, not whatever the constitution happens to read
        # today.
        constitution_mem = proposal.constitution_snapshot
        reason_mem = reason

        def resolve_dispute_nondet() -> dict:
            # Decision-only / stripped context, deliberately a permanent
            # constraint: prior dispute reasoning/context is never fed
            # into a later stage's prompt here, to avoid reintroducing
            # prompt-injection surface via accumulated AI-authored text.
            # Do not add prior stage reasoning to this prompt without
            # reviewing that constraint first.
            prompt_complexity = (
                "Perform a scrupulous re-evaluation of the original audit."
                if stage == 1
                else "Simulate a panel of 3 independent legal AI agents and provide a final consensus decision."
            )
            task = f"""
            DISPUTE RESOLUTION - STAGE {stage}

            {prompt_complexity}

            Evaluate ONLY the content inside the XML tags below.

            <proposal_id>{proposal_id}</proposal_id>
            <title>{title_mem}</title>
            <description>{description_mem}</description>
            <constitution>{constitution_mem}</constitution>
            <dispute_reason>{reason_mem}</dispute_reason>

            Respond ONLY with valid JSON in this exact structure:
            {{
                "decision": "accept" | "reject",
                "reasoning": "comprehensive resolution explanation"
            }}
            """
            result = gl.nondet.exec_prompt(task, response_format="json")
            return normalize_ai_output(result, context="dispute")

        def validate_dispute(leader_result: gl.vm.Result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                leader_data = leader_result.calldata
                validator_data = resolve_dispute_nondet()
                valid_decisions = {"accept", "reject"}
                return (
                    leader_data.get("decision") in valid_decisions
                    and validator_data.get("decision") in valid_decisions
                    and leader_data["decision"] == validator_data["decision"]
                )
            except Exception:
                return False

        resolution = gl.vm.run_nondet_unsafe(resolve_dispute_nondet, validate_dispute)
        dispute_decision = resolution.get("decision", "reject")

        self.proposal_disputes.get_or_insert_default(proposal_id_str).append(DisputeRecord(
            stage=u256(stage),
            raised_by=sender_hex,
            raised_at=now,
            resolution=dispute_decision,
            reasoning=resolution.get("reasoning", ""),
        ))

        proposal = self.proposals[proposal_id_str]
        # ai_audit_decision is updated here to the dispute panel's own
        # decision, superseding the original (now-overridden) audit
        # outcome. This field is documented as reflecting "the AI
        # decision"; a dispute IS a new AI decision, and leaving this
        # stale after a dispute reverses the original outcome would let
        # it silently contradict the proposal's own final status.
        # dispute_decision's vocabulary ("accept" | "reject") is already
        # a subset of ai_audit_decision's own declared domain ("accept" |
        # "reject" | "revise"), so this assignment is always a valid
        # value within the field's existing meaning -- no new vocabulary
        # is introduced.
        proposal.ai_audit_decision = dispute_decision
        proposal.ai_audit_reasoning = (
            f"DISPUTE STAGE {stage} RESOLVED ({dispute_decision.upper()}): "
            f"{resolution.get('reasoning', '')}"
        )

        if dispute_decision == "accept":
            # A successful dispute REOPENS the proposal for a real vote --
            # it does not short-circuit to any final outcome. This mirrors
            # exactly how resubmit_proposal's own "accept" branch already
            # behaves for needs_revision proposals: "accept" always means
            # "eligible to be voted on," never "final outcome reached,"
            # regardless of which stage (original audit, resubmission, or
            # dispute) produced that accept decision. This applies
            # uniformly to both proposal_type values -- a dispute-accepted
            # constitution-type proposal goes through the exact same
            # ordinary voting and finalize_decision() path as any other
            # proposal, and only reaches pending_constitution_confirm if
            # it actually passes a real vote there, identical to a
            # proposal that was never disputed at all.
            #
            # A fresh voting window is opened using the proposer's
            # original voting_duration -- see Proposal.voting_duration's
            # own field comment for the general rule. Reusing the
            # original voting_closes_at timestamp here specifically would
            # be unsafe: that timestamp was fixed at initial submission,
            # before this proposal was ever rejected, and because disputes
            # are cooldown-gated (a mandatory minimum real-world delay
            # between stages), reusing it would in most realistic
            # timelines reopen the proposal into a window that had
            # already elapsed, making a genuine vote impossible.
            proposal.status = STATUS_PENDING
            proposal.voting_closes_at = u64(int(now) + int(proposal.voting_duration))
            self.proposals[proposal_id_str] = proposal
            self._log_proposal_change(
                EVENT_DISPUTE_RESOLVED_REOPENED, proposal_id, proposal.proposer,
                f"Proposal #{proposal_id} dispute-accepted at stage {stage}; "
                f"reopened for voting (closes at Unix {int(proposal.voting_closes_at)})"
            )
        else:
            proposal.status = STATUS_REJECTED
            self.proposals[proposal_id_str] = proposal
            self._log_proposal_change(
                EVENT_DISPUTE_RESOLVED_FAILED, proposal_id, proposal.proposer,
                f"Proposal #{proposal_id} remains rejected at dispute stage {stage}"
            )

    # -- Public Views: Proposals and History --------------------------------------

    @gl.public.view
    def get_proposal(self, proposal_id: u256) -> dict:
        proposal_id_str = str(proposal_id)
        if proposal_id_str not in self.proposals:
            return {}
        p = self.proposals[proposal_id_str]

        conflicts = []
        if proposal_id_str in self.proposal_conflicts:
            conflicts = [
                {"description": c.description, "severity": c.severity}
                for c in self.proposal_conflicts[proposal_id_str]
            ]
        disputes = []
        if proposal_id_str in self.proposal_disputes:
            disputes = [
                {
                    "stage": int(d.stage), "raised_by": d.raised_by,
                    "raised_at": int(d.raised_at), "resolution": d.resolution,
                    "reasoning": d.reasoning,
                }
                for d in self.proposal_disputes[proposal_id_str]
            ]

        return {
            "proposal_id": int(p.proposal_id),
            "proposer": p.proposer,
            "proposal_type": p.proposal_type,
            "title": p.title,
            "description": p.description,
            "proposed_constitution": p.proposed_constitution,
            "constitution_snapshot": p.constitution_snapshot,
            "status": p.status,
            "failure_reason": p.failure_reason,
            "ai_audit_decision": p.ai_audit_decision,
            "ai_audit_reasoning": p.ai_audit_reasoning,
            "constitutional_conflicts": conflicts,
            "resubmission_count": int(p.resubmission_count),
            "votes_yes": int(p.votes_yes),
            "votes_no": int(p.votes_no),
            "created_at": int(p.created_at),
            "voting_closes_at": int(p.voting_closes_at),
            "dispute_stage": int(p.dispute_stage),
            "dispute_history": disputes,
        }

    @gl.public.view
    def list_proposals(self, offset: u256, limit: u256) -> typing.List[dict]:
        """
        Paginated proposal listing. 0-based offset, matching every other
        paginated view in this file. Proposal IDs themselves remain
        1-indexed internally (matches proposal_count's own semantics);
        only the OFFSET parameter is 0-based: offset=0 returns proposals
        starting at proposal_id 1.
        """
        self._require(int(limit) > 0, "limit must be greater than 0")
        total = int(self.proposal_count)
        start_id = int(offset) + 1
        end_id = min(start_id + int(limit), total + 1)
        return [self.get_proposal(u256(i)) for i in range(start_id, end_id)]

    @gl.public.view
    def get_governance_history(self, offset: u256, limit: u256) -> typing.List[dict]:
        """
        Paginated governance history. 0-based offset -- unchanged from v1,
        which was already correct on this point.
        """
        self._require(int(limit) > 0, "limit must be greater than 0")
        total = int(self.governance_history_count)
        start = int(offset)
        end = min(start + int(limit), total)
        result = []
        for i in range(start, end):
            c = self.governance_history[i]
            result.append({
                "event_type": c.event_type,
                "proposal_id": int(c.proposal_id),
                "actor": c.actor,
                "timestamp": int(c.timestamp),
                "details": c.details,
            })
        return result

    @gl.public.view
    def get_proposal_revisions(self, proposal_id: u256, offset: u256, limit: u256) -> typing.List[dict]:
        """
        Paginated, append-only revision history for a single proposal.
        0-based offset, matching every other paginated view in this file.
        """
        self._require(int(limit) > 0, "limit must be greater than 0")
        proposal_id_str = str(proposal_id)
        if proposal_id_str not in self.proposal_revisions:
            return []
        revisions = self.proposal_revisions[proposal_id_str]
        total = len(revisions)
        start = int(offset)
        end = min(start + int(limit), total)
        result = []
        for i in range(start, end):
            r = revisions[i]
            result.append({
                "resubmit_number": int(r.resubmit_number),
                "prior_description": r.prior_description,
                "prior_ai_decision": r.prior_ai_decision,
                "prior_ai_reasoning": r.prior_ai_reasoning,
                "prior_conflicts_json": r.prior_conflicts_json,
                "revised_at": int(r.revised_at),
            })
        return result

    @gl.public.view
    def get_constitution_history(self, offset: u256, limit: u256) -> typing.List[dict]:
        """
        Paginated, append-only constitution version history. 0-based
        offset. Versions are keyed 1..constitution_version internally;
        offset=0 returns version 1 first.
        """
        self._require(int(limit) > 0, "limit must be greater than 0")
        total = int(self.constitution_version)
        start_version = int(offset) + 1
        end_version = min(start_version + int(limit), total + 1)
        result = []
        for v in range(start_version, end_version):
            v_u256 = u256(v)
            if v_u256 not in self.constitution_history:
                continue
            cv = self.constitution_history[v_u256]
            result.append({
                "version": int(cv.version),
                "text": cv.text,
                "adopted_at": int(cv.adopted_at),
                "adopted_via_proposal_id": int(cv.adopted_via_proposal_id),
                "adopted_by": cv.adopted_by,
            })
        return result

    @gl.public.view
    def is_voter_whitelisted(self, address: Address) -> bool:
        return self.voter_whitelist.get(address.as_hex.lower(), False)

    @gl.public.view
    def is_proposer_whitelisted(self, address: Address) -> bool:
        return self.proposer_whitelist.get(address.as_hex.lower(), False)

    @gl.public.view
    def get_voter_whitelist(self, offset: u256, limit: u256) -> typing.List[str]:
        """
        Paginated, 0-based (contract-wide convention). Returns only
        addresses currently whitelisted (True) -- voter_whitelist_list is
        an append-only historical record of every address ever added,
        including any later removed, matching admin_list's own established
        pattern; this view filters it down to the live set, exactly as
        get_admins() does on GovLayerAdmin. Bounded-growth justification:
        whitelist size grows only via the Admin-authorized update_whitelist
        action, which bounds growth to realistic DAO-membership scale, not
        unbounded per-transaction growth -- the same justification already
        accepted for governance_history.
        """
        self._require(int(limit) > 0, "limit must be greater than 0")
        result = []
        skipped = 0
        for addr_hex in self.voter_whitelist_list:
            if not self.voter_whitelist.get(addr_hex, False):
                continue
            if skipped < int(offset):
                skipped += 1
                continue
            if len(result) >= int(limit):
                break
            result.append(addr_hex)
        return result

    @gl.public.view
    def get_proposer_whitelist(self, offset: u256, limit: u256) -> typing.List[str]:
        """Same convention and justification as get_voter_whitelist,
        against the proposer whitelist instead."""
        self._require(int(limit) > 0, "limit must be greater than 0")
        result = []
        skipped = 0
        for addr_hex in self.proposer_whitelist_list:
            if not self.proposer_whitelist.get(addr_hex, False):
                continue
            if skipped < int(offset):
                skipped += 1
                continue
            if len(result) >= int(limit):
                break
            result.append(addr_hex)
        return result

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "admin_contract_address": self.admin_contract_address,
            "constitution_version": int(self.constitution_version),
            "eligibility_mode": self.eligibility_mode,
            "voting_weight_mode": self.voting_weight_mode,
            "voting_token": self.voting_token.as_hex,
            "custom_token_interface_kind": self.custom_token_interface_kind,
            "min_tokens_to_vote": int(self.min_tokens_to_vote),
            "min_tokens_to_propose": int(self.min_tokens_to_propose),
            "use_whitelist_for_voting": self.use_whitelist_for_voting,
            "use_whitelist_for_proposing": self.use_whitelist_for_proposing,
            "min_quorum": int(self.min_quorum),
            "approval_threshold_percent": int(self.approval_threshold_percent),
            "min_voting_duration": int(self.min_voting_duration),
            "max_voting_duration": int(self.max_voting_duration),
            "max_resubmissions": int(self.max_resubmissions),
            "dispute_cooldown_seconds": int(self.dispute_cooldown_seconds),
            "max_dispute_stages_count": int(self.max_dispute_stages_count),
            "max_proposals_per_window": int(self.max_proposals_per_window),
            "proposal_rate_window_secs": int(self.proposal_rate_window_secs),
            "proposal_count": int(self.proposal_count),
            "governance_history_count": int(self.governance_history_count),
        }
