import { describe, expect, it } from "vitest";
import {
  formatFixedPoint,
  formatInteger,
  formatRatioPercent,
  isSafeIntegerValue,
  pluralize,
  toSafeNumber,
} from "./format";

describe("formatInteger", () => {
  it("formats beyond the safe integer range without precision loss", () => {
    expect(formatInteger(0n)).toBe("0");
    expect(formatInteger(1000n)).toBe("1,000");
    expect(formatInteger(123456789012345678901234567890n)).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
  });

  it("handles negatives", () => {
    expect(formatInteger(-4321n)).toBe("-4,321");
  });
});

describe("formatFixedPoint", () => {
  it("places the decimal point exactly", () => {
    expect(formatFixedPoint(1500n, 2)).toBe("15");
    expect(formatFixedPoint(1555n, 2)).toBe("15.55");
    expect(formatFixedPoint(5n, 3)).toBe("0.005");
    expect(formatFixedPoint(123456789n, 6)).toBe("123.456789");
  });

  it("groups large whole parts", () => {
    expect(formatFixedPoint(1234567890123n, 2)).toBe("12,345,678,901.23");
  });

  it("rejects an invalid decimals argument", () => {
    expect(() => formatFixedPoint(1n, -1)).toThrowError(RangeError);
  });
});

describe("formatRatioPercent", () => {
  it("computes an exact rounded percentage", () => {
    expect(formatRatioPercent(2n, 3n)).toBe("66.7%");
    expect(formatRatioPercent(1n, 2n)).toBe("50%");
    expect(formatRatioPercent(0n, 5n)).toBe("0%");
    expect(formatRatioPercent(5n, 5n)).toBe("100%");
  });

  it("scales to big values without floating point", () => {
    expect(formatRatioPercent(10n ** 20n, 2n * 10n ** 20n)).toBe("50%");
  });

  it("returns null when there is nothing to divide by", () => {
    expect(formatRatioPercent(0n, 0n)).toBeNull();
  });
});

describe("integer safety helpers", () => {
  it("refuses lossy conversions", () => {
    expect(isSafeIntegerValue(5n)).toBe(true);
    expect(isSafeIntegerValue(2n ** 80n)).toBe(false);
    expect(() => toSafeNumber(2n ** 80n)).toThrowError(RangeError);
    expect(toSafeNumber(42n)).toBe(42);
  });
});

describe("pluralize", () => {
  it("handles singular and plural forms", () => {
    expect(pluralize(1, "proposal")).toBe("1 proposal");
    expect(pluralize(3, "proposal")).toBe("3 proposals");
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });
});
