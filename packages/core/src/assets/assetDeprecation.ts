/**
 * Asset deprecation helpers.
 *
 * Payment assets are retired over time — a token contract may be replaced by
 * a new version, or a stablecoin issuer may migrate. This module turns the
 * optional deprecation fields on `AssetMetadata` into a structured
 * `AssetDeprecation` value that callers can render or act on.
 *
 * @module
 */

import type { AssetDeprecation, AssetMetadata } from "./types";

/**
 * Build the structured deprecation record for an asset, or `undefined` when
 * the asset is not deprecated.
 *
 * When `deprecationMessage` is omitted, a default message is generated that
 * names the asset and, when present, its replacement.
 *
 * @param metadata - Registered asset metadata to inspect.
 */
export function getAssetDeprecation(metadata: AssetMetadata): AssetDeprecation | undefined {
  if (metadata.deprecated !== true) return undefined;

  const replacementAssetId = metadata.replacementAssetId;
  const overrideMessage = metadata.deprecationMessage?.trim();
  const message =
    overrideMessage && overrideMessage.length > 0
      ? overrideMessage
      : `Asset "${metadata.symbol}" (${metadata.id}) is deprecated for new payroll payments.` +
        (replacementAssetId
          ? ` Use replacement asset "${replacementAssetId}" instead.`
          : " Register a replacement asset before creating new payments.");

  return {
    deprecated: true,
    message,
    ...(replacementAssetId ? { replacementAssetId } : {}),
  };
}
