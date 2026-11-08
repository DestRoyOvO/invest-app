import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dailyRows } from "./prices";
import { securityOf } from "./securities";
import { parseDayKey } from "./sessions";
import { fixtureTreasuryFetch, treasuryCsv, treasuryYearOf } from "./treasury";

const SATURDAY = Date.parse("2026-11-07T15:00:00Z");
const URL_2026 =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv";

describe("treasuryCsv", () => {
  it("prints Treasury's columns, newest day first, up to the latest completed session", () => {
    const lines = treasuryCsv(2026, SATURDAY).trim().split("\n");
    expect(lines[0]).toBe('Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"');
    expect(lines[1].startsWith("11/06/2026,")).toBe(true);
    expect(lines.at(-1)?.startsWith("01/02/2026,")).toBe(true);
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      expect(cells).toHaveLength(15);
      for (const cell of cells.slice(1)) expect(cell).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("agrees with the ^TNX and ^IRX quotes", () => {
    const [header, latest] = treasuryCsv(2026, SATURDAY).split("\n");
    const columns = header.split(",");
    const cells = latest.split(",");
    const day = parseDayKey("2026-11-06");
    const tnx = dailyRows(securityOf("^TNX")!, day, day)[0].c;
    const irx = dailyRows(securityOf("^IRX")!, day, day)[0].c;
    expect(Number(cells[columns.indexOf('"10 Yr"')])).toBeCloseTo(tnx, 2);
    expect(Number(cells[columns.indexOf('"3 Mo"')])).toBeCloseTo(irx, 2);
  });

  it("leaves out columns Treasury had not added yet and is empty for a future year", () => {
    expect(treasuryCsv(2021, SATURDAY).split("\n")[0]).not.toContain("4 Mo");
    expect(treasuryCsv(2024, SATURDAY).split("\n")[0]).not.toContain("1.5 Month");
    expect(treasuryCsv(2027, SATURDAY)).toBe("");
  });

  it("is the same on every call", () => {
    expect(treasuryCsv(2025, SATURDAY)).toBe(treasuryCsv(2025, SATURDAY + 86_400_000 * 30));
  });
});

describe("fixtureTreasuryFetch", () => {
  it("serves the yield curve CSV for Treasury's URL and 404 for anything else", async () => {
    expect(treasuryYearOf(URL_2026)).toBe(2026);
    const response = await fixtureTreasuryFetch(URL_2026, { headers: { accept: "text/csv" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect((await response.text()).startsWith("Date,")).toBe(true);
    expect((await fixtureTreasuryFetch("https://example.com/other")).status).toBe(404);
  });
});
