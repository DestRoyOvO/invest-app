import { describe, expect, it } from "vitest";

import { currencyDigits, signedMoneyText } from "./money-format";

describe("currencyDigits", () => {
  it("uses the currency's minor unit", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("EUR")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KRW")).toBe(0);
  });

  it("keeps 2 for minor-unit quotes, unknown codes and missing currencies", () => {
    expect(currencyDigits("GBp")).toBe(2);
    expect(currencyDigits("ZAc")).toBe(2);
    expect(currencyDigits("not a code")).toBe(2);
    expect(currencyDigits(null)).toBe(2);
    expect(currencyDigits("")).toBe(2);
  });
});

describe("signedMoneyText", () => {
  it("signs gains and losses with a true minus and groups thousands", () => {
    expect(signedMoneyText(1234.5, "en")).toBe("+1,234.50");
    expect(signedMoneyText(-12, "en")).toBe("−12.00");
    expect(signedMoneyText(0, "en")).toBe("0.00");
    expect(signedMoneyText(26781.017, "en")).toBe("+26,781.02");
    expect(signedMoneyText(-19500, "en", 0)).toBe("−19,500");
  });

  it("takes the sign from the rounded amount", () => {
    expect(signedMoneyText(-0.004, "en")).toBe("0.00");
    expect(signedMoneyText(0.004, "en")).toBe("0.00");
    expect(signedMoneyText(-0.006, "en")).toBe("−0.01");
    expect(signedMoneyText(-0.4, "en", 0)).toBe("0");
  });

  it("shows a dash for missing values", () => {
    expect(signedMoneyText(null, "en")).toBe("—");
    expect(signedMoneyText(undefined, "zh")).toBe("—");
    expect(signedMoneyText(Number.NaN, "en")).toBe("—");
  });
});
