import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import * as cheerio from 'cheerio'; 

export const runtime = 'nodejs';

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// --- Single-article content fetching (only for "News Insight" view) ---
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNewsContent(url: string, timeoutMs: number = 8000): Promise<string> {
  if (!url) return "";

  // Jina Reader (primary — handles JS rendering, consent walls, read-more)
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetchWithTimeout(jinaUrl, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
    }, timeoutMs);
    if (res.ok) {
      const text = await res.text();
      if (text.length > 200) return text.slice(0, 6000);
    }
  } catch (e) {}

  // Direct scrape fallback
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Referer': 'https://www.google.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, timeoutMs);

    if (res.ok) {
      const html = await res.text();
      if (html.includes("consent.yahoo.com") || html.includes("guce.yahoo.com")) return "";
      const $ = cheerio.load(html);
      $('script, style, nav, footer, iframe, .advertisement, .caas-iframe, .bypass-block, button').remove();
      let content = "";
      const selectors = ['.caas-body', 'article', '.article-body', 'main', 'body'];
      for (const selector of selectors) {
        if ($(selector).length) {
          $(selector).find('p').each((_, el) => {
            const text = $(el).text().trim();
            if (text.length > 40) content += text + "\n\n";
          });
          break;
        }
      }
      if (content.length > 150) return content.slice(0, 6000);
    }
  } catch (e) {}
  return "";
}

// --- Headline intelligence: categorize news by provenance for AI context ---
function buildNewsIntelligence(newsItems: any[]): string {
  if (!newsItems || newsItems.length === 0) return '';

  const byCategory: Record<string, { title: string; snippet?: string }[]> = {
    company: [],
    industry: [],
    macro: [],
  };

  for (const item of newsItems) {
    const cat = item.provenance || 'macro';
    const bucket = byCategory[cat] || byCategory.macro;
    bucket.push({ title: item.title, snippet: item.snippet || '' });
  }

  let block = '';

  if (byCategory.company.length > 0) {
    block += `\n**[COMPANY-SPECIFIC NEWS]** (directly mentions the company):\n`;
    for (const n of byCategory.company) {
      block += `- "${n.title}"${n.snippet ? ` — ${n.snippet}` : ''}\n`;
    }
  }

  if (byCategory.industry.length > 0) {
    block += `\n**[INDUSTRY CONTEXT]** (affects the company's industry/supply chain):\n`;
    for (const n of byCategory.industry) {
      block += `- "${n.title}"${n.snippet ? ` — ${n.snippet}` : ''}\n`;
    }
  }

  if (byCategory.macro.length > 0) {
    block += `\n**[MACRO/SECTOR BACKDROP]** (broader market & geopolitical context):\n`;
    for (const n of byCategory.macro) {
      block += `- "${n.title}"${n.snippet ? ` — ${n.snippet}` : ''}\n`;
    }
  }

  return block;
}

export async function POST(request: Request) {
  try {
    const { context, data } = await request.json();

    if (!context && !data) {
      return NextResponse.json({ error: 'Missing analysis data' }, { status: 400 });
    }

    let extraContext = "";
    let debugMsg = "";

    // 1a. Single article fetch (News Insight view)
    if (data.link && (context.includes("Insight") || context.includes("News"))) {
        const articleBody = await fetchNewsContent(data.link);
        if (articleBody && articleBody.length > 200) {
            extraContext = articleBody;
            debugMsg = `> 🟢 **[System Log]**: Successfully retrieved full article content (${articleBody.length} chars). Analyzing...\n\n`;
        } else {
             debugMsg = `> ⚠️ **[System Log]**: Direct content access restricted. Analyzing based on headline and summary data.\n\n`;
        }
    }

    // 1b. For stock analysis: build categorized headline intelligence (no scraping needed)
    if (data.relatedNews && Array.isArray(data.relatedNews) && data.relatedNews.length > 0 && !extraContext) {
        const newsIntel = buildNewsIntelligence(data.relatedNews);
        if (newsIntel) {
            extraContext = newsIntel;
        }
    }

    // 2. 构建专业分析 Prompt (根据不同层级定制深度指令)
    let specificInstructions = "";
    
    if (context.includes("Portfolio") || context.includes("Watchlist")) {
        // 针对自选股：不仅看风险，还要结合相关新闻
        specificInstructions = `
        - **Focus**: Portfolio Health Check & Exposure Analysis.
        - **Assess**: Sector Concentration (Are they all Tech?), Beta/Volatility.
        - **Synthesize**: Connect the provided 'relevantNews' headlines to the portfolio's performance drivers.
        - **Goal**: Provide a "Portfolio Manager's" view on risk and balance.`;

    } else if (context.includes("Sector")) {
        // 针对板块：强制要求结合新闻进行叙事，而不仅仅是列出涨跌
        specificInstructions = `
        - **Focus**: Sector Rotation, Trends & Narrative.
        - **Assess**: Relative strength vs broader market. Identify the leaders vs laggards.
        - **Synthesize**: Use the provided 'sectorNews' headlines to explain *WHY* the sector is moving today. Is it earnings? Macro? Hype?
        - **Goal**: Explain the "Story" behind the price action.`;

    } else if (context.includes("News")) {
        // 针对单条新闻
        specificInstructions = `
        - **Focus**: Impact Analysis.
        - **Assess**: Is this noise or a fundamental shift? Short-term reaction vs Long-term thesis.
        - **Goal**: Determine if this is actionable intelligence.`;

    } else if (context.includes("Market Overview") || context.includes("Global Market")) {
        // 针对市场总览：新增的分支，专注于宏观
        specificInstructions = `
        - **Focus**: Global Macro Sentiment.
        - **Assess**: Key Drivers (Inflation, Fed, Geopolitics). Compare Indices (Nasdaq vs Dow).
        - **Synthesize**: Connect the 'topHeadlines' to the overall market mood (Risk-On vs Risk-Off).
        - **Goal**: A high-level executive summary of the market day.`;

    } else {
        specificInstructions = `
        - **Focus**: Fundamental & Technical Synthesis for the specific stock.
        - **Assess**: Valuation (P/E vs Growth), Technical Trend (SMA), and Earnings quality.
        - **News Intelligence**: The news headlines below are categorized by relevance:
          - COMPANY-SPECIFIC: directly about this company — highest signal weight.
          - INDUSTRY CONTEXT: affects the company's supply chain, competitors, or pricing — connect cause to effect.
          - MACRO/SECTOR BACKDROP: broad forces (geopolitics, interest rates, regulation) — assess second-order impact.
          Treat each headline as an intelligence signal. Infer likely content from the headline and your knowledge, then explain how it impacts this stock's thesis. Do NOT just list headlines — analyze them.
        - **Goal**: A Buy/Hold/Sell/Watch framework grounded in data and news intelligence.`;
    }

    // Inject quantitative model signal as a supporting reference (not the central focus)
    let modelSignalBlock = "";
    if (data.modelSignal) {
        const ms = data.modelSignal;
        const c = ms.components || {};
        const confLabel = ms.confidence >= 70 ? 'HIGH' : ms.confidence >= 45 ? 'MEDIUM' : 'LOW';
        const fit = typeof ms.factorAgreement === 'number' ? ms.factorAgreement : ms.confidence;
        const cov = typeof ms.dataCompleteness === 'number' ? ms.dataCompleteness : null;
        const dataBit = cov !== null ? `, data coverage ${cov}%` : '';

        // Identify standout factors (top/bottom)
        const entries = Object.entries(c) as [string, number][];
        const sorted = [...entries].sort((a, b) => b[1] - a[1]);
        const highlights = sorted.filter(([, v]) => v >= 70 || v <= 30);
        const highlightStr = highlights.length > 0
            ? highlights.map(([k, v]) => `${k}=${v}`).join(', ')
            : 'no extreme factors';

        let btSummary = '';
        const bts = ms.backtests || {};
        const btEntries = Object.entries(bts).filter(([_, bt]: [string, any]) => bt && bt.sampleSize > 0);
        if (btEntries.length > 0) {
            const parts = btEntries.map(([period, bt]: [string, any]) =>
                `${period}: ${(bt.winRate * 100).toFixed(0)}% win, ${bt.avgReturn >= 0 ? '+' : ''}${(bt.avgReturn * 100).toFixed(1)}% avg`
            );
            btSummary = ` | Backtest: ${parts.join('; ')}`;
        }

        modelSignalBlock = `

**[Quant Model Reference]**
Our systematic 7-factor model rates this: **${ms.signal}** (score ${ms.score}/100, headline reliability ${ms.confidence}% ${confLabel} — factor directional fit ${fit}%${dataBit}). Notable: ${highlightStr}.${btSummary}

Treat this as one analyst's view — a data point on your desk, not the thesis itself.
Lead your memo with your own fundamental/technical/news-driven narrative.
You may reference the model signal once (e.g., in Bottom Line or Strategic Implication) where it naturally supports or contrasts your view.
Do NOT structure the memo around explaining each factor score. Do NOT invent different model numbers.`;
    }

    const systemPrompt = `You are "InvestSeek AI", a Senior Institutional Portfolio Manager. 
Your task is to generate a **professional, high-value investment memo** based on the provided data.

**Your Mandate:**
1.  **Rationality Over Hype**: Focus on Risk/Reward, Valuation, and Fundamentals.
2.  **Strict Data Integrity**: Use ONLY the data provided in the JSON below. Do NOT hallucinate prices.
3.  **Narrative Synthesis**: Don't just list numbers. **Connect the dots** between the Price Data and the News Headlines provided in the context.
4.  **Structured Output**: Use this Markdown structure:
    -   **📉 The Bottom Line**: A 1-sentence executive summary.
    -   **🔍 Deep Dive**: Analysis of the data/news. Connect the dots between macro indices and specific stocks.
    -   **⚠️ Risk Vectors**: Specific risks (e.g., "High concentration", "Macro headwinds").
    -   **💡 Strategic Implication**: A prudent, actionable thought (e.g., "Consider trimming exposure", "Watch for support at...").

**Context Specifics:**
${specificInstructions}
${modelSignalBlock}

**Tone**: Institutional, Objective, Concise (under 350 words).`;

    const userContent = `**Analysis Context**: ${context}
**Market/Stock Data**: ${JSON.stringify(data)}
${extraContext ? `\n**News Intelligence**:\n${extraContext}` : ''}`;

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.3,
      stream: true, 
    });

    const stream = new ReadableStream({
      async start(controller) {
        if (debugMsg) {
            controller.enqueue(new TextEncoder().encode(debugMsg));
        }
        for await (const chunk of response) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            controller.enqueue(new TextEncoder().encode(content));
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (error) {
    console.error("Analysis API Error:", error);
    return NextResponse.json({ result: "DeepSeek API Connection Failed." }, { status: 500 });
  }
}