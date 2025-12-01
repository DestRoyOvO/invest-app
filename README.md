InvestSeek AI 🚀

A Next-Gen Intelligent Financial Research Terminal combining real-time market data with institutional-grade AI analysis.

📖 Introduction

InvestSeek AI redefines the personal investment dashboard. By combining the speed of Next.js, the flexibility of Yahoo Finance data, and the analytical power of DeepSeek AI, it delivers a research experience previously reserved for professional terminals.

Unlike traditional dashboards that just show numbers, InvestSeek provides context-aware insights, helping you understand why the market is moving.

✨ Key Features

📊 Market Intelligence

Global Pulse: Real-time tracking of major indices (S&P 500, Nasdaq, 10Y Treasury).

Sector Heatmap: Visualizing market movements with volatility-based sizing.

Macro News Engine: Auto-curated top stories covering global economy and policy.

📈 Deep Dive Quotes

Dynamic Charts: Custom SVG Sparklines with "Robinhood-style" pulsing indicators.

Technical Analysis: Auto-calculated MA5, MA10, MA20 moving averages.

Smart Context: A unique "Dual-Track" search engine that fetches both company-specific news AND relevant industry context (e.g., fetching "Oil Prices" when viewing an Energy stock).

⭐ Smart Watchlist

Privacy First: Your portfolio is stored locally in your browser (localStorage). No login required.

Risk Scanner: AI-powered analysis of your portfolio to detect concentration risks.

Live Updates: Data auto-refreshes every 5 seconds to keep you ahead.

🤖 AI "Portfolio Manager"

Context Awareness: The AI knows exactly what you are looking at and tailors its answers accordingly.

Structured Memos: Generates professional investment reports with sections like "Bottom Line", "Deep Dive", and "Risk Vectors".

Bilingual Core: Native support for both English and Chinese (Simplified).

📸 Screenshots

(Place your screenshots in the public/images folder to see them here)

1. Market Overview & Heatmap

2. Stock Detail with AI Analysis

🛠️ Tech Stack

Framework: Next.js 14 (App Router)

Language: TypeScript

Styling: Tailwind CSS

Icons: Lucide React

Data Fetching: yahoo-finance2 (Server-side), Custom SWR Hooks

AI Model: DeepSeek API (OpenAI SDK Compatible)

🚀 Getting Started

Follow these steps to run the project locally.

Prerequisites

Node.js 18.17 or later

A valid DeepSeek API Key

Installation

Clone the repository

git clone [https://github.com/your-username/investseek-ai.git](https://github.com/your-username/investseek-ai.git)
cd investseek-ai


Install dependencies

npm install
# or
yarn install


Configure Environment Variables
Create a .env.local file in the root directory and add your API key:

DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here


Run the Development Server

npm run dev


Launch
Open http://localhost:3000 in your browser.

📂 Project Structure

investseek-ai/
├── app/
│   ├── api/
│   │   ├── analyze/       # AI Analysis & Web Scraper logic
│   │   ├── chat/          # Chatbot context injection
│   │   └── market/        # Yahoo Finance data fetching (Dual-Track Search)
│   ├── globals.css        # Global Tailwind styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main Dashboard UI (SPA architecture)
├── public/                # Static assets & images
├── .env.local             # Environment variables (not committed)
├── next.config.mjs        # Next.js configuration
├── package.json           # Dependencies and scripts
├── tailwind.config.ts     # Tailwind configuration
└── tsconfig.json          # TypeScript configuration


🛡️ Disclaimer

This project is for educational and informational purposes only.

The data provided is sourced from public APIs and may not be real-time or 100% accurate.

InvestSeek AI does not provide financial advice. All investment strategies involve risk of loss.

Always consult with a qualified financial professional before making investment decisions.

📄 License

This project is licensed under the MIT License.