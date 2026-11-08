import { describe, expect, it } from "vitest";

import { industryName, insiderRole, quoteTypeName, ratingWord, sectorName } from "./yahoo-terms";

describe("Yahoo's words in Chinese", () => {
  it("translates analyst ratings whatever the spelling", () => {
    expect(ratingWord("Overweight", "zh")).toBe("增持");
    expect(ratingWord("Equal-Weight", "zh")).toBe("与大市持平");
    expect(ratingWord("Equal Weight", "zh")).toBe("与大市持平");
    expect(ratingWord("In-Line", "zh")).toBe("与大盘一致");
    expect(ratingWord("Strong Buy", "zh")).toBe("强烈买入");
  });

  it("names Yahoo's sectors as the app names its sectors", () => {
    expect(sectorName("Technology", "zh")).toBe("信息技术");
    expect(sectorName("Consumer Cyclical", "zh")).toBe("可选消费");
    expect(sectorName("Basic Materials", "zh")).toBe("原材料");
  });

  it("translates industries with any dash between the parts", () => {
    expect(industryName("Consumer Electronics", "zh")).toBe("消费电子");
    expect(industryName("Software—Infrastructure", "zh")).toBe("软件—基础设施");
    expect(industryName("Software - Infrastructure", "zh")).toBe("软件—基础设施");
    expect(industryName("Oil & Gas E&P", "zh")).toBe("油气勘探与生产");
    expect(industryName("REIT - Hotel & Motel", "zh")).toBe("REIT—酒店");
  });

  it("translates insider roles and joins known combinations", () => {
    expect(insiderRole("Officer", "zh")).toBe("高管");
    expect(insiderRole("Officer and Director", "zh")).toBe("高管兼董事");
    expect(insiderRole("President and Chief Executive Officer", "zh")).toBe("总裁兼首席执行官");
    expect(insiderRole("General Counsel", "zh")).toBe("总法律顾问");
  });

  it("translates quote types", () => {
    expect(quoteTypeName("EQUITY", "zh")).toBe("股票");
    expect(quoteTypeName("FUTURE", "zh")).toBe("期货");
    expect(quoteTypeName("CRYPTOCURRENCY", "zh")).toBe("加密货币");
  });

  it("keeps Yahoo's word when the table does not have it", () => {
    expect(ratingWord("Tender", "zh")).toBe("Tender");
    expect(sectorName("Space", "zh")).toBe("Space");
    expect(industryName("Quantum Computing", "zh")).toBe("Quantum Computing");
    expect(insiderRole("Director (Indirect)", "zh")).toBe("Director (Indirect)");
    expect(insiderRole("Officer and Wizard", "zh")).toBe("Officer and Wizard");
    expect(quoteTypeName("WARRANT", "zh")).toBe("WARRANT");
  });

  it("leaves English pages as Yahoo wrote them", () => {
    expect(ratingWord("Overweight", "en")).toBe("Overweight");
    expect(sectorName("Consumer Cyclical", "en")).toBe("Consumer Cyclical");
    expect(industryName("Consumer Electronics", "en")).toBe("Consumer Electronics");
    expect(insiderRole("Officer and Director", "en")).toBe("Officer and Director");
    expect(quoteTypeName("EQUITY", "en")).toBe("EQUITY");
  });
});
