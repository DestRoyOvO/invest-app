"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Search, TrendingUp, TrendingDown, Zap, Activity, Brain, ArrowRight, BarChart3, 
  ArrowLeft, LayoutGrid, Newspaper, ChevronRight, Layers, PieChart, Loader2,
  MessageSquare, X, Send, Minus, RefreshCw, History, Star, Plus, Check, List, Globe,
  Target, ShieldCheck, AlertTriangle
} from 'lucide-react';

// --- 1. 语言包定义 ---
const TRANSLATIONS: any = {
  en: {
    nav: { market: "Market Overview", watchlist: "My Watchlist", sector: "Sector", quote: "Quote", status: "DeepSeek Status", connected: "CONNECTED" },
    header: { market: "Market", watchlist: "My Watchlist", insight: "Insight", searchPlaceholder: "Search Ticker (e.g. AAPL)...", analyzing: "Analyzing...", aiMacro: "AI Macro Analysis", aiPort: "AI Portfolio Scan", aiDeep: "AI Deep Dive", regen: "Regenerate Insight", aiSummary: "AI Summary" },
    overview: { heatMap: "Market Heatmap", volatility: "Size based on volatility", aiInsight: "AI Market Insight", topStories: "Top Stories", majorEtfs: "Major ETFs", loadingEtfs: "Loading ETFs..." },
    watchlist: { title: "My Watchlist", tickers: "Tickers", colCompany: "Company", colPrice: "Last Price", colChange: "Change", colTrend: "Trend (14D)", colMktCap: "Mkt Cap", loading: "Fetching Portfolio...", empty: "Your watchlist is empty. Search for a stock to add it here.", riskAnalysis: "Portfolio Risk Analysis", relatedNews: "Related News" },
    sector: { title: "Sector", aiScan: "AI Scan", relatedEtfs: "Related ETFs", loading: "Fetching Data...", colCompany: "Company", colPrice: "Last Price", colChange: "Change", colTrend: "Trend (14D)", colMktCap: "Mkt Cap" },
    detail: { historical: "Historical View", live: "Live Market", liveData: "Live Market Data", mktCap: "Market Cap", pe: "P/E (TTM)", eps: "EPS", roe: "ROE", margin: "Gross Margin", earnings: "Earnings", nextEarnings: "Next Earnings", analysis: "DeepSeek Analysis" },
    signal: { title: "Model Signal", score: "Score", confidence: "Confidence", momentum: "Momentum", trend: "Trend", rsi: "RSI", volume: "Volume", value: "Value", quality: "Quality", volatility: "Vol Risk", backtest: "Backtest", winRate: "Win Rate", avgReturn: "Avg Ret", sharpe: "Sharpe", maxDD: "Max DD", trades: "Trades", noData: "Insufficient data", disclaimer: "Model output for research only. Not investment advice.", loading: "Computing signal...", technical: "Technical", fundamental: "Fundamental", highConf: "High", medConf: "Medium", lowConf: "Low" },
    news: { readOriginal: "Read Original Story on Yahoo Finance", aiInsight: "AI Strategic Insight" },
    chat: { title: "DeepSeek Assistant", placeholder: "Ask anything...", welcome: "Hello! I am InvestSeek AI. Ask me about markets, stocks, or your watchlist." },
    sectors: { "Technology": "Technology", "Communication": "Communication", "Consumer Disc.": "Consumer Disc.", "Financials": "Financials", "Healthcare": "Healthcare" }
  },
  zh: {
    nav: { market: "市场总览", watchlist: "我的自选", sector: "板块", quote: "个股行情", status: "DeepSeek 状态", connected: "已连接" },
    header: { market: "市场", watchlist: "自选股", insight: "洞察", searchPlaceholder: "搜索代码 (如 AAPL)...", analyzing: "分析中...", aiMacro: "AI 宏观分析", aiPort: "AI 持仓诊断", aiDeep: "AI 深度分析", regen: "重新生成观点", aiSummary: "AI 智能总结" },
    overview: { heatMap: "市场热力图", volatility: "大小基于波动率", aiInsight: "AI 市场洞察", topStories: "头条新闻", majorEtfs: "主要 ETF", loadingEtfs: "加载 ETF 中..." },
    watchlist: { title: "我的自选", tickers: "只股票", colCompany: "公司", colPrice: "最新价", colChange: "涨跌幅", colTrend: "趋势 (14日)", colMktCap: "市值", loading: "正在获取持仓...", empty: "自选股为空。请搜索股票代码添加。", riskAnalysis: "持仓风险分析", relatedNews: "相关新闻" },
    sector: { title: "板块", aiScan: "AI 扫描", relatedEtfs: "相关 ETF", loading: "正在获取数据...", colCompany: "公司", colPrice: "最新价", colChange: "涨跌幅", colTrend: "趋势 (14日)", colMktCap: "市值" },
    detail: { historical: "历史回溯", live: "实时行情", liveData: "实时市场数据", mktCap: "市值", pe: "市盈率 (TTM)", eps: "每股收益", roe: "净资产收益率", margin: "毛利率", earnings: "财报", nextEarnings: "下次财报", analysis: "DeepSeek 深度分析" },
    signal: { title: "量化信号", score: "评分", confidence: "置信度", momentum: "动量", trend: "趋势", rsi: "RSI", volume: "成交量", value: "价值", quality: "质量", volatility: "波动风险", backtest: "回测", winRate: "胜率", avgReturn: "均收益", sharpe: "夏普", maxDD: "最大回撤", trades: "交易数", noData: "数据不足", disclaimer: "模型输出仅供研究参考，不构成投资建议。", loading: "正在计算信号...", technical: "技术面", fundamental: "基本面", highConf: "高", medConf: "中", lowConf: "低" },
    news: { readOriginal: "在 Yahoo Finance 阅读原文", aiInsight: "AI 战略洞察" },
    chat: { title: "DeepSeek 助手", placeholder: "随便问问...", welcome: "您好！我是 InvestSeek AI。您可以问我关于市场、个股或您持仓的问题。" },
    sectors: { "Technology": "科技", "Communication": "通信服务", "Consumer Disc.": "非必需消费", "Financials": "金融", "Healthcare": "医疗健康" }
  }
};

// --- 2. 修复后的 useSWR (解决刷新闪烁问题) ---
function useSWR(key: string | null, fetcher: any, config?: any) {
    const [data, setData] = useState<any>(undefined);
    const [error, setError] = useState<any>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    
    // 使用 ref 追踪是否已有数据，用于静默刷新
    const hasData = useRef(false);

    // 当 key 变化时（例如切换股票），重置状态
    useEffect(() => {
        if (key) {
            hasData.current = false;
            setData(undefined);
            setIsLoading(true);
        }
    }, [key]);

    const execute = useCallback(() => {
        if (!key) return;
        
        // [核心修复]：只有在当前没有数据时才显示 Loading
        // 如果已经有数据（后台刷新），则不显示 Loading，避免页面闪烁
        if (!hasData.current) {
            setIsLoading(true);
        }

        fetcher(key)
            .then((res: any) => {
                setData(res);
                hasData.current = true; // 标记已有数据
            })
            .catch((err: any) => setError(err))
            .finally(() => setIsLoading(false));
    }, [key, fetcher]);

    useEffect(() => {
        execute();
        let interval: any;
        if (config?.refreshInterval && key) {
            interval = setInterval(execute, config.refreshInterval);
        }
        return () => clearInterval(interval);
    }, [key, config?.refreshInterval, execute]);

    return { data, isLoading, error, mutate: execute };
}

// --- SWR Fetcher ---
const fetcher = (url: string) => fetch(url).then((res) => res.json());

// --- 类型定义 ---
interface StockData {
  symbol: string;
  name: string;
  price: string;
  change: string;
  marketCap: string;
  volume: string;
  trend: number[];
  isUp: boolean;
}

interface EtfData {
  symbol: string;
  name: string;
  price: string;
  change: string;
  isUp: boolean;
}

interface StockDetail {
  symbol: string;
  name: string;
  price: string;
  change: string;
  isUp: boolean;
  metrics: { marketCap: string; pe: string; eps: string; roe: string; grossMargin: string; };
  earningsDate: string;
  chartHistory?: { x: number; y: number[] }[];
}

interface NewsItem {
  id: number;
  title: string;
  link?: string;
  source: string;
  time: string;
  tag?: string;
  snippet?: string;
  provenance?: 'company' | 'industry' | 'macro';
}

interface MacroIndex {
  name: string;
  value: string;
  change: string;
  isUp: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface HoverData {
    price: string;
    change: string;
    changePercent: string;
    isUp: boolean;
    date: string;
    marketCap?: string; 
    pe?: string; 
}

// --- 常量 ---
const SECTOR_ETF_MAP: Record<string, string[]> = {
  "Technology": ["XLK", "SMH"],
  "Communication": ["XLC", "VOX"],
  "Consumer Disc.": ["XLY", "VCR"],
  "Financials": ["XLF", "KBE"],
  "Healthcare": ["XLV", "IBB"],
};

const INITIAL_INDICES: MacroIndex[] = [
  { name: "S&P 500", value: "-", change: "0.00%", isUp: true },
  { name: "Nasdaq", value: "-", change: "0.00%", isUp: true },
  { name: "Dow Jones", value: "-", change: "0.00%", isUp: true },
  { name: "10Y Treasury", value: "-", change: "0.00%", isUp: true }, 
];

// --- 辅助函数 ---
function calculateSMA(data: { x: number, y: number[] }[], window: number) {
  if (!data) return [];
  return data.map((item, index) => {
    if (index < window - 1) return { x: item.x, y: null };
    const slice = data.slice(index - window + 1, index + 1);
    const sum = slice.reduce((acc, curr) => acc + curr.y[3], 0);
    return { x: item.x, y: parseFloat((sum / window).toFixed(2)) };
  });
}

function parseMarketCap(capStr: string) {
    if (!capStr || capStr === '-') return 0;
    const num = parseFloat(capStr.replace(/[TMB]/g, ''));
    if (capStr.includes('T')) return num * 1e12;
    if (capStr.includes('B')) return num * 1e9;
    if (capStr.includes('M')) return num * 1e6;
    return num;
}

function formatMarketCap(cap: number) {
    if (cap > 1e12) return (cap / 1e12).toFixed(2) + "T";
    if (cap > 1e9) return (cap / 1e9).toFixed(2) + "B";
    if (cap > 1e6) return (cap / 1e6).toFixed(2) + "M";
    return cap.toString();
}

function getSectorWeight(stocks: any[]) {
    if (!stocks || stocks.length === 0) return 0.5; 
    const totalAbsChange = stocks.reduce((acc, s) => {
        const changeVal = Math.abs(parseFloat(s.change.replace('%','').replace('+','')) || 0);
        return acc + changeVal;
    }, 0);
    const avgAbsChange = totalAbsChange / stocks.length;
    return Math.max(avgAbsChange, 0.4);
}

function parseBold(text: string) {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={idx} className="text-white font-bold">{part.slice(2, -2)}</strong>;
        return part;
    });
}

// --- 3. 原生 SVG K 线图组件 (带您喜欢的吸附和悬浮 Tag) ---
const ChartComponent = React.memo(function ChartComponentInner({ history, onHover, onLeave, currentMarketCap, currentPrice, currentPe }: any) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [hoverPos, setHoverPos] = useState<{x: number, y: number} | null>(null);
    const [tooltipInfo, setTooltipInfo] = useState<any>(null); 

    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setDimensions({ width, height });
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    const { processedData, minPrice, maxPrice, priceRange } = useMemo(() => {
        if (!history || history.length === 0) return { processedData: [], minPrice: 0, maxPrice: 0, priceRange: 1 };
        
        let min = Infinity;
        let max = -Infinity;
        
        const ma5 = calculateSMA(history, 5);
        const ma10 = calculateSMA(history, 10);
        const ma20 = calculateSMA(history, 20); // [ADD] MA20

        const data = history.map((item: any, i: number) => {
            const [open, high, low, close] = item.y;
            min = Math.min(min, low);
            max = Math.max(max, high);
            return { xVal: item.x, open, high, low, close, ma5: ma5[i]?.y, ma10: ma10[i]?.y, ma20: ma20[i]?.y };
        });

        const padding = (max - min) * 0.1;
        return { processedData: data, minPrice: min - padding, maxPrice: max + padding, priceRange: (max - min) + (padding * 2) };
    }, [history]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!containerRef.current || processedData.length === 0) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        const index = Math.min(Math.max(Math.floor((x / dimensions.width) * processedData.length), 0), processedData.length - 1);
        const point = processedData[index];
        
        const y = dimensions.height - ((point.close - minPrice) / priceRange) * dimensions.height;
        const xPos = (index + 0.5) * (dimensions.width / processedData.length);
        
        setHoverPos({ x: xPos, y });

        // 设置悬浮 Tag 数据
        setTooltipInfo({
            x: xPos,
            y: y,
            date: new Date(point.xVal).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
            open: point.open.toFixed(2),
            high: point.high.toFixed(2),
            low: point.low.toFixed(2),
            close: point.close.toFixed(2),
            isUp: point.close >= point.open
        });

        const changeVal = point.close - (index > 0 ? processedData[index-1].close : point.open);
        const changePercent = (changeVal / (index > 0 ? processedData[index-1].close : point.open)) * 100;
        const estimatedMarketCap = currentPrice ? (point.close / currentPrice) * currentMarketCap : 0;
        const estimatedPe = currentPrice ? (point.close / currentPrice) * currentPe : 0;

        onHover({
            price: point.close.toFixed(2),
            change: (changeVal >= 0 ? "+" : "") + changePercent.toFixed(2) + "%",
            changePercent: (changeVal >= 0 ? "+" : "") + changePercent.toFixed(2) + "%",
            isUp: changeVal >= 0,
            date: new Date(point.xVal).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
            marketCap: formatMarketCap(estimatedMarketCap),
            pe: estimatedPe ? estimatedPe.toFixed(2) : '-'
        });

    }, [dimensions, processedData, minPrice, priceRange, currentMarketCap, currentPrice, currentPe, onHover]);

    const handleMouseLeave = useCallback(() => {
        setHoverPos(null);
        setTooltipInfo(null);
        onLeave();
    }, [onLeave]);

    if (!history || history.length === 0) return <div className="h-full flex items-center justify-center text-slate-500 text-xs flex-col gap-2"><BarChart3 className="w-8 h-8 opacity-50"/>Chart data unavailable</div>;

    const candleWidth = (dimensions.width / processedData.length) * 0.6;
    const stepX = dimensions.width / processedData.length;
    const getY = (price: number) => dimensions.height - ((price - minPrice) / priceRange) * dimensions.height;
    const getPolylinePoints = (maKey: 'ma5' | 'ma10' | 'ma20') => {
        return processedData.map((d: any, i: number) => {
            if (d[maKey] === null || d[maKey] === undefined) return null;
            return `${(i + 0.5) * stepX},${getY(d[maKey])}`;
        }).filter(Boolean).join(' ');
    };

    return (
        <div ref={containerRef} className="w-full h-full relative cursor-crosshair" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
            <svg width="100%" height="100%" className="overflow-visible">
                {[0.2, 0.4, 0.6, 0.8].map(p => (
                    <line key={p} x1="0" y1={dimensions.height * p} x2={dimensions.width} y2={dimensions.height * p} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
                ))}
                {processedData.map((d: any, i: number) => {
                    const isUp = d.close >= d.open;
                    const color = isUp ? '#34d399' : '#f43f5e';
                    const x = (i + 0.5) * stepX;
                    const yOpen = getY(d.open); const yClose = getY(d.close); const yHigh = getY(d.high); const yLow = getY(d.low);
                    return (
                        <g key={i}>
                            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1" />
                            <rect x={x - candleWidth/2} y={Math.min(yOpen, yClose)} width={candleWidth} height={Math.max(Math.abs(yOpen - yClose), 1)} fill={color} />
                        </g>
                    );
                })}
                <polyline points={getPolylinePoints('ma5')} fill="none" stroke="#2E93fA" strokeWidth="1.5" />
                <polyline points={getPolylinePoints('ma10')} fill="none" stroke="#FBBF24" strokeWidth="1.5" />
                <polyline points={getPolylinePoints('ma20')} fill="none" stroke="#A78BFA" strokeWidth="1.5" /> {/* [ADD] MA20 */}
                {hoverPos && (
                    <>
                        <line x1={0} y1={hoverPos.y} x2={dimensions.width} y2={hoverPos.y} stroke="#818CF8" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1={hoverPos.x} y1={0} x2={hoverPos.x} y2={dimensions.height} stroke="#818CF8" strokeWidth="1" strokeDasharray="3 3" />
                        <circle cx={hoverPos.x} cy={hoverPos.y} r="3" fill="#818CF8" />
                    </>
                )}
            </svg>
            
            {/* 悬浮 Tag - 您要求的半透明效果 */}
            {tooltipInfo && (
                <div 
                    className="absolute pointer-events-none bg-[#0f172a]/60 border border-white/10 rounded-lg p-3 text-xs shadow-xl z-50 backdrop-blur-md min-w-[140px]"
                    style={{ left: tooltipInfo.x < dimensions.width / 2 ? tooltipInfo.x + 15 : tooltipInfo.x - 155, top: 10 }}
                >
                    <div className="text-slate-400 font-mono mb-2 border-b border-slate-700/50 pb-1 text-[10px] font-bold">{tooltipInfo.date}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                        <span className="text-slate-500">Open</span><span className="text-slate-200 text-right">{tooltipInfo.open}</span>
                        <span className="text-slate-500">High</span><span className="text-slate-200 text-right">{tooltipInfo.high}</span>
                        <span className="text-slate-500">Low</span><span className="text-slate-200 text-right">{tooltipInfo.low}</span>
                        <span className="text-slate-500">Close</span><span className={`${tooltipInfo.isUp ? 'text-emerald-400' : 'text-rose-400'} text-right font-bold`}>{tooltipInfo.close}</span>
                    </div>
                </div>
            )}

            <div className="absolute top-2 left-2 flex gap-4 text-[10px] font-mono pointer-events-none bg-black/30 p-1.5 rounded backdrop-blur-sm border border-white/5">
                <div className="flex items-center gap-1"><div className="w-2 h-2 bg-[#2E93fA]"></div><span className="text-slate-300">MA5</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 bg-[#FBBF24]"></div><span className="text-slate-300">MA10</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 bg-[#A78BFA]"></div><span className="text-slate-300">MA20</span></div> {/* [ADD] MA20 */}
            </div>
        </div>
    );
}, (prev, next) => JSON.stringify(prev.history) === JSON.stringify(next.history)); 

// --- 主入口组件 ---
export default function DeepSeekInvestDashboard() {
  const [currentView, setCurrentView] = useState<'overview' | 'sector' | 'detail' | 'news' | 'watchlist'>('overview');
  const [lastView, setLastView] = useState<'overview' | 'sector' | 'detail' | 'watchlist'>('overview');
  
  // --- 语言状态 ---
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const t = TRANSLATIONS[lang];
  const toggleLang = () => setLang(prev => prev === 'en' ? 'zh' : 'en');

  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [watchlist, setWatchlist] = useState<string[]>(['NVDA', 'AAPL']);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiContent, setAiContent] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('userWatchlist');
    if (saved) {
        try { setWatchlist(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  const toggleWatchlist = (ticker: string) => {
    let newWatchlist;
    if (watchlist.includes(ticker)) {
        newWatchlist = watchlist.filter(t => t !== ticker);
    } else {
        newWatchlist = [...watchlist, ticker];
    }
    setWatchlist(newWatchlist);
    localStorage.setItem('userWatchlist', JSON.stringify(newWatchlist));
  };

  const { data: marketData, isLoading: isMarketLoading } = useSWR(
    `/api/market?watchlist=${watchlist.join(',')}`, 
    fetcher, 
    { refreshInterval: 30000, revalidateOnFocus: false }
  );

  const { data: detailData, isLoading: isDetailLoading, mutate: mutateDetail } = useSWR(
    selectedTicker ? `/api/market?ticker=${selectedTicker}` : null, 
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5000 }
  );

  const { data: signalData, isLoading: isSignalLoading } = useSWR(
    selectedTicker ? `/api/signal?ticker=${selectedTicker}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const { data: sectorNewsData } = useSWR(
    selectedSector ? `/api/market?news=${encodeURIComponent(selectedSector + ' news')}` : null,
    fetcher
  );

  const indices = marketData?.indices || INITIAL_INDICES;
  const stocks = marketData?.sectorStocks || {};
  const watchlistStocks = marketData?.watchlist || []; 
  const generalNews = marketData?.news || [];
  
  const etfMap = useMemo(() => {
    const map: Record<string, EtfData> = {};
    if (marketData?.etfs) {
      marketData.etfs.forEach((e: EtfData) => map[e.symbol] = e);
    }
    return map;
  }, [marketData]);

  const currentNewsList = useMemo(() => {
    if (currentView === 'overview') return generalNews;
    if (currentView === 'sector') return sectorNewsData?.news || generalNews;
    if (currentView === 'watchlist') return generalNews; 
    if (currentView === 'detail') return detailData?.news || [];
    return [];
  }, [currentView, generalNews, sectorNewsData, detailData]);

  useEffect(() => {
    setAiContent('');
    setIsAnalyzing(false);
  }, [currentView, selectedSector, selectedTicker]);

  const goToSector = (sectorName: string) => {
    setLastView('overview'); 
    setSelectedSector(sectorName);
    setCurrentView('sector');
  };

  const goToDetail = (ticker: string) => {
    if (ticker === selectedTicker) mutateDetail(); 
    if (currentView !== 'news') setLastView(currentView as any);
    setSelectedTicker(ticker);
    setCurrentView('detail');
  };

  const goToWatchlist = () => {
    setLastView('overview');
    setSelectedSector(null);
    setCurrentView('watchlist');
  };

  const goToOverview = () => {
    setCurrentView('overview');
    setSelectedSector(null);
    setSelectedTicker(null);
    setSearchQuery('');
  };

  const goToNews = (newsItem: NewsItem) => {
    if (currentView !== 'news') setLastView(currentView as any);
    setSelectedNews(newsItem);
    setCurrentView('news');
    setTimeout(() => startAnalysis(newsItem), 100);
  };

  const handleBack = () => {
    if (currentView === 'news') {
      setSelectedNews(null);
      setCurrentView(lastView);
    } else if (currentView === 'detail') {
      if (selectedSector && lastView === 'sector') {
        setCurrentView('sector');
      } else if (lastView === 'watchlist') {
        setCurrentView('watchlist');
      } else {
        goToOverview();
      }
    } else if (currentView === 'sector' || currentView === 'watchlist') {
      goToOverview();
    }
  };

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery) {
      goToDetail(searchQuery.toUpperCase());
    }
  };

  // AI 分析逻辑
  const startAnalysis = async (overrideNews?: NewsItem) => {
    setIsAnalyzing(true);
    setAiContent('');
    
    let dataToSend: any = {};
    // --- 语言控制指令 ---
    let contextDesc = `(IMPORTANT: Please respond in ${lang === 'zh' ? 'Chinese (Simplified)' : 'English'}). `;

    if (currentView === 'news' || overrideNews) {
       const targetNews = overrideNews || selectedNews;
       if (!targetNews) return;
       contextDesc += "News Insight"; 
       dataToSend = { 
         title: targetNews.title, source: targetNews.source, timestamp: targetNews.time, link: targetNews.link, 
         task: "Deep dive analysis", relatedContext: "Consider broader market impact." 
       };
    } else if (currentView === 'overview') {
       contextDesc += "Global Market Overview";
       dataToSend = { indices: indices, marketNews: generalNews.slice(0, 4) };
    } else if (currentView === 'sector') {
       const sectorName = selectedSector || 'Technology';
       contextDesc += `${sectorName} Sector Analysis`;
       dataToSend = { 
         sector: sectorName, 
         stocks: (stocks[sectorName] || []).map((s: StockData) => ({ symbol: s.symbol, change: s.change, price: s.price })),
         recentNews: currentNewsList.slice(0, 3),
         indicesContext: indices.map((i: MacroIndex) => `${i.name}: ${i.change}`)
       };
    } else if (currentView === 'watchlist') {
       contextDesc += "User Watchlist Portfolio Analysis";
       dataToSend = {
           stocks: watchlistStocks.map((s: StockData) => ({ symbol: s.symbol, change: s.change, price: s.price, isUp: s.isUp })),
           marketContext: indices.map((i: MacroIndex) => `${i.name}: ${i.change}`)
       };
    } else {
       if (!detailData?.detail) return;
       contextDesc += `${detailData.detail.symbol} Stock Deep Dive`;
       dataToSend = { 
           ...detailData.detail, 
           relatedNews: currentNewsList.slice(0, 8),
           marketContext: {
               indices: indices.slice(0, 3).map((i: MacroIndex) => ({ name: i.name, change: i.change, isUp: i.isUp })),
               topHeadlines: generalNews.slice(0, 2).map((n: NewsItem) => n.title)
           },
           ...(signalData && !signalData.error ? { modelSignal: { signal: signalData.signal, score: signalData.score, confidence: signalData.confidence, components: signalData.components, backtests: signalData.backtests, metadata: signalData.metadata } } : {}),
       };
    }
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: contextDesc, data: dataToSend }),
      });

      if (!response.ok || !response.body) throw new Error("API Error");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value, { stream: true });
        setAiContent((prev) => prev + chunkValue);
      }
    } catch (error) {
      setAiContent(lang === 'zh' ? "**分析错误**: 无法连接 DeepSeek AI。" : "**Analysis Error**: Unable to connect to DeepSeek AI.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Chat Context 增强，加入语言指令
  const chatContext = useMemo(() => {
    return {
        view: currentView,
        language: lang === 'zh' ? 'Chinese' : 'English',
        ticker: selectedTicker,
        sector: selectedSector,
        marketIndices: indices.map((i: any) => `${i.name}: ${i.value} (${i.change})`),
        watchlistData: watchlistStocks.map((s: any) => `${s.symbol}: ${s.price} (${s.change})`),
        visibleNews: currentNewsList.slice(0, 4).map((n: any) => `${n.title} (${n.source})`),
        detailSummary: (currentView === 'detail' && detailData?.detail) ? {
            symbol: detailData.detail.symbol,
            price: detailData.detail.price,
            change: detailData.detail.change,
            marketCap: detailData.detail.metrics.marketCap
        } : null
    };
  }, [currentView, selectedTicker, selectedSector, indices, detailData, watchlistStocks, lang, currentNewsList]);

  return (
    <div className="flex h-screen bg-[#0a0c10] text-slate-100 font-sans overflow-hidden selection:bg-indigo-500/30 relative">
      <Sidebar currentView={currentView} goToOverview={goToOverview} selectedSector={selectedSector} goToSector={goToSector} selectedTicker={selectedTicker} goToDetail={goToDetail} goToWatchlist={goToWatchlist} t={t} />
      
      <main className="flex-1 flex flex-col overflow-y-auto bg-[#0a0c10] relative scroll-smooth">
        <Header 
          currentView={currentView} 
          lastView={lastView} 
          handleBack={handleBack} 
          goToOverview={goToOverview}
          selectedSector={selectedSector}
          goToSector={goToSector}
          selectedTicker={selectedTicker}
          goToDetail={goToDetail}
          goToWatchlist={goToWatchlist}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          handleSearch={handleSearch}
          isAnalyzing={isAnalyzing}
          startAnalysis={startAnalysis}
          hasDetailData={!!detailData?.detail}
          lang={lang} toggleLang={toggleLang} t={t} 
        />

        <div className="p-6 max-w-[1800px] mx-auto w-full pb-24">
          {currentView === 'overview' && (
            <OverviewView 
              indices={indices} stocks={stocks} news={generalNews} etfMap={etfMap} 
              watchlist={watchlistStocks} 
              isLoading={isMarketLoading} aiContent={aiContent} isAnalyzing={isAnalyzing}
              onSectorClick={goToSector} onNewsClick={goToNews} onStockClick={goToDetail}
              goToWatchlist={goToWatchlist} t={t}
            />
          )}
          {currentView === 'sector' && (
            <SectorView 
              sectorName={selectedSector} stocksData={stocks} news={currentNewsList} etfMap={etfMap}
              isLoading={isMarketLoading} aiContent={aiContent} isAnalyzing={isAnalyzing}
              onStockClick={goToDetail} onNewsClick={goToNews} t={t}
            />
          )}
          {currentView === 'watchlist' && (
            <WatchlistView 
                stocks={watchlistStocks} news={generalNews} 
                isLoading={isMarketLoading} aiContent={aiContent} isAnalyzing={isAnalyzing}
                onStockClick={goToDetail} onNewsClick={goToNews} t={t}
            />
          )}
          {currentView === 'detail' && (
            <DetailView 
              detail={detailData?.detail} news={currentNewsList} 
              isLoading={isDetailLoading} aiContent={aiContent} isAnalyzing={isAnalyzing}
              onNewsClick={goToNews}
              watchlist={watchlist}
              onToggleWatchlist={toggleWatchlist} t={t}
              signalData={signalData} isSignalLoading={isSignalLoading}
            />
          )}
          {currentView === 'news' && (
            <NewsView newsItem={selectedNews} aiContent={aiContent} isAnalyzing={isAnalyzing} t={t} />
          )}
        </div>
      </main>

      <ChatWidget context={chatContext} t={t} lang={lang} />
    </div>
  );
}

// --- 子组件 ---

function Sidebar({ currentView, goToOverview, selectedSector, goToSector, selectedTicker, goToDetail, goToWatchlist, t }: any) {
  return (
    <aside className="w-64 border-r border-slate-800/60 bg-[#0d1117] flex flex-col hidden md:flex z-30">
      <div className="p-6 flex items-center gap-2 border-b border-slate-800/60 cursor-pointer group" onClick={goToOverview}>
        <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/20 group-hover:bg-indigo-500 transition-colors">
          <Brain className="w-6 h-6 text-white" />
        </div>
        <span className="font-bold text-xl tracking-tight text-slate-100">InvestSeek</span>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        <NavItem icon={<LayoutGrid />} label={t.nav.market} active={currentView === 'overview'} onClick={goToOverview} />
        <NavItem icon={<Star />} label={t.nav.watchlist} active={currentView === 'watchlist'} onClick={goToWatchlist} />
        <NavItem icon={<Layers />} label={t.nav.sector} active={currentView === 'sector'} onClick={() => selectedSector ? goToSector(selectedSector) : goToSector('Technology')} />
        <NavItem icon={<Activity />} label={t.nav.quote} active={currentView === 'detail'} onClick={() => selectedTicker ? goToDetail(selectedTicker) : goToDetail('NVDA')} />
      </nav>
      <div className="p-4 border-t border-slate-800/60">
          <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">{t.nav.status}</p>
          <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></span>
              <span className="text-xs text-emerald-400 font-mono tracking-wide">{t.nav.connected}</span>
          </div>
          </div>
      </div>
    </aside>
  );
}

// ✅ 修复点：已确保解构 lastView
function Header({ currentView, lastView, handleBack, goToOverview, selectedSector, goToSector, selectedTicker, goToDetail, goToWatchlist, searchQuery, setSearchQuery, handleSearch, isAnalyzing, startAnalysis, hasDetailData, lang, toggleLang, t }: any) {
    return (
      <header className="h-16 border-b border-slate-800/60 flex items-center px-6 bg-[#0d1117]/80 backdrop-blur-md sticky top-0 z-20 justify-between">
      <div className="flex items-center gap-4 w-full max-w-2xl">
        <div className="flex items-center gap-2 text-sm">
            {currentView !== 'overview' && (
               <button onClick={handleBack} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white border border-transparent hover:border-slate-700 mr-2">
                  <ArrowLeft className="w-4 h-4" />
               </button>
            )}
            
            <span className={`cursor-pointer transition-colors font-medium ${currentView === 'overview' ? 'text-slate-200 font-bold' : 'text-slate-500 hover:text-indigo-400'}`} onClick={goToOverview}>{t.header.market}</span>
  
            {((currentView === 'sector' && selectedSector) || (currentView === 'detail' && selectedSector && lastView === 'sector')) && (
              <><ChevronRight className="w-4 h-4 text-slate-600" /><span className={`cursor-pointer transition-colors font-medium ${currentView === 'sector' ? 'text-slate-200 font-bold' : 'text-slate-500 hover:text-indigo-400'}`} onClick={() => goToSector(selectedSector)}>{selectedSector ? (t.sectors[selectedSector] || selectedSector) : ''}</span></>
            )}
            {((currentView === 'watchlist') || (currentView === 'detail' && lastView === 'watchlist' && !selectedSector)) && (
              <><ChevronRight className="w-4 h-4 text-slate-600" /><span className={`cursor-pointer transition-colors font-medium ${currentView === 'watchlist' ? 'text-slate-200 font-bold' : 'text-slate-500 hover:text-indigo-400'}`} onClick={goToWatchlist}>{t.header.watchlist}</span></>
            )}
            {(currentView === 'detail' || currentView === 'news') && selectedTicker && (
              <><ChevronRight className="w-4 h-4 text-slate-600" /><span className={`cursor-pointer transition-colors font-medium ${(currentView === 'detail' && !isAnalyzing) ? 'text-slate-200 font-bold' : 'text-slate-500 hover:text-indigo-400'}`} onClick={() => goToDetail(selectedTicker)}>{selectedTicker}</span></>
            )}
            {currentView === 'news' && (<><ChevronRight className="w-4 h-4 text-slate-600" /><span className="font-bold text-slate-200">{t.header.insight}</span></>)}
        </div>
        <div className="relative w-full max-w-md ml-6 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 group-focus-within:text-indigo-400 transition-colors" />
          <input type="text" placeholder={t.header.searchPlaceholder} className="w-full bg-[#161b22] border border-slate-700/50 text-slate-200 pl-9 pr-4 py-2 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-slate-600" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={handleSearch} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={toggleLang} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white border border-slate-700/50 hover:border-slate-600 group" title="Switch Language">
            <Globe className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
        </button>
        <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-indigo-900/20 hover:shadow-indigo-900/40 flex items-center gap-2 border border-indigo-500 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => startAnalysis()} disabled={isAnalyzing || (currentView === 'detail' && !hasDetailData)}>
        {isAnalyzing ? <span className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> {t.header.analyzing}</span> : <span className="flex items-center gap-2"><Zap className="w-4 h-4 fill-white" /> {currentView === 'news' ? t.header.regen : (currentView === 'overview' ? t.header.aiMacro : (currentView === 'watchlist' ? t.header.aiPort : t.header.aiDeep))}</span>}
      </button>
      </div>
    </header>
  );
}

function OverviewView({ indices, stocks, news, etfMap, watchlist, isLoading, aiContent, isAnalyzing, onSectorClick, onNewsClick, onStockClick, goToWatchlist, t }: any) {
    const majorTickers = ["SPY", "QQQ", "DIA"];
    const majorEtfs = majorTickers.map(t => etfMap[t]).filter(Boolean);

    const techW = getSectorWeight(stocks['Technology']);
    const commW = getSectorWeight(stocks['Communication']);
    const consW = getSectorWeight(stocks['Consumer Disc.']);
    const finW = getSectorWeight(stocks['Financials']);
    const healthW = getSectorWeight(stocks['Healthcare']);
    const watchW = getSectorWeight(watchlist);

    const row1LeftFlex = techW;
    const row1RightFlex = commW + consW;
    const row2Total = finW + healthW + watchW;
    const row1Total = techW + commW + consW;
    const totalWeight = row1Total + row2Total;
    const row1HeightPct = Math.min(Math.max((row1Total / totalWeight) * 100, 45), 65); 
    const row2HeightPct = 100 - row1HeightPct;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {indices.map((idx: MacroIndex, i: number) => (
                    <div key={i} className="bg-[#161b22] border border-slate-800/60 p-4 rounded-xl hover:border-slate-700 transition-colors shadow-sm">
                        <div className="flex justify-between items-center mb-2"><span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">{idx.name}</span>{idx.isUp ? <TrendingUp size={16} className="text-emerald-500" /> : <TrendingDown size={16} className="text-rose-500" />}</div>
                        <div className="flex items-baseline gap-2"><span className="text-2xl font-bold text-slate-100 tracking-tight">{idx.value}</span><span className={`text-xs font-bold px-1.5 py-0.5 rounded ${idx.isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{idx.change}</span></div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between"><h2 className="text-lg font-bold flex items-center gap-2 text-slate-200 tracking-tight"><LayoutGrid className="w-5 h-5 text-indigo-400" /> {t.overview.heatMap} <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded ml-2 font-normal">{t.overview.volatility}</span></h2></div>
                    {isLoading && Object.keys(stocks).length === 0 ? <SkeletonHeight height="450px" /> : (
                        <div className="h-[450px] w-full flex flex-col gap-1 p-1 bg-[#161b22] border border-slate-800 rounded-lg shadow-inner select-none">
                            <div className="flex gap-1 transition-all duration-500 ease-in-out" style={{ height: `${row1HeightPct}%` }}>
                                <div style={{ flex: row1LeftFlex }} className="transition-all duration-500 h-full"><SectorBlock name="Technology" stocks={stocks} onClick={onSectorClick} big t={t} weight={techW} /></div>
                                <div style={{ flex: row1RightFlex }} className="flex flex-col gap-1 transition-all duration-500 h-full">
                                    <div style={{ flex: commW }} className="transition-all duration-500 h-full"><SectorBlock name="Communication" stocks={stocks} onClick={onSectorClick} t={t} weight={commW} /></div>
                                    <div style={{ flex: consW }} className="transition-all duration-500 h-full"><SectorBlock name="Consumer Disc." stocks={stocks} onClick={onSectorClick} t={t} weight={consW} /></div>
                                </div>
                            </div>
                            <div className="flex gap-1 transition-all duration-500 ease-in-out" style={{ height: `${row2HeightPct}%` }}>
                                <div style={{ flex: finW }} className="transition-all duration-500 h-full"><SectorBlock name="Financials" stocks={stocks} onClick={onSectorClick} t={t} weight={finW} /></div>
                                <div style={{ flex: healthW }} className="transition-all duration-500 h-full"><SectorBlock name="Healthcare" stocks={stocks} onClick={onSectorClick} t={t} weight={healthW} /></div>
                                <div style={{ flex: watchW }} className="transition-all duration-500 h-full"><WatchlistBlock stocks={watchlist} onClick={goToWatchlist} t={t} weight={watchW} /></div>
                            </div>
                        </div>
                    )}
                    <AiInsightBox content={aiContent} isAnalyzing={isAnalyzing} title={t.overview.aiInsight} />
                </div>

                <div className="space-y-6">
                    <NewsPanel title={t.overview.topStories} news={news} onNewsClick={onNewsClick} />
                    <div className="bg-[#161b22] border border-slate-800 rounded-xl p-6">
                        <h3 className="font-bold text-slate-200 mb-4 flex items-center gap-2 text-sm uppercase tracking-wider"><PieChart className="w-4 h-4 text-slate-400" /> {t.overview.majorEtfs}</h3>
                        <div className="space-y-2">{majorEtfs.length > 0 ? majorEtfs.map((etf: any) => <EtfRow key={etf.symbol} data={etf} />) : <div className="text-xs text-slate-500">{t.overview.loadingEtfs}</div>}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function WatchlistView({ stocks, news, isLoading, aiContent, isAnalyzing, onStockClick, onNewsClick, t }: any) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-right-4 duration-500">
            <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-3 text-slate-100 tracking-tight"><Star className="w-6 h-6 text-amber-400 fill-amber-400" /> {t.watchlist.title}</h2>
                    <span className="text-slate-400 text-xs font-mono">{stocks.length} {t.watchlist.tickers}</span>
                </div>
                
                <div className="bg-[#161b22] border border-slate-800 rounded-xl overflow-hidden shadow-lg ring-1 ring-slate-800/50 flex flex-col max-h-[600px]">
                    <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-800 bg-[#0d1117] text-[11px] font-bold text-slate-500 uppercase tracking-widest sticky top-0 z-10">
                        <div className="col-span-4">{t.watchlist.colCompany}</div><div className="col-span-2 text-right">{t.watchlist.colPrice}</div><div className="col-span-2 text-right">{t.watchlist.colChange}</div><div className="col-span-2 text-center">{t.watchlist.colTrend}</div><div className="col-span-2 text-right">{t.watchlist.colMktCap}</div>
                    </div>
                    <div className="divide-y divide-slate-800/50 overflow-y-auto custom-scrollbar">
                        {isLoading && stocks.length === 0 ? <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400 mb-2"/>{t.watchlist.loading}</div> : stocks.length === 0 ? <div className="p-12 text-center text-slate-500">{t.watchlist.empty}</div> : stocks.map((stock: any, i: number) => (
                            <div key={i} onClick={() => onStockClick(stock.symbol)} className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-slate-800/40 cursor-pointer transition-all group items-center">
                                <div className="col-span-4"><div className="flex items-center gap-4"><div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm ${stock.isUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{stock.symbol[0]}</div><div><div className="text-[15px] font-semibold text-white group-hover:text-indigo-400 transition-colors tracking-tight">{stock.symbol}</div><div className="text-xs text-slate-500 font-medium truncate max-w-[140px]">{stock.name}</div></div></div></div>
                                <div className="col-span-2 text-right text-[15px] font-semibold font-mono text-slate-200">{stock.price}</div>
                                <div className="col-span-2 flex justify-end"><span className={`px-2.5 py-1 rounded text-xs font-bold font-mono ${stock.isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{stock.change}</span></div>
                                <div className="col-span-2 flex justify-center h-8 items-center opacity-80 group-hover:opacity-100 transition-opacity"><Sparkline data={stock.trend} isUp={stock.isUp} /></div>
                                <div className="col-span-2 text-right text-slate-400 text-sm font-medium tracking-tight">{stock.marketCap}</div>
                            </div>
                        ))}
                    </div>
                </div>
                <AiInsightBox content={aiContent} isAnalyzing={isAnalyzing} title={t.watchlist.riskAnalysis} />
            </div>
            <div className="space-y-6">
                <NewsPanel title={t.watchlist.relatedNews} news={news} onNewsClick={onNewsClick} />
            </div>
        </div>
    );
}

function SectorView({ sectorName, stocksData, news, etfMap, isLoading, aiContent, isAnalyzing, onStockClick, onNewsClick, t }: any) {
    const stocks = stocksData[sectorName || 'Technology'] || [];
    const targetTickers = SECTOR_ETF_MAP[sectorName || 'Technology'] || [];
    const etfs = targetTickers.map((t: string) => etfMap[t]).filter(Boolean);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-right-4 duration-500">
            <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between"><h2 className="text-xl font-bold flex items-center gap-3 text-slate-100 tracking-tight"><Layers className="w-6 h-6 text-indigo-400" /> {sectorName} {t.sector.title}</h2></div>
                <div className="bg-[#161b22] border border-slate-800 rounded-xl overflow-hidden shadow-lg ring-1 ring-slate-800/50 flex flex-col max-h-[600px]">
                    <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-800 bg-[#0d1117] text-[11px] font-bold text-slate-500 uppercase tracking-widest sticky top-0 z-10">
                        <div className="col-span-4">{t.watchlist.colCompany}</div><div className="col-span-2 text-right">{t.watchlist.colPrice}</div><div className="col-span-2 text-right">{t.watchlist.colChange}</div><div className="col-span-2 text-center">{t.watchlist.colTrend}</div><div className="col-span-2 text-right">{t.watchlist.colMktCap}</div>
                    </div>
                    <div className="divide-y divide-slate-800/50 overflow-y-auto custom-scrollbar">
                        {isLoading && stocks.length === 0 ? <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400 mb-2"/>{t.sector.loading}</div> : stocks.map((stock: any, i: number) => (
                            <div key={i} onClick={() => onStockClick(stock.symbol)} className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-slate-800/40 cursor-pointer transition-all group items-center">
                                <div className="col-span-4"><div className="flex items-center gap-4"><div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm ${stock.isUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{stock.symbol[0]}</div><div><div className="text-[15px] font-semibold text-white group-hover:text-indigo-400 transition-colors tracking-tight">{stock.symbol}</div><div className="text-xs text-slate-500 font-medium truncate max-w-[140px]">{stock.name}</div></div></div></div>
                                <div className="col-span-2 text-right text-[15px] font-semibold font-mono text-slate-200">{stock.price}</div>
                                <div className="col-span-2 flex justify-end"><span className={`px-2.5 py-1 rounded text-xs font-bold font-mono ${stock.isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{stock.change}</span></div>
                                <div className="col-span-2 flex justify-center h-8 items-center opacity-80 group-hover:opacity-100 transition-opacity"><Sparkline data={stock.trend} isUp={stock.isUp} /></div>
                                <div className="col-span-2 text-right text-slate-400 text-sm font-medium tracking-tight">{stock.marketCap}</div>
                            </div>
                        ))}
                    </div>
                </div>
                <AiInsightBox content={aiContent} isAnalyzing={isAnalyzing} title={`${sectorName} ${t.sector.aiScan}`} />
            </div>
            <div className="space-y-6">
                <NewsPanel title={`${sectorName} News`} news={news} onNewsClick={onNewsClick} />
                <div className="bg-[#161b22] border border-slate-800 rounded-xl p-6"><h3 className="font-bold text-slate-200 mb-4 flex items-center gap-2 text-sm uppercase tracking-wider"><PieChart className="w-4 h-4 text-slate-400" /> {t.sector.relatedEtfs}</h3><div className="space-y-2">{etfs.length > 0 ? etfs.map((etf: any) => <EtfRow key={etf.symbol} data={etf} />) : <div className="text-xs text-slate-500">{t.overview.loadingEtfs}</div>}</div></div>
            </div>
        </div>
    );
}

function DetailView({ detail, news, isLoading, aiContent, isAnalyzing, onNewsClick, watchlist, onToggleWatchlist, t, signalData, isSignalLoading }: any) {
    const [hoverData, setHoverData] = useState<HoverData | null>(null);
    const handleChartLeave = useCallback(() => setHoverData(null), []);

    if (isLoading || !detail) return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6"><SkeletonHeight height="250px" /><SkeletonHeight height="400px" /></div>
            <div className="space-y-6"><SkeletonHeight height="600px" /></div>
        </div>
    );

    const displayData = hoverData ? {
        price: hoverData.price, change: hoverData.changePercent, isUp: hoverData.isUp,
        marketCap: hoverData.marketCap || detail.metrics.marketCap, pe: hoverData.pe || detail.metrics.pe, dateLabel: hoverData.date
    } : {
        price: detail.price, change: detail.change, isUp: detail.isUp,
        marketCap: detail.metrics.marketCap, pe: detail.metrics.pe, dateLabel: t.detail.liveData
    };

    const inWatchlist = watchlist?.includes(detail.symbol);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-right-4 duration-500">
            <div className="lg:col-span-2 space-y-6">
                <div className={`bg-[#161b22] border transition-colors duration-300 rounded-xl p-8 shadow-xl ${hoverData ? 'border-cyan-500/30' : 'border-slate-800'}`}>
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <div className="flex items-baseline gap-4 mb-2">
                                <h1 className="text-3xl font-bold text-white tracking-tight">{detail.symbol}</h1>
                                <span className="text-base text-slate-400 font-light">{detail.name}</span>
                                <button onClick={() => onToggleWatchlist(detail.symbol)} className={`ml-2 p-1.5 rounded-full transition-all ${inWatchlist ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'}`}>
                                    {inWatchlist ? <Star className="w-4 h-4 fill-amber-400" /> : <Plus className="w-4 h-4" />}
                                </button>
                            </div>
                            <div className="flex items-baseline gap-4">
                                <span className={`text-5xl font-bold tracking-tighter transition-all duration-100 ${hoverData ? 'text-cyan-100' : 'text-white'}`}>${displayData.price}</span>
                                <span className={`text-xl font-bold flex items-center ${displayData.isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {displayData.isUp ? <ArrowRight className="w-5 h-5 mr-1 -rotate-45" /> : <ArrowRight className="w-5 h-5 mr-1 rotate-45" />}{displayData.change}
                                </span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <span className={`px-4 py-1.5 rounded-full text-xs font-bold border uppercase tracking-wider transition-colors ${hoverData ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 animate-pulse' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'}`}>
                                {hoverData ? <span className="flex items-center gap-1"><History size={12}/> {t.detail.historical}</span> : t.detail.live}
                            </span>
                            <p className={`text-xs mt-2 font-medium ${hoverData ? 'text-cyan-500/80' : 'text-slate-500'}`}>{displayData.dateLabel}</p>
                        </div>
                    </div>
                    <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 border-t border-slate-800 pt-8 transition-opacity duration-300 ${hoverData ? 'opacity-90' : 'opacity-100'}`}>
                        <MetricCard label={t.detail.mktCap} value={displayData.marketCap} highlight={!!hoverData} />
                        <MetricCard label={t.detail.pe} value={displayData.pe} highlight={!!hoverData} />
                        <MetricCard label={t.detail.eps} value={detail.metrics.eps} dimmed={!!hoverData} />
                        <MetricCard label={t.detail.roe} value={detail.metrics.roe} dimmed={!!hoverData} />
                        <MetricCard label={t.detail.margin} value={detail.metrics.grossMargin} dimmed={!!hoverData} />
                        <MetricCard label={t.detail.earnings} value={detail.earningsDate} dimmed={!!hoverData} />
                    </div>
                </div>

                <SignalCard signalData={signalData} isLoading={isSignalLoading} t={t} />

                <div className="bg-[#161b22] border border-slate-800 rounded-xl p-4 h-[450px] relative overflow-hidden group">
                    <ChartComponent history={detail.chartHistory} currentMarketCap={parseMarketCap(detail.metrics.marketCap)} currentPrice={parseFloat(detail.price)} currentPe={parseFloat(detail.metrics.pe)} onHover={setHoverData} onLeave={handleChartLeave} />
                </div>
                <AiInsightBox content={aiContent} isAnalyzing={isAnalyzing} title="DeepSeek Analysis" />
            </div>
            <div className="space-y-6"><NewsPanel title={`${detail.symbol} News`} news={news} onNewsClick={onNewsClick} /></div>
        </div>
    );
}

function NewsView({ newsItem, aiContent, isAnalyzing, t }: any) {
    if (!newsItem) return null;
    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-4">
                <div className="flex items-center gap-3"><span className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-3 py-1 rounded text-xs font-bold uppercase tracking-wider">{newsItem.tag || "News"}</span><span className="text-slate-500 text-sm">{newsItem.source} • {newsItem.time}</span></div>
                <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">{newsItem.title}</h1>
                {newsItem.link && <a href={newsItem.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 hover:underline transition-colors mt-2"><Newspaper className="w-4 h-4" />{t.news.readOriginal}<ArrowRight className="w-3 h-3 -rotate-45" /></a>}
            </div>
            <AiInsightBox content={aiContent} isAnalyzing={isAnalyzing} title={t.news.aiInsight} expanded />
        </div>
    );
}

// --- 基础 UI 组件 (Function Declarations - Hoisted) ---

function NavItem({ icon, label, active, onClick }: any) {
    return <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 border border-transparent ${active ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20 shadow-sm' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>{React.cloneElement(icon, { size: 18 })}<span className={active ? "font-bold" : ""}>{label}</span></button>;
}

function SignalCard({ signalData, isLoading, t }: any) {
    const ts = t.signal;
    const [activePeriod, setActivePeriod] = React.useState('5d');

    if (isLoading) return (
        <div className="bg-[#161b22] border border-slate-800 rounded-xl p-5 animate-pulse">
            <div className="flex items-center gap-2 mb-4"><Target className="w-5 h-5 text-slate-600" /><div className="h-4 w-32 bg-slate-700 rounded"></div></div>
            <div className="h-24 bg-slate-800/50 rounded-lg"></div>
        </div>
    );
    if (!signalData || signalData.error) return null;

    const { signal, score, confidence, components, backtests } = signalData;
    const signalColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
        'Strong Buy':  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-lg shadow-emerald-500/10' },
        'Buy':         { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', glow: '' },
        'Hold':        { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', glow: '' },
        'Sell':        { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', glow: '' },
        'Strong Sell': { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30', glow: 'shadow-lg shadow-rose-500/10' },
    };
    const sc = signalColors[signal] || signalColors['Hold'];
    const confColor = confidence >= 70 ? 'text-emerald-400' : confidence >= 45 ? 'text-amber-400' : 'text-rose-400';
    const confBg = confidence >= 70 ? 'bg-emerald-500/10' : confidence >= 45 ? 'bg-amber-500/10' : 'bg-rose-500/10';
    const confLabel = confidence >= 70 ? ts.highConf : confidence >= 45 ? ts.medConf : ts.lowConf;

    const factorColor = (val: number) => val >= 58 ? 'text-emerald-400' : val >= 42 ? 'text-amber-400' : 'text-rose-400';
    const factorBg = (val: number) => val >= 58 ? 'bg-emerald-500/15' : val >= 42 ? 'bg-amber-500/15' : 'bg-rose-500/15';

    const FactorPill = ({ label, value: val }: { label: string; value: number }) => (
        <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md ${factorBg(val)} border border-slate-800/50`}>
            <span className="text-[10px] text-slate-400 font-medium">{label}</span>
            <span className={`text-xs font-bold font-mono ${factorColor(val)}`}>{val}</span>
        </div>
    );

    const btKeys = backtests ? Object.keys(backtests).filter(k => backtests[k]?.sampleSize > 0) : [];
    const bt = backtests?.[activePeriod] || (btKeys.length > 0 ? backtests[btKeys[0]] : null);

    const StatCell = ({ label, value, color }: { label: string; value: string; color: string }) => (
        <div className="text-center">
            <div className="text-[9px] text-slate-500 font-medium uppercase tracking-wider">{label}</div>
            <div className={`text-sm font-bold font-mono ${color}`}>{value}</div>
        </div>
    );

    return (
        <div className={`bg-[#161b22] border ${sc.border} rounded-xl p-5 ${sc.glow} relative overflow-hidden`}>
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500"></div>

            {/* Header: signal badge + score + confidence */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="bg-indigo-500/10 p-1.5 rounded-lg"><Target className="w-4 h-4 text-indigo-400" /></div>
                    <h2 className="text-sm font-bold text-white tracking-tight">{ts.title}</h2>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${confBg}`}>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">{ts.confidence}</span>
                        <span className={`text-xs font-bold font-mono ${confColor}`}>{confidence}%</span>
                        <span className={`text-[9px] font-bold ${confColor}`}>{confLabel}</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-800/50 px-2 py-1 rounded-md">
                        <span className="text-[9px] text-slate-500 font-bold uppercase">{ts.score}</span>
                        <span className={`text-lg font-bold font-mono leading-none ${sc.text}`}>{score}</span>
                    </div>
                    <span className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${sc.bg} ${sc.text} ${sc.border}`}>
                        {signal}
                    </span>
                </div>
            </div>

            {/* Factors: two groups side-by-side */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-950/30 rounded-lg p-3 border border-slate-800/50">
                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">{ts.technical}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                        <FactorPill label={ts.momentum} value={components.momentum} />
                        <FactorPill label={ts.trend} value={components.trend} />
                        <FactorPill label={ts.rsi} value={components.rsi} />
                        <FactorPill label={ts.volume} value={components.volume} />
                    </div>
                </div>
                <div className="bg-slate-950/30 rounded-lg p-3 border border-slate-800/50">
                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">{ts.fundamental}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                        <FactorPill label={ts.value} value={components.value} />
                        <FactorPill label={ts.quality} value={components.quality} />
                        <div className="col-span-2">
                            <FactorPill label={ts.volatility} value={components.volatility} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Backtest: tabs for hold period */}
            {btKeys.length > 0 && bt ? (
                <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800/50">
                    <div className="flex items-center justify-between mb-2.5">
                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <ShieldCheck className="w-3 h-3" /> {ts.backtest}
                        </h3>
                        <div className="flex gap-1">
                            {btKeys.map(key => (
                                <button
                                    key={key}
                                    onClick={() => setActivePeriod(key)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                        activePeriod === key || (activePeriod === '5d' && !btKeys.includes('5d') && key === btKeys[0])
                                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                            : 'bg-slate-800/50 text-slate-500 border border-slate-700/50 hover:text-slate-400'
                                    }`}
                                >
                                    {key}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                        <StatCell
                            label={ts.winRate}
                            value={`${(bt.winRate * 100).toFixed(1)}%`}
                            color={bt.winRate >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}
                        />
                        <StatCell
                            label={ts.avgReturn}
                            value={`${bt.avgReturn >= 0 ? '+' : ''}${(bt.avgReturn * 100).toFixed(2)}%`}
                            color={bt.avgReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                        />
                        <StatCell
                            label={ts.sharpe}
                            value={bt.sharpe?.toFixed(2) ?? '-'}
                            color={bt.sharpe >= 0.5 ? 'text-emerald-400' : bt.sharpe >= 0 ? 'text-amber-400' : 'text-rose-400'}
                        />
                        <StatCell
                            label={ts.maxDD}
                            value={`${((bt.maxDrawdown || 0) * 100).toFixed(1)}%`}
                            color={bt.maxDrawdown > -0.05 ? 'text-amber-400' : 'text-rose-400'}
                        />
                        <StatCell
                            label={ts.trades}
                            value={`${bt.sampleSize}`}
                            color="text-slate-300"
                        />
                    </div>
                </div>
            ) : (
                <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-800/50 flex items-center justify-center">
                    <span className="text-[10px] text-slate-500">{ts.noData}</span>
                </div>
            )}

            <div className="mt-3 flex items-center gap-1.5 text-[9px] text-slate-600">
                <AlertTriangle className="w-2.5 h-2.5" />
                <span>{ts.disclaimer}</span>
            </div>
        </div>
    );
}

function MetricCard({ label, value, highlight, dimmed }: any) {
    return (
        <div className={`px-3 py-3 rounded-xl border flex flex-col justify-center transition-all duration-200 ${highlight ? 'bg-cyan-500/10 border-cyan-500/30' : dimmed ? 'bg-slate-800/20 border-slate-800/50 opacity-60' : 'bg-slate-800/30 border-slate-800'}`}>
            <p className={`text-[10px] mb-1 font-semibold uppercase transition-colors ${highlight ? 'text-cyan-400' : 'text-slate-500'}`}>{label}</p>
            <p className={`font-bold text-sm tracking-tight transition-colors ${highlight ? 'text-cyan-200' : 'text-slate-200'}`}>{value}</p>
        </div>
    );
}

function EtfRow({ data }: { data: EtfData }) {
    return <div className="flex justify-between items-center text-sm p-3 hover:bg-slate-800/50 rounded-lg transition-colors cursor-pointer group border border-transparent hover:border-slate-700/50"><div className="flex flex-col"><span className="text-slate-200 font-bold font-mono group-hover:text-indigo-400 transition-colors">{data.symbol}</span><span className="text-[10px] text-slate-500 font-medium">{data.name}</span></div><div className="text-right"><div className="text-slate-200 font-mono text-xs">${data.price}</div><div className={`text-[10px] font-bold ${data.isUp ? 'text-emerald-400' : 'text-rose-400'}`}>{data.change}</div></div></div>;
}

function NewsPanel({ title, news, onNewsClick }: any) {
    return <div className="bg-[#161b22] border border-slate-800 rounded-xl p-6 h-fit"><div className="flex items-center justify-between mb-6"><h3 className="font-bold flex items-center gap-2 text-slate-200 text-sm uppercase tracking-wider"><Newspaper className="w-4 h-4 text-indigo-400" />{title}</h3></div><div className="space-y-6">{(!news || news.length === 0) ? <div className="text-slate-500 text-xs">Fetching latest headlines...</div> : news.map((n: any) => <div key={n.id} onClick={() => onNewsClick && onNewsClick(n)} className="group cursor-pointer"><div className="flex justify-between items-start mb-1.5"><span className="text-[9px] font-bold tracking-wider text-slate-500 uppercase border border-slate-700 px-1.5 py-0.5 rounded">{n.tag}</span><span className="text-[10px] text-slate-500">{n.time}</span></div><h4 className="text-[13px] font-semibold text-slate-300 group-hover:text-indigo-400 transition-colors leading-relaxed">{n.title}</h4><div className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-slate-600"></span>{n.source}</div></div>)}</div></div>;
}

function SectorBlock({ name, stocks, onClick, big, style, t, weight }: any) { 
    const sList = stocks[name] || []; 
    const avg = sList.reduce((acc: number, c: any) => acc + (parseFloat(c.change.replace('%','').replace('+','')) || 0), 0) / (sList.length || 1); 
    const isUp = avg >= 0; 
    
    const sortedStocks = [...sList].sort((a: any, b: any) => {
        const changeA = Math.abs(parseFloat(a.change.replace('%', '').replace('+', '')) || 0);
        const changeB = Math.abs(parseFloat(b.change.replace('%', '').replace('+', '')) || 0);
        return changeB - changeA;
    });

    const displayStocks = sortedStocks.slice(0, big ? 3 : 2);

    let titleSize = 'text-sm';
    let priceSize = 'text-base';
    if (weight > 1.5) { titleSize = 'text-3xl'; priceSize = 'text-3xl'; }
    else if (weight > 1.0) { titleSize = 'text-2xl'; priceSize = 'text-2xl'; }
    else if (weight > 0.6) { titleSize = 'text-xl'; priceSize = 'text-xl'; }

    const displayName = t?.sectors?.[name] || name;

    return (
        <div onClick={() => onClick(name)} style={style} className={`w-full h-full cursor-pointer p-4 flex flex-col justify-between transition-all border relative overflow-hidden group ${isUp ? 'bg-emerald-900/20 border-emerald-500/20 hover:bg-emerald-900/30' : 'bg-rose-900/10 border-rose-500/20 hover:bg-rose-900/20'}`}>
            <div className="flex justify-between items-start z-10">
                <span className={`font-bold text-slate-100 ${titleSize} transition-all`}>{displayName}</span>
                <span className={`font-bold ${priceSize} ${isUp ? 'text-emerald-400' : 'text-rose-400'} transition-all`}>{avg.toFixed(2)}%</span>
            </div>
            <div className="mt-auto z-10">
                <div className="flex flex-wrap gap-2">
                    {displayStocks.map((s: any) => (
                        <div key={s.symbol} className="text-[10px] font-medium text-slate-300 bg-black/20 px-2 py-1 rounded border border-white/5 backdrop-blur-sm">
                            <span className="font-bold mr-1">{s.symbol}</span> 
                            <span className={parseFloat(s.change) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{s.change}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

function WatchlistBlock({ stocks, onClick, t, weight }: any) { 
    const avg = stocks.reduce((acc: number, c: any) => acc + (parseFloat(c.change.replace('%','').replace('+','')) || 0), 0) / (stocks.length || 1); 
    const isUp = avg >= 0; 
    
    const sortedStocks = [...stocks].sort((a: any, b: any) => {
        const changeA = Math.abs(parseFloat(a.change.replace('%', '').replace('+', '')) || 0);
        const changeB = Math.abs(parseFloat(b.change.replace('%', '').replace('+', '')) || 0);
        return changeB - changeA;
    });

    const displayStocks = sortedStocks.slice(0, 2);

    let titleSize = 'text-sm';
    let priceSize = 'text-xl';
    if (weight > 0.8) { titleSize = 'text-lg'; priceSize = 'text-2xl'; }

    return (
        <div onClick={onClick} className={`w-full h-full cursor-pointer p-4 flex flex-col justify-between transition-all border relative overflow-hidden group ${isUp ? 'bg-indigo-900/20 border-indigo-500/30 hover:bg-indigo-900/30' : 'bg-indigo-900/20 border-indigo-500/30 hover:bg-indigo-900/30'}`}>
            <div className="flex justify-between items-start z-10">
                <span className={`font-bold text-slate-200 flex items-center gap-2 transition-all ${titleSize}`}><Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {t.watchlist.title}</span>
                <span className={`font-bold ${priceSize} ${isUp ? 'text-emerald-400' : 'text-rose-400'} transition-all`}>{avg.toFixed(2)}%</span>
            </div>
            <div className="mt-auto z-10">
                 <div className="flex flex-wrap gap-2">
                    {displayStocks.map((s: any) => (
                        <div key={s.symbol} className="text-[10px] font-medium text-slate-300 bg-black/20 px-2 py-1 rounded border border-white/5 backdrop-blur-sm">
                            <span className="font-bold mr-1">{s.symbol}</span>
                            <span className={parseFloat(s.change) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{s.change}</span>
                        </div>
                    ))}
                    {sortedStocks.length > 2 && <div className="text-[9px] text-slate-500 self-center ml-1">+{sortedStocks.length - 2}</div>}
                </div>
            </div>
        </div>
    )
}

function Sparkline({ data, isUp }: any) { 
    if (!data?.length) return <span className="text-[10px] text-slate-700">No Data</span>; 
    const min = Math.min(...data); 
    const max = Math.max(...data); 
    const width = 80;
    const height = 32;
    
    const points = data.map((val: number, i: number) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((val - min) / (max - min || 1)) * height;
        return `${x},${y}`;
    }).join(' '); 
    
    const lastVal = data[data.length - 1];
    const lastY = height - ((lastVal - min) / (max - min || 1)) * height;

    const color = isUp ? '#34d399' : '#f43f5e'; 
    return (
        <div className="relative w-[80px] h-[32px]">
            <svg width="80" height="32" className="overflow-visible">
                <path d={`M ${points}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="80" cy={lastY} r="2" fill={color} className="animate-pulse" />
                <circle cx="80" cy={lastY} r="1" fill="#fff" />
            </svg>
        </div>
    );
}

function SkeletonHeight({ height }: { height: string }) {
    return <div style={{ height }} className="w-full bg-slate-800/50 animate-pulse rounded-xl border border-slate-800"></div>;
}

function MarkdownRenderer({ content }: { content: string }) {
    if (!content) return <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4 py-8"><Brain className="w-12 h-12 opacity-20" /><p className="opacity-60">Waiting for analysis...</p></div>;
    return (
      <div className="space-y-3 text-slate-300 leading-relaxed text-[15px] animate-in fade-in duration-500">
        {content.split('\n').map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;
          const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
          if (headerMatch) {
            const level = headerMatch[1].length;
            const sizeClass = level <= 2 ? 'text-xl' : level === 3 ? 'text-lg' : 'text-base';
            return <h3 key={i} className={`${sizeClass} font-bold text-indigo-300 mt-5 mb-2 flex items-center gap-2`}>{headerMatch[2]}</h3>;
          }
          if (trimmed.startsWith('> ')) return <div key={i} className="border-l-4 border-indigo-500 pl-4 py-2 my-4 bg-indigo-500/10 italic text-slate-200 rounded-r">{parseBold(trimmed.replace(/^> /, ''))}</div>;
          if (trimmed.match(/^[-*•]\s/)) return <div key={i} className="flex gap-3 pl-1 mb-1"><span className="text-indigo-500 mt-2 text-[6px] flex-shrink-0">●</span><div className="flex-1">{parseBold(trimmed.replace(/^[-*•]\s/, ''))}</div></div>;
          return <p key={i} className="mb-2">{parseBold(trimmed)}</p>;
        })}
      </div>
    );
}

function AiInsightBox({ content, isAnalyzing, title, expanded }: any) {
    return (
        <div className={`bg-[#161b22] border border-indigo-500/30 rounded-xl p-6 shadow-lg relative overflow-hidden group ${expanded ? 'min-h-[400px]' : ''}`}>
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
            <div className="flex items-center gap-2 mb-4"><div className="bg-indigo-500/10 p-2 rounded-lg"><Zap className="w-5 h-5 text-indigo-400" /></div><h2 className="text-lg font-bold text-white tracking-tight">{title}</h2>{isAnalyzing && <span className="text-xs text-indigo-400 animate-pulse ml-auto font-mono font-bold">ANALYZING...</span>}</div>
            <div className={`bg-slate-950/30 rounded-lg p-5 leading-7 border border-slate-800/50 text-[14px] font-light text-slate-300 ${expanded ? 'min-h-[300px]' : 'min-h-[160px]'}`}>
                <MarkdownRenderer content={content} />
            </div>
        </div>
    );
}

function ChatWidget({ context, t, lang }: any) {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (messages.length === 0) {
            setMessages([{ role: 'assistant', content: t.chat.welcome }]);
        }
    }, [t, messages.length]);

    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || loading) return;
        const userMsg = input.trim();
        setInput("");
        setMessages(p => [...p, { role: 'user', content: userMsg }]);
        setLoading(true);
        try {
            const res = await fetch('/api/chat', { 
                method: 'POST', 
                body: JSON.stringify({ 
                    messages: [...messages, { role: 'user', content: userMsg }],
                    context: { ...context, language: lang === 'zh' ? 'Chinese' : 'English' } 
                }) 
            });
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            setMessages(p => [...p, { role: 'assistant', content: '' }]);
            let done = false; let fullContent = "";
            while (!done) {
                const { value, done: rDone } = await reader!.read();
                done = rDone;
                const chunk = decoder.decode(value, { stream: true });
                fullContent += chunk;
                setMessages(p => { const newArr = [...p]; newArr[newArr.length - 1].content = fullContent; return newArr; });
            }
        } catch (e) { setMessages(p => [...p, { role: 'assistant', content: "⚠️ Connection Failed" }]); } finally { setLoading(false); }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {isOpen && (
                <div className="bg-[#161b22] border border-slate-700 w-[340px] h-[450px] rounded-xl shadow-2xl mb-4 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
                    <div className="bg-[#0d1117] p-3 border-b border-slate-700 flex justify-between items-center"><div className="flex items-center gap-2 font-bold text-slate-200"><Brain className="w-4 h-4 text-indigo-400" /> {t.chat.title}</div><button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white"><X size={16}/></button></div>
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-lg p-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                                    {m.role === 'assistant' ? (
                                        <div className="space-y-1.5">
                                            {m.content.split('\n').map((line, j) => {
                                                const trimmed = line.trim();
                                                if (!trimmed) return <div key={j} className="h-1"></div>;
                                                
                                                const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
                                                if (headerMatch) {
                                                    return <h4 key={j} className="font-bold text-indigo-400 mt-2">{headerMatch[2]}</h4>;
                                                }
                                                
                                                if (trimmed.match(/^[-*•]\s/)) {
                                                    return (
                                                        <div key={j} className="flex gap-2 pl-1">
                                                            <span className="text-indigo-400 flex-shrink-0">•</span>
                                                            <span>{parseBold(trimmed.replace(/^[-*•]\s/, ''))}</span>
                                                        </div>
                                                    );
                                                }
                                                return <p key={j}>{parseBold(line)}</p>;
                                            })}
                                        </div>
                                    ) : m.content}
                                </div>
                            </div>
                        ))}
                        {loading && <div className="flex justify-start"><div className="bg-slate-800 p-2 rounded-lg"><Loader2 className="w-4 h-4 animate-spin text-indigo-400"/></div></div>}
                    </div>
                    <div className="p-3 border-t border-slate-700 bg-[#0d1117] flex gap-2"><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder={t.chat.placeholder} className="flex-1 bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"/><button onClick={sendMessage} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-lg disabled:opacity-50"><Send size={16} /></button></div>
                </div>
            )}
            <button onClick={() => setIsOpen(!isOpen)} className="bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-lg shadow-indigo-900/40 transition-all hover:scale-105 active:scale-95">{isOpen ? <Minus size={24} /> : <MessageSquare size={24} />}</button>
        </div>
    )
}