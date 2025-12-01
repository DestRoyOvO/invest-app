import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// --- 1. 宏观/板块搜索词生成 (保持原样) ---
function getMacroSearchTerm(sector: string | undefined): string {
    if (!sector) return "Stock Market News";
    
    switch (sector) {
        case 'Energy': return "Energy Sector Oil Gas News";
        case 'Technology': return "Technology Sector AI Chips";
        case 'Financial Services': return "Financial Sector Banks Fed";
        case 'Basic Materials': return "Mining Commodities Sector News";
        case 'Consumer Cyclical': return "Retail Consumer Spending News";
        case 'Consumer Defensive': return "Consumer Staples Inflation News";
        case 'Healthcare': return "Healthcare Sector Biotech News";
        case 'Real Estate': return "Real Estate Housing Market";
        case 'Industrials': return "Industrial Sector Manufacturing";
        case 'Utilities': return "Utilities Sector Energy Grid";
        case 'Communication Services': return "Communication Services Telecom";
        default: return `${sector} Sector Market News`;
    }
}

// --- 2. 简单的关键词相关性检查 (保持原样) ---
function isRelevantNews(newsItem: any, sector: string | undefined): boolean {
    if (!sector) return true;
    const title = (newsItem.title || "").toLowerCase();
    const sectorLower = sector.toLowerCase();
    
    const keywords: Record<string, string[]> = {
        'Energy': ['oil', 'gas', 'energy', 'crude', 'petroleum', 'drill', 'opec', 'pipeline', 'merger', 'acquisition'],
        'Technology': ['tech', 'chip', 'ai', 'software', 'data', 'cyber', 'semiconductor'],
        'Healthcare': ['health', 'drug', 'fda', 'med', 'bio', 'pharma', 'cancer', 'vaccine'],
        'Financial Services': ['bank', 'fed', 'rate', 'loan', 'credit', 'finance', 'invest'],
    };

    const targetKeywords = keywords[sector];
    if (!targetKeywords) return true;

    return targetKeywords.some(k => title.includes(k)) || title.includes(sectorLower);
}

// --- 3. 智能财报日期处理 (保持原样) ---
function formatEarningsDate(rawDate: any) {
    if (!rawDate) return '-';
    
    try {
        const date = new Date(rawDate);
        const now = new Date();
        now.setDate(now.getDate() - 1);
        
        if (date < now) {
            return "Awaiting Update"; 
        }
        return date.toLocaleDateString();
    } catch (e) {
        return '-';
    }
}

export async function GET(request: Request) {
  try {
    const pkg = require('yahoo-finance2');
    let yf = pkg.default || pkg;
    
    if (!yf.quote && yf.YahooFinance) yf = new yf.YahooFinance();
    else if (typeof yf === 'function') yf = new yf();
    if (!yf.quote && pkg.YahooFinance) yf = new pkg.YahooFinance();
    
    try {
        if (yf._opts) yf._opts.suppressNotices = ['yahooSurvey', 'ripHistorical'];
    } catch (e) { /* ignore */ }
    
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const newsQuery = searchParams.get('news'); 
    const watchlistQuery = searchParams.get('watchlist');

    const getDateAgo = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() - days);
        return date; 
    };

    // --- 1. 板块/新闻查询 (保持原样) ---
    if (newsQuery) {
      try {
        const q = newsQuery.includes("news") ? newsQuery : `${newsQuery} finance news`;
        const result = await yf.search(q, { newsCount: 6 });
        const news = result.news.map((item: any, index: number) => ({
          id: index,
          title: item.title,
          link: item.link,
          source: item.providerPublishTime ? new Date(item.providerPublishTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "Yahoo",
          time: "Live",
          tag: "Sector"
        }));
        return NextResponse.json({ news });
      } catch (e) {
        return NextResponse.json({ news: [] });
      }
    }

    // --- 2. 个股详情 (保持原样) ---
    if (ticker) {
      try {
        const quote = await yf.quote(ticker);
        const companyName = quote.shortName || quote.longName || ticker;
        const newsSearchTerm = `"${companyName}"`; 

        const summary = await yf.quoteSummary(ticker, { 
            modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'calendarEvents', 'summaryProfile'] 
        }, { validateResult: false }).catch(() => ({}));

        const sector = summary?.summaryProfile?.sector;
        const macroQuery = getMacroSearchTerm(sector);

        const [newsResult, macroNewsResult, chartResult] = await Promise.all([
          yf.search(newsSearchTerm, { newsCount: 5, quotesCount: 0 }).catch(() => ({ news: [] })), 
          yf.search(macroQuery, { newsCount: 5, quotesCount: 0 }).catch(() => ({ news: [] })), 
          yf.chart(ticker, { period1: getDateAgo(90), interval: '1d' }, { validateResult: false }).catch((e: any) => null)
        ]);
        
        const getMetric = (path: string[]) => {
          let current: any = summary;
          for (const key of path) { if (!current) return undefined; current = current[key]; }
          return current;
        };

        const rawRoe = getMetric(['financialData', 'returnOnEquity']) || getMetric(['defaultKeyStatistics', 'returnOnEquity']);
        const rawMargin = getMetric(['financialData', 'profitMargins']) || getMetric(['defaultKeyStatistics', 'profitMargins']);
        const rawEarningsDate = getMetric(['calendarEvents', 'earnings', 'earningsDate', 0]);

        const chartHistory = (chartResult?.quotes || []).map((q: any) => {
          if (!q.date || typeof q.open !== 'number' || typeof q.high !== 'number' || typeof q.low !== 'number' || typeof q.close !== 'number') return null;
          return { x: new Date(q.date).getTime(), y: [ Number(q.open.toFixed(2)), Number(q.high.toFixed(2)), Number(q.low.toFixed(2)), Number(q.close.toFixed(2)) ] };
        }).filter(Boolean);

        const detailData = {
          symbol: quote.symbol,
          name: quote.shortName || quote.symbol,
          price: (quote.regularMarketPrice || 0).toFixed(2),
          change: formatChange(quote.regularMarketChangePercent),
          isUp: (quote.regularMarketChangePercent || 0) >= 0,
          metrics: {
            marketCap: formatMarketCap(quote.marketCap),
            pe: quote.trailingPE?.toFixed(2) || getMetric(['summaryDetail', 'trailingPE'])?.toFixed(2) || '-',
            eps: quote.epsTrailingTwelveMonths?.toFixed(2) || '-',
            roe: rawRoe ? (rawRoe * 100).toFixed(2) + '%' : '-',
            grossMargin: rawMargin ? (rawMargin * 100).toFixed(2) + '%' : '-',
          },
          earningsDate: formatEarningsDate(rawEarningsDate),
          chartHistory 
        };

        const companyNewsItems = (newsResult.news || []).map((item: any, index: number) => ({
          id: `co-${index}`, title: item.title, link: item.link,
          source: item.providerPublishTime ? new Date(item.providerPublishTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "Yahoo",
          time: "Live", tag: ticker
        }));

        const macroNewsItems = (macroNewsResult.news || [])
            .filter((item: any) => isRelevantNews(item, sector)) 
            .slice(0, 3) 
            .map((item: any, index: number) => ({
                id: `macro-${index}`, title: item.title, link: item.link,
                source: item.providerPublishTime ? new Date(item.providerPublishTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "Industry",
                time: "Live", tag: sector || "Macro"
            }));

        const allNews = [...companyNewsItems, ...macroNewsItems];
        const uniqueNews = Array.from(new Map(allNews.map(item => [item.title, item])).values());

        return NextResponse.json({ detail: detailData, news: uniqueNews });
      } catch (e) {
        return NextResponse.json({ error: `Failed to fetch ticker ${ticker}` }, { status: 404 });
      }
    }

    // --- 3. 市场总览 (仅修复宏观新闻抓取逻辑) ---
    const symbols = {
      indices: ['^GSPC', '^IXIC', '^DJI', '^TNX'],
      Technology: ['NVDA', 'MSFT', 'AAPL', 'AMD', 'ORCL', 'AVGO', 'QCOM', 'INTC', 'TSM', 'CRM'],
      Communication: ['GOOGL', 'META', 'NFLX', 'DIS', 'TMUS', 'CMCSA', 'VZ', 'T'],
      "Consumer Disc.": ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'LULU', 'F', 'GM'],
      Financials: ['JPM', 'V', 'BAC', 'MA', 'GS', 'MS', 'WFC', 'C', 'BLK'],
      Healthcare: ['LLY', 'UNH', 'JNJ', 'MRK', 'PFE', 'ABBV', 'TMO', 'AMGN'],
      etfs: ['SPY', 'QQQ', 'DIA', 'XLK', 'SMH', 'XLC', 'VOX', 'XLY', 'VCR', 'XLF', 'KBE', 'XLV', 'IBB']
    };

    let allStockSymbols = [
      ...symbols.Technology, ...symbols.Communication, 
      ...symbols["Consumer Disc."], ...symbols.Financials, ...symbols.Healthcare
    ];

    let watchlistSymbols: string[] = [];
    if (watchlistQuery) {
        watchlistSymbols = watchlistQuery.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
        const uniqueSymbols = new Set([...allStockSymbols, ...watchlistSymbols]);
        allStockSymbols = Array.from(uniqueSymbols);
    }

    const fetchCharts = async (symbolList: string[]) => {
      const batchSize = 12;
      let allResults: any[] = [];
      const startDate = getDateAgo(25); 
      for (let i = 0; i < symbolList.length; i += batchSize) {
        const batch = symbolList.slice(i, i + batchSize);
        const batchPromises = batch.map(async (sym) => {
          try {
            const res = await yf.chart(sym, { period1: startDate, interval: '1d' }, { validateResult: false });
            const quotes = res?.quotes || [];
            let closes = quotes.map((q: any) => q.close).filter((c: any) => typeof c === 'number');
            if (closes.length > 14) closes = closes.slice(-14);
            return { symbol: sym, trend: closes };
          } catch (e: any) {
            return { symbol: sym, trend: [] };
          }
        });
        allResults = [...allResults, ...await Promise.all(batchPromises)];
      }
      return allResults;
    };

    const [indicesResult, stocksResult, chartResults, etfResult, newsResult] = await Promise.all([
      yf.quote(symbols.indices),
      yf.quote(allStockSymbols), 
      fetchCharts(allStockSymbols), 
      yf.quote(symbols.etfs),
      // [FIX]: 将搜索词简化为 'Stock Market' 并增加数量，确保有结果返回
      yf.search('Stock Market', { newsCount: 10 }).catch(() => ({ news: [] }))
    ]);

    const chartMap = new Map(chartResults.map((c: any) => [c.symbol, c.trend]));

    const indices = (indicesResult as any[] || []).map((item: any) => ({
      name: getIndexName(item.symbol),
      value: (item.regularMarketPrice || item.price || 0).toFixed(2),
      change: formatChange(item.regularMarketChangePercent || item.changePercent),
      isUp: (item.regularMarketChangePercent || item.changePercent || 0) >= 0
    }));

    const formatStock = (item: any) => {
      const trend = chartMap.get(item.symbol) || [];
      return {
        symbol: item.symbol,
        name: item.shortName || item.symbol,
        price: (item.regularMarketPrice || item.price || 0).toFixed(2),
        change: formatChange(item.regularMarketChangePercent || item.changePercent),
        marketCap: formatMarketCap(item.marketCap),
        volume: formatVolume(item.regularMarketVolume || item.volume),
        isUp: (item.regularMarketChangePercent || item.changePercent || 0) >= 0,
        trend: trend 
      };
    };

    const stockMap = new Map((stocksResult as any[]).map((s: any) => [s.symbol, s]));
    
    const sectorStocks: Record<string, any[]> = {};
    ["Technology", "Communication", "Consumer Disc.", "Financials", "Healthcare"].forEach(sector => {
      // @ts-ignore
      sectorStocks[sector] = symbols[sector].map(sym => {
        const data = stockMap.get(sym);
        return data ? formatStock(data) : null;
      }).filter(Boolean);
    });

    const watchlist = watchlistSymbols.map(sym => {
        const data = stockMap.get(sym);
        return data ? formatStock(data) : null;
    }).filter(Boolean);

    const etfs = (etfResult as any[] || []).map(item => ({
      symbol: item.symbol,
      name: item.shortName || item.symbol,
      price: (item.regularMarketPrice || 0).toFixed(2),
      change: formatChange(item.regularMarketChangePercent),
      isUp: (item.regularMarketChangePercent || 0) >= 0
    }));

    // [FIX]: 安全地处理新闻结果，使用可选链
    const newsRaw = (newsResult && newsResult.news) ? newsResult.news : [];
    const news = newsRaw
      .filter((item: any) => !item.title.includes("Stock Market News for"))
      .map((item: any, index: number) => ({
        id: index, title: item.title, link: item.link,
        source: item.providerPublishTime ? new Date(item.providerPublishTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "Yahoo",
        time: "Live", tag: "Market"
      })).slice(0, 6);

    return NextResponse.json({ indices, sectorStocks, etfs, news, watchlist });

  } catch (error: any) {
    return NextResponse.json({ error: 'Failed', details: String(error) }, { status: 500 });
  }
}

function getIndexName(symbol: string) {
  const map: Record<string, string> = { '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^TNX': '10Y Treasury' };
  return map[symbol] || symbol;
}
function formatChange(percent: number | undefined) {
  if (percent === undefined || percent === null) return "0.00%";
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}
function formatMarketCap(cap: number | undefined) {
  if (!cap) return "-";
  if (cap > 1e12) return (cap / 1e12).toFixed(2) + "T";
  if (cap > 1e9) return (cap / 1e9).toFixed(2) + "B";
  return (cap / 1e6).toFixed(2) + "M";
}
function formatVolume(vol: number | undefined) {
  if (!vol) return "-";
  if (vol > 1e9) return (vol / 1e9).toFixed(1) + "B";
  if (vol > 1e6) return (vol / 1e6).toFixed(1) + "M";
  if (vol > 1e3) return (vol / 1e3).toFixed(1) + "K";
  return vol.toString();
}