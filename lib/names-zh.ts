// Chinese names for common symbols, matched locally by the command bar and the add-symbol form. Yahoo's search only
// understands Latin text (a query such as "苹果" fails), so Chinese input is resolved here instead of upstream.
// Covers the stock universe, the market board, the sector and broad ETFs, and widely followed US-listed Chinese
// companies, Hong Kong stocks and indices. The first name is the display name; the rest are aliases.

export interface ChineseName {
  symbol: string;
  names: readonly [string, ...string[]];
}

export const CHINESE_NAMES: readonly ChineseName[] = [
  // Universe: technology
  { symbol: "NVDA", names: ["英伟达", "辉达"] },
  { symbol: "MSFT", names: ["微软"] },
  { symbol: "AAPL", names: ["苹果"] },
  { symbol: "AVGO", names: ["博通"] },
  { symbol: "ORCL", names: ["甲骨文"] },
  { symbol: "AMD", names: ["超威半导体", "超微半导体", "AMD"] },
  { symbol: "CRM", names: ["赛富时", "Salesforce"] },
  { symbol: "ADBE", names: ["奥多比", "Adobe"] },
  { symbol: "CSCO", names: ["思科"] },
  { symbol: "QCOM", names: ["高通"] },
  // Universe: communication services
  { symbol: "GOOGL", names: ["谷歌", "Alphabet"] },
  { symbol: "META", names: ["Meta", "脸书", "元宇宙平台"] },
  { symbol: "NFLX", names: ["奈飞", "网飞"] },
  { symbol: "DIS", names: ["迪士尼"] },
  { symbol: "TMUS", names: ["T-Mobile", "T-Mobile 美国"] },
  { symbol: "VZ", names: ["威瑞森", "Verizon"] },
  { symbol: "T", names: ["美国电话电报", "AT&T"] },
  { symbol: "CMCSA", names: ["康卡斯特"] },
  // Universe: consumer discretionary
  { symbol: "AMZN", names: ["亚马逊"] },
  { symbol: "TSLA", names: ["特斯拉"] },
  { symbol: "HD", names: ["家得宝"] },
  { symbol: "MCD", names: ["麦当劳"] },
  { symbol: "BKNG", names: ["缤客", "Booking"] },
  { symbol: "LOW", names: ["劳氏"] },
  { symbol: "TJX", names: ["TJX"] },
  { symbol: "NKE", names: ["耐克"] },
  { symbol: "SBUX", names: ["星巴克"] },
  // Universe: consumer staples
  { symbol: "WMT", names: ["沃尔玛"] },
  { symbol: "COST", names: ["好市多", "开市客", "Costco"] },
  { symbol: "PG", names: ["宝洁"] },
  { symbol: "KO", names: ["可口可乐"] },
  { symbol: "PEP", names: ["百事"] },
  { symbol: "PM", names: ["菲利普莫里斯"] },
  { symbol: "MDLZ", names: ["亿滋"] },
  // Universe: health care
  { symbol: "LLY", names: ["礼来"] },
  { symbol: "UNH", names: ["联合健康"] },
  { symbol: "JNJ", names: ["强生"] },
  { symbol: "ABBV", names: ["艾伯维"] },
  { symbol: "MRK", names: ["默沙东", "默克"] },
  { symbol: "TMO", names: ["赛默飞世尔", "赛默飞"] },
  { symbol: "ABT", names: ["雅培"] },
  { symbol: "AMGN", names: ["安进"] },
  { symbol: "PFE", names: ["辉瑞"] },
  // Universe: financials
  { symbol: "BRK-B", names: ["伯克希尔哈撒韦", "伯克希尔", "巴菲特"] },
  { symbol: "JPM", names: ["摩根大通", "小摩"] },
  { symbol: "V", names: ["维萨", "Visa"] },
  { symbol: "MA", names: ["万事达"] },
  { symbol: "BAC", names: ["美国银行", "美银"] },
  { symbol: "WFC", names: ["富国银行"] },
  { symbol: "GS", names: ["高盛"] },
  { symbol: "MS", names: ["摩根士丹利", "大摩"] },
  { symbol: "BLK", names: ["贝莱德"] },
  // Universe: industrials
  { symbol: "GE", names: ["通用电气", "GE 航空航天"] },
  { symbol: "CAT", names: ["卡特彼勒"] },
  { symbol: "RTX", names: ["雷神技术", "RTX"] },
  { symbol: "UNP", names: ["联合太平洋"] },
  { symbol: "HON", names: ["霍尼韦尔"] },
  { symbol: "BA", names: ["波音"] },
  { symbol: "DE", names: ["迪尔", "约翰迪尔"] },
  { symbol: "LMT", names: ["洛克希德马丁", "洛马"] },
  // Universe: energy
  { symbol: "XOM", names: ["埃克森美孚"] },
  { symbol: "CVX", names: ["雪佛龙"] },
  { symbol: "COP", names: ["康菲石油"] },
  { symbol: "SLB", names: ["斯伦贝谢", "SLB"] },
  { symbol: "EOG", names: ["EOG 能源"] },
  // Universe: materials
  { symbol: "LIN", names: ["林德"] },
  { symbol: "SHW", names: ["宣伟"] },
  { symbol: "APD", names: ["空气化工"] },
  { symbol: "FCX", names: ["自由港麦克莫兰", "自由港"] },
  { symbol: "NEM", names: ["纽蒙特"] },
  // Universe: utilities
  { symbol: "NEE", names: ["新纪元能源"] },
  { symbol: "SO", names: ["南方电力", "南方公司"] },
  { symbol: "DUK", names: ["杜克能源"] },
  { symbol: "CEG", names: ["星座能源"] },
  // Universe: real estate
  { symbol: "PLD", names: ["安博", "普洛斯"] },
  { symbol: "AMT", names: ["美国电塔"] },
  { symbol: "EQIX", names: ["易昆尼克斯", "Equinix"] },
  { symbol: "SPG", names: ["西蒙地产"] },

  // Other widely followed US stocks
  { symbol: "TSM", names: ["台积电"] },
  { symbol: "INTC", names: ["英特尔"] },
  { symbol: "MU", names: ["美光"] },
  { symbol: "ASML", names: ["阿斯麦"] },
  { symbol: "ARM", names: ["安谋"] },
  { symbol: "PLTR", names: ["帕兰提尔", "Palantir"] },
  { symbol: "IBM", names: ["IBM", "国际商业机器"] },
  { symbol: "UBER", names: ["优步"] },
  { symbol: "ABNB", names: ["爱彼迎"] },
  { symbol: "SMCI", names: ["超微电脑"] },
  { symbol: "MRVL", names: ["迈威尔"] },
  { symbol: "COIN", names: ["Coinbase"] },
  { symbol: "MSTR", names: ["微策略", "Strategy"] },
  { symbol: "HOOD", names: ["罗宾汉"] },
  { symbol: "SHOP", names: ["Shopify"] },
  { symbol: "PYPL", names: ["贝宝", "PayPal"] },

  // US-listed Chinese companies
  { symbol: "BABA", names: ["阿里巴巴", "阿里"] },
  { symbol: "PDD", names: ["拼多多"] },
  { symbol: "JD", names: ["京东"] },
  { symbol: "BIDU", names: ["百度"] },
  { symbol: "NTES", names: ["网易"] },
  { symbol: "TCOM", names: ["携程"] },
  { symbol: "BILI", names: ["哔哩哔哩", "B站"] },
  { symbol: "NIO", names: ["蔚来"] },
  { symbol: "XPEV", names: ["小鹏汽车", "小鹏"] },
  { symbol: "LI", names: ["理想汽车", "理想"] },
  { symbol: "BEKE", names: ["贝壳"] },
  { symbol: "TME", names: ["腾讯音乐"] },
  { symbol: "FUTU", names: ["富途"] },
  { symbol: "TAL", names: ["好未来"] },
  { symbol: "EDU", names: ["新东方"] },
  { symbol: "VIPS", names: ["唯品会"] },

  // Hong Kong
  { symbol: "0700.HK", names: ["腾讯控股", "腾讯"] },
  { symbol: "9988.HK", names: ["阿里巴巴港股"] },
  { symbol: "3690.HK", names: ["美团"] },
  { symbol: "1810.HK", names: ["小米集团", "小米"] },
  { symbol: "1211.HK", names: ["比亚迪股份", "比亚迪"] },
  { symbol: "9618.HK", names: ["京东集团港股"] },
  { symbol: "2318.HK", names: ["中国平安"] },
  { symbol: "0005.HK", names: ["汇丰控股", "汇丰"] },

  // Indices, rates, currencies, commodities, crypto
  { symbol: "^GSPC", names: ["标普500", "标普 500", "标普"] },
  { symbol: "^NDX", names: ["纳斯达克100", "纳指100", "纳指"] },
  { symbol: "^IXIC", names: ["纳斯达克综合指数", "纳斯达克"] },
  { symbol: "^DJI", names: ["道琼斯", "道指"] },
  { symbol: "^RUT", names: ["罗素2000", "罗素"] },
  { symbol: "^VIX", names: ["波动率指数", "恐慌指数"] },
  { symbol: "^TNX", names: ["美债10年收益率", "十年期美债"] },
  { symbol: "^HSI", names: ["恒生指数", "恒指"] },
  { symbol: "000001.SS", names: ["上证指数", "上证综指"] },
  { symbol: "000300.SS", names: ["沪深300"] },
  { symbol: "^N225", names: ["日经225", "日经"] },
  { symbol: "DX-Y.NYB", names: ["美元指数"] },
  { symbol: "GC=F", names: ["黄金", "金价"] },
  { symbol: "SI=F", names: ["白银"] },
  { symbol: "CL=F", names: ["原油", "WTI 原油"] },
  { symbol: "BTC-USD", names: ["比特币"] },
  { symbol: "ETH-USD", names: ["以太坊"] },

  // ETFs
  { symbol: "SPY", names: ["标普500 ETF"] },
  { symbol: "QQQ", names: ["纳指100 ETF"] },
  { symbol: "DIA", names: ["道指 ETF"] },
  { symbol: "IWM", names: ["罗素2000 ETF"] },
  { symbol: "XLK", names: ["科技板块 ETF"] },
  { symbol: "XLC", names: ["通信服务板块 ETF"] },
  { symbol: "XLY", names: ["可选消费板块 ETF"] },
  { symbol: "XLP", names: ["必需消费板块 ETF"] },
  { symbol: "XLV", names: ["医疗保健板块 ETF"] },
  { symbol: "XLF", names: ["金融板块 ETF"] },
  { symbol: "XLI", names: ["工业板块 ETF"] },
  { symbol: "XLE", names: ["能源板块 ETF"] },
  { symbol: "XLB", names: ["原材料板块 ETF"] },
  { symbol: "XLU", names: ["公用事业板块 ETF"] },
  { symbol: "XLRE", names: ["房地产板块 ETF"] },
  { symbol: "SMH", names: ["半导体 ETF"] },
  { symbol: "KWEB", names: ["中概互联网 ETF", "中概股 ETF"] },
  { symbol: "FXI", names: ["中国大盘 ETF"] },
  { symbol: "GLD", names: ["黄金 ETF"] },
  { symbol: "TLT", names: ["20年期以上美债 ETF", "长期美债 ETF"] },
];

const BY_SYMBOL = new Map(CHINESE_NAMES.map((entry) => [entry.symbol, entry.names[0]]));

/** Display name in Chinese, if known. */
export function chineseNameOf(symbol: string): string | undefined {
  return BY_SYMBOL.get(symbol);
}

/** True when the text contains CJK characters (Yahoo search cannot handle those). */
export function hasCjk(text: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(text);
}

/**
 * Symbols whose Chinese names or aliases contain the query (case-insensitive for Latin aliases), best matches first:
 * exact name, then prefix, then substring. At most `limit` results.
 */
export function searchChineseNames(query: string, limit = 8): Array<{ symbol: string; name: string }> {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];
  const scored: Array<{ symbol: string; name: string; rank: number; order: number }> = [];
  CHINESE_NAMES.forEach((entry, order) => {
    let best = Infinity;
    for (const name of entry.names) {
      const n = name.toLowerCase().replace(/\s+/g, "");
      const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : Infinity;
      best = Math.min(best, rank);
    }
    if (best < Infinity) scored.push({ symbol: entry.symbol, name: entry.names[0], rank: best, order });
  });
  return scored
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ symbol, name }) => ({ symbol, name }));
}
