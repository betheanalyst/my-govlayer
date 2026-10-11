"""Mutation smoke test: re-introduce each fixed defect into a temporary copy of the
contracts and confirm the test suite FAILS. A surviving mutant means a fix is not
actually protected by a test.

    python tests/tools/mutation_check.py

Each mutation is an exact-text replacement; the script aborts if the text it
expects to change is no longer present (so it cannot silently go stale)."""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
C, A = "govlayercore.py", "govlayeradmin.py"

MUTANTS = [
    # ---- Ordering and expiry of applied Admin actions
    ("Ordering check removed", C, 'if family != "" and order_key <= self.applied_order_key.get(family, ""):', 'if False:'),
    ("Order key ignores ready_at", C, 'order_key = f"{ready_at:012d}|{action_id}"', 'order_key = f"{0:012d}|{action_id}"'),
    ("Order key never recorded", C, '            self.applied_order_key[family] = order_key\n', '            pass\n'),
    ("Whitelist targets share one family", C, 'return action_type + ":" + target', 'return action_type'),
    ("Core expiry removed", C, 'if ready_at <= 0 or int(now) > ready_at + ACTION_VALIDITY_WINDOW_SECONDS:', 'if ready_at <= 0:'),
    ("Core expiry off by one", C, 'int(now) > ready_at + ACTION_VALIDITY_WINDOW_SECONDS', 'int(now) >= ready_at + ACTION_VALIDITY_WINDOW_SECONDS'),
    ("Admin expiry removed", A, 'if int(now) > int(action.ready_at) + ACTION_VALIDITY_WINDOW_SECONDS:', 'if False:'),
    ("Admin expiry off by one", A, 'if int(now) > int(action.ready_at) + ACTION_VALIDITY_WINDOW_SECONDS:', 'if int(now) >= int(action.ready_at) + ACTION_VALIDITY_WINDOW_SECONDS:'),
    ("Validity windows differ between Core and Admin", A, 'ACTION_VALIDITY_WINDOW_SECONDS: int = 604800', 'ACTION_VALIDITY_WINDOW_SECONDS: int = 86400'),
    # ---- Quorum counts distinct voters in every weighting mode
    ("Quorum counts weight instead of voters", C, 'quorum_met = voters >= int(proposal.snap_min_quorum)', 'quorum_met = total_votes >= int(proposal.snap_min_quorum)'),
    ("Voter count never incremented", C, '        proposal.voter_count = u256(int(proposal.voter_count) + 1)\n', ''),
    # ---- Voting rules are frozen per proposal
    ("Vote weight reads the live token", C, 'Address(proposal.snap_voting_token), user,\n                proposal.snap_eligibility_mode', 'self.voting_token, user,\n                proposal.snap_eligibility_mode'),
    ("Eligibility reads the live mode", C, 'mode = proposal.snap_eligibility_mode', 'mode = self.eligibility_mode'),
    ("Eligibility reads the live minimum", C, 'min_tokens = int(proposal.snap_min_tokens_to_vote)', 'min_tokens = int(self.min_tokens_to_vote)'),
    ("Eligibility reads the live token", C, 'Address(proposal.snap_voting_token), user, mode,', 'self.voting_token, user, mode,'),
    ("Token kind not frozen", C, '        proposal.snap_token_interface_kind = self.custom_token_interface_kind\n', ''),
    ("Token not frozen on reopen", C, '        proposal.snap_voting_token = self.voting_token.as_hex.lower()\n', ''),
    ("Weight mode read live instead of frozen", C, 'if proposal.snap_weight_mode == VOTING_WEIGHT_MODE_TOKEN_WEIGHTED:', 'if self.voting_weight_mode == VOTING_WEIGHT_MODE_TOKEN_WEIGHTED:'),
    ("Quorum read live instead of frozen", C, 'int(proposal.snap_min_quorum)', 'int(self.min_quorum)'),
    ("Threshold read live instead of frozen", C, 'approval_ratio >= int(proposal.snap_threshold_percent)', 'approval_ratio >= int(self.approval_threshold_percent)'),
    ("A dispute reopening voting does not refreeze the rules", C, '            self._freeze_voting_rules(proposal)\n            self.proposals[proposal_id_str] = proposal\n            self._log_proposal_change(\n                EVENT_DISPUTE_RESOLVED_REOPENED', '            self.proposals[proposal_id_str] = proposal\n            self._log_proposal_change(\n                EVENT_DISPUTE_RESOLVED_REOPENED'),
    ("A resubmission reopening voting does not refreeze the rules", C, '            self._freeze_voting_rules(proposal)\n        elif decision == "reject":', '        elif decision == "reject":'),
    # ---- Input validation, AI-output handling, token reads and view limits
    ("Threshold floor back to 50 (Core)", C, 'MIN_APPROVAL_THRESHOLD_PERCENT: int = 51', 'MIN_APPROVAL_THRESHOLD_PERCENT: int = 50'),
    ("Threshold floor back to 50 (Admin)", A, 'MIN_APPROVAL_THRESHOLD_PERCENT: int = 51', 'MIN_APPROVAL_THRESHOLD_PERCENT: int = 50'),
    ("Zero-weight votes allowed", C, 'int(weight) > 0,', 'int(weight) >= 0,'),
    ("Unusable audit output recorded", C, 'result.get("decision") != AI_DECISION_ERROR,', 'True,'),
    ("Unusable dispute output recorded", C, 'resolution.get("decision") != AI_DECISION_ERROR,', 'True,'),
    ("Cancel allowed after close", C, 'int(self._get_now()) <= int(proposal.voting_closes_at),\n                "Voting has closed; the proposal can no longer be cancelled. "', 'True,\n                "Voting has closed; the proposal can no longer be cancelled. "'),
    ("Stale amendment check removed", C, 'if int(proposal.constitution_version) != int(self.constitution_version):', 'if False:'),
    ("Resubmit hides the amendment", C, 'proposal.proposal_type, amendment\n        )', 'proposal.proposal_type, ""\n        )'),
    ("Dispute prompt hides the amendment", C, '{amendment_block}\n            <dispute_reason>', '\n            <dispute_reason>'),
    ("Prompt escaping disabled", C, 'return str(text).replace("<", "&lt;").replace(">", "&gt;")', 'return str(text)'),
    ("Dispute reason cap removed", C, 'len(reason) <= MAX_DISPUTE_REASON_LENGTH,', 'True,'),
    ("Amendment cap removed", C, 'len(proposed_constitution) <= MAX_CONSTITUTION_LENGTH,', 'True,'),
    ("Page limit not clamped", C, 'limit = u256(min(int(limit), MAX_PAGE_LIMIT))\n        total = int(self.constitution_version)', 'total = int(self.constitution_version)'),
    ("Wiring not validated", C, 'isinstance(paused_flag, bool) and admin_count >= 1,', 'True,'),
    ("EVM balanceOf read removed", C, 'return u256(first(token).view().balanceOf(user))', 'raise Exception("x")'),
    ("GenVM-native balance read removed", C, 'return u256(gl.get_contract_at(token).view().balance_of(user))', 'raise Exception("x")'),
    ("get_vote always reports not voted", C, 'if pid in self.votes and voter_hex in self.votes[pid]:', 'if False:'),
    # ---- Whitelist updates are ordered per address, never as a whole batch
    ("Whitelist batch ordered as a whole again (the exploit)", C, 'if action_type in (ACTION_CONSTITUTION_UPDATE_PROPOSE, ACTION_UPDATE_WHITELIST):', 'if action_type == ACTION_CONSTITUTION_UPDATE_PROPOSE:'),
    ("Per-address ordering removed", C, 'if order_key <= self.applied_order_key.get(addr_key, ""):', 'if False:'),
    ("Per-address key never recorded", C, '                self.applied_order_key[addr_key] = order_key\n', ''),
    ("Per-address key ignores the target list", C, 'addr_key = f"{ACTION_UPDATE_WHITELIST}:{target}:{addr_hex}"', 'addr_key = f"{ACTION_UPDATE_WHITELIST}:{addr_hex}"'),
    ("Remove no longer wins a same-batch duplicate", C, '                instructions[addr_hex] = False          # remove wins, as above', '                instructions.setdefault(addr_hex, False)'),
    # ---- Constitution snapshot stored by version reference
    ("get_proposal no longer returns the snapshot text", C, '"constitution_snapshot": self._constitution_text_at(p.constitution_version) if with_text else "",', '"constitution_snapshot": "",'),
    ("Snapshot lookup returns the live text, not the version's", C, 'return self.constitution_history[version].text', 'return self.constitution'),
    ("List view returns the heavy text again", C, 'return [self._proposal_view(u256(i), False) for i in range(start_id, end_id)]', 'return [self._proposal_view(u256(i), True) for i in range(start_id, end_id)]'),
    ("List view leaks the amendment text", C, '"proposed_constitution": p.proposed_constitution if with_text else "",', '"proposed_constitution": p.proposed_constitution,'),
    ("List view leaks the snapshot text", C, 'self._constitution_text_at(p.constitution_version) if with_text else "",', 'self._constitution_text_at(p.constitution_version),'),
    ("Resubmit reviews against the live constitution", C, '            self._constitution_text_at(proposal.constitution_version),\n            proposal.proposal_type, amendment', '            self.constitution,\n            proposal.proposal_type, amendment'),
    ("Dispute reviews against the live constitution", C, 'prompt_safe(self._constitution_text_at(proposal.constitution_version))', 'prompt_safe(self.constitution)'),
    ("Version not recorded at submission", C, 'constitution_version=self.constitution_version,', 'constitution_version=u256(1),'),
    ("Stale-amendment check compares live text instead of versions", C, 'if int(proposal.constitution_version) != int(self.constitution_version):', 'if self._constitution_text_at(proposal.constitution_version) != self.constitution:'),
    ("constitution_version key not exposed", C, '            "constitution_version": int(p.constitution_version),\n', ''),
    # ---- The frontend-compatibility guard must notice unreviewed surface changes
    ("surface guard: an unreviewed public method appears", C, '    @gl.public.view\n    def get_vote(', '    @gl.public.view\n    def surprise(self) -> int:\n        return 1\n\n    @gl.public.view\n    def get_vote('),
    ("surface guard: a baseline view key disappears", C, '            "voter_count": int(p.voter_count),\n', ''),
    # ---- pre-existing safety properties the suite must also guard
    ("replay protection removed", C, 'action_id not in self.applied_admin_action_ids,', 'True,'),
    ("double vote allowed", C, 'sender_hex not in self.votes[proposal_id_str],', 'True,'),
    ("Admin proposer may approve own action", A, 'sender_hex != action.proposer,', 'True,'),
    ("Admin timelock skipped", A, 'int(now) >= int(action.ready_at),', 'True,'),
    ("Admin epoch check ignored", A, 'if current_epoch > 0 and int(approved_epoch) == current_epoch:', 'if current_epoch > 0:'),
]


def run_suite(workdir):
    r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-q"],
                       cwd=workdir, capture_output=True, text=True)
    return r.returncode == 0


def main():
    survivors, stale = [], []
    for name, fname, old, new in MUTANTS:
        with tempfile.TemporaryDirectory() as tmp:
            work = os.path.join(tmp, "contracts")
            shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns("__pycache__"))
            path = os.path.join(work, fname)
            src = open(path).read()
            if src.count(old) < 1:
                stale.append(name)
                print(f"  STALE     {name}")
                continue
            open(path, "w").write(src.replace(old, new, 1))
            killed = not run_suite(work)
            print(f"  {'killed  ' if killed else 'SURVIVED'}  {name}")
            if not killed:
                survivors.append(name)
    print(f"\n{len(MUTANTS) - len(survivors) - len(stale)}/{len(MUTANTS)} mutants killed; "
          f"{len(survivors)} survived; {len(stale)} stale")
    sys.exit(1 if survivors or stale else 0)


if __name__ == "__main__":
    main()
