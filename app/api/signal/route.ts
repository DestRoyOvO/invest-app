import { NextResponse } from 'next/server';
import { computeSignal, backtest, DailyBar, Fundamentals } from '@/lib/signal';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const pkg = require('yahoo-finance2');
    let yf = pkg.default || pkg;
    if (!yf.quote && yf.YahooFinance) yf = new yf.YahooFinance();
    else if (typeof yf === 'function') yf = new yf();
    if (!yf.quote && pkg.YahooFinance) yf = new pkg.YahooFinance();
    try { if (yf._opts) yf._opts.suppressNotices = ['yahooSurvey', 'ripHistorical']; } catch (e) {}

    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const backtestDaysParam = searchParams.get('backtestDays');
    const backtestDays = backtestDaysParam ? parseInt(backtestDaysParam, 10) : 60;

    if (!ticker) {
      return NextResponse.json({ error: 'Missing ticker parameter' }, { status: 400 });
    }

    // Pull 18 months of data (need 100d lookback + 60d backtest + hold period)
    const period1 = new Date();
    period1.setDate(period1.getDate() - 540);

    const [quote, chartResult, summary] = await Promise.all([
      yf.quote(ticker),
      yf.chart(ticker, { period1, interval: '1d' }, { validateResult: false }).catch(() => null),
      yf.quoteSummary(ticker, {
        modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'incomeStatementHistory']
      }, { validateResult: false }).catch(() => ({})),
    ]);

    const bars: DailyBar[] = (chartResult?.quotes || [])
      .filter((q: any) => q.date && typeof q.close === 'number' && typeof q.open === 'number' && typeof q.high === 'number' && typeof q.low === 'number')
      .map((q: any) => ({
        date: new Date(q.date).getTime(),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
      }));

    const getMetric = (path: string[]) => {
      let current: any = summary;
      for (const key of path) { if (!current) return undefined; current = current[key]; }
      return current;
    };

    const fundamentals: Fundamentals = {
      pe: quote?.trailingPE
        ?? getMetric(['summaryDetail', 'trailingPE'])
        ?? undefined,
      roe: getMetric(['financialData', 'returnOnEquity'])
        ?? getMetric(['defaultKeyStatistics', 'returnOnEquity'])
        ?? undefined,
      profitMargin: getMetric(['financialData', 'profitMargins'])
        ?? getMetric(['defaultKeyStatistics', 'profitMargins'])
        ?? undefined,
      revenueGrowth: getMetric(['financialData', 'revenueGrowth'])
        ?? undefined,
      debtToEquity: getMetric(['financialData', 'debtToEquity'])
        ? (getMetric(['financialData', 'debtToEquity']) / 100) // Yahoo reports as percentage
        : undefined,
    };

    const signal = computeSignal(ticker.toUpperCase(), bars, fundamentals);

    // Multi-period backtest: test 3d, 5d, 10d hold periods simultaneously
    const holdPeriods = [3, 5, 10];
    const backtests: Record<string, any> = {};
    for (const hold of holdPeriods) {
      const minBars = 100 + backtestDays + hold;
      if (bars.length >= minBars) {
        const result = backtest(bars, fundamentals, backtestDays, hold);
        if (result) backtests[`${hold}d`] = result;
      }
    }

    return NextResponse.json({
      ...signal,
      backtests,
    });
  } catch (error: any) {
    console.error('Signal API Error:', error);
    return NextResponse.json(
      { error: 'Failed to compute signal', details: String(error) },
      { status: 500 }
    );
  }
}
