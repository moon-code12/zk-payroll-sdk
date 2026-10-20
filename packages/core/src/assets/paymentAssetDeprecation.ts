/**
 * Payment asset deprecation handling.
 *
 * Combines payment asset compatibility validation with registry deprecation
 * metadata so payroll flows can:
 *
 * - reject identifiers that cannot name a payment asset at all,
 * - warn when an otherwise usable asset is being retired, and
 * - fail fast with an actionable error before building a payment to a
 *   deprecated asset.
 *
 * @module
 */

import { ValidationError } from "../core/errors";
import { AssetRegistry, AssetRegistryClass } from "./AssetRegistry";
import {
  PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
  isPaymentAssetCompatible,
} from "./paymentAssetCompatibility";
import type { AssetDeprecation, AssetMetadata } from "./types";

/** Stable error code used when a deprecated asset blocks a payment. */
export const PAYMENT_ASSET_DEPRECATED_ERROR_CODE = "PAYMENT_ASSET_DEPRECATED";

/**
 * Machine-readable outcome of a payment asset deprecation check.
 *
 * - `"ok"` — the asset is compatible, registered, and not deprecated.
 * - `"deprecated"` — the asset is usable but marked deprecated; migration is
 *   recommended (or required, when `allowDeprecated` is `false`).
 * - `"not_payment_compatible"` — the identifier cannot name a payment asset.
 * - `"unregistered"` — the identifier is valid but has no registry metadata.
 */
export type PaymentAssetDeprecationCode =
  "ok" | "deprecated" | "not_payment_compatible" | "unregistered";

/** Options accepted by {@link checkPaymentAssetDeprecation}. */
export interface PaymentAssetDeprecationOptions {
  /**
   * Registry to resolve asset metadata from. Defaults to the shared
   * `AssetRegistry` singleton.
   */
  registry?: AssetRegistryClass;

  /**
   * When `true`, deprecated assets remain usable and the result only carries
   * a warning. Defaults to `false` so new payments cannot silently target an
   * asset that is being retired.
   */
  allowDeprecated?: boolean;
}

/** Result of {@link checkPaymentAssetDeprecation}. */
export interface PaymentAssetDeprecationResult {
  /** The canonical asset ID that was checked, when one could be resolved. */
  assetId: string;

  /**
   * Whether the asset can be used for a new payment under the supplied
   * options. Deprecated assets are not usable unless `allowDeprecated` is set.
   */
  usable: boolean;

  /** `true` when the resolved asset is marked deprecated. */
  deprecated: boolean;

  /** Machine-readable outcome code. */
  code: PaymentAssetDeprecationCode;

  /** Actionable message for failures and deprecation warnings. */
  message?: string;

  /** Resolved metadata when the asset is registered. */
  metadata?: AssetMetadata;

  /** Structured deprecation details when the asset is deprecated. */
  deprecation?: AssetDeprecation;

  /** Metadata for the replacement asset, when registered and deprecated. */
  replacement?: AssetMetadata;
}

/**
 * Check a payment asset identifier for compatibility and deprecation.
 *
 * This function never throws for invalid input; it returns a structured
 * result so validation pipelines and UIs can surface the reason. Use
 * {@link assertPaymentAssetUsable} when a thrown error is more convenient.
 *
 * @param asset - Payment asset identifier (`"native"` or a Soroban contract ID).
 * @param options - Registry and deprecation policy overrides.
 *
 * @example
 * ```ts
 * const result = checkPaymentAssetDeprecation(asset);
 * if (result.deprecated) {
 *   console.warn(result.message);
 * }
 * ```
 */
export function checkPaymentAssetDeprecation(
  asset: unknown,
  options: PaymentAssetDeprecationOptions = {}
): PaymentAssetDeprecationResult {
  const registry = options.registry ?? AssetRegistry;
  const allowDeprecated = options.allowDeprecated ?? false;

  if (!isPaymentAssetCompatible(asset)) {
    return {
      assetId: typeof asset === "string" ? asset : String(asset),
      usable: false,
      deprecated: false,
      code: "not_payment_compatible",
      message: PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
    };
  }

  const assetId = asset as string;
  const metadata = registry.get(assetId);

  if (!metadata) {
    return {
      assetId,
      usable: false,
      deprecated: false,
      code: "unregistered",
      message:
        `Asset "${assetId}" is not registered. Register its metadata with ` +
        `AssetRegistry.register({ id, symbol, label, decimals }) before creating payments.`,
    };
  }

  const deprecation = registry.getDeprecation(assetId);
  if (!deprecation) {
    return {
      assetId: metadata.id,
      usable: true,
      deprecated: false,
      code: "ok",
      metadata,
    };
  }

  const replacement = deprecation.replacementAssetId
    ? registry.get(deprecation.replacementAssetId)
    : undefined;

  return {
    assetId: metadata.id,
    usable: allowDeprecated,
    deprecated: true,
    code: "deprecated",
    message: deprecation.message,
    metadata,
    deprecation,
    ...(replacement ? { replacement } : {}),
  };
}

/**
 * Assert that an asset is a compatible, registered, non-deprecated payment
 * asset and return its metadata.
 *
 * @param asset - Payment asset identifier (`"native"` or a Soroban contract ID).
 * @param options - Registry and deprecation policy overrides. Set
 *   `allowDeprecated: true` to permit deprecated assets during a migration.
 * @throws {ValidationError} with code `PAYMENT_ASSET_DEPRECATED` for deprecated
 *   assets, or `VALIDATION_ERROR` for incompatible/unregistered assets. The
 *   error message includes migration guidance when a replacement is known.
 *
 * @example
 * ```ts
 * const metadata = assertPaymentAssetUsable("native");
 * ```
 */
export function assertPaymentAssetUsable(
  asset: unknown,
  options: PaymentAssetDeprecationOptions = {}
): AssetMetadata {
  const result = checkPaymentAssetDeprecation(asset, options);

  if (!result.usable) {
    throw new PaymentAssetDeprecationError(result);
  }

  // `usable` implies registered metadata.
  return result.metadata as AssetMetadata;
}

/**
 * Error thrown by {@link assertPaymentAssetUsable} when a payment asset cannot
 * be used. Extends the SDK's `ValidationError`, and exposes the full structured
 * result so callers can inspect the replacement asset and deprecation details
 * without parsing the message.
 *
 * `code` is `PAYMENT_ASSET_DEPRECATED` for deprecated assets and
 * `VALIDATION_ERROR` for incompatible or unregistered assets. `outcome` always
 * carries the finer-grained {@link PaymentAssetDeprecationCode}.
 */
export class PaymentAssetDeprecationError extends ValidationError {
  public readonly outcome: PaymentAssetDeprecationCode;
  public readonly assetId: string;
  public readonly deprecation?: AssetDeprecation;
  public readonly replacement?: AssetMetadata;

  constructor(public readonly result: PaymentAssetDeprecationResult) {
    super(
      result.message ?? `Asset "${result.assetId}" cannot be used for payments.`,
      "asset",
      result.code === "deprecated" ? PAYMENT_ASSET_DEPRECATED_ERROR_CODE : "VALIDATION_ERROR",
      {
        code: result.code,
        assetId: result.assetId,
        ...(result.deprecation?.replacementAssetId
          ? { replacementAssetId: result.deprecation.replacementAssetId }
          : {}),
      }
    );
    this.name = "PaymentAssetDeprecationError";
    this.outcome = result.code;
    this.assetId = result.assetId;
    this.deprecation = result.deprecation;
    this.replacement = result.replacement;
  }
}
