# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from genlayer import *


# -----------------------------------------------------------------------------
# GovLayerAdmin -- GovLayer V2
# -----------------------------------------------------------------------------
#
# This contract is GovLayer V2's multisig/timelock authorization layer: the
# admin set and a proposal/approval/threshold/timelock state machine for
# twelve action types. This file contains no gl.get_contract_at(...) calls of
# any kind, by design (Admin never calls into Core) -- every action
# below that authorizes a GovLayerCore-owned configuration change is applied
# entirely on Core's own side, when Core pulls the executed action. This
# contract never reaches into Core, in either direction, under any
# circumstance.
#
# Action types, all passing through the identical propose -> approve ->
# timelock -> execute state machine, with no fast path for any of them,
# including pause/unpause :
#   - add_admin               (post-bootstrap; bootstrap itself uses a
#                               separate, one-time direct method -- see below)
#   - remove_admin
#   - constitution_update_propose  (authorizes Core to apply a constitution
#                               change Core itself already voted through;
#                               this contract never touches Core's proposal
#                               state -- see _validate_action_now's own
#                               docstring)
#   - set_rate_limit_params    (Admin is the authoritative, governance-
#                               adjustable source; Core holds a synced
#                               working copy it updates only when it later
#                               pulls an executed action of this type)
#   - set_eligibility_mode     (authorizes Core to change eligibility_mode --
#                               Admin holds no copy of this value at all,
#                               structural validation only, same division of
#                               labor as constitution_update_propose)
#   - set_token_rules          (bundles voting_token, min_tokens_to_vote,
#                               min_tokens_to_propose,
#                               custom_token_interface_kind as one action)
#   - set_voting_weight_mode   (genuinely governance-mutable post-genesis)
#   - set_whitelist_enabled    (toggles Core's
#                               use_whitelist_for_voting/proposing)
#   - update_whitelist         (batched add/remove of voter or proposer
#                               whitelist membership -- batched because each
#                               AdminAction costs a full approval-window-
#                               plus-timelock cycle)
#   - set_voting_parameters    (bundles min_quorum,
#                               approval_threshold_percent,
#                               min_voting_duration, max_voting_duration as
#                               one combined action, mirroring
#                               set_token_rules's own combined-field
#                               precedent)
#   - propose_pause / propose_unpause
#
# The one deliberate exception to the state machine above is the
# bootstrap-only add_admin() method below, which is not a member of it at
# all -- see that method's own docstring for why it must exist outside it.


# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

MIN_VALID_TIMESTAMP: int = 1700000000

# Fixed, never governance-adjustable -- no proposal or admin action of any
# type may alter this table. Admin count 1 has no entry:
# bootstrap only, never reaches the proposal system below.
THRESHOLD_TABLE: dict = {2: 2, 3: 2, 4: 3, 5: 3}

# Fixed at genesis, never adjustable post-deployment -- coupled 1:1 with
# THRESHOLD_TABLE's own supported range (2-5); raising this would require
# extending the table too, which this contract deliberately does not
# support.
MAX_ADMINS: int = 5

# Contract-ENFORCED removal floor, not merely a documented recommendation:
# propose_remove_admin() rejects outright below 4 active admins (see that
# method's own docstring).
#
# At a floor of 2, losing a single admin's key would be an unrecoverable
# lockout: reaching 3 (the only way to then remove the dead key) itself
# requires 2-of-2 approval, which the dead key makes impossible to obtain.
# At a floor of 3, losing one admin still leaves 2 live signers, meeting
# THRESHOLD_TABLE's 2-of-3 requirement to add a replacement.
#
# This constant governs only when removal is blocked -- it does not, and
# structurally cannot, prevent the brief post-bootstrap window where
# active_admin_count is legitimately 2 (bootstrap itself only ever reaches 2
# admins; THRESHOLD_TABLE therefore still has a valid entry for 2).
MIN_ADMINS_POST_BOOTSTRAP: int = 3

# Fixed durations, never governance-adjustable, for the same reason the
# threshold table isn't.
APPROVAL_WINDOW_SECONDS: int = 86400   # 24h -- window to gather approvals
TIMELOCK_SECONDS:        int = 86400   # 24h -- reaction window before execute

ACTION_ADD_ADMIN:                  str = "add_admin"
ACTION_REMOVE_ADMIN:               str = "remove_admin"
ACTION_CONSTITUTION_UPDATE_PROPOSE: str = "constitution_update_propose"
ACTION_SET_RATE_LIMIT_PARAMS:      str = "set_rate_limit_params"
ACTION_SET_ELIGIBILITY_MODE:       str = "set_eligibility_mode"
ACTION_SET_TOKEN_RULES:            str = "set_token_rules"
ACTION_SET_VOTING_WEIGHT_MODE:     str = "set_voting_weight_mode"
ACTION_SET_WHITELIST_ENABLED:      str = "set_whitelist_enabled"
ACTION_UPDATE_WHITELIST:           str = "update_whitelist"
ACTION_SET_VOTING_PARAMETERS:      str = "set_voting_parameters"
ACTION_PROPOSE_PAUSE:              str = "propose_pause"
ACTION_PROPOSE_UNPAUSE:            str = "propose_unpause"

STATUS_PENDING_APPROVALS: str = "pending_approvals"
STATUS_TIMELOCKED:        str = "timelocked"
STATUS_EXECUTED:          str = "executed"
STATUS_EXPIRED:           str = "expired"

ZERO_ADDRESS_HEX: str = "0x0000000000000000000000000000000000000000"

# Structural sanity bounds for set_rate_limit_params proposals. Admin
# validates against these at propose time as a defense-in-depth,
# non-authoritative check; Core independently re-validates when it later
# pulls an executed action of this type and remains the authoritative
# check for its own synced copy.
MIN_PROPOSALS_PER_WINDOW: int = 1
MAX_PROPOSALS_PER_WINDOW: int = 1000
MIN_RATE_WINDOW_SECS:     int = 3600      # 1 hour
MAX_RATE_WINDOW_SECS:     int = 2592000   # 30 days

# Bounds for set_voting_parameters. MIN_QUORUM_FLOOR mirrors GovLayerCore's
# own present default (3) -- governance may raise quorum, never lower it
# below that floor. MIN/MAX_APPROVAL_THRESHOLD_PERCENT bound the pass
# threshold to a majority-or-higher range; 0 or a value below 50 would let
# a proposal pass without genuine majority support, and above 100 is
# nonsensical. MIN_VOTING_DURATION_FLOOR / MAX_VOTING_DURATION_CEILING
# mirror GovLayerCore's own present defaults (3600s / 2592000s) as hard
# bounds, not just defaults -- governance may move within this window,
# never outside it.
MIN_QUORUM_FLOOR:            int = 3
MIN_APPROVAL_THRESHOLD_PERCENT: int = 50
MAX_APPROVAL_THRESHOLD_PERCENT: int = 100
MIN_VOTING_DURATION_FLOOR:   int = 3600      # 1 hour
MAX_VOTING_DURATION_CEILING: int = 2592000   # 30 days

# Structural validation enums for the action types that carry a JSON params
# payload. These MUST match GovLayerCore.py's own VALID_ELIGIBILITY_MODES /
# VALID_VOTING_WEIGHT_MODES / VALID_CUSTOM_TOKEN_INTERFACE_KINDS exactly --
# duplicated deliberately, not imported (no cross-contract import
# mechanism exists on this platform), matching the same convention already
# established for the rate-limit bounds above. Admin validates structural
# well-formedness only ("is this a recognized enum member"); Core
# independently re-validates against its own copy of these same values at
# pull time and remains the sole authority for what actually gets applied
# -- Admin's check here is defense-in-depth, never trusted alone.
VALID_ELIGIBILITY_MODES = ("open", "erc20", "nft", "custom")
VALID_VOTING_WEIGHT_MODES = ("equal", "token_weighted")
VALID_CUSTOM_TOKEN_INTERFACE_KINDS = ("erc20",)
VALID_WHITELIST_TOGGLE_TARGETS = ("voting", "proposing")
VALID_WHITELIST_UPDATE_TARGETS = ("voter", "proposer")

# Defensive bound on update_whitelist's combined add+remove batch size per
# action (matching GovLayerCore.py's own identical constant and rationale):
# an unbounded batch would let a single AdminAction carry an arbitrarily
# large payload, impractical to reason about or gas-bound.
MAX_WHITELIST_BATCH_SIZE: int = 50


# -----------------------------------------------------------------------------
# Storage Dataclass
# -----------------------------------------------------------------------------

@allow_storage
@dataclass
class AdminAction:
    """
    A single administrative action moving through the propose -> approve ->
    timelock -> execute state machine. One record shape for all twelve
    action types -- a small tagged union rather than a separate dataclass
    per type, narrowed to the two generic payload fields this contract's
    action-type set actually needs.

    target_hex is populated only for add_admin/remove_admin (the admin
    address being added or removed) and is "" for every other action type.

    params is a JSON-encoded payload, populated for every other action
    type: constitution_update_propose ({"proposal_id": <int>}),
    set_rate_limit_params ({"max_proposals_per_window": <int>,
    "proposal_rate_window_secs": <int>}), set_eligibility_mode
    ({"eligibility_mode": <str>}), set_token_rules ({"voting_token": <hex
    str>, "min_tokens_to_vote": <int>, "min_tokens_to_propose": <int>,
    "custom_token_interface_kind": <str>}), set_voting_weight_mode
    ({"voting_weight_mode": <str>}), set_whitelist_enabled ({"target":
    "voting"|"proposing", "enabled": <bool>}), update_whitelist
    ({"target": "voter"|"proposer", "add": [<hex str>...], "remove":
    [<hex str>...]}), and set_voting_parameters ({"min_quorum": <int>,
    "approval_threshold_percent": <int>, "min_voting_duration": <int>,
    "max_voting_duration": <int>}) -- and is "" for
    propose_pause/propose_unpause. See each action type's own
    _decode_*_payload method for the single, shared decode path used by
    both validation and execution.

    expires_at and ready_at are both 0 until the corresponding transition
    occurs, then immutable: without expires_at, a PENDING_APPROVALS action
    that never reaches threshold would have no mechanism to ever transition
    out of that state.

    The required-approval threshold itself is never stored on the record:
    it is always recomputed live from the current active_admin_count at the
    moment of each check (see _required_threshold), so a stored, possibly-
    stale threshold value can never be read by mistake.
    """
    action_id:             str
    action_type:            str
    target_hex:              str
    params:                   str
    proposer:                  str
    proposed_at:                 u64
    expires_at:                    u64
    threshold_reached_at:           u64
    ready_at:                         u64
    status:                             str


# -----------------------------------------------------------------------------
# Contract
# -----------------------------------------------------------------------------

class GovLayerAdmin(gl.Contract):
    """
    GovLayer V2 -- Admin contract. Owns protected administrative authority:
    the admin set, the multisig/timelock action state machine, and the
    governance-adjustable safety/rate-limit parameters that GovLayerCore
    consumes. Never owns proposals, votes, disputes, or the constitution --
    those are GovLayerCore's exclusive domain.

    Storage justification, field by field:
      admins                     -- live admin membership, boolean flag per
                                   hex address. See _is_active_admin()'s own
                                   comment for why membership is never a bare
                                   `in` check.
      admin_list                 -- append-only historical record of every
                                   address ever granted a seat, used only for
                                   enumeration in get_admins().
      active_admin_count         -- maintained counter, not derived by
                                   iterating admins or admin_list.
      bootstrap_complete         -- one-way flag, set True the instant the
                                   second admin is added via the bootstrap
                                   add_admin() exception, never reset. Gates
                                   that method's one-time availability and
                                   the multisig pause/unpause methods (which
                                   require a functioning multisig to exist).
      max_admins                 -- fixed at genesis, never adjustable
                                   post-deployment (see MAX_ADMINS constant
                                   comment for why this is a module constant
                                   duplicated into storage rather than a
                                   settable field), initialized once from the
                                   fixed constant and never written again.
      pending_actions             -- one record per action, keyed by
                                   action_id. Required to persist the state
                                   machine across the multi-transaction
                                   propose/approve/execute lifecycle.
      pending_action_count        -- monotonic counter for deterministic
                                   action_id generation (no uuid, per GenVM
                                   restrictions) and for bounding the ID-space
                                   scan in get_pending_actions().
      active_pending_action_count -- live count of actions not yet in a
                                   terminal state (executed/expired),
                                   maintained directly at every transition
                                   rather than derived by iterating every
                                   action ever created.
      admin_epoch                  -- per-admin tenure counter, keyed by
                                   hex address. Incremented every time an
                                   address is GRANTED an admin seat
                                   (bootstrap's add_admin, and execute_
                                   admin_action's ADD_ADMIN branch), and
                                   never touched by removal. This is the
                                   mechanism behind a standing protocol
                                   invariant:

                                     INVARIANT: removal permanently
                                     invalidates every approval that admin
                                     had recorded on any pending action, on
                                     every action, and reinstatement never
                                     resurrects them. An admin removed and
                                     later re-added must approve again from
                                     scratch on any action still pending
                                     from before their removal.

                                   This is enforced without ever scanning
                                   pending_actions at removal or
                                   reinstatement time (which would be an
                                   unbounded-cost operation over however
                                   many actions happen to be pending) --
                                   see action_approvals and
                                   _count_valid_approvals below for the
                                   O(1) mechanism.
      action_approvals             -- one submap per action, keyed by
                                   approving admin's hex address, valued
                                   with the SENDER'S admin_epoch AT THE
                                   MOMENT they approved (not a bare bool).
                                   An approval only still counts if the
                                   admin is currently active AND their
                                   stored epoch still matches their
                                   CURRENT admin_epoch -- i.e., they
                                   approved during their present, unbroken
                                   tenure, not a tenure that has since
                                   ended and restarted. This submap is
                                   re-filtered against current
                                   active_admin_count and current
                                   admin_epoch at every threshold check
                                   (_count_valid_approvals), never trusted
                                   as a frozen count.
      max_proposals_per_window,
      proposal_rate_window_secs,
      max_resubmissions,
      dispute_cooldown_seconds,
      max_dispute_stages_count    -- Admin's authoritative, governance-
                                   adjustable copies of GovLayerCore's
                                   safety/anti-spam parameters.
                                   max_resubmissions,
                                   dispute_cooldown_seconds, and
                                   max_dispute_stages_count carry their
                                   deployment defaults forward unchanged --
                                   no Admin-authorized action type exists
                                   yet to change these three; they exist
                                   here as Admin's authoritative record for
                                   a future action type, should one be
                                   added, and are exposed via
                                   get_rate_limit_params() /
                                   get_dispute_safety_params() for
                                   transparency now.
      paused                      -- emergency, submission-only pause flag.
                                   Lives here, in Admin, not in Core --
                                   Core reads this via a cross-contract
                                   view() call inside submit_proposal();
                                   this contract never writes to Core in
                                   either direction.
    """

    admins:             TreeMap[str, bool]
    admin_list:         DynArray[str]
    active_admin_count: u256
    bootstrap_complete: bool
    max_admins:         u256
    admin_epoch:        TreeMap[str, u256]

    pending_actions:              TreeMap[str, AdminAction]
    pending_action_count:          u256
    active_pending_action_count:    u256
    action_approvals:                TreeMap[str, TreeMap[str, u256]]

    max_proposals_per_window:  u256
    proposal_rate_window_secs: u64
    max_resubmissions:         u256
    dispute_cooldown_seconds:  u64
    max_dispute_stages_count:  u256

    paused: bool

    def __init__(self) -> None:
        deployer_hex = gl.message.sender_address.as_hex.lower()
        self.admins[deployer_hex] = True
        self.admin_list.append(deployer_hex)
        self.active_admin_count = u256(1)
        self.bootstrap_complete = False
        self.max_admins         = u256(MAX_ADMINS)
        # INVARIANT (see class docstring): every address with an active
        # seat has a non-zero admin_epoch, set here and re-set (bumped,
        # never reset) every time a seat is granted. Never touched by
        # removal.
        self.admin_epoch[deployer_hex] = u256(1)

        self.pending_action_count        = u256(0)
        self.active_pending_action_count = u256(0)

        # Deployment defaults, carried forward unchanged (see class docstring).
        self.max_proposals_per_window  = u256(7)
        self.proposal_rate_window_secs = u64(604800)
        self.max_resubmissions         = u256(3)
        self.dispute_cooldown_seconds  = u64(3600)
        self.max_dispute_stages_count  = u256(3)

        self.paused = False

        gl.trace("ADMIN_BOOTSTRAP_INITIALIZED|deployer:" + deployer_hex)

    # -- Internal Utilities --------------------------------------------------

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(message)

    def _get_now(self) -> u64:
        """
        Read transaction timestamp from GenVM runtime context. Identical
        implementation to GovLayerCore.py's own _get_now() -- duplicated
        verbatim since this helper cannot be shared across contracts on
        this platform.
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

    def _is_active_admin(self, addr_hex: str) -> bool:
        """
        The single, centralized admin-membership check for this entire
        contract. Every method that needs to know "is this address
        currently an admin" must call this helper, never check
        `addr_hex in self.admins` directly.
        """
        return self.admins.get(addr_hex, False)

    def _validate_new_admin_address(self, candidate_address: str) -> str:
        """
        Shared validation for any address about to be granted admin status:
        must parse as a well-formed Address, must not already hold an
        active seat, and must not be the zero address. Returns the
        validated, lowercased hex form. Reusable by the bootstrap
        add_admin() exception and propose_add_admin() alike, so both paths
        that can grant an admin seat validate identically.
        """
        try:
            candidate = Address(candidate_address)
        except Exception:
            raise gl.vm.UserError(
                f"Invalid address: '{candidate_address[:40]}' is not a "
                f"valid address"
            )
        candidate_hex = candidate.as_hex.lower()
        self._require(
            candidate_hex != ZERO_ADDRESS_HEX,
            "Invalid address: the zero address cannot hold an admin seat"
        )
        self._require(
            not self._is_active_admin(candidate_hex),
            "Already admin: this address already holds an active admin seat"
        )
        return candidate_hex

    def _validate_removal_target(self, candidate_address: str) -> str:
        """
        Shared validation for a remove_admin target: must parse as a
        well-formed Address, and must currently BE an active admin. Returns
        the validated, lowercased hex form.
        """
        try:
            candidate = Address(candidate_address)
        except Exception:
            raise gl.vm.UserError(
                f"Invalid address: '{candidate_address[:40]}' is not a "
                f"valid address"
            )
        candidate_hex = candidate.as_hex.lower()
        self._require(
            self._is_active_admin(candidate_hex),
            "Not an active admin: target does not currently hold an "
            "active admin seat"
        )
        return candidate_hex

    def _required_threshold(self, admin_count: int) -> int:
        """
        Fixed threshold table lookup. Raises if admin_count is outside the
        2-5 range this contract can ever be in once bootstrap is complete --
        a defensive check that should be structurally unreachable, but
        cheap to assert explicitly. See THRESHOLD_TABLE's own comment for
        why this is deliberately a different range than
        MIN_ADMINS_POST_BOOTSTRAP.
        """
        self._require(
            admin_count in THRESHOLD_TABLE,
            f"Invalid admin count: {admin_count} is outside the supported "
            f"range of {min(THRESHOLD_TABLE)} to {max(THRESHOLD_TABLE)}"
        )
        return THRESHOLD_TABLE[admin_count]

    def _count_valid_approvals(self, action_id: str) -> int:
        """
        Counts approvals for an action that are still valid right now.
        Two independent conditions must both hold for a recorded approval
        to count:

          1. The approving address is a currently active admin.
          2. The epoch recorded at approval time still matches that
             admin's CURRENT admin_epoch.

        Condition 2 is what makes removal permanently invalidate an
        admin's prior approvals rather than merely suspending them: if the
        admin is later reinstated, admin_epoch has been bumped, so their
        old, epoch-tagged approval can never match again -- it is
        permanently stale, without this function or removal/reinstatement
        needing to touch action_approvals at all. See the class docstring
        for the full invariant statement.
        """
        count = 0
        for admin_hex, approved_epoch in self.action_approvals[action_id].items():
            if not self._is_active_admin(admin_hex):
                continue
            current_epoch = int(self.admin_epoch.get(admin_hex, 0))
            if current_epoch > 0 and int(approved_epoch) == current_epoch:
                count += 1
        return count

    def _decode_proposal_id_payload(self, params_json: str) -> u256:
        """
        Decodes a constitution_update_propose action's params payload.
        Returns the decoded proposal_id, or u256(0) if params_json does not
        decode to a well-formed, positive-integer proposal_id -- u256(0) is
        never a valid proposal_id (Core's proposal_count starts at 0 and
        proposal_id assignment begins at 1), so it is a safe, unambiguous
        sentinel for "invalid payload" without needing a second return
        value.

        This is the single shared decode path used by both
        _validate_action_now (structural check only, at propose and
        execute time) and GovLayerCore's own independent re-validation
        when it pulls an executed action of this type. Admin decodes this
        payload only to confirm it is well-formed; it never inspects
        GovLayerCore's actual proposal state, which this contract has no
        access to and must never pretend to.
        """
        try:
            decoded = json.loads(params_json)
            proposal_id = int(decoded["proposal_id"])
            if proposal_id <= 0:
                return u256(0)
            return u256(proposal_id)
        except Exception:
            return u256(0)

    def _decode_rate_limit_payload(self, params_json: str):
        """
        Decodes a set_rate_limit_params action's params payload. Returns
        (max_proposals_per_window, proposal_rate_window_secs) as a tuple of
        plain ints if params_json decodes to a well-formed payload within
        the structural sanity bounds (MIN/MAX_PROPOSALS_PER_WINDOW,
        MIN/MAX_RATE_WINDOW_SECS); returns None otherwise. Shared decode
        path for both _validate_action_now and execute_admin_action's
        application branch, so the two can never silently drift apart on
        what "well-formed" means.
        """
        try:
            decoded = json.loads(params_json)
            max_per_window = int(decoded["max_proposals_per_window"])
            window_secs    = int(decoded["proposal_rate_window_secs"])
        except Exception:
            return None
        if not (MIN_PROPOSALS_PER_WINDOW <= max_per_window <= MAX_PROPOSALS_PER_WINDOW):
            return None
        if not (MIN_RATE_WINDOW_SECS <= window_secs <= MAX_RATE_WINDOW_SECS):
            return None
        return (max_per_window, window_secs)

    def _decode_voting_parameters_payload(self, params_json: str):
        """
        Decodes a set_voting_parameters action's params payload -- bundles
        min_quorum, approval_threshold_percent, min_voting_duration,
        max_voting_duration as one combined action, mirroring
        set_token_rules's own combined-field precedent, rather than four
        separate actions. Returns a (min_quorum,
        approval_threshold_percent, min_voting_duration,
        max_voting_duration) tuple of plain ints if params_json decodes
        to a well-formed payload within the structural sanity bounds
        (MIN_QUORUM_FLOOR, MIN/MAX_APPROVAL_THRESHOLD_PERCENT,
        MIN_VOTING_DURATION_FLOOR, MAX_VOTING_DURATION_CEILING, and the
        cross-field max_voting_duration >= min_voting_duration
        requirement -- mirroring the same ordering check
        submit_proposal's own voting_duration bounds check already
        enforces on GovLayerCore), or None otherwise. Shared decode path
        for both _validate_action_now and execute_admin_action's
        application branch, so the two can never silently drift apart on
        what "well-formed" means.
        """
        try:
            decoded = json.loads(params_json)
            min_quorum = int(decoded["min_quorum"])
            approval_threshold_percent = int(decoded["approval_threshold_percent"])
            min_voting_duration = int(decoded["min_voting_duration"])
            max_voting_duration = int(decoded["max_voting_duration"])
        except Exception:
            return None
        if min_quorum < MIN_QUORUM_FLOOR:
            return None
        if not (MIN_APPROVAL_THRESHOLD_PERCENT <= approval_threshold_percent <= MAX_APPROVAL_THRESHOLD_PERCENT):
            return None
        if min_voting_duration < MIN_VOTING_DURATION_FLOOR:
            return None
        if max_voting_duration > MAX_VOTING_DURATION_CEILING:
            return None
        if max_voting_duration < min_voting_duration:
            return None
        return (min_quorum, approval_threshold_percent, min_voting_duration, max_voting_duration)

    def _decode_eligibility_mode_payload(self, params_json: str) -> str:
        """
        Decodes a set_eligibility_mode action's params payload. Returns
        the decoded eligibility_mode string if it is a member of
        VALID_ELIGIBILITY_MODES, or "" (never itself a valid mode)
        otherwise. Shared decode path for _validate_action_now and
        execute_admin_action's application branch.
        """
        try:
            decoded = json.loads(params_json)
            mode = str(decoded["eligibility_mode"])
        except Exception:
            return ""
        if mode not in VALID_ELIGIBILITY_MODES:
            return ""
        return mode

    def _decode_token_rules_payload(self, params_json: str):
        """
        Decodes a set_token_rules action's params payload -- voting_token,
        min_tokens_to_vote, min_tokens_to_propose, and
        custom_token_interface_kind bundled as one action, not four
        separate ones. Returns a dict with all four keys if well-formed
        and structurally valid, or None otherwise. custom_token_interface_kind
        may be "" (unset) or a member of VALID_CUSTOM_TOKEN_INTERFACE_KINDS
        -- this is the one field in this payload restricted to a closed,
        code-defined set rather than freely governance-settable; nothing
        outside that set is ever considered well-formed here.
        """
        try:
            decoded = json.loads(params_json)
            voting_token = str(decoded["voting_token"])
            min_tokens_to_vote = int(decoded["min_tokens_to_vote"])
            min_tokens_to_propose = int(decoded["min_tokens_to_propose"])
            custom_kind = str(decoded.get("custom_token_interface_kind", ""))
        except Exception:
            return None
        try:
            Address(voting_token)
        except Exception:
            return None
        if min_tokens_to_vote < 0 or min_tokens_to_propose < 0:
            return None
        if custom_kind != "" and custom_kind not in VALID_CUSTOM_TOKEN_INTERFACE_KINDS:
            return None
        return {
            "voting_token": voting_token,
            "min_tokens_to_vote": min_tokens_to_vote,
            "min_tokens_to_propose": min_tokens_to_propose,
            "custom_token_interface_kind": custom_kind,
        }

    def _decode_voting_weight_mode_payload(self, params_json: str) -> str:
        """
        Decodes a set_voting_weight_mode action's params payload. Returns
        the decoded voting_weight_mode string if it is a member of
        VALID_VOTING_WEIGHT_MODES, or "" otherwise.
        """
        try:
            decoded = json.loads(params_json)
            mode = str(decoded["voting_weight_mode"])
        except Exception:
            return ""
        if mode not in VALID_VOTING_WEIGHT_MODES:
            return ""
        return mode

    def _decode_whitelist_toggle_payload(self, params_json: str):
        """
        Decodes a set_whitelist_enabled action's params payload. Returns
        (target, enabled) as (str, bool) if well-formed, or None
        otherwise. target must be "voting" or "proposing".
        """
        try:
            decoded = json.loads(params_json)
            target = str(decoded["target"])
            enabled = decoded["enabled"]
        except Exception:
            return None
        if target not in VALID_WHITELIST_TOGGLE_TARGETS:
            return None
        if not isinstance(enabled, bool):
            return None
        return (target, enabled)

    def _decode_whitelist_update_payload(self, params_json: str):
        """
        Decodes an update_whitelist action's params payload. Returns a
        dict with "target", "add", and "remove" keys if well-formed, or
        None otherwise. target must be "voter" or "proposer"; add/remove
        must each be lists of strings that parse as valid Addresses, with
        combined length bounded by MAX_WHITELIST_BATCH_SIZE -- batched
        deliberately: a DAO populating even a modest whitelist one
        address per action, each costing a full approval-window-plus-
        timelock cycle, would be impractical.
        """
        try:
            decoded = json.loads(params_json)
            target = str(decoded["target"])
            add_list = decoded.get("add", [])
            remove_list = decoded.get("remove", [])
        except Exception:
            return None
        if target not in VALID_WHITELIST_UPDATE_TARGETS:
            return None
        if not isinstance(add_list, list) or not isinstance(remove_list, list):
            return None
        if len(add_list) + len(remove_list) > MAX_WHITELIST_BATCH_SIZE:
            return None
        try:
            validated_add = [Address(a).as_hex.lower() for a in add_list]
            validated_remove = [Address(r).as_hex.lower() for r in remove_list]
        except Exception:
            return None
        return {"target": target, "add": validated_add, "remove": validated_remove}

    def _validate_action_now(self, action_type: str, target_hex: str = "",
                              params_json: str = "") -> bool:
        """
        The single structural/target/range validity check for all twelve
        action types, used identically at proposal creation ("would this
        be valid if executed right now?") and at execution time ("is this
        still valid given current state?") -- sharing one implementation so
        the two checks can never silently drift apart. Returns True/False
        rather than raising, since the two call sites react differently to
        failure: creation rejects outright (raises), execution instead
        expires the action gracefully (see execute_admin_action below).

        Validates ONLY Admin-owned state: this function never references
        GovLayerCore storage of any kind, under any action type.
        set_rate_limit_params, set_eligibility_mode, set_token_rules,
        set_voting_weight_mode, set_whitelist_enabled, update_whitelist,
        and set_voting_parameters all mutate GovLayerCore-owned state
        exclusively; this function confirms only that each one's payload
        is structurally well-formed (a recognized enum member, a
        parseable address, a non-negative integer, a batch within its
        size bound) -- it does NOT, and structurally cannot, check
        anything about GovLayerCore's actual current state (e.g. whether
        a constitution-update's target proposal still exists and is
        still pending_constitution_confirm). That independent check
        belongs entirely to GovLayerCore, at pull time. Reaching EXECUTED
        status on this contract is Admin's authorization only, never a
        claim that Core's state has already been verified.
        """
        current_count = int(self.active_admin_count)
        if action_type == ACTION_ADD_ADMIN:
            if current_count >= int(self.max_admins):
                return False
            if self._is_active_admin(target_hex):
                return False
            return True
        elif action_type == ACTION_REMOVE_ADMIN:
            if current_count < MIN_ADMINS_POST_BOOTSTRAP + 1:
                # Removing would drop the count below the enforced floor of
                # 3 -- i.e., removal is only ever valid starting from 4
                # admins. See MIN_ADMINS_POST_BOOTSTRAP's own comment for
                # why this is a hard, contract-enforced rule.
                return False
            if not self._is_active_admin(target_hex):
                return False
            return True
        elif action_type == ACTION_CONSTITUTION_UPDATE_PROPOSE:
            return int(self._decode_proposal_id_payload(params_json)) > 0
        elif action_type == ACTION_SET_RATE_LIMIT_PARAMS:
            return self._decode_rate_limit_payload(params_json) is not None
        elif action_type == ACTION_SET_ELIGIBILITY_MODE:
            return self._decode_eligibility_mode_payload(params_json) != ""
        elif action_type == ACTION_SET_TOKEN_RULES:
            return self._decode_token_rules_payload(params_json) is not None
        elif action_type == ACTION_SET_VOTING_WEIGHT_MODE:
            return self._decode_voting_weight_mode_payload(params_json) != ""
        elif action_type == ACTION_SET_WHITELIST_ENABLED:
            return self._decode_whitelist_toggle_payload(params_json) is not None
        elif action_type == ACTION_UPDATE_WHITELIST:
            return self._decode_whitelist_update_payload(params_json) is not None
        elif action_type == ACTION_SET_VOTING_PARAMETERS:
            return self._decode_voting_parameters_payload(params_json) is not None
        elif action_type == ACTION_PROPOSE_PAUSE:
            # Invalid to propose pausing an already-paused protocol -- same
            # "would this be valid right now" question every other action
            # type answers, just against Admin's own paused flag.
            return not self.paused
        elif action_type == ACTION_PROPOSE_UNPAUSE:
            return self.paused
        else:
            return False

    def _maybe_reach_threshold(self, action_id: str, action: AdminAction, now: u64) -> None:
        """
        Shared transition logic: recompute the current threshold and the
        current count of still-valid approvals, and transition the action
        from pending_approvals to timelocked if the threshold is now met.
        Called both immediately after action creation and after every
        explicit approve_admin_action() call.
        """
        threshold = self._required_threshold(int(self.active_admin_count))
        valid_approvals = self._count_valid_approvals(action_id)
        if valid_approvals >= threshold and action.status == STATUS_PENDING_APPROVALS:
            action.threshold_reached_at = now
            action.ready_at             = u64(int(now) + TIMELOCK_SECONDS)
            action.status               = STATUS_TIMELOCKED
            self.pending_actions[action_id] = action
            gl.trace(
                f"ACTION_THRESHOLD_REACHED|id:{action_id}|"
                f"valid_approvals:{valid_approvals}|threshold:{threshold}|"
                f"ready_at:{int(action.ready_at)}"
            )

    def _make_action_id(self, counter: u256) -> str:
        return f"ACTION-{int(counter):08d}"

    def _create_action(self, action_type: str, target_hex: str = "",
                        params_json: str = "") -> str:
        """
        Shared action-creation bookkeeping for every propose_*() method,
        after each has already performed its own action-specific
        validation. Records the proposer's implicit first approval, then
        runs the same shared threshold check every approve_admin_action()
        call uses.
        """
        now         = self._get_now()
        sender_hex  = gl.message.sender_address.as_hex.lower()
        action_id   = self._make_action_id(self.pending_action_count)
        self.pending_action_count        = u256(int(self.pending_action_count) + 1)
        self.active_pending_action_count = u256(int(self.active_pending_action_count) + 1)

        action = AdminAction(
            action_id             = action_id,
            action_type            = action_type,
            target_hex              = target_hex,
            params                    = params_json,
            proposer                   = sender_hex,
            proposed_at                  = now,
            expires_at                     = u64(int(now) + APPROVAL_WINDOW_SECONDS),
            threshold_reached_at             = u64(0),
            ready_at                           = u64(0),
            status                               = STATUS_PENDING_APPROVALS,
        )
        self.pending_actions[action_id] = action
        # Recorded against the proposer's CURRENT admin_epoch, not a bare
        # True -- see _count_valid_approvals / class docstring invariant.
        # sender_hex is guaranteed to be a currently active admin at this
        # point (every propose_*() method checks this before calling
        # _create_action), so admin_epoch[sender_hex] is guaranteed
        # non-zero by the standing invariant.
        self.action_approvals.get_or_insert_default(action_id)[sender_hex] = self.admin_epoch[sender_hex]

        gl.trace(
            f"ACTION_CREATED|id:{action_id}|action_type:{action_type}|"
            f"target:{target_hex}|proposer:{sender_hex}|"
            f"expires_at:{int(action.expires_at)}"
        )

        self._maybe_reach_threshold(action_id, action, now)
        return action_id

    # -- Bootstrap -------------------------------------------------------------

    @gl.public.write
    def add_admin(self, new_admin_address: str) -> None:
        """
        Bootstrap exception -- adds the second admin only. No proposal, no
        approval window, no timelock: immediate execution within this
        single transaction.

        This method exists outside the propose/approve/timelock/execute
        state machine entirely, and is not a violation of "every
        AdminAction passes through the identical state machine, no fast
        path" (INV-A4): that invariant governs the ongoing, ordinary
        action set once a functioning multisig exists. Before a second
        admin is ever added, no valid THRESHOLD_TABLE entry exists for a
        1-admin contract (the table's lowest key is 2), so no proposal
        could ever reach threshold from a sole admin in the first place
        -- this method is the structurally necessary, one-time escape
        from that chicken-and-egg state.

        This is the one and only time this method may succeed. The instant
        it does, bootstrap_complete is permanently set to True, and every
        future call to this method is rejected outright, regardless of
        active_admin_count at that time.

        Operational recommendation (not contract-enforced): the deploying
        DAO should propose and execute a 3rd admin promptly after this
        call completes. Bootstrap ends at exactly 2 active admins, which
        is below the post-bootstrap enforced floor of 3 (see
        MIN_ADMINS_POST_BOOTSTRAP) -- while sitting at 2, the loss of
        either admin's key is an unrecoverable lockout.
        """
        self._require(
            not self.bootstrap_complete,
            "Bootstrap already complete: add_admin's bootstrap exception "
            "is a one-time-only path and is no longer available; "
            "post-bootstrap admin additions require propose_add_admin()"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only the current sole admin may add the second admin"
        )
        self._require(
            int(self.active_admin_count) == 1,
            "Invalid bootstrap state: expected exactly one active admin"
        )

        new_hex = self._validate_new_admin_address(new_admin_address)

        self.admins[new_hex] = True
        self.admin_list.append(new_hex)
        self.active_admin_count = u256(2)
        self.bootstrap_complete = True
        self.admin_epoch[new_hex] = u256(int(self.admin_epoch.get(new_hex, 0)) + 1)

        gl.trace("BOOTSTRAP_ADMIN_ADDED|added:" + new_hex + "|by:" + sender_hex)
        gl.trace(
            "BOOTSTRAP_COMPLETE|admin_count:2|multisig and timelock now "
            "govern every future admin-set change"
        )

    # -- Multisig Proposals ------------------------------------------------------

    @gl.public.write
    def propose_add_admin(self, target_address: str) -> str:
        """
        Propose adding a new admin (the 3rd, 4th, or 5th seat -- the 2nd is
        added only via the bootstrap add_admin() exception above). Full
        multisig + timelock flow. Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_add_admin is not available "
            "during the single-admin bootstrap phase; use add_admin instead"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose adding an admin"
        )
        target_hex = self._validate_new_admin_address(target_address)
        self._require(
            self._validate_action_now(ACTION_ADD_ADMIN, target_hex),
            "Proposal invalid: adding this admin would exceed max_admins, "
            "or the target already holds an active seat"
        )
        return self._create_action(ACTION_ADD_ADMIN, target_hex)

    @gl.public.write
    def propose_remove_admin(self, target_address: str) -> str:
        """
        Propose removing an existing admin. Full multisig + timelock flow.
        Blocked at creation time if removal would drop active_admin_count
        below the enforced floor of 3 (see MIN_ADMINS_POST_BOOTSTRAP).
        Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_remove_admin is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose removing an admin"
        )
        target_hex = self._validate_removal_target(target_address)
        self._require(
            self._validate_action_now(ACTION_REMOVE_ADMIN, target_hex),
            f"Proposal invalid: removal is only permitted starting from "
            f"{MIN_ADMINS_POST_BOOTSTRAP + 1} active admins currently present"
        )
        return self._create_action(ACTION_REMOVE_ADMIN, target_hex)

    @gl.public.write
    def propose_constitution_update(self, proposal_id: u256) -> str:
        """
        Propose authorizing GovLayerCore to apply a constitution update
        that has already passed Core's own vote and reached
        pending_constitution_confirm status there. This contract records
        only that proposal_id as a structurally well-formed payload -- it
        never reads or references Core's actual proposal state (Core has
        no address on file here and this contract makes no cross-contract
        calls of any kind, by design). The independent check of whether
        this proposal_id is still valid on Core happens entirely on Core's
        side, at pull time.

        Full multisig + timelock flow. Resulting action_type is
        "constitution_update_propose". Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_constitution_update is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a constitution "
            "update authorization"
        )
        self._require(
            int(proposal_id) > 0,
            "Invalid proposal_id: must be a positive integer"
        )
        params_json = json.dumps({"proposal_id": int(proposal_id)})
        self._require(
            self._validate_action_now(ACTION_CONSTITUTION_UPDATE_PROPOSE, "", params_json),
            "Proposal invalid: malformed proposal_id payload"
        )
        return self._create_action(ACTION_CONSTITUTION_UPDATE_PROPOSE, "", params_json)

    @gl.public.write
    def propose_set_rate_limit_params(self, max_proposals_per_window: u256,
                                       proposal_rate_window_secs: u64) -> str:
        """
        Propose updating the authoritative rate-limit parameters. Full
        multisig + timelock flow. Once executed, Admin's own
        max_proposals_per_window / proposal_rate_window_secs are updated
        immediately (this contract applies its own parameter directly,
        unlike constitution_update_propose); GovLayerCore's separately-
        held synced copy is updated later, when Core pulls this executed
        action. Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_set_rate_limit_params is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a rate-limit "
            "parameter update"
        )
        params_json = json.dumps({
            "max_proposals_per_window": int(max_proposals_per_window),
            "proposal_rate_window_secs": int(proposal_rate_window_secs),
        })
        self._require(
            self._validate_action_now(ACTION_SET_RATE_LIMIT_PARAMS, "", params_json),
            f"Proposal invalid: max_proposals_per_window must be between "
            f"{MIN_PROPOSALS_PER_WINDOW} and {MAX_PROPOSALS_PER_WINDOW}, "
            f"proposal_rate_window_secs must be between "
            f"{MIN_RATE_WINDOW_SECS} and {MAX_RATE_WINDOW_SECS}"
        )
        return self._create_action(ACTION_SET_RATE_LIMIT_PARAMS, "", params_json)

    @gl.public.write
    def propose_set_eligibility_mode(self, new_eligibility_mode: str) -> str:
        """
        Propose changing GovLayerCore's eligibility_mode. Full multisig +
        timelock flow. This contract never applies this itself -- reaching
        executed status is the authorization only; GovLayerCore applies
        it when it pulls this action, mirroring constitution_update_propose's
        own division of labor, not set_rate_limit_params' (which Admin
        also applies to its own copy). Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_set_eligibility_mode is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose an eligibility "
            "mode change"
        )
        params_json = json.dumps({"eligibility_mode": new_eligibility_mode})
        self._require(
            self._validate_action_now(ACTION_SET_ELIGIBILITY_MODE, "", params_json),
            f"Proposal invalid: eligibility_mode must be one of "
            f"{VALID_ELIGIBILITY_MODES}"
        )
        return self._create_action(ACTION_SET_ELIGIBILITY_MODE, "", params_json)

    @gl.public.write
    def propose_set_token_rules(self, voting_token: str, min_tokens_to_vote: u256,
                                 min_tokens_to_propose: u256,
                                 custom_token_interface_kind: str = "") -> str:
        """
        Propose updating GovLayerCore's combined token-eligibility
        configuration (voting_token, min_tokens_to_vote,
        min_tokens_to_propose, custom_token_interface_kind) as one action.
        Full multisig + timelock flow. GovLayerCore-applied only, same
        division of labor as propose_set_eligibility_mode above. Returns
        the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_set_token_rules is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a token-rules "
            "update"
        )
        params_json = json.dumps({
            "voting_token": voting_token,
            "min_tokens_to_vote": int(min_tokens_to_vote),
            "min_tokens_to_propose": int(min_tokens_to_propose),
            "custom_token_interface_kind": custom_token_interface_kind,
        })
        self._require(
            self._validate_action_now(ACTION_SET_TOKEN_RULES, "", params_json),
            "Proposal invalid: voting_token must be a valid address, "
            "min_tokens_to_vote/min_tokens_to_propose must be non-negative, "
            f"and custom_token_interface_kind (if set) must be one of "
            f"{VALID_CUSTOM_TOKEN_INTERFACE_KINDS}"
        )
        return self._create_action(ACTION_SET_TOKEN_RULES, "", params_json)

    @gl.public.write
    def propose_set_voting_weight_mode(self, new_voting_weight_mode: str) -> str:
        """
        Propose changing GovLayerCore's voting_weight_mode -- genuinely
        governance-mutable post-genesis, same lifecycle as
        eligibility_mode. Full multisig + timelock flow. GovLayerCore-
        applied only. Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_set_voting_weight_mode is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a voting-weight "
            "mode change"
        )
        params_json = json.dumps({"voting_weight_mode": new_voting_weight_mode})
        self._require(
            self._validate_action_now(ACTION_SET_VOTING_WEIGHT_MODE, "", params_json),
            f"Proposal invalid: voting_weight_mode must be one of "
            f"{VALID_VOTING_WEIGHT_MODES}"
        )
        return self._create_action(ACTION_SET_VOTING_WEIGHT_MODE, "", params_json)

    @gl.public.write
    def propose_set_whitelist_enabled(self, target: str, enabled: bool) -> str:
        """
        Propose enabling/disabling GovLayerCore's voter or proposer
        whitelist gate (target: "voting" | "proposing"). Full multisig +
        timelock flow. GovLayerCore-applied only. Returns the new
        action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_set_whitelist_enabled is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a whitelist "
            "toggle change"
        )
        params_json = json.dumps({"target": target, "enabled": enabled})
        self._require(
            self._validate_action_now(ACTION_SET_WHITELIST_ENABLED, "", params_json),
            f"Proposal invalid: target must be one of "
            f"{VALID_WHITELIST_TOGGLE_TARGETS} and enabled must be a boolean"
        )
        return self._create_action(ACTION_SET_WHITELIST_ENABLED, "", params_json)

    @gl.public.write
    def propose_update_whitelist(self, target: str, add_addresses: list,
                                  remove_addresses: list) -> str:
        """
        Propose a batched update to GovLayerCore's voter or proposer
        whitelist membership (target: "voter" | "proposer"). Batched
        deliberately: each AdminAction costs a full
        24h-approval-window-plus-24h-timelock cycle, so a DAO populating
        even a modest whitelist one address per action would be
        impractical. Combined add+remove batch size is bounded by
        MAX_WHITELIST_BATCH_SIZE. Full multisig + timelock flow.
        GovLayerCore-applied only. Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_update_whitelist is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a whitelist "
            "membership update"
        )
        params_json = json.dumps({
            "target": target,
            "add": add_addresses,
            "remove": remove_addresses,
        })
        self._require(
            self._validate_action_now(ACTION_UPDATE_WHITELIST, "", params_json),
            f"Proposal invalid: target must be one of "
            f"{VALID_WHITELIST_UPDATE_TARGETS}, every address in add/remove "
            f"must be a valid address, and the combined batch size must "
            f"not exceed {MAX_WHITELIST_BATCH_SIZE}"
        )
        return self._create_action(ACTION_UPDATE_WHITELIST, "", params_json)

    @gl.public.write
    def propose_set_voting_parameters(self, min_quorum: u256, approval_threshold_percent: u256,
                                       min_voting_duration: u64, max_voting_duration: u64) -> str:
        """
        Propose updating GovLayerCore's combined core vote-counting
        parameters -- min_quorum, approval_threshold_percent,
        min_voting_duration, max_voting_duration -- as one action,
        mirroring set_token_rules's own combined-field precedent rather
        than four separate actions. These four fields have no other
        governance path to change them: they are otherwise fixed at
        deployment, unlike every other DAO-configurable parameter in this
        file. This uses the exact same generic authorize-on-Admin /
        apply-on-Core mechanism every other action type here uses -- no
        new state machine, no new authorization model, no change to
        finalize_decision()'s actual quorum/threshold comparison logic on
        GovLayerCore, only to where the VALUES it compares against come
        from.

        Structural bounds (see _decode_voting_parameters_payload):
        min_quorum must be >= MIN_QUORUM_FLOOR (mirrors GovLayerCore's
        own present default -- governance may raise quorum, never below
        this floor); approval_threshold_percent must be between
        MIN_APPROVAL_THRESHOLD_PERCENT and MAX_APPROVAL_THRESHOLD_PERCENT
        (a majority-or-higher pass bar, never above 100); min/max_voting_
        duration must each stay within MIN_VOTING_DURATION_FLOOR /
        MAX_VOTING_DURATION_CEILING (GovLayerCore's own present defaults,
        used here as hard bounds rather than just defaults), and
        max_voting_duration must be >= min_voting_duration -- mirroring
        the identical ordering check submit_proposal's own
        voting_duration bounds check already enforces on GovLayerCore.

        This contract never applies this itself -- reaching executed
        status is the authorization only; GovLayerCore applies it when it
        pulls this action, mirroring set_eligibility_mode's own division
        of labor, not set_rate_limit_params' (which Admin also applies to
        its own copy) -- Admin holds no copy of any of these four values
        at all. Full multisig + timelock flow, no fast path. Returns the
        new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_set_voting_parameters is not "
            "available during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a voting "
            "parameters update"
        )
        params_json = json.dumps({
            "min_quorum": int(min_quorum),
            "approval_threshold_percent": int(approval_threshold_percent),
            "min_voting_duration": int(min_voting_duration),
            "max_voting_duration": int(max_voting_duration),
        })
        self._require(
            self._validate_action_now(ACTION_SET_VOTING_PARAMETERS, "", params_json),
            f"Proposal invalid: min_quorum must be >= {MIN_QUORUM_FLOOR}, "
            f"approval_threshold_percent must be between "
            f"{MIN_APPROVAL_THRESHOLD_PERCENT} and "
            f"{MAX_APPROVAL_THRESHOLD_PERCENT}, min_voting_duration must "
            f"be >= {MIN_VOTING_DURATION_FLOOR}, max_voting_duration must "
            f"be <= {MAX_VOTING_DURATION_CEILING}, and max_voting_duration "
            f"must be >= min_voting_duration"
        )
        return self._create_action(ACTION_SET_VOTING_PARAMETERS, "", params_json)

    @gl.public.write
    def propose_pause(self) -> str:
        """
        Propose pausing new proposal submission on GovLayerCore
        (submission-only gate). Same full multisig + timelock flow as
        every other action type here -- an emergency pause is not exempt
        from the deliberation this contract exists to enforce; this is
        not an instant circuit breaker, and that is deliberate. Rejected
        at creation if already paused. Returns the new action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_pause is not available "
            "during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose a pause"
        )
        self._require(
            self._validate_action_now(ACTION_PROPOSE_PAUSE),
            "Proposal invalid: the protocol is already paused"
        )
        return self._create_action(ACTION_PROPOSE_PAUSE)

    @gl.public.write
    def propose_unpause(self) -> str:
        """
        Propose lifting an active pause. Same full multisig + timelock
        flow -- deliberately not a faster path than propose_pause().
        Rejected at creation if not currently paused. Returns the new
        action_id.
        """
        self._require(
            self.bootstrap_complete,
            "Bootstrap not complete: propose_unpause is not available "
            "during the single-admin bootstrap phase"
        )
        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may propose an unpause"
        )
        self._require(
            self._validate_action_now(ACTION_PROPOSE_UNPAUSE),
            "Proposal invalid: the protocol is not currently paused"
        )
        return self._create_action(ACTION_PROPOSE_UNPAUSE)

    @gl.public.write
    def approve_admin_action(self, action_id: str) -> None:
        """
        Record an explicit approval for a pending action.

        Rejects outright if the action has already reached a terminal
        state (executed or expired). If the 24h approval window has
        elapsed while the action was still pending_approvals, this call
        formalizes that as expired and returns normally without recording
        an approval or raising -- the first such discovery is a graceful
        state-machine transition, not a caller error.

        Each admin may approve a given action at most once per admin
        tenure (see class docstring, admin_epoch): the proposer's own
        creation act already consumed their allowance and they may not
        additionally call this method on their own proposal. An admin
        removed and later reinstated is on a new tenure and may approve
        again -- their prior approval on this action, if any, is by then
        permanently invalid regardless (see _count_valid_approvals).
        """
        self._require(
            action_id in self.pending_actions,
            "Action not found"
        )
        action = self.pending_actions[action_id]
        self._require(
            action.status not in (STATUS_EXECUTED, STATUS_EXPIRED),
            f"Action already finalized: status is {action.status}"
        )

        now = self._get_now()

        if action.status == STATUS_PENDING_APPROVALS and int(now) > int(action.expires_at):
            action.status = STATUS_EXPIRED
            self.pending_actions[action_id] = action
            self.active_pending_action_count = u256(int(self.active_pending_action_count) - 1)
            gl.trace(f"ACTION_EXPIRED|id:{action_id}|reason:approval_window_elapsed")
            return

        self._require(
            action.status == STATUS_PENDING_APPROVALS,
            f"Approvals closed: action is already {action.status}, no "
            f"further approvals are accepted"
        )

        sender_hex = gl.message.sender_address.as_hex.lower()
        self._require(
            self._is_active_admin(sender_hex),
            "Not admin: only a current admin may approve an action"
        )
        self._require(
            sender_hex != action.proposer,
            "Proposer cannot approve own action: the proposer's creation "
            "act already counts as their approval"
        )
        sender_current_epoch = self.admin_epoch[sender_hex]
        already_approved_this_tenure = (
            int(self.action_approvals[action_id].get(sender_hex, u256(0))) == int(sender_current_epoch)
        )
        self._require(
            not already_approved_this_tenure,
            "Already approved: this admin has already approved this "
            "action during their current tenure"
        )

        self.action_approvals.get_or_insert_default(action_id)[sender_hex] = sender_current_epoch
        gl.trace(f"ACTION_APPROVED|id:{action_id}|by:{sender_hex}|epoch:{int(sender_current_epoch)}")

        self._maybe_reach_threshold(action_id, action, now)

    @gl.public.write
    def execute_admin_action(self, action_id: str) -> None:
        """
        Execute an action whose timelock has elapsed. Permissionless --
        any address may call this, not only admins, so liveness never
        depends on a particular admin remembering to submit the final
        transaction.

        Rejects outright if the action is already executed or expired
        (exactly-once execution, no silent no-op replay).

        If still pending_approvals past its approval window, formalizes
        expired (same graceful, first-discovery transition as
        approve_admin_action()). If timelocked but the timelock has not
        yet elapsed, rejects with a clear error. If timelocked and the
        timelock has elapsed, re-runs the full dual-validation check
        against current state and either applies the action (executed) or
        formalizes expired, in both cases persisting the outcome rather
        than raising.

        For add_admin, remove_admin, set_rate_limit_params, propose_pause,
        and propose_unpause, this method applies the action's effect
        directly to this contract's own storage. For
        constitution_update_propose, set_eligibility_mode, set_token_rules,
        set_voting_weight_mode, set_whitelist_enabled, update_whitelist,
        and set_voting_parameters, this method deliberately does nothing
        beyond the status flip to executed -- reaching that status IS the
        authorization; GovLayerCore is solely responsible for pulling
        each of these records and applying them to its own state. Admin
        authorizes, Core applies -- no cross-contract call is made from
        this method, under any action type, ever.
        """
        self._require(
            action_id in self.pending_actions,
            "Action not found"
        )
        action = self.pending_actions[action_id]
        self._require(
            action.status not in (STATUS_EXECUTED, STATUS_EXPIRED),
            f"Action already finalized: status is {action.status}"
        )

        now = self._get_now()

        if action.status == STATUS_PENDING_APPROVALS:
            if int(now) > int(action.expires_at):
                action.status = STATUS_EXPIRED
                self.pending_actions[action_id] = action
                self.active_pending_action_count = u256(int(self.active_pending_action_count) - 1)
                gl.trace(f"ACTION_EXPIRED|id:{action_id}|reason:approval_window_elapsed")
                return
            raise gl.vm.UserError(
                "Threshold not reached: this action has not yet gathered "
                "enough approvals to enter its timelock"
            )

        # status == STATUS_TIMELOCKED from here on.
        self._require(
            int(now) >= int(action.ready_at),
            f"Timelock active: not executable until timestamp {int(action.ready_at)}"
        )

        # Full revalidation against current state -- structural bounds,
        # target state, and current-valid-approval count against the
        # current threshold: a stale approval from an admin removed after
        # this action was timelocked does not count.
        current_threshold  = self._required_threshold(int(self.active_admin_count))
        valid_approvals    = self._count_valid_approvals(action_id)
        structurally_valid = self._validate_action_now(
            action.action_type, action.target_hex, action.params
        )

        if not structurally_valid or valid_approvals < current_threshold:
            action.status = STATUS_EXPIRED
            self.pending_actions[action_id] = action
            self.active_pending_action_count = u256(int(self.active_pending_action_count) - 1)
            gl.trace(
                f"ACTION_EXPIRED|id:{action_id}|reason:revalidation_failed|"
                f"structurally_valid:{structurally_valid}|"
                f"valid_approvals:{valid_approvals}|"
                f"current_threshold:{current_threshold}"
            )
            return

        # Apply the action.
        outcome_detail = ""
        if action.action_type == ACTION_ADD_ADMIN:
            self.admins[action.target_hex] = True
            self.admin_list.append(action.target_hex)
            self.active_admin_count = u256(int(self.active_admin_count) + 1)
            # This is the actual moment a stale, pre-removal approval
            # becomes permanently unable to count again: bumping the
            # epoch here means any approval recorded under a prior epoch
            # can never match self.admin_epoch[target_hex] again, for any
            # action, without touching pending_actions or
            # action_approvals at all. See class docstring invariant.
            self.admin_epoch[action.target_hex] = u256(int(self.admin_epoch.get(action.target_hex, 0)) + 1)
            outcome_detail = f"admin_added:{action.target_hex}|epoch:{int(self.admin_epoch[action.target_hex])}"
        elif action.action_type == ACTION_REMOVE_ADMIN:
            self.admins[action.target_hex] = False
            self.active_admin_count = u256(int(self.active_admin_count) - 1)
            # admin_epoch is deliberately left untouched here -- it is
            # bumped only on (re)admission (above), never on removal.
            # _count_valid_approvals already excludes this admin's
            # approvals immediately via the is_active_admin check alone;
            # the epoch mechanism exists specifically for what happens if
            # they are LATER re-added, not for the removal itself.
            outcome_detail = f"admin_removed:{action.target_hex}"
        elif action.action_type == ACTION_CONSTITUTION_UPDATE_PROPOSE:
            # Core-applied only; see this method's own docstring.
            proposal_id = self._decode_proposal_id_payload(action.params)
            outcome_detail = f"authorized_for_core:proposal_id={int(proposal_id)}"
        elif action.action_type == ACTION_SET_RATE_LIMIT_PARAMS:
            decoded = self._decode_rate_limit_payload(action.params)
            # structurally_valid already confirmed decoded is not None.
            max_per_window, window_secs = decoded
            self.max_proposals_per_window  = u256(max_per_window)
            self.proposal_rate_window_secs = u64(window_secs)
            outcome_detail = (
                f"max_proposals_per_window={max_per_window},"
                f"proposal_rate_window_secs={window_secs}"
            )
        elif action.action_type == ACTION_SET_ELIGIBILITY_MODE:
            # Core-applied only; see this method's own docstring.
            new_mode = self._decode_eligibility_mode_payload(action.params)
            outcome_detail = f"authorized_for_core:eligibility_mode={new_mode}"
        elif action.action_type == ACTION_SET_TOKEN_RULES:
            decoded = self._decode_token_rules_payload(action.params)
            # structurally_valid already confirmed decoded is not None.
            outcome_detail = (
                f"authorized_for_core:voting_token={decoded['voting_token']},"
                f"min_tokens_to_vote={decoded['min_tokens_to_vote']},"
                f"min_tokens_to_propose={decoded['min_tokens_to_propose']},"
                f"custom_token_interface_kind={decoded['custom_token_interface_kind']}"
            )
        elif action.action_type == ACTION_SET_VOTING_WEIGHT_MODE:
            new_mode = self._decode_voting_weight_mode_payload(action.params)
            outcome_detail = f"authorized_for_core:voting_weight_mode={new_mode}"
        elif action.action_type == ACTION_SET_WHITELIST_ENABLED:
            decoded = self._decode_whitelist_toggle_payload(action.params)
            # structurally_valid already confirmed decoded is not None.
            target, enabled = decoded
            outcome_detail = f"authorized_for_core:target={target},enabled={enabled}"
        elif action.action_type == ACTION_UPDATE_WHITELIST:
            decoded = self._decode_whitelist_update_payload(action.params)
            # structurally_valid already confirmed decoded is not None.
            # decoded is a dict ({"target", "add", "remove"}), not a
            # tuple -- must be indexed by key, not unpacked positionally.
            target = decoded["target"]
            add_list = decoded["add"]
            remove_list = decoded["remove"]
            outcome_detail = (
                f"authorized_for_core:target={target},"
                f"add_count={len(add_list)},remove_count={len(remove_list)}"
            )
        elif action.action_type == ACTION_SET_VOTING_PARAMETERS:
            # Core-applied only; see this method's own docstring.
            decoded = self._decode_voting_parameters_payload(action.params)
            # structurally_valid already confirmed decoded is not None.
            min_quorum, approval_threshold_percent, min_voting_duration, max_voting_duration = decoded
            outcome_detail = (
                f"authorized_for_core:min_quorum={min_quorum},"
                f"approval_threshold_percent={approval_threshold_percent},"
                f"min_voting_duration={min_voting_duration},"
                f"max_voting_duration={max_voting_duration}"
            )
        elif action.action_type == ACTION_PROPOSE_PAUSE:
            self.paused = True
            outcome_detail = "paused:True"
        elif action.action_type == ACTION_PROPOSE_UNPAUSE:
            self.paused = False
            outcome_detail = "paused:False"
        else:
            # Structurally unreachable -- action_type is fixed at creation
            # to one of the twelve known constants -- but fail loudly
            # rather than silently applying nothing if it is ever reached.
            raise gl.vm.UserError(f"Unknown action type: {action.action_type}")

        action.status = STATUS_EXECUTED
        self.pending_actions[action_id] = action
        self.active_pending_action_count = u256(int(self.active_pending_action_count) - 1)
        gl.trace(
            f"ACTION_EXECUTED|id:{action_id}|action_type:{action.action_type}|"
            f"target:{action.target_hex}|"
            f"new_admin_count:{int(self.active_admin_count)}|"
            f"outcome:{outcome_detail}"
        )

    # -- Public View Methods -----------------------------------------------------

    @gl.public.view
    def is_admin(self, address_hex: str) -> bool:
        """Check whether a given address currently holds an active admin seat."""
        try:
            addr = Address(address_hex)
        except Exception:
            raise gl.vm.UserError(
                f"Invalid address: '{address_hex[:40]}' is not a valid address"
            )
        return self._is_active_admin(addr.as_hex.lower())

    @gl.public.view
    def get_admins(self) -> list:
        """Active admins, in the order they were originally granted."""
        result = []
        for addr_hex in self.admin_list:
            if self._is_active_admin(addr_hex):
                result.append(addr_hex)
        return result

    @gl.public.view
    def get_active_admin_count(self) -> int:
        """Current number of active admins (O(1))."""
        return int(self.active_admin_count)

    @gl.public.view
    def is_bootstrap_complete(self) -> bool:
        """True once the second admin has ever been added. Permanent."""
        return self.bootstrap_complete

    @gl.public.view
    def get_current_threshold(self) -> int:
        """
        The number of approvals a NEW action would need right now, per the
        fixed threshold table. Informational only -- the actual threshold
        applied to any given action is always recomputed live at the
        moment of each check, never read from this view.
        """
        return self._required_threshold(int(self.active_admin_count))

    @gl.public.view
    def is_paused(self) -> bool:
        """
        Current emergency-pause state. This is the method GovLayerCore
        cross-contract-reads via view() before accepting a new proposal
        submission -- the only method this flag gates.
        """
        return self.paused

    @gl.public.view
    def get_rate_limit_params(self) -> dict:
        """
        Admin's current authoritative rate-limit parameters. This is the
        method GovLayerCore reads from, once, at genesis configuration
        and again whenever it pulls an executed set_rate_limit_params
        action -- Core never reads this live on every submit_proposal()
        call.
        """
        return {
            "max_proposals_per_window": int(self.max_proposals_per_window),
            "proposal_rate_window_secs": int(self.proposal_rate_window_secs),
        }

    @gl.public.view
    def get_dispute_safety_params(self) -> dict:
        """
        Admin's current authoritative copy of the dispute-related safety
        parameters (max_resubmissions, dispute_cooldown_seconds,
        max_dispute_stages_count). No action type currently authorizes
        changing these (see class docstring); exposed here for
        transparency and as the ready point of authority should a future
        action type be added to change them.
        """
        return {
            "max_resubmissions": int(self.max_resubmissions),
            "dispute_cooldown_seconds": int(self.dispute_cooldown_seconds),
            "max_dispute_stages_count": int(self.max_dispute_stages_count),
        }

    @gl.public.view
    def get_action(self, action_id: str) -> dict:
        """
        Full state of a single action, including live-recomputed fields.
        This is the method GovLayerCore's apply_admin_action()
        cross-contract-reads via view() to pull an executed action and
        discover its action_type, proposer, and params -- used identically
        for all eight Core-applied action types (constitution_update_propose,
        set_rate_limit_params, set_eligibility_mode, set_token_rules,
        set_voting_weight_mode, set_whitelist_enabled, update_whitelist,
        set_voting_parameters).
        """
        self._require(action_id in self.pending_actions, "Action not found")
        a = self.pending_actions[action_id]
        return {
            "action_id":             a.action_id,
            "action_type":           a.action_type,
            "target_hex":            a.target_hex,
            "params":                a.params,
            "proposer":              a.proposer,
            "proposed_at":           int(a.proposed_at),
            "expires_at":            int(a.expires_at),
            "threshold_reached_at":  int(a.threshold_reached_at),
            "ready_at":              int(a.ready_at),
            "status":                a.status,
            "valid_approvals_now":   self._count_valid_approvals(action_id),
            "current_threshold":     self._required_threshold(int(self.active_admin_count)),
        }

    @gl.public.view
    def get_pending_actions(self, offset: u256, limit: u256) -> list:
        """
        Paginated list of actions currently in pending_approvals or
        timelocked status (i.e. not yet executed or expired). 0-based
        offset, bounded limit -- the contract-wide pagination convention.

        Still walks the action_id space to find which specific entries are
        currently active, since active entries are not stored
        contiguously; active_pending_action_count is used here only to
        let a caller-side UI know the total active count up front without
        a separate call, and as a fast O(1) short-circuit when it is zero.
        A secondary active-ID index for true O(limit) enumeration was
        explicitly assessed and rejected as unnecessary overhead, given
        GovLayer's inherently low admin-action volume (multisig actions,
        not user transactions).
        """
        self._require(int(limit) > 0, "limit must be greater than 0")
        result = []
        skipped = 0
        count = int(self.pending_action_count)
        if int(self.active_pending_action_count) == 0:
            return result
        for i in range(count):
            action_id = self._make_action_id(u256(i))
            if action_id not in self.pending_actions:
                continue
            a = self.pending_actions[action_id]
            if a.status not in (STATUS_PENDING_APPROVALS, STATUS_TIMELOCKED):
                continue
            if skipped < int(offset):
                skipped += 1
                continue
            if len(result) >= int(limit):
                break
            result.append({
                "action_id":            a.action_id,
                "action_type":          a.action_type,
                "target_hex":           a.target_hex,
                "proposer":             a.proposer,
                "proposed_at":          int(a.proposed_at),
                "expires_at":           int(a.expires_at),
                "ready_at":             int(a.ready_at),
                "status":               a.status,
                "valid_approvals_now":  self._count_valid_approvals(action_id),
            })
        return result
