import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { messages, context } = await request.json();

    // 1. 构建基础上下文描述 (Context Construction)
    let contextInfo = "";
    let languageInstruction = "English"; // 默认为英文

    // 判断当前视图
    if (context) {
        // 提取语言设置
        if (context.language) {
            languageInstruction = context.language;
        }

        if (context.view === 'detail' && context.detailSummary) {
            const d = context.detailSummary;
            contextInfo += `User Active View: Stock Detail for ${d.symbol}. Price: ${d.price} (${d.change}). Market Cap: ${d.marketCap}.\n`;
            // 补充财务指标
            if (d.pe) contextInfo += `Key Fundamentals visible to user: P/E(TTM): ${d.pe}, EPS: ${d.eps}, ROE: ${d.roe}, Gross Margin: ${d.grossMargin}, Next Earnings: ${d.earningsDate}.\n`;
        } else if (context.view === 'sector' && context.sector) {
            contextInfo += `User Active View: ${context.sector} Sector Dashboard.\n`;
        } else if (context.view === 'watchlist') {
            contextInfo += `User Active View: Personal Watchlist Page.\n`;
        } else {
            contextInfo += `User Active View: Market Overview.\n`;
        }

        // 注入持仓数据
        if (context.watchlistData && Array.isArray(context.watchlistData) && context.watchlistData.length > 0) {
            contextInfo += `\n[USER'S WATCHLIST/PORTFOLIO DATA]:\n${context.watchlistData.join(', ')}\n(Use this specific data to answer questions about the user's holdings/watchlist.)\n`;
        }

        // 注入宏观指数
        if (context.marketIndices && context.marketIndices.length > 0) {
            contextInfo += `\n[REAL-TIME MARKET INDICES]:\n${context.marketIndices.join(', ')}\n`;
        }
        
        // 注入新闻
        if (context.visibleNews && context.visibleNews.length > 0) {
            contextInfo += `\n[VISIBLE NEWS HEADLINES]:\n${context.visibleNews.slice(0, 3).join('; ')}\n`;
        }
    }

    // 2. 定义系统提示词 (System Prompt Engineering)
    // 采用通用的行为准则 (Core Behavioral Guidelines) 替代硬编码的问答对
    const systemPrompt = `You are "InvestSeek AI", an elite financial assistant with the persona of a **Senior Institutional Portfolio Manager**. 
Your goal is to empower the user with professional, data-driven, and risk-aware insights.

**IMPORTANT CONFIGURATION:**
1.  **Language**: You MUST respond in **${languageInstruction}**. (Even if the user asks in a different language, try to align with ${languageInstruction} unless explicitly requested otherwise).
2.  **Tone**: Professional, Rational, Concise.

**CURRENT LIVE DATA & CONTEXT:**
${contextInfo}

**CORE BEHAVIORAL GUIDELINES (UNIVERSAL):**

1.  **INTENT DETECTION & RESPONSE SIZING**:
    -   **Conversational / Identity / Greeting Inputs**: If the user's input is casual, social, or asking about your identity, keep the response **brief, polite, and conversational**. Do NOT dump data or provide an unasked market analysis. Simply acknowledge the context and offer help.
    -   **Analytical / Market Inputs**: If the user asks about stocks, trends, risks, or strategies, switch to "Deep Analysis Mode" and provide a comprehensive answer using the data provided.

2.  **THE "INSTITUTIONAL MINDSET" (For Analysis)**:
    -   **Strict Data Integrity**: Use the specific numbers provided above (P/E, ROE, Prices). Do not hallucinate.
    -   **Rationality Over Hype**: Pivot to Valuation and Risk/Reward, not hype.
    -   **Holistic View**: Warn about concentration risk if the watchlist is unbalanced.
    -   **Strategy**: Provide actionable, prudent thoughts (e.g., "Hold", "Rebalance").

3.  **FORMATTING**:
    -   Use Markdown (Bold, Bullet points) for readability.
    -   Keep it professional but accessible.

**Current Task**: Respond to the user's latest message naturally based on these guidelines.`;

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      stream: true,
      temperature: 0.3, 
    });

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of response) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) controller.enqueue(new TextEncoder().encode(content));
        }
        controller.close();
      },
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error) {
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}