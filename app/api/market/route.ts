import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// --- 1. Short search terms (Yahoo returns 0 news for 4+ word queries) ---
// Each function returns an array of 2-3 word terms for parallel searching.
function getMacroSearchTerms(sector: string | undefined): string[] {
    if (!sector) return ["stock market"];
    switch (sector) {
        case 'Energy':                return ["oil prices", "OPEC"];
        case 'Technology':            return ["semiconductor AI", "tech earnings"];
        case 'Financial Services':    return ["Federal Reserve", "bank earnings"];
        case 'Basic Materials':       return ["gold prices", "commodity prices"];
        case 'Consumer Cyclical':     return ["consumer spending", "retail sales"];
        case 'Consumer Defensive':    return ["inflation", "consumer staples"];
        case 'Healthcare':            return ["FDA", "biotech"];
        case 'Real Estate':           return ["housing market", "mortgage rates"];
        case 'Industrials':           return ["manufacturing", "supply chain"];
        case 'Utilities':             return ["renewable energy", "energy grid"];
        case 'Communication Services':return ["streaming", "social media"];
        default:                      return ["stock market"];
    }
}

function getIndustrySearchTerms(industry: string | undefined): string[] {
    if (!industry) return [];
    const lower = industry.toLowerCase();

    const industryMap: Record<string, string[]> = {
        'oil & gas e&p':             ['crude oil', 'Iran oil'],
        'oil & gas integrated':      ['crude oil', 'oil supply'],
        'oil & gas midstream':       ['natural gas', 'pipeline'],
        'oil & gas refining':        ['oil refinery', 'gasoline prices'],
        'oil & gas equipment':       ['oil drilling', 'offshore rig'],
        'semiconductors':            ['chip shortage', 'nvidia'],
        'software - infrastructure': ['cloud computing', 'SaaS'],
        'software - application':    ['enterprise software', 'AI software'],
        'consumer electronics':      ['consumer electronics', 'Apple'],
        'internet content':          ['online advertising', 'social media'],
        'banks - diversified':       ['bank earnings', 'interest rate'],
        'banks - regional':          ['regional bank', 'deposits'],
        'insurance':                 ['insurance', 'catastrophe'],
        'capital markets':           ['Wall Street', 'IPO'],
        'asset management':          ['ETF flows', 'asset management'],
        'drug manufacturers':        ['pharma', 'FDA approval'],
        'biotechnology':             ['biotech', 'clinical trials'],
        'medical devices':           ['medical devices', 'surgery'],
        'health care plans':         ['health insurance', 'Medicare'],
        'aerospace & defense':       ['defense', 'military'],
        'auto manufacturers':        ['electric vehicle', 'auto tariff'],
        'residential construction':  ['homebuilder', 'housing starts'],
        'reit - residential':        ['apartment rent', 'housing'],
        'reit - retail':             ['retail REIT', 'shopping mall'],
        'utilities - regulated':     ['utility', 'energy regulation'],
        'solar':                     ['solar energy', 'renewable'],
        'gold':                      ['gold prices', 'safe haven'],
        'copper':                    ['copper prices', 'mining'],
        'steel':                     ['steel tariff', 'steel demand'],
    };

    for (const [key, terms] of Object.entries(industryMap)) {
        if (lower.includes(key)) return terms;
    }
    // Fallback: split industry name into a short 2-word query
    const words = industry.split(/[\s&,/-]+/).filter(w => w.length > 2);
    return words.length >= 2 ? [words.slice(0, 2).join(' ')] : [industry];
}

// --- 2. Scored news relevance (replaces boolean isRelevantNews) ---
const SECTOR_KEYWORDS: Record<string, string[]> = {
    'Energy': ['oil', 'gas', 'energy', 'crude', 'petroleum', 'opec', 'pipeline', 'refinery', 'drill', 'lng', 'sanctions', 'iran', 'russia', 'saudi', 'barrel', 'brent', 'wti', 'geopolitical', 'supply cut', 'tariff'],
    'Technology': ['tech', 'chip', 'ai', 'software', 'data', 'cyber', 'semiconductor', 'cloud', 'saas', 'nvidia', 'datacenter', 'gpu', 'regulation', 'antitrust'],
    'Healthcare': ['health', 'drug', 'fda', 'med', 'bio', 'pharma', 'cancer', 'vaccine', 'clinical', 'trial', 'approval', 'medicare', 'hospital'],
    'Financial Services': ['bank', 'fed', 'rate', 'loan', 'credit', 'finance', 'invest', 'interest', 'yield', 'treasury', 'deposit', 'mortgage', 'default'],
    'Basic Materials': ['mining', 'gold', 'copper', 'steel', 'lithium', 'commodity', 'metal', 'ore', 'chemical', 'tariff'],
    'Consumer Cyclical': ['retail', 'consumer', 'spending', 'amazon', 'luxury', 'auto', 'ev', 'housing', 'e-commerce', 'tariff'],
    'Consumer Defensive': ['grocery', 'staple', 'inflation', 'food', 'beverage', 'tobacco', 'walmart', 'costco', 'consumer'],
    'Industrials': ['manufacturing', 'industrial', 'supply chain', 'defense', 'aerospace', 'infrastructure', 'transport', 'trade', 'tariff'],
    'Real Estate': ['real estate', 'housing', 'mortgage', 'rent', 'reit', 'construction', 'property', 'commercial'],
    'Utilities': ['utility', 'grid', 'renewable', 'solar', 'wind', 'nuclear', 'electric', 'power', 'regulation'],
    'Communication Services': ['streaming', 'social media', 'telecom', 'advertising', 'content', 'media', '5g', 'broadband'],
};

const SPAM_PATTERNS = [
    'top 10', 'top 5', 'best stocks to buy', 'motley fool', 'picks for',
    'could soar', 'must-buy', 'can\'t miss', 'no-brainer', 'millionaire',
    'wall street loves', 'retire rich', 'hidden gem', 'next big thing',
    'buy before', 'skyrocket', 'massive upside', 'get rich',
];

function scoreNewsRelevance(
    newsItem: any,
    ticker: string,
    companyName: string,
    sector: string | undefined,
    industry: string | undefined,
): number {
    const title = (newsItem.title || "").toLowerCase();
    if (!title || title.length < 15) return -10;

    let score = 0;

    // Direct company/ticker mention is highest value
    if (title.includes(ticker.toLowerCase()) || title.includes(companyName.toLowerCase())) {
        score += 35;
    }

    // Industry-specific keyword matches
    if (industry) {
        const industryWords = industry.toLowerCase().split(/[\s&,/-]+/).filter(w => w.length > 2);
        const industryHits = industryWords.filter(w => title.includes(w)).length;
        score += Math.min(industryHits * 10, 25);
    }

    // Sector keyword matches
    if (sector && SECTOR_KEYWORDS[sector]) {
        const hits = SECTOR_KEYWORDS[sector].filter(k => title.includes(k)).length;
        score += Math.min(hits * 8, 20);
    }

    // General finance/market relevance
    const financeTerms = ['market', 'stock', 'earnings', 'revenue', 'profit', 'analyst', 'forecast', 'gdp', 'inflation', 'trade', 'tariff', 'geopolitical', 'war', 'sanction'];
    const financeHits = financeTerms.filter(k => title.includes(k)).length;
    score += Math.min(financeHits * 5, 15);

    // Spam/clickbait penalty
    if (SPAM_PATTERNS.some(p => title.includes(p))) {
        score -= 30;
    }

    return score;
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

    // --- 1. 板块/新闻查询 ---
    if (newsQuery) {
      try {
        const q = newsQuery.includes("news") ? newsQuery : `${newsQuery} news`;
        const result = await yf.search(q, { newsCount: 6, quotesCount: 0 });
        const news = (result.news || []).map((item: any, index: number) => ({
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
        const industry = summary?.summaryProfile?.industry;
        const macroTerms = getMacroSearchTerms(sector);
        const industryTerms = getIndustrySearchTerms(industry);

        const safeSearch = (q: string) =>
            yf.search(q, { newsCount: 5, quotesCount: 0 }).catch(() => ({ news: [] }));

        const [companyNews, chartResult, ...extraResults] = await Promise.all([
          safeSearch(newsSearchTerm),
          yf.chart(ticker, { period1: getDateAgo(90), interval: '1d' }, { validateResult: false }).catch(() => null),
          ...macroTerms.map(q => safeSearch(q)),
          ...industryTerms.map(q => safeSearch(q)),
        ]);

        // Tag results by provenance: macro terms come first, then industry terms
        const macroResults = extraResults.slice(0, macroTerms.length);
        const industryResults = extraResults.slice(macroTerms.length);
        
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

        // Score, tag, and categorize all news from parallel search tracks
        type Provenance = 'company' | 'industry' | 'macro';
        const tagAndScore = (items: any[], defaultSource: string, tag: string, provenance: Provenance) =>
            (items || []).map((item: any) => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet || item.description || '',
                source: item.providerPublishTime
                    ? new Date(item.providerPublishTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : defaultSource,
                time: "Live",
                tag,
                provenance,
                _score: scoreNewsRelevance(item, ticker, companyName, sector, industry),
            }));

        const allRawNews = [
            ...tagAndScore(companyNews.news, "Yahoo", ticker, 'company'),
            ...macroResults.flatMap(r => tagAndScore(r.news, "Macro", sector || "Macro", 'macro')),
            ...industryResults.flatMap(r => tagAndScore(r.news, "Industry", industry || sector || "Industry", 'industry')),
        ];
        // Yahoo already matched macro/industry items to our targeted short queries,
        // so give them a baseline relevance boost to avoid filtering out geopolitical headlines
        // that lack explicit sector keywords (e.g., "Trump to escort tankers" for oil stocks).
        for (const item of allRawNews) {
            if (item.provenance !== 'company' && item._score < 10) {
                item._score = Math.max(item._score, 8);
            }
        }

        // Deduplicate by title, keep highest-scored version
        const titleMap = new Map<string, any>();
        for (const item of allRawNews) {
            const existing = titleMap.get(item.title);
            if (!existing || item._score > existing._score) {
                titleMap.set(item.title, item);
            }
        }

        // Filter by minimum relevance, sort by score descending
        const uniqueNews = Array.from(titleMap.values())
            .filter(item => item._score >= 5)
            .sort((a, b) => b._score - a._score)
            .slice(0, 10)
            .map((item, index) => ({
                id: `news-${index}`, title: item.title, link: item.link,
                snippet: item.snippet, source: item.source, time: item.time,
                tag: item.tag, provenance: item.provenance,
            }));

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
      yf.search('Stock Market', { newsCount: 10, quotesCount: 0 }).catch(() => ({ news: [] }))
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

    const newsRaw = (newsResult && newsResult.news) ? newsResult.news : [];
    const news = newsRaw
      .filter((item: any) => item.title && !item.title.includes("Stock Market News for"))
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