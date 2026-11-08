import "server-only";

import type { SectorKey } from "@/types/api";
import { UNIVERSE_STOCKS } from "@/lib/universe";

import {
  announcedDividend,
  companyFigures,
  dividendSchedule,
  earningsSchedule,
  lastReportedYear,
  quarterResult,
  recommendationKey,
  shiftQuarterEnd,
  trailingDividends,
  trailingEps,
  trailingEpsOf,
  yearResult,
  type EarningsSchedule,
} from "./company";
import { lastDayOfPreviousYear, priceDigits } from "./prices";
import { recentRows } from "./quote";
import { between, pick, round } from "./random";
import { securityOf, YAHOO_SECTORS, type QuoteType, type Security } from "./securities";
import { DAY_MS, dailyStamp, dayNumber, localToUtc, marketStateAt, PROFILES, sessionClose, tradingDayOnOrBefore, yearOf } from "./sessions";

// quoteSummary() of the fixture data. Each module has the shape yahoo-finance2 returns after validation (raw numbers,
// Date objects, Yahoo's units: fractions in quoteSummary, percent only where Yahoo uses it, such as debtToEquity).
// Modules follow the quote type, as on Yahoo: an ETF has fund modules but no financials, an index only price, summary
// detail and key statistics. Asking only for modules a symbol lacks fails with Yahoo's "No fundamentals data found";
// an unknown symbol fails with "Quote not found". People and firms in the ownership and analyst modules are made up.

type Module = Record<string, unknown>;

const EQUITY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "calendarEvents",
  "assetProfile",
  "earnings",
  "earningsHistory",
  "earningsTrend",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "insiderTransactions",
  "netSharePurchaseActivity",
  "majorHoldersBreakdown",
  "institutionOwnership",
  "fundOwnership",
] as const;
const FUND_MODULES = ["price", "summaryDetail", "defaultKeyStatistics", "assetProfile", "topHoldings", "fundProfile"] as const;

const AVAILABLE: Readonly<Record<QuoteType, readonly string[]>> = {
  EQUITY: EQUITY_MODULES,
  ETF: FUND_MODULES,
  MUTUALFUND: FUND_MODULES,
  INDEX: ["price", "summaryDetail", "defaultKeyStatistics"],
  CRYPTOCURRENCY: ["price", "summaryDetail", "assetProfile"],
  CURRENCY: ["price", "summaryDetail"],
  FUTURE: ["price", "summaryDetail"],
};

/** Every module the fixture data can produce ("all" asks for these). */
export const FIXTURE_SUMMARY_MODULES: readonly string[] = [...new Set([...EQUITY_MODULES, ...FUND_MODULES])];

const DEFAULT_MODULES = ["price", "summaryDetail"];

interface Context {
  security: Security;
  now: number;
  latest: number;
  price: number;
  previous: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  avgVolume3m: number;
  avgVolume10d: number;
  high52: number;
  low52: number;
  avg50: number;
  avg200: number;
  change52: number;
  digits: number;
}

function contextOf(security: Security, now: number): Context | null {
  const { latest, rows } = recentRows(security, now);
  const last = rows.at(-1);
  if (!last) return null;
  const year = rows.filter((row) => row.day > latest - 365);
  const closes = rows.map((row) => row.c);
  const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
  return {
    security,
    now,
    latest,
    price: last.c,
    previous: rows.at(-2)?.c ?? last.o,
    open: last.o,
    dayHigh: last.h,
    dayLow: last.l,
    volume: last.v,
    avgVolume3m: Math.round(avg(rows.slice(-63).map((row) => row.v))),
    avgVolume10d: Math.round(avg(rows.slice(-10).map((row) => row.v))),
    high52: Math.max(...year.map((row) => row.h)),
    low52: Math.min(...year.map((row) => row.l)),
    avg50: avg(closes.slice(-50)),
    avg200: avg(closes.slice(-200)),
    change52: year[0] ? last.c / year[0].c - 1 : 0,
    digits: priceDigits(security, last.c),
  };
}

const at = (ms: number) => new Date(ms);
const midnight = (day: number) => new Date(day * DAY_MS);

// ---------------------------------------------------------------------------
// Price, summary detail and key statistics
// ---------------------------------------------------------------------------

function marketCapOf(ctx: Context): number | undefined {
  const { security, price } = ctx;
  if (security.type === "EQUITY") return Math.round(companyFigures(security).sharesOutstanding * price);
  if (security.type === "CRYPTOCURRENCY" && security.sizeAtAnchor) return Math.round((security.sizeAtAnchor / security.anchorPrice) * price);
  return undefined;
}

function priceModule(ctx: Context): Module {
  const { security } = ctx;
  const change = ctx.price - ctx.previous;
  return compact({
    maxAge: 1,
    regularMarketChangePercent: ctx.previous ? change / ctx.previous : 0,
    regularMarketChange: round(change, ctx.digits + 2),
    regularMarketTime: at(sessionClose(security.profile, ctx.latest)),
    priceHint: ctx.digits,
    regularMarketPrice: ctx.price,
    regularMarketDayHigh: ctx.dayHigh,
    regularMarketDayLow: ctx.dayLow,
    regularMarketVolume: ctx.volume,
    averageDailyVolume10Day: ctx.avgVolume10d,
    averageDailyVolume3Month: ctx.avgVolume3m,
    regularMarketPreviousClose: ctx.previous,
    regularMarketSource: "FREE_REALTIME",
    regularMarketOpen: ctx.open,
    exchange: security.exchange,
    exchangeName: security.fullExchangeName,
    exchangeDataDelayedBy: security.market === "us_market" ? 0 : 15,
    marketState: marketStateAt(security.profile, ctx.now),
    quoteType: security.type,
    symbol: security.symbol,
    underlyingSymbol: null,
    shortName: security.shortName,
    longName: security.name,
    currency: security.currency,
    quoteSourceName: "Delayed Quote",
    currencySymbol: security.currency === "USD" ? "$" : security.currency,
    fromCurrency: null,
    toCurrency: null,
    lastMarket: null,
    marketCap: marketCapOf(ctx),
  });
}

function summaryDetailModule(ctx: Context): Module {
  const { security, latest, price } = ctx;
  const dividends = dividendSchedule(security, latest);
  const announced = announcedDividend(dividends, latest);
  const lastEx = dividends ? (announced ?? dividends.history.at(-1)) : null;
  const trailing = dividends ? trailingDividends(dividends, latest) : 0;
  const fund = security.type === "ETF" || security.type === "MUTUALFUND";
  const figures = security.type === "EQUITY" ? companyFigures(security) : null;
  // The trailing EPS of the reported quarters, as in the quote, so both show the same P/E.
  const epsTtm = trailingEpsOf(security, latest);
  const detail: Module = {
    maxAge: 1,
    priceHint: ctx.digits,
    previousClose: ctx.previous,
    open: ctx.open,
    dayLow: ctx.dayLow,
    dayHigh: ctx.dayHigh,
    regularMarketPreviousClose: ctx.previous,
    regularMarketOpen: ctx.open,
    regularMarketDayLow: ctx.dayLow,
    regularMarketDayHigh: ctx.dayHigh,
    volume: ctx.volume,
    regularMarketVolume: ctx.volume,
    averageVolume: ctx.avgVolume3m,
    averageVolume10days: ctx.avgVolume10d,
    averageDailyVolume10Day: ctx.avgVolume10d,
    bid: round(price * 0.9998, ctx.digits),
    ask: round(price * 1.0002, ctx.digits),
    bidSize: 300,
    askSize: 400,
    fiftyTwoWeekLow: ctx.low52,
    fiftyTwoWeekHigh: ctx.high52,
    fiftyDayAverage: round(ctx.avg50, ctx.digits + 1),
    twoHundredDayAverage: round(ctx.avg200, ctx.digits + 1),
    currency: security.currency,
    fromCurrency: null,
    toCurrency: null,
    lastMarket: null,
    coinMarketCapLink: null,
    algorithm: null,
    tradeable: false,
    fulldayPrice: price,
    marketCap: marketCapOf(ctx),
  };
  if (dividends) {
    Object.assign(detail, {
      dividendRate: dividends.annualRate,
      dividendYield: round(dividends.annualRate / price, 4),
      exDividendDate: lastEx ? at(localToUtc("America/New_York", lastEx.exDay, 0)) : undefined,
      trailingAnnualDividendRate: trailing,
      trailingAnnualDividendYield: trailing / price,
      fiveYearAvgDividendYield: round(security.dividendYield * 100 * between(0.85, 1.2, security.symbol, "avgyield"), 2),
      payoutRatio: epsTtm && epsTtm > 0 ? round(trailing / epsTtm, 4) : 0,
    });
  } else if (security.type === "EQUITY") {
    Object.assign(detail, { payoutRatio: 0, trailingAnnualDividendRate: 0, trailingAnnualDividendYield: 0 });
  }
  if (figures) {
    Object.assign(detail, {
      beta: round(figures.beta, 3),
      trailingPE: epsTtm !== null && epsTtm > 0 ? price / epsTtm : undefined,
      forwardPE: figures.forwardEps > 0 ? price / figures.forwardEps : undefined,
      priceToSalesTrailing12Months: (figures.sharesOutstanding * price) / figures.revenueTtm,
    });
  }
  if (fund) {
    const base = lastDayOfPreviousYear(security, latest);
    const rows = recentRows(security, ctx.now).rows;
    const yearStart = rows.find((row) => row.day >= base)?.c ?? price;
    Object.assign(detail, {
      yield: round(security.dividendYield, 4),
      totalAssets: Math.round((security.sizeAtAnchor ?? 0) * (price / security.anchorPrice)),
      navPrice: round(price * 0.9999, ctx.digits),
      ytdReturn: round(price / yearStart - 1, 4),
    });
  }
  if (security.type === "CRYPTOCURRENCY") {
    Object.assign(detail, {
      fromCurrency: security.symbol.split("-")[0],
      toCurrency: `${security.currency}=X`,
      lastMarket: "CoinMarketCap",
      volume24Hr: ctx.volume,
      volumeAllCurrencies: ctx.volume,
      circulatingSupply: Math.round((security.sizeAtAnchor ?? 0) / security.anchorPrice),
      startDate: at(dailyStamp(security.profile, security.profile.epoch)),
    });
  }
  return compact(detail);
}

function keyStatisticsModule(ctx: Context): Module {
  const { security, price, latest } = ctx;
  const base: Module = { maxAge: 1, priceHint: ctx.digits, category: null, fundFamily: null, legalType: null, lastSplitFactor: null, "52WeekChange": round(ctx.change52, 4) };
  if (security.type === "ETF" || security.type === "MUTUALFUND") {
    const fund = security.fund;
    return compact({
      ...base,
      category: fund?.category ?? null,
      fundFamily: fund?.family ?? null,
      legalType: security.type === "ETF" ? "Exchange Traded Fund" : "Open-End Fund",
      totalAssets: Math.round((security.sizeAtAnchor ?? 0) * (price / security.anchorPrice)),
      yield: round(security.dividendYield, 4),
      beta3Year: round(between(0.8, 1.2, security.symbol, "beta3"), 2),
      threeYearAverageReturn: round(between(0.04, 0.16, security.symbol, "r3"), 4),
      fiveYearAverageReturn: round(between(0.05, 0.15, security.symbol, "r5"), 4),
      fundInceptionDate: midnight(security.profile.epoch),
      annualHoldingsTurnover: round(between(0.02, 0.4, security.symbol, "turnover"), 4),
      morningStarOverallRating: 3 + pick(3, security.symbol, "stars"),
      morningStarRiskRating: 2 + pick(3, security.symbol, "risk"),
    });
  }
  if (security.type !== "EQUITY") return base;
  const figures = companyFigures(security);
  const schedule = earningsSchedule(security, latest);
  const lastReport = schedule?.history.at(-1);
  const epsTtm = schedule ? trailingEps(schedule) : round(figures.epsTtm, 2);
  const dividends = dividendSchedule(security, latest);
  const lastDividend = dividends?.history.filter((payment) => payment.exDay <= latest).at(-1);
  const enterprise = figures.sharesOutstanding * price + figures.totalDebt - figures.totalCash;
  const ebitda = figures.revenueTtm * figures.ebitdaMargin;
  const shortInterestDay = latest - 20;
  return compact({
    ...base,
    enterpriseValue: Math.round(enterprise),
    forwardPE: figures.forwardEps > 0 ? price / figures.forwardEps : undefined,
    profitMargins: round(figures.profitMargin, 4),
    floatShares: Math.round(figures.sharesOutstanding * (1 - figures.insidersPercentHeld)),
    sharesOutstanding: figures.sharesOutstanding,
    sharesShort: Math.round(figures.sharesOutstanding * figures.shortPercentOfFloat),
    sharesShortPriorMonth: midnight(shortInterestDay - 30),
    sharesShortPreviousMonthDate: midnight(shortInterestDay - 30),
    dateShortInterest: midnight(shortInterestDay),
    sharesPercentSharesOut: round(figures.shortPercentOfFloat * 0.95, 4),
    heldPercentInsiders: round(figures.insidersPercentHeld, 4),
    heldPercentInstitutions: round(figures.institutionsPercentHeld, 4),
    shortRatio: round(between(0.8, 4.5, security.symbol, "shortratio"), 2),
    shortPercentOfFloat: round(figures.shortPercentOfFloat, 4),
    beta: round(figures.beta, 3),
    impliedSharesOutstanding: figures.sharesOutstanding,
    bookValue: round(figures.bookValuePerShare, 3),
    priceToBook: price / figures.bookValuePerShare,
    lastFiscalYearEnd: midnight(dayNumber(yearOf(latest) - 1, 12, 31)),
    nextFiscalYearEnd: midnight(dayNumber(yearOf(latest), 12, 31)),
    mostRecentQuarter: lastReport ? midnight(lastReport.periodEnd) : undefined,
    earningsQuarterlyGrowth: round(figures.earningsGrowth, 4),
    netIncomeToCommon: Math.round(epsTtm * figures.sharesOutstanding),
    trailingEps: epsTtm,
    forwardEps: round(figures.forwardEps, 2),
    pegRatio: epsTtm > 0 && figures.earningsGrowth > 0.02 ? round(price / epsTtm / (figures.earningsGrowth * 100), 2) : undefined,
    enterpriseToRevenue: round(enterprise / figures.revenueTtm, 3),
    enterpriseToEbitda: ebitda > 0 ? round(enterprise / ebitda, 3) : undefined,
    SandP52WeekChange: round(between(0.05, 0.2, "^GSPC", yearOf(latest)), 4),
    lastDividendValue: lastDividend?.amount,
    lastDividendDate: lastDividend ? at(localToUtc("America/New_York", lastDividend.exDay, 0)) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Financial data, calendar and profile
// ---------------------------------------------------------------------------

function financialDataModule(ctx: Context): Module {
  const figures = companyFigures(ctx.security);
  const target = ctx.price * figures.targetRatio;
  const operatingCashflow = figures.revenueTtm * (figures.operatingMargin + 0.06);
  return compact({
    maxAge: 86400,
    currentPrice: ctx.price,
    targetHighPrice: round(target * 1.3, 2),
    targetLowPrice: round(target * 0.75, 2),
    targetMeanPrice: round(target, 2),
    targetMedianPrice: round(target * 1.01, 2),
    recommendationMean: figures.recommendationMean,
    recommendationKey: recommendationKey(figures.recommendationMean),
    numberOfAnalystOpinions: figures.analysts,
    totalCash: Math.round(figures.totalCash),
    totalCashPerShare: round(figures.totalCash / figures.sharesOutstanding, 3),
    ebitda: Math.round(figures.revenueTtm * figures.ebitdaMargin),
    totalDebt: Math.round(figures.totalDebt),
    quickRatio: round(between(0.6, 2.5, ctx.security.symbol, "quick"), 3),
    currentRatio: round(between(0.9, 3, ctx.security.symbol, "current"), 3),
    totalRevenue: Math.round(figures.revenueTtm),
    debtToEquity: round(figures.debtToEquityPercent, 3),
    revenuePerShare: round(figures.revenueTtm / figures.sharesOutstanding, 3),
    returnOnAssets: round(figures.returnOnAssets, 5),
    returnOnEquity: round(figures.returnOnEquity, 5),
    grossProfits: Math.round(figures.revenueTtm * figures.grossMargin),
    freeCashflow: Math.round(operatingCashflow * 0.7),
    operatingCashflow: Math.round(operatingCashflow),
    earningsGrowth: round(figures.earningsGrowth, 4),
    revenueGrowth: round(figures.revenueGrowth, 4),
    grossMargins: round(figures.grossMargin, 5),
    ebitdaMargins: round(figures.ebitdaMargin, 5),
    operatingMargins: round(figures.operatingMargin, 5),
    profitMargins: round(figures.profitMargin, 5),
    financialCurrency: ctx.security.currency === "GBp" ? "GBP" : ctx.security.currency,
  });
}

function nextDates(schedule: EarningsSchedule): Date[] {
  const next = schedule.next.at;
  return schedule.nextEstimated ? [at(next), at(next + 4 * DAY_MS)] : [at(next)];
}

function calendarEventsModule(ctx: Context): Module {
  const { security, latest } = ctx;
  const schedule = earningsSchedule(security, latest);
  const dividends = dividendSchedule(security, latest);
  const announced = announcedDividend(dividends, latest);
  const earnings: Module = schedule
    ? {
        earningsDate: nextDates(schedule),
        earningsCallDate: [at(schedule.next.at + 60 * 60_000)],
        isEarningsDateEstimate: schedule.nextEstimated,
        earningsAverage: schedule.next.epsEstimate,
        earningsLow: round(schedule.next.epsEstimate * 0.92, 2),
        earningsHigh: round(schedule.next.epsEstimate * 1.08, 2),
        revenueAverage: schedule.next.revenueEstimate,
        revenueLow: Math.round(schedule.next.revenueEstimate * 0.96),
        revenueHigh: Math.round(schedule.next.revenueEstimate * 1.04),
      }
    : { earningsDate: [], earningsCallDate: [] };
  const payment = announced ?? dividends?.history.at(-1) ?? null;
  return compact({
    maxAge: 1,
    earnings,
    exDividendDate: payment ? at(localToUtc("America/New_York", payment.exDay, 0)) : undefined,
    dividendDate: payment ? at(localToUtc("America/New_York", payment.payDay, 0)) : undefined,
  });
}

const CITIES = [
  ["Austin", "TX", "78701"],
  ["Denver", "CO", "80202"],
  ["Seattle", "WA", "98101"],
  ["Chicago", "IL", "60601"],
  ["Boston", "MA", "02110"],
  ["Atlanta", "GA", "30303"],
  ["San Jose", "CA", "95113"],
  ["Charlotte", "NC", "28202"],
] as const;
const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Sam", "Robin"];
const LAST_NAMES = ["Rivera", "Chen", "Patel", "Novak", "Okafor", "Lindqvist", "Moreau", "Tanaka", "Silva", "Kowalski", "Haddad", "Brennan"];
const OFFICER_TITLES = ["Chief Executive Officer & Director", "Chief Financial Officer", "Chief Operating Officer", "General Counsel & Secretary", "Chief Technology Officer"];

function personName(...parts: Array<string | number>): string {
  return `${FIRST_NAMES[pick(FIRST_NAMES.length, ...parts, "first")]} ${LAST_NAMES[pick(LAST_NAMES.length, ...parts, "last")]}`;
}

function slug(symbol: string): string {
  return symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A plain description that says it is test data. */
function businessSummary(security: Security): string {
  if (security.type === "ETF" || security.type === "MUTUALFUND") {
    const category = security.fund?.category ?? "equity";
    return `${security.name} seeks investment results that correspond to its benchmark in the ${category.toLowerCase()} category. The fund holds a diversified portfolio and is rebalanced periodically. This description is synthetic fixture data used by InvestSeek's automated tests.`;
  }
  if (security.type === "CRYPTOCURRENCY") {
    return `${security.name} tracks the price of the ${security.symbol.split("-")[0]} digital asset in ${security.currency}. This description is synthetic fixture data used by InvestSeek's automated tests.`;
  }
  const industry = (security.industry ?? "diversified").toLowerCase();
  const sector = (security.sector ?? "industrial").toLowerCase();
  return `${security.name} develops, makes and sells products and services in the ${industry} industry, part of the ${sector} sector. The company serves consumers and businesses through direct sales, distribution partners and online channels, and invests in research to extend its product lines. This description is synthetic fixture data used by InvestSeek's automated tests.`;
}

function assetProfileModule(ctx: Context): Module {
  const { security } = ctx;
  if (security.type === "ETF" || security.type === "MUTUALFUND") {
    return { longBusinessSummary: businessSummary(security), companyOfficers: [], executiveTeam: [], maxAge: 86400 };
  }
  if (security.type === "CRYPTOCURRENCY") {
    return {
      website: `https://example.com/fixtures/crypto/${slug(security.symbol)}`,
      companyOfficers: [],
      name: security.symbol.split("-")[0],
      startDate: at(dailyStamp(security.profile, security.profile.epoch)),
      description: businessSummary(security),
      executiveTeam: [],
      maxAge: 86400,
    };
  }
  const figures = companyFigures(security);
  const [city, state, zip] = CITIES[pick(CITIES.length, security.symbol, "city")];
  const us = security.country === "United States";
  const sectorKey = security.sectorKey ?? "industrials";
  return compact({
    address1: `${100 + pick(900, security.symbol, "street")} Fixture Way`,
    city: us ? city : "Example City",
    state: us ? state : undefined,
    zip: us ? zip : undefined,
    country: security.country ?? "United States",
    phone: "555 0100",
    website: `https://example.com/company/${slug(security.symbol)}`,
    industry: security.industry,
    industryKey: slug(security.industry ?? "other"),
    industryDisp: security.industry,
    sector: security.sector ?? YAHOO_SECTORS[sectorKey],
    sectorKey: slug(security.sector ?? YAHOO_SECTORS[sectorKey]),
    sectorDisp: security.sector ?? YAHOO_SECTORS[sectorKey],
    longBusinessSummary: businessSummary(security),
    fullTimeEmployees: figures.employees,
    companyOfficers: OFFICER_TITLES.map((title, i) => ({
      maxAge: 1,
      name: personName(security.symbol, "officer", i),
      age: 45 + pick(20, security.symbol, "age", i),
      title,
      yearBorn: yearOf(ctx.latest) - 46 - pick(20, security.symbol, "age", i),
      fiscalYear: yearOf(ctx.latest) - 1,
      totalPay: Math.round(between(1.5e6, 9e6, security.symbol, "pay", i)),
      exercisedValue: 0,
      unexercisedValue: 0,
    })),
    auditRisk: 1 + pick(10, security.symbol, "audit"),
    boardRisk: 1 + pick(10, security.symbol, "board"),
    compensationRisk: 1 + pick(10, security.symbol, "comp"),
    shareHolderRightsRisk: 1 + pick(10, security.symbol, "rights"),
    overallRisk: 1 + pick(10, security.symbol, "overall"),
    governanceEpochDate: midnight(ctx.latest - 10),
    compensationAsOfEpochDate: midnight(dayNumber(yearOf(ctx.latest) - 1, 12, 31)),
    irWebsite: `https://example.com/company/${slug(security.symbol)}/investors`,
    executiveTeam: [],
    maxAge: 86400,
  });
}

// ---------------------------------------------------------------------------
// Earnings modules
// ---------------------------------------------------------------------------

/** Yahoo's calendar quarter label of a quarter end ("3Q2026" for 2026-09-30). */
export function quarterLabel(periodEnd: number): string {
  const date = new Date(periodEnd * DAY_MS);
  return `${Math.floor(date.getUTCMonth() / 3) + 1}Q${date.getUTCFullYear()}`;
}

function earningsModule(ctx: Context, schedule: EarningsSchedule): Module {
  const figures = companyFigures(ctx.security);
  const recent = schedule.history.slice(-4);
  const lastYear = lastReportedYear(schedule);
  return {
    maxAge: 86400,
    earningsChart: {
      quarterly: recent.map((report) => {
        const actual = report.epsActual ?? 0;
        return {
          date: quarterLabel(report.periodEnd),
          actual,
          estimate: report.epsEstimate,
          fiscalQuarter: quarterLabel(report.periodEnd),
          calendarQuarter: quarterLabel(report.periodEnd),
          difference: (actual - report.epsEstimate).toFixed(2),
          surprisePct: report.epsEstimate ? (((actual - report.epsEstimate) / Math.abs(report.epsEstimate)) * 100).toFixed(2) : "0",
          periodEndDate: midnight(report.periodEnd),
          reportedDate: at(report.at),
        };
      }),
      currentQuarterEstimate: schedule.next.epsEstimate,
      currentQuarterEstimateDate: quarterLabel(schedule.next.periodEnd).slice(0, 2),
      currentQuarterEstimateYear: new Date(schedule.next.periodEnd * DAY_MS).getUTCFullYear(),
      earningsDate: nextDates(schedule),
      isEarningsDateEstimate: schedule.nextEstimated,
      currentCalendarQuarter: quarterLabel(schedule.next.periodEnd),
      currentFiscalQuarter: quarterLabel(schedule.next.periodEnd),
      currentPeriodEndDate: midnight(schedule.next.periodEnd),
    },
    financialsChart: {
      // The four latest fully reported years, as the sums of their quarters.
      yearly: [3, 2, 1, 0].map((back) => {
        const { eps, revenue } = yearResult(ctx.security, lastYear - back, schedule.history.at(-1)?.periodEnd ?? 0);
        const earnings = Math.round(eps * figures.sharesOutstanding);
        return { date: lastYear - back, revenue, earnings, profitMargin: revenue ? round(earnings / revenue, 4) : 0 };
      }),
      quarterly: recent.map((report) => {
        const revenue = report.revenueActual ?? 0;
        const earnings = Math.round((report.epsActual ?? 0) * figures.sharesOutstanding);
        return { date: quarterLabel(report.periodEnd), revenue, earnings, fiscalQuarter: quarterLabel(report.periodEnd), profitMargin: revenue ? round(earnings / revenue, 4) : 0 };
      }),
    },
    financialCurrency: ctx.security.currency,
    defaultMethodology: "gaap",
  };
}

function earningsHistoryModule(ctx: Context, schedule: EarningsSchedule): Module {
  const recent = schedule.history.slice(-4);
  return {
    history: recent.map((report, i) => {
      const actual = report.epsActual ?? 0;
      return {
        maxAge: 1,
        epsActual: actual,
        epsEstimate: report.epsEstimate,
        epsDifference: round(actual - report.epsEstimate, 2),
        surprisePercent: report.epsEstimate ? round((actual - report.epsEstimate) / Math.abs(report.epsEstimate), 4) : 0,
        quarter: midnight(report.periodEnd),
        period: `-${recent.length - i}q`,
        currency: ctx.security.currency,
      };
    }),
    maxAge: 86400,
    defaultMethodology: "gaap",
  };
}

function trendRow(ctx: Context, period: string, endDay: number, epsAvg: number, revenueAvg: number, yearAgoEps: number, yearAgoRevenue: number): Module {
  const s = ctx.security.symbol;
  const analysts = Math.max(4, companyFigures(ctx.security).analysts - 6 - pick(6, s, period));
  const drift = (days: number) => round(epsAvg * (1 - between(-0.01, 0.03, s, period, days) * (days / 90)), 5);
  return {
    maxAge: 1,
    period,
    endDate: midnight(endDay),
    growth: yearAgoEps ? round(epsAvg / yearAgoEps - 1, 4) : null,
    earningsEstimate: {
      avg: round(epsAvg, 5),
      low: round(epsAvg * 0.9, 5),
      high: round(epsAvg * 1.1, 5),
      yearAgoEps: round(yearAgoEps, 5),
      numberOfAnalysts: analysts,
      growth: yearAgoEps ? round(epsAvg / yearAgoEps - 1, 4) : null,
      earningsCurrency: ctx.security.currency,
    },
    revenueEstimate: {
      avg: Math.round(revenueAvg),
      low: Math.round(revenueAvg * 0.96),
      high: Math.round(revenueAvg * 1.04),
      numberOfAnalysts: Math.max(3, analysts - 2),
      yearAgoRevenue: Math.round(yearAgoRevenue),
      growth: yearAgoRevenue ? round(revenueAvg / yearAgoRevenue - 1, 4) : null,
      revenueCurrency: ctx.security.currency,
    },
    epsTrend: { current: round(epsAvg, 5), "7daysAgo": drift(7), "30daysAgo": drift(30), "60daysAgo": drift(60), "90daysAgo": drift(90), epsTrendCurrency: ctx.security.currency },
    epsRevisions: {
      upLast7days: pick(4, s, period, "up7"),
      upLast30days: pick(9, s, period, "up30"),
      downLast7Days: pick(2, s, period, "down7"),
      downLast30days: pick(4, s, period, "down30"),
      epsRevisionsCurrency: ctx.security.currency,
    },
  };
}

/**
 * Consensus for the next two quarters and the current and next calendar years, from the same quarter model as the
 * reported figures: year-ago values are reported results, a year mixes reported quarters with estimates.
 */
function earningsTrendModule(ctx: Context, schedule: EarningsSchedule): Module {
  const security = ctx.security;
  const next = schedule.next;
  const lastReported = schedule.history.at(-1)?.periodEnd ?? shiftQuarterEnd(next.periodEnd, -3);
  const followingEnd = shiftQuarterEnd(next.periodEnd, 3);
  const following = quarterResult(security, followingEnd);
  const yearAgo = quarterResult(security, shiftQuarterEnd(next.periodEnd, -12));
  const yearAgoFollowing = quarterResult(security, shiftQuarterEnd(followingEnd, -12));
  const year = yearOf(next.periodEnd);
  const lastYear = yearResult(security, year - 1, lastReported);
  const thisYear = yearResult(security, year, lastReported);
  const nextYear = yearResult(security, year + 1, lastReported);
  return {
    trend: [
      trendRow(ctx, "0q", next.periodEnd, next.epsEstimate, next.revenueEstimate, yearAgo.eps, yearAgo.revenue),
      trendRow(ctx, "+1q", followingEnd, following.epsEstimate, following.revenueEstimate, yearAgoFollowing.eps, yearAgoFollowing.revenue),
      trendRow(ctx, "0y", dayNumber(year, 12, 31), thisYear.eps, thisYear.revenue, lastYear.eps, lastYear.revenue),
      trendRow(ctx, "+1y", dayNumber(year + 1, 12, 31), nextYear.eps, nextYear.revenue, thisYear.eps, thisYear.revenue),
    ],
    maxAge: 1,
    defaultMethodology: "gaap",
  };
}

// ---------------------------------------------------------------------------
// Analysts and ownership
// ---------------------------------------------------------------------------

const FIRMS = [
  "Northwind Securities",
  "Blue Harbor Capital",
  "Granite Peak Research",
  "Meridian Partners",
  "Summit Ridge Advisors",
  "Harborview Equity",
  "Atlas Street Research",
  "Kestrel & Co.",
  "Lakeshore Markets",
  "Copperfield Analytics",
];
/** Rating scales, best grade first: each firm rates on one of them. */
const SCALES: ReadonlyArray<readonly string[]> = [
  ["Buy", "Hold", "Sell"],
  ["Outperform", "Market Perform", "Underperform"],
  ["Overweight", "Equal-Weight", "Underweight"],
  ["Buy", "Neutral", "Sell"],
  ["Outperform", "Neutral", "Underperform"],
];

function recommendationTrendModule(ctx: Context): Module {
  const figures = companyFigures(ctx.security);
  const s = ctx.security.symbol;
  return {
    trend: ["0m", "-1m", "-2m", "-3m"].map((period) => {
      const total = Math.max(5, figures.analysts - pick(4, s, period, "total"));
      const bullish = Math.round(total * Math.min(0.9, Math.max(0.2, (3.2 - figures.recommendationMean) / 2)));
      const strongBuy = Math.round(bullish * between(0.25, 0.5, s, period, "sb"));
      const sell = pick(3, s, period, "sell");
      const strongSell = pick(2, s, period, "ss");
      return { period, strongBuy, buy: bullish - strongBuy, hold: Math.max(0, total - bullish - sell - strongSell), sell, strongSell };
    }),
    maxAge: 86400,
  };
}

/**
 * Twelve rating actions, newest first, about eleven days apart. Each comes out on a trading day at a New York time
 * between 07:00 and 17:00, as Yahoo stamps them; each firm keeps its own rating scale, and its next action starts from
 * the grade and price target of its previous one (a firm's first action in the list may be an initiation).
 */
function upgradeDowngradeModule(ctx: Context): Module {
  const s = ctx.security.symbol;
  const figures = companyFigures(ctx.security);
  const previous = new Map<string, { grade: number; target: number }>();
  const history: Module[] = [];
  // Oldest first, so each firm's previous action is known.
  for (let i = 11; i >= 0; i--) {
    const day = tradingDayOnOrBefore(PROFILES.us, ctx.latest - (3 + i * 11 + pick(6, s, "grade-day", i)));
    const firm = FIRMS[pick(FIRMS.length, s, "firm", i)];
    const scale = SCALES[pick(SCALES.length, firm, "scale")];
    // Mostly the top or the middle grade, now and then the bottom one.
    const to = pick(10, s, "to", i) < 9 ? pick(2, s, "to-grade", i) : scale.length - 1;
    const last = previous.get(firm);
    const from = last ? last.grade : i % 5 === 4 ? null : pick(scale.length, s, "from", i);
    const action = from === null ? "init" : to === from ? "main" : to < from ? "up" : "down";
    const prior = last?.target ?? round(ctx.price * figures.targetRatio * between(0.88, 1.02, s, "prior", i), 0);
    const current = round(prior * between(0.97, 1.12, s, "current", i), 0);
    previous.set(firm, { grade: to, target: current });
    history.unshift({
      epochGradeDate: at(localToUtc("America/New_York", day, 7 * 60 + pick(600, s, "grade-time", i))),
      firm,
      toGrade: scale[to],
      fromGrade: from === null ? "" : scale[from],
      action,
      priceTargetAction: action === "init" ? "Announces" : current > prior ? "Raises" : current < prior ? "Lowers" : "Maintains",
      currentPriceTarget: current,
      priorPriceTarget: action === "init" ? 0 : prior,
    });
  }
  return { history, maxAge: 86400 };
}

function insiderTransactionsModule(ctx: Context): Module {
  const s = ctx.security.symbol;
  const transactions = Array.from({ length: 8 }, (_, i) => {
    const kind = pick(5, s, "insider-kind", i);
    const shares = 2_000 + pick(60_000, s, "insider-shares", i);
    const price = round(ctx.price * between(0.9, 1.05, s, "insider-price", i), 2);
    const sale = kind <= 2;
    const text = sale ? `Sale at price ${price.toFixed(2)} per share.` : kind === 3 ? "Stock Award(Grant) at price 0.00 per share." : `Purchase at price ${price.toFixed(2)} per share.`;
    return {
      maxAge: 1,
      shares,
      filerUrl: "",
      transactionText: text,
      filerName: personName(s, "insider", i % 4).toUpperCase(),
      filerRelation: OFFICER_TITLES[i % OFFICER_TITLES.length].replace(" & Director", ""),
      moneyText: "",
      startDate: midnight(ctx.latest - 4 - i * 9),
      ownership: i % 3 === 2 ? "I" : "D",
      value: kind === 3 ? 0 : Math.round(shares * price),
    };
  });
  return { transactions, maxAge: 1 };
}

function netSharePurchaseModule(ctx: Context): Module {
  const s = ctx.security.symbol;
  const figures = companyFigures(ctx.security);
  const totalInsider = Math.round(figures.sharesOutstanding * figures.insidersPercentHeld);
  const buy = 10_000 + pick(400_000, s, "buy");
  const sell = 50_000 + pick(900_000, s, "sell");
  return {
    maxAge: 1,
    period: "6m",
    buyInfoCount: 2 + pick(12, s, "buycount"),
    buyInfoShares: buy,
    buyPercentInsiderShares: round(buy / Math.max(1, totalInsider), 6),
    sellInfoCount: 4 + pick(20, s, "sellcount"),
    sellInfoShares: sell,
    sellPercentInsiderShares: round(sell / Math.max(1, totalInsider), 6),
    netInfoCount: 20,
    netInfoShares: buy - sell,
    netPercentInsiderShares: round((buy - sell) / Math.max(1, totalInsider), 6),
    totalInsiderShares: totalInsider,
    netInstSharesBuying: Math.round(figures.sharesOutstanding * between(-0.01, 0.01, s, "inst")),
    netInstBuyingPercent: round(between(-0.01, 0.01, s, "instpct"), 4),
  };
}

function majorHoldersModule(ctx: Context): Module {
  const figures = companyFigures(ctx.security);
  return {
    maxAge: 1,
    insidersPercentHeld: round(figures.insidersPercentHeld, 5),
    institutionsPercentHeld: round(figures.institutionsPercentHeld, 5),
    institutionsFloatPercentHeld: round(figures.institutionsPercentHeld / (1 - figures.insidersPercentHeld), 5),
    institutionsCount: 800 + pick(4000, ctx.security.symbol, "institutions"),
  };
}

const INSTITUTIONS = [
  "Evergreen Index Advisors",
  "Northbridge Asset Management",
  "Cobalt Street Investors",
  "Pinecrest Capital",
  "Silverline Pension Trust",
  "Riverbend Global",
  "Oakmont Fund Partners",
  "Bluewater Holdings",
  "Highgate Investment Co.",
  "Fairhaven Advisors",
];

function ownershipModule(ctx: Context, kind: "institution" | "fund"): Module {
  const s = ctx.security.symbol;
  const figures = companyFigures(ctx.security);
  const reportDay = dayNumber(yearOf(ctx.latest - 45), Math.floor(new Date((ctx.latest - 45) * DAY_MS).getUTCMonth() / 3) * 3 + 1, 0);
  const ownershipList = INSTITUTIONS.map((name, i) => {
    const pctHeld = round((kind === "fund" ? 0.035 : 0.09) / (1 + i * 0.6) * between(0.8, 1.2, s, kind, i), 4);
    const position = Math.round(figures.sharesOutstanding * pctHeld);
    return {
      maxAge: 1,
      reportDate: midnight(reportDay),
      organization: kind === "fund" ? name.replace(/(Advisors|Management|Investors|Capital|Trust|Global|Partners|Holdings|Co\.)$/, "Index Fund") : name,
      pctHeld,
      position,
      value: Math.round(position * ctx.price),
      pctChange: round(between(-0.05, 0.08, s, kind, "change", i), 4),
    };
  });
  return { maxAge: 1, ownershipList };
}

// ---------------------------------------------------------------------------
// Fund modules
// ---------------------------------------------------------------------------

const YAHOO_WEIGHT_KEYS: Readonly<Record<SectorKey, string>> = {
  technology: "technology",
  communication: "communication_services",
  "consumer-discretionary": "consumer_cyclical",
  "consumer-staples": "consumer_defensive",
  healthcare: "healthcare",
  financials: "financial_services",
  industrials: "industrials",
  energy: "energy",
  materials: "basic_materials",
  utilities: "utilities",
  "real-estate": "realestate",
};

function holdingsPool(security: Security): Security[] {
  const focus = security.fund?.focus ?? "broad";
  const universe = UNIVERSE_STOCKS.map((symbol) => securityOf(symbol)).filter((s): s is Security => s !== null);
  if (focus === "china") return ["BABA", "PDD", "JD", "BIDU", "NTES", "TCOM", "0700.HK", "3690.HK", "1810.HK", "BEKE"].map((symbol) => securityOf(symbol)).filter((s): s is Security => s !== null);
  if (focus === "gold" || focus === "bonds") return [];
  if (focus === "growth") return universe.filter((s) => s.sectorKey === "technology" || s.sectorKey === "communication" || s.symbol === "AMZN" || s.symbol === "TSLA");
  if (focus === "smallcap") return [...universe].sort((a, b) => (a.sizeAtAnchor ?? 0) - (b.sizeAtAnchor ?? 0)).slice(0, 15);
  if (focus === "broad") return universe;
  return universe.filter((s) => s.sectorKey === focus);
}

function topHoldingsModule(ctx: Context): Module {
  const { security } = ctx;
  const pool = holdingsPool(security).sort((a, b) => (b.sizeAtAnchor ?? 0) - (a.sizeAtAnchor ?? 0));
  const top = pool.slice(0, 10);
  const total = pool.reduce((sum, s) => sum + (s.sizeAtAnchor ?? 0), 0) || 1;
  // Funds report their top ten holdings, which together hold a share of the fund, in proportion to their size.
  const share = security.fund?.focus === "broad" ? 0.38 : 0.62;
  const topTotal = top.reduce((sum, s) => sum + (s.sizeAtAnchor ?? 0), 0) || 1;
  const holdings = top.map((s) => ({ symbol: s.symbol, holdingName: s.name, holdingPercent: round(((s.sizeAtAnchor ?? 0) / topTotal) * share, 4) }));
  const weights = new Map<string, number>();
  for (const s of pool) {
    const key = YAHOO_WEIGHT_KEYS[s.sectorKey ?? "industrials"];
    weights.set(key, (weights.get(key) ?? 0) + (s.sizeAtAnchor ?? 0) / total);
  }
  const bonds = security.fund?.focus === "bonds";
  const gold = security.fund?.focus === "gold";
  return {
    maxAge: 1,
    stockPosition: bonds || gold ? 0 : 0.995,
    bondPosition: bonds ? 0.995 : 0,
    cashPosition: 0.005,
    otherPosition: gold ? 0.995 : 0,
    preferredPosition: 0,
    convertiblePosition: 0,
    holdings,
    equityHoldings: { priceToBook: round(between(2, 8, security.symbol, "pb"), 2), priceToCashflow: round(between(10, 25, security.symbol, "pcf"), 2), priceToEarnings: round(between(15, 32, security.symbol, "pe"), 2), priceToSales: round(between(1.5, 6, security.symbol, "psa"), 2) },
    bondHoldings: {},
    bondRatings: bonds ? [{ us_government: 0.99 }, { other: 0.01 }] : [],
    sectorWeightings: [...weights.entries()].map(([key, weight]) => ({ [key]: round(weight, 4) })),
  };
}

function fundProfileModule(ctx: Context): Module {
  const { security } = ctx;
  const fund = security.fund;
  const expense = fund?.expenseRatio ?? 0.005;
  const assets = Math.round((security.sizeAtAnchor ?? 0) * (ctx.price / security.anchorPrice));
  return {
    maxAge: 1,
    styleBoxUrl: null,
    family: fund?.family ?? null,
    categoryName: fund?.category ?? null,
    legalType: security.type === "ETF" ? "Exchange Traded Fund" : null,
    managementInfo: { managerName: null, managerBio: null },
    feesExpensesInvestment: { annualHoldingsTurnover: round(between(0.02, 0.4, security.symbol, "turnover"), 4), annualReportExpenseRatio: expense, netExpRatio: expense, totalNetAssets: round(assets / 1e6, 2), projectionValues: {} },
    feesExpensesInvestmentCat: { annualHoldingsTurnover: 0.42, annualReportExpenseRatio: 0.0085, totalNetAssets: 0, projectionValuesCat: {} },
    brokerages: [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Drops undefined fields, as JSON parsing (and the library after it) would never produce them. */
function compact(fields: Module): Module {
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
  return fields;
}

export interface FixtureSummaryOptions {
  modules?: readonly string[] | "all";
}

/** Yahoo's error for an unknown symbol. */
export function quoteNotFound(symbol: string): Error {
  return new Error(`Quote not found for symbol: ${symbol}`);
}

/** quoteSummary(symbol, { modules }) in fixture mode. */
export function buildSummary(symbol: string, options: FixtureSummaryOptions | undefined, now: number): Record<string, Module> {
  const security = securityOf(symbol);
  if (!security) throw quoteNotFound(symbol);
  const ctx = contextOf(security, now);
  if (!ctx) throw quoteNotFound(symbol);
  const requested = options?.modules === "all" ? FIXTURE_SUMMARY_MODULES : (options?.modules ?? DEFAULT_MODULES);
  const available = new Set(AVAILABLE[security.type]);
  const schedule = earningsSchedule(security, ctx.latest);
  const result: Record<string, Module> = {};
  for (const name of requested) {
    if (!available.has(name)) continue;
    const built = buildModule(name, ctx, schedule);
    if (built) result[name] = built;
  }
  if (Object.keys(result).length === 0) throw new Error(`No fundamentals data found for symbol: ${security.symbol}`);
  return result;
}

function buildModule(name: string, ctx: Context, schedule: EarningsSchedule | null): Module | null {
  switch (name) {
    case "price":
      return priceModule(ctx);
    case "summaryDetail":
      return summaryDetailModule(ctx);
    case "defaultKeyStatistics":
      return keyStatisticsModule(ctx);
    case "financialData":
      return financialDataModule(ctx);
    case "calendarEvents":
      return calendarEventsModule(ctx);
    case "assetProfile":
      return assetProfileModule(ctx);
    case "earnings":
      return schedule ? earningsModule(ctx, schedule) : null;
    case "earningsHistory":
      return schedule ? earningsHistoryModule(ctx, schedule) : null;
    case "earningsTrend":
      return schedule ? earningsTrendModule(ctx, schedule) : null;
    case "recommendationTrend":
      return recommendationTrendModule(ctx);
    case "upgradeDowngradeHistory":
      return upgradeDowngradeModule(ctx);
    case "insiderTransactions":
      return insiderTransactionsModule(ctx);
    case "netSharePurchaseActivity":
      return netSharePurchaseModule(ctx);
    case "majorHoldersBreakdown":
      return majorHoldersModule(ctx);
    case "institutionOwnership":
      return ownershipModule(ctx, "institution");
    case "fundOwnership":
      return ownershipModule(ctx, "fund");
    case "topHoldings":
      return topHoldingsModule(ctx);
    case "fundProfile":
      return fundProfileModule(ctx);
    default:
      return null;
  }
}
