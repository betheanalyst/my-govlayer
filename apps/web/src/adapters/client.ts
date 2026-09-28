import { createAccount, createClient } from "genlayer-js";
import {
  ExecutionResult,
  TransactionStatus,
  type GenLayerTransaction,
} from "genlayer-js/types";
import {
  getRuntimeConfig,
  ConfigurationError,
  type GovLayerRuntimeConfig,
} from "@/config/env";
import { resolveNetwork, type NetworkPreset } from "@/config/network";
import {
  AppError,
  classifyError,
  extractMessage,
  verificationUncertainty,
} from "@/lib/errors";
import { asTransactionHash, type HexAddress, type TransactionHash } from "@/lib/hex";
import type { Eip1193Provider } from "@/wallet/eip1193";

/**
 * The single GenLayer gateway.
 *
 * Foundation Standard sections 2.5, 2.8, and 8: genlayer-js is the only
 * blockchain entry point; every adapter call goes through this module, and the
 * write path never equates "transaction finalized" with "operation succeeded".
 *
 * Returned values stay `unknown` here on purpose. Mapping into domain models is
 * the mappers' job, so the UI never depends on raw SDK shapes.
 */

export type GenLayerClientInstance = ReturnType<typeof createClient>;

/**
 * A signing account, as genlayer-js models it.
 *
 * Writes require a signer, not a bare address. The wallet layer (a later
 * phase) supplies one; this module never fabricates or stores a key.
 */
export type GenLayerSigner = ReturnType<typeof createAccount>;

export interface ClientOverrides {
  /**
   * Signer for writes. Reads need none.
   *
   * A bare address is also accepted: genlayer-js then routes signing methods
   * (`eth_sendTransaction`, `personal_sign`, ...) through the configured
   * provider instead of signing locally, which is how an EIP-1193 wallet signs.
   */
  readonly account?: GenLayerSigner | HexAddress;
  /**
   * EIP-1193 provider used for wallet signing. Required when `account` is a bare
   * address, because there is no key material in this application -- by design
   * (Foundation Standard section 2.4: private keys and seed phrases are never
   * requested).
   */
  readonly provider?: Eip1193Provider;
}

export interface ResolvedConnection {
  readonly config: GovLayerRuntimeConfig;
  readonly preset: NetworkPreset;
  readonly client: GenLayerClientInstance;
}

/**
 * The SDK types addresses as viem's `Address`, which is a `0x${string}`
 * template type. Configuration values are validated against the same shape, so
 * this helper is a checked hand-off rather than a cast of unverified input.
 */
function sdkAddress(address: string): HexAddress {
  return address as HexAddress;
}

/**
 * The SDK types its provider as a private `EthereumProvider` interface it does
 * not export. Our own structural type describes exactly the surface the SDK
 * uses (`request`, optional `on`/`removeListener`), so this is a checked
 * hand-off between two structurally identical declarations rather than a cast of
 * unverified input.
 */
function sdkProvider(provider: Eip1193Provider): never {
  return provider as never;
}

export function createGovLayerClient(
  config: GovLayerRuntimeConfig = getRuntimeConfig(),
  overrides: ClientOverrides = {},
): ResolvedConnection {
  const preset = resolveNetwork(config.network);

  const client = createClient({
    chain: preset.chain,
    ...(overrides.account === undefined ? {} : { account: overrides.account }),
    ...(overrides.provider === undefined
      ? {}
      : { provider: sdkProvider(overrides.provider) }),
  });

  return { config, preset, client };
}

export interface WalletConnectionInput {
  /** The address the wallet has authorized. */
  readonly address: string;
  /** The injected EIP-1193 provider that will sign. */
  readonly provider: Eip1193Provider;
}

/**
 * A connection that signs through the user's wallet.
 *
 * The address is set as the client's account so the SDK routes signing through
 * the provider; no per-call account is passed, and no key material exists on
 * this side. Reads through this connection behave exactly like the read-only
 * one.
 */
export function createWalletConnection(
  input: WalletConnectionInput,
  config: GovLayerRuntimeConfig = getRuntimeConfig(),
): ResolvedConnection {
  return createGovLayerClient(config, {
    account: sdkAddress(input.address),
    provider: input.provider,
  });
}

let defaultConnection: ResolvedConnection | undefined;

/**
 * Read-only connection, created once per process.
 *
 * This is only ever called from inside an async operation. It deliberately does
 * not run from a constructor or a default parameter, because configuration
 * problems must surface as a failed read rather than as a render-time crash --
 * the interface has an honest "configuration incomplete" state for exactly this,
 * and a misconfigured deployment should show it instead of failing to build.
 */
export function getDefaultConnection(): ResolvedConnection {
  if (defaultConnection === undefined) {
    defaultConnection = createGovLayerClient();
  }
  return defaultConnection;
}

/**
 * Turns a configuration failure into a typed, non-retryable error on the read.
 *
 * Preferable to letting the raw `ConfigurationError` escape: the query policy,
 * the notices and the error registry all understand `AppError`, and a missing
 * variable is not something a retry can fix.
 */
export function asReadFailure(error: unknown): AppError {
  if (error instanceof ConfigurationError) {
    return new AppError({
      kind: "configuration",
      message:
        "This deployment's contract configuration is incomplete, so the governance contracts could not be read.",
      nextStep:
        "Set the required NEXT_PUBLIC_* variables for this deployment. The interface lists which ones are missing.",
      raw: extractMessage(error),
      cause: error,
    });
  }

  return classifyError(error);
}

/** Values the SDK's calldata encoder accepts (maps omitted deliberately). */
export type CalldataValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | CalldataValue[]
  | { [key: string]: CalldataValue };

export interface ReadRequest {
  readonly address: string;
  readonly functionName: string;
  readonly args?: readonly CalldataValue[];
}

/**
 * Performs a contract read.
 *
 * A revert that carries a real protocol answer ("Proposal does not exist") is
 * surfaced as that answer. Any other failure is surfaced as verification
 * uncertainty -- deliberately not as a negative result (Blueprint section 12).
 */
export async function readContractView(
  request: ReadRequest,
  connection: ResolvedConnection = getDefaultConnection(),
): Promise<unknown> {
  try {
    return await connection.client.readContract({
      address: sdkAddress(request.address),
      functionName: request.functionName,
      ...(request.args === undefined ? {} : { args: [...request.args] }),
    });
  } catch (error) {
    const classified = classifyError(error);
    if (
      classified.kind === "not_found" ||
      classified.kind === "protocol_state" ||
      classified.kind === "validation"
    ) {
      throw classified;
    }
    throw verificationUncertainty(`The "${request.functionName}" read`, error);
  }
}

/** Accepts either a bare hash or a receipt-shaped object from `writeContract`. */
function toTransactionHash(value: unknown): TransactionHash {
  if (typeof value === "string") return asTransactionHash(value);

  if (value !== null && typeof value === "object") {
    const candidate = value as { hash?: unknown; txId?: unknown };
    if (typeof candidate.hash === "string") {
      return asTransactionHash(candidate.hash);
    }
    if (typeof candidate.txId === "string") {
      return asTransactionHash(candidate.txId);
    }
  }

  throw new AppError({
    kind: "transaction_failure",
    message: "The wallet response did not include a transaction hash.",
    nextStep: "Nothing was submitted. Retry the action.",
    recoverable: true,
    raw: extractMessage(value),
  });
}

/**
 * Best-effort extraction of a contract revert message from a receipt.
 * Returns undefined when the receipt carries no readable message, in which case
 * the caller reports that honestly instead of guessing.
 */
function extractExecutionError(receipt: GenLayerTransaction): string | undefined {
  const candidates: unknown[] = [
    (receipt.data as { error?: unknown } | undefined)?.error,
  ];

  const consensus = receipt.consensus_data as
    | { leader_receipt?: readonly Record<string, unknown>[] }
    | undefined;
  const leader = consensus?.leader_receipt?.[0];
  if (leader !== undefined) {
    candidates.push(leader.error, leader.result);
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return undefined;
}

/** Statuses in which no successful execution can ever be claimed. */
function isTerminalFailure(statusName: string): boolean {
  return (
    statusName === TransactionStatus.CANCELED ||
    statusName === TransactionStatus.UNDETERMINED ||
    statusName === TransactionStatus.VALIDATORS_TIMEOUT ||
    statusName === TransactionStatus.LEADER_TIMEOUT
  );
}
export interface WriteOptions {
  readonly account?: GenLayerSigner;
  readonly value?: bigint;
  /** Poll attempts while waiting for FINALIZED. */
  readonly retries?: number;
  readonly intervalMs?: number;
}

/**
 * Submits a write, waits for finality, and classifies the outcome from the
 * transaction's own execution result.
 *
 * The caller must branch on `kind`. `confirmed` is the only outcome that may be
 * presented as a completed operation -- and even then the caller should re-read
 * protocol state, because several GovLayer writes finish by making a decision
 * (for example a stewardship action that expires instead of applying).
 */
export async function submitContractWrite(
  request: WriteSubmission,
  options: WriteOptions,
  connection: ResolvedConnection,
): Promise<WriteOutcome> {
  let hash: TransactionHash;
  const account = options.account ?? request.account;

  try {
    const raw = await connection.client.writeContract({
      address: sdkAddress(request.address),
      functionName: request.functionName,
      args: request.args === undefined ? [] : [...request.args],
      value: options.value ?? request.value ?? 0n,
      ...(account === undefined ? {} : { account }),
    });
    hash = toTransactionHash(raw);
  } catch (error) {
    return { kind: "submission_failed", error: classifyError(error) };
  }

  let receipt: GenLayerTransaction;
  try {
    receipt = await connection.client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      interval: options.intervalMs ?? 5_000,
      retries: options.retries ?? 120,
    });
  } catch (error) {
    return {
      kind: "not_finalized",
      hash,
      statusName: "UNKNOWN",
      error: new AppError({
        kind: "transaction_failure",
        message:
          "The transaction was submitted but its finality could not be confirmed.",
        nextStep:
          "Protocol state was not confirmed to change. Re-check the record before retrying.",
        recoverable: true,
        raw: extractMessage(error),
        cause: error,
      }),
    };
  }

  return classifyReceipt(hash, receipt);
}

/**
 * Classifies a finalized transaction. Exported so it can be unit-tested
 * against constructed receipts without touching a live network.
 */
export function classifyReceipt(
  hash: TransactionHash,
  receipt: GenLayerTransaction,
): WriteOutcome {
  const statusName = String(receipt.statusName ?? "UNKNOWN");

  if (isTerminalFailure(statusName)) {
    return {
      kind: "not_finalized",
      hash,
      statusName,
      error: new AppError({
        kind: "transaction_failure",
        message: `The network finished this transaction as ${statusName}, without a successful execution.`,
        nextStep:
          "Re-check the record; retry only if the operation is still needed.",
        recoverable: true,
      }),
    };
  }

  if (statusName !== TransactionStatus.FINALIZED) {
    return {
      kind: "not_finalized",
      hash,
      statusName,
      error: new AppError({
        kind: "transaction_failure",
        message:
          "The transaction has not reached network finality, so no outcome can be confirmed.",
        nextStep: "Check the record again shortly before retrying.",
        recoverable: true,
      }),
    };
  }

  const executionName = receipt.txExecutionResultName;

  if (executionName === ExecutionResult.FINISHED_WITH_RETURN) {
    return { kind: "confirmed", hash, receipt };
  }

  if (executionName === ExecutionResult.FINISHED_WITH_ERROR) {
    const rawMessage = extractExecutionError(receipt);
    return {
      kind: "execution_failed",
      hash,
      receipt,
      error:
        rawMessage === undefined
          ? new AppError({
              kind: "transaction_failure",
              message:
                "The transaction was finalized, but its execution failed and the contract returned no readable reason.",
              nextStep: "Re-check protocol state before retrying.",
              recoverable: true,
            })
          : classifyError(rawMessage),
    };
  }

  // Finalized without a reported execution result: an honest unknown.
  return {
    kind: "not_finalized",
    hash,
    statusName,
    error: verificationUncertainty(
      "The execution result of this finalized transaction",
    ),
  };
}



export interface WriteSubmission {
  readonly address: string;
  readonly functionName: string;
  readonly args?: readonly CalldataValue[];
  /** Native value in wei. GovLayer's governance calls never send value. */
  readonly value?: bigint;
  readonly account?: GenLayerSigner;
}

/**
 * Outcome of a write, classified from the transaction's own execution result
 * rather than from its status alone.
 */
export type WriteOutcome =
  | {
      readonly kind: "confirmed";
      readonly hash: TransactionHash;
      readonly receipt: GenLayerTransaction;
    }
  | {
      readonly kind: "execution_failed";
      readonly hash: TransactionHash;
      readonly error: AppError;
      readonly receipt: GenLayerTransaction;
    }
  | {
      /** Submitted, but the network never reached FINALIZED within its window. */
      readonly kind: "not_finalized";
      readonly hash: TransactionHash;
      readonly statusName: string;
      readonly error: AppError;
    }
  | {
      /** Never accepted by the network or the wallet (nothing was submitted). */
      readonly kind: "submission_failed";
      readonly error: AppError;
    };

export function isConfirmed(outcome: WriteOutcome): boolean {
  return outcome.kind === "confirmed";
}
