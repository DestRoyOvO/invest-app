import { defineMessages } from "./define";

// Tab titles and page descriptions that no page heading provides: the site's default title, description and tagline
// (app/layout.tsx), the factor lab's description and the title of a quote page without a valid symbol. Pages with a
// heading take their title from their own namespace (data.title, alerts.title ...). zh is typed against en; add keys
// to both.
export const metaMessages = defineMessages(
  {
    title: "InvestSeek · Market terminal",
    description: "A fast, honest market research terminal: live quotes, sector heatmap, quant signals with transparent backtests, and AI research notes.",
    tagline: "The market terminal that publishes its own track record.",
    labDescription:
      "What the prices in InvestSeek can and cannot forecast: pre-registered factor tests, the track record of the technical reading and the calibration of the risk forecast.",
    quote: "Quote",
  },
  {
    title: "InvestSeek · 行情终端",
    description: "快速、坦诚的行情研究终端：最新行情、板块热力图、回测透明的量化信号和 AI 研究笔记。",
    tagline: "公开自身历史表现的行情终端。",
    labDescription: "InvestSeek 的价格数据能预测什么、不能预测什么：事先登记的因子检验、技术读数的历史表现和风险预测的校准。",
    quote: "个股",
  },
);
