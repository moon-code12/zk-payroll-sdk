import { AssetRegistryClass } from "../src/assets/AssetRegistry";
import {
  PAYMENT_ASSET_DEPRECATED_ERROR_CODE,
  PaymentAssetDeprecationError,
  assertPaymentAssetUsable,
  checkPaymentAssetDeprecation,
} from "../src/assets/paymentAssetDeprecation";
import { PAYMENT_ASSET_COMPATIBILITY_MESSAGE } from "../src/assets/paymentAssetCompatibility";
import type { AssetMetadata } from "../src/assets/types";

const OLD_TOKEN_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const NEW_TOKEN_ID = "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC";
const UNREGISTERED_TOKEN_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const NEW_TOKEN: AssetMetadata = {
  id: NEW_TOKEN_ID,
  symbol: "NEWUSD",
  label: "New USD",
  decimals: 7,
  displayFormat: "decimal",
};

const DEPRECATED_TOKEN: AssetMetadata = {
  id: OLD_TOKEN_ID,
  symbol: "OLDUSD",
  label: "Old USD",
  decimals: 7,
  displayFormat: "decimal",
  deprecated: true,
  replacementAssetId: NEW_TOKEN_ID,
};

function makeRegistry(...assets: AssetMetadata[]): AssetRegistryClass {
  return new AssetRegistryClass(assets);
}

describe("checkPaymentAssetDeprecation", () => {
  it("passes a registered, non-deprecated payment asset", () => {
    const registry = makeRegistry(NEW_TOKEN);
    const result = checkPaymentAssetDeprecation(NEW_TOKEN_ID, { registry });

    expect(result).toEqual({
      assetId: NEW_TOKEN_ID,
      usable: true,
      deprecated: false,
      code: "ok",
      metadata: NEW_TOKEN,
    });
  });

  it("rejects deprecated assets by default and resolves the replacement", () => {
    const registry = makeRegistry(DEPRECATED_TOKEN, NEW_TOKEN);
    const result = checkPaymentAssetDeprecation(OLD_TOKEN_ID, { registry });

    expect(result.usable).toBe(false);
    expect(result.deprecated).toBe(true);
    expect(result.code).toBe("deprecated");
    expect(result.message).toContain("OLDUSD");
    expect(result.message).toContain(NEW_TOKEN_ID);
    expect(result.deprecation).toEqual({
      deprecated: true,
      message: expect.stringContaining(NEW_TOKEN_ID),
      replacementAssetId: NEW_TOKEN_ID,
    });
    expect(result.replacement).toEqual(NEW_TOKEN);
  });

  it("allows deprecated assets when explicitly opted in", () => {
    const registry = makeRegistry(DEPRECATED_TOKEN);
    const result = checkPaymentAssetDeprecation(OLD_TOKEN_ID, {
      registry,
      allowDeprecated: true,
    });

    expect(result.usable).toBe(true);
    expect(result.deprecated).toBe(true);
    expect(result.code).toBe("deprecated");
  });

  it("uses an explicit deprecation message when provided", () => {
    const registry = makeRegistry({
      ...DEPRECATED_TOKEN,
      deprecationMessage: "Migrate to NEWUSD before 2027-01-01.",
    });
    const result = checkPaymentAssetDeprecation(OLD_TOKEN_ID, { registry });

    expect(result.message).toBe("Migrate to NEWUSD before 2027-01-01.");
  });

  it("generates a default message when no replacement is known", () => {
    const registry = makeRegistry({ ...DEPRECATED_TOKEN, replacementAssetId: undefined });
    const result = checkPaymentAssetDeprecation(OLD_TOKEN_ID, { registry });

    expect(result.message).toContain("deprecated");
    expect(result.message).toContain("Register a replacement asset");
    expect(result.deprecation?.replacementAssetId).toBeUndefined();
  });

  it("reports identifiers that cannot name a payment asset", () => {
    const result = checkPaymentAssetDeprecation("USDC", { registry: makeRegistry() });

    expect(result.usable).toBe(false);
    expect(result.code).toBe("not_payment_compatible");
    expect(result.message).toBe(PAYMENT_ASSET_COMPATIBILITY_MESSAGE);
  });

  it("reports a valid but unregistered contract ID", () => {
    const registry = makeRegistry();
    const result = checkPaymentAssetDeprecation(UNREGISTERED_TOKEN_ID, { registry });

    expect(result.usable).toBe(false);
    expect(result.code).toBe("unregistered");
    expect(result.message).toContain(UNREGISTERED_TOKEN_ID);
  });
});

describe("assertPaymentAssetUsable", () => {
  it("returns metadata for a usable asset", () => {
    const registry = makeRegistry(NEW_TOKEN);
    expect(assertPaymentAssetUsable(NEW_TOKEN_ID, { registry })).toEqual(NEW_TOKEN);
  });

  it("throws an actionable deprecation error by default", () => {
    const registry = makeRegistry(DEPRECATED_TOKEN, NEW_TOKEN);

    let error: unknown;
    try {
      assertPaymentAssetUsable(OLD_TOKEN_ID, { registry });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(PaymentAssetDeprecationError);
    const deprecationError = error as PaymentAssetDeprecationError;
    expect(deprecationError.code).toBe(PAYMENT_ASSET_DEPRECATED_ERROR_CODE);
    expect(deprecationError.outcome).toBe("deprecated");
    expect(deprecationError.assetId).toBe(OLD_TOKEN_ID);
    expect(deprecationError.replacement).toEqual(NEW_TOKEN);
    expect(deprecationError.message).toContain(NEW_TOKEN_ID);
  });

  it("allows a deprecated asset during an explicit migration", () => {
    const registry = makeRegistry(DEPRECATED_TOKEN);
    expect(assertPaymentAssetUsable(OLD_TOKEN_ID, { registry, allowDeprecated: true })).toEqual(
      DEPRECATED_TOKEN
    );
  });

  it("throws a validation error for an incompatible identifier", () => {
    expect(() => assertPaymentAssetUsable("not-an-asset", { registry: makeRegistry() })).toThrow(
      PaymentAssetDeprecationError
    );

    try {
      assertPaymentAssetUsable("not-an-asset", { registry: makeRegistry() });
    } catch (err) {
      expect((err as PaymentAssetDeprecationError).code).toBe("VALIDATION_ERROR");
      expect((err as PaymentAssetDeprecationError).outcome).toBe("not_payment_compatible");
    }
  });
});

describe("AssetRegistry deprecation helpers", () => {
  it("exposes deprecation details by id and symbol", () => {
    const registry = makeRegistry(DEPRECATED_TOKEN);

    expect(registry.isDeprecated(OLD_TOKEN_ID)).toBe(true);
    expect(registry.isDeprecated("oldusd")).toBe(true);
    expect(registry.getDeprecation(OLD_TOKEN_ID)?.replacementAssetId).toBe(NEW_TOKEN_ID);
  });

  it("returns false/undefined for non-deprecated and unknown assets", () => {
    const registry = makeRegistry(NEW_TOKEN);

    expect(registry.isDeprecated(NEW_TOKEN_ID)).toBe(false);
    expect(registry.getDeprecation(NEW_TOKEN_ID)).toBeUndefined();
    expect(registry.getDeprecation("GHOST")).toBeUndefined();
  });

  it("includes deprecation info in checkAvailability without making the asset unavailable", () => {
    const registry = makeRegistry(DEPRECATED_TOKEN);

    const result = registry.checkAvailability(OLD_TOKEN_ID);
    expect(result.available).toBe(true);
    expect(result.code).toBe("ok");
    expect(result.deprecated).toBe(true);
    expect(result.deprecation?.replacementAssetId).toBe(NEW_TOKEN_ID);
  });
});
