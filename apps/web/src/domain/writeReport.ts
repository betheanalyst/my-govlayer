import type { WriteOutcome } from "@/adapters/client";
import { AppError } from "@/lib/errors";

/**
 * Write outcome reporting (Experience Blueprint section 12).
 *
 * A transaction failure has to explain four things: what was attempted, what the
 * wallet/network did, whether protocol state actually changed, and what happens
 * next. This module turns a `WriteOutcome` into exactly that, as pure data, so
 * the same sentences appear wherever a write is attempted and can be unit
 * tested without a network.
 *
 * The rule it enforces: only `confirmed` may be called recorded. Even then, a
 * caller is expected to have re-read protocol state, because several GovLayer
 * writes finish by taking a decision rather than by doing what the sender
 * intended.
 */

/** A write that was never attempted, because the wallet could not be used. */
export interface NotAttempted {
  readonly kind: "not_attempted";
  readonly error: AppError;
}

export type WriteAttempt = WriteOutcome | NotAttempted;

export interface WriteReport {
  /** What was attempted, in a short human phrase. */
  readonly action: string;
  readonly kind: WriteAttempt["kind"];
  /** Headline stating the network's result, never the intended result. */
  readonly headline: string;
  /** One or two sentences: what happened, and whether state changed. */
  readonly detail: string;
  /** A sentence describing the re-read protocol state, when one was obtained. */
  readonly observed: string | null;
  readonly error: AppError | null;
  readonly hash: string | null;
  /** True only when the transaction finalized and executed without error. */
  readonly recorded: boolean;
  /** True when the write reached the network at all. */
  readonly submitted: boolean;
}

export interface WriteReportInput {
  readonly action: string;
  readonly outcome: WriteAttempt;
  /** What the contract recorded, read back after the write. */
  readonly observed?: string | null;
}

export function buildWriteReport(input: WriteReportInput): WriteReport {
  const { action, outcome } = input;
  const observed = input.observed ?? null;

  switch (outcome.kind) {
    case "confirmed":
      return {
        action,
        kind: outcome.kind,
        recorded: true,
        submitted: true,
        headline: "Recorded on chain",
        detail:
          "The transaction finalized and its execution completed. What the protocol recorded is read back below rather than assumed.",
        observed,
        error: null,
        hash: outcome.hash,
      };

    case "execution_failed":
      return {
        action,
        kind: outcome.kind,
        recorded: false,
        submitted: true,
        headline: "The contract refused this action",
        detail:
          "The transaction reached the network and finalized, but its execution failed, so no change was made.",
        observed,
        error: outcome.error,
        hash: outcome.hash,
      };

    case "not_finalized":
      return {
        action,
        kind: outcome.kind,
        recorded: false,
        submitted: true,
        headline: "Submitted, but finality was not confirmed",
        detail:
          "The transaction was submitted and the network did not confirm finality within the window this interface waits for. Whether protocol state changed is not known from here, so it is not claimed.",
        observed,
        error: outcome.error,
        hash: outcome.hash,
      };

    case "submission_failed":
      return {
        action,
        kind: outcome.kind,
        recorded: false,
        submitted: false,
        headline: "Nothing was submitted",
        detail:
          "The request did not become a transaction, so no protocol state changed.",
        observed: null,
        error: outcome.error,
        hash: null,
      };

    case "not_attempted":
      return {
        action,
        kind: outcome.kind,
        recorded: false,
        submitted: false,
        headline: "Not attempted",
        detail:
          "This action was not sent to the network. No protocol state changed.",
        observed: null,
        error: outcome.error,
        hash: null,
      };
  }
}

/** A write the wallet layer prevented. Kept separate from a network result. */
export function notAttempted(error: AppError): NotAttempted {
  return { kind: "not_attempted", error };
}
