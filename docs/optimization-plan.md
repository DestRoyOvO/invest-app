# InvestSeek 优化计划

> 审查日期：2026-11-07 ｜ 审查对象：`main` 分支，commit 7cdc7a6
>
> 方法：按 6 个维度（安全、后端与 AI 集成、前端正确性、性能与数据获取、量化模型、体验与架构）各派一个审查代理独立通读代码，再由一个独立的验证代理逐条对照代码尝试反驳、修正行号和严重度。另外在本地实际运行了应用（1024px 与 375px 视口），跑了 `npm audit` 和生产构建，并用真实行情数据复算了回测。

## 实施进度（2026-11-07 更新）

本计划已在 feat/terminal-redesign 分支上实施，尚未提交。各阶段状态如下：

| 阶段 | 状态 | 说明 |
|---|---|---|
| 0 立即处理 | 已完成 | Next.js 升级到 16.4.5；开发服务器只监听 127.0.0.1；代码与参数校验；不再向客户端返回内部错误；生产依赖审计 0 个漏洞 |
| 1 AI 接口与显眼 bug | 已完成 | 密码会话、按 IP 与全局限流、每日预算、同源检查、zod 校验、请求体上限、max_tokens；SSRF 改为优先使用服务端查到的新闻链接，客户端传来的链接只作后备且必须通过域名白名单，抓取时再拦截私网地址并逐跳校验重定向；流式请求可中止；换用 swr；无效代码显示“未找到” |
| 2 数据层与性能 | 已完成 | 共享 Yahoo 客户端、分层 TTL 缓存与并发合并、失败时保留旧数据、前后端类型契约、新闻相关性按词边界打分、依赖清理 |
| 3 量化模型可信度 | 已完成 | 单元测试、仅技术面回测（约 250 日、次日开盘、交易成本、复权价、Wilson 区间、基准对比）、因子校准，以及离线全市场评估。评估结论是没有可靠的预测力，因此界面改为中性读数，并在评分下方展示历史表现 |
| 4 体验与工程化 | 大部分完成 | App Router 路由拆分、终端风格重新设计、响应式布局与手机底栏、键盘导航、类型化的中英文词典、浅色主题、CI。尚未做 Playwright 端到端测试和 axe 自动化无障碍检查 |

计划之外新增的内容：持仓跟踪，以及按持仓市值分析的 AI 组合扫描；量化评分的全市场历史表现面板；AI 回答被长度上限截断时的提示；公共行情接口的限流。

## 一、结论速览

验证后保留 **122 条**问题（另驳回 9 条），不同维度之间有重复，合并后约 40 个问题组。

| 严重度 | 条数 |
|---|---|
| 严重 critical | 3 |
| 高 high | 27 |
| 中 medium | 53 |
| 低 low | 39 |

最需要先处理的五件事：

1. **Next.js 16.0.4 有多个严重漏洞**，其中包括无需登录的远程代码执行（React Server Components 协议漏洞，所有 App Router 应用都受影响；另有一条专门针对 Windows 主机）。升级到 16.4.5 即可修复，属于同一大版本内的升级。
2. **两个 AI 接口等于公开的 DeepSeek 代理**：没有鉴权、限流和 `max_tokens`，客户端可以塞入任意 `system` 消息和任意长度的内容。一旦部署到公网，任何人都能刷掉你的余额。
3. **`/api/analyze` 存在服务端请求伪造（SSRF）**：服务器会抓取客户端传来的任意网址，包括内网和 localhost，抓到的正文还会经模型复述回来。
4. **行情轮询量过大且没有缓存**：停留在个股页的一个标签页每小时约产生 1 万次 Yahoo 请求，很容易被限流；而前端又把错误响应当作数据，一次失败的轮询就会把整个看板刷成全 0。
5. **量化信号的"证据"站不住**：回测窗口只有 60 天（最多 6–20 笔交易），并且把今天的基本面套到所有历史日期。实测 NVDA、MSFT、XOM 的回测结果与"每 5 天无条件买入"完全相同；"可信度 High"几乎对所有数据完整的股票都成立。

## 二、做得好的地方（建议保留）

- **密钥处理正确**：`DEEPSEEK_API_KEY` 只在服务端读取，从未提交进 git，也不在客户端 bundle 里。
- **没有 XSS 注入点**：AI 输出和 Markdown 都以 React 文本节点渲染，没有 `dangerouslySetInnerHTML`。
- **量化引擎结构好**：`lib/signal.ts` 全是纯函数，实时信号与回测共用同一条计算路径；验证代理用"扰动未来数据"的测试确认没有未来数据泄漏。Wilder RSI、年化方式、单位换算都正确，回测交易不重叠。
- **文档诚实**：`docs/signal-model.md` 写明了局限性并附免责声明。
- **双语基础扎实**：中英文词典的键完全对齐（各 88 个），AI 回复会跟随界面语言。
- **轻量**：自绘的 SVG K 线图很轻；生产构建通过，首屏 JS 约 184 KB（gzip），其中应用自身代码约 17 KB。

## 三、分阶段计划

方括号内是主要代码位置。工作量：S 少于 2 小时，M 少于 1 天，L 多于 1 天。

### 阶段 0：立即处理（半天内）

| # | 事项 | 做法 | 工作量 |
|---|---|---|---|
| 0.1 | 升级 Next.js，修复严重漏洞 [package.json] | `npm i next@16.4.5`、`npm i -D eslint-config-next@16.4.5`，再运行 `npm audit fix` 修复 undici、postcss、sharp、zod 等传递依赖的高危漏洞；跑一遍 build 和冒烟测试 | S |
| 0.2 | 开发服务器只监听本机 [package.json] | 改为 `"dev": "next dev -H 127.0.0.1"`。`next dev` 默认监听所有网卡，同一局域网（咖啡馆 Wi-Fi 之类）的人能访问到有漏洞的服务和没有保护的 AI 接口 | S |
| 0.3 | 如果已经部署到公网 | 在加上鉴权之前，先下线 AI 接口或开启平台的访问密码保护 | S |
| 0.4 | 输入校验 [app/api/market/route.ts:329-334, app/api/signal/route.ts:17-18] | 用正则 `^[A-Z0-9.^=-]{1,12}$` 校验代码；自选股去重并限制在 30 个以内（现在一个请求带几千个代码就会触发几千次 Yahoo 调用）；`backtestDays` 限制在 20–250；客户端拼 URL 时用 `encodeURIComponent`（现在搜索 "AT&T" 会查成 "AT"） | S |
| 0.5 | 不再把内部错误返回给客户端 [market/route.ts:425, signal/route.ts:95] | 删除 `details: String(error)`，只写服务端日志 | S |

### 阶段 1：本周（堵住 AI 接口 + 修最显眼的 bug）

**AI 接口防滥用** [app/api/chat/route.ts, app/api/analyze/route.ts]

- **鉴权、限流、输出上限**：个人项目用一个服务端校验的访问密码换取 httpOnly cookie 就够了；加按 IP 的限流和每日预算；两个接口都设置 `max_tokens`（例如备忘录 1000、聊天 800）；要求 `Content-Type: application/json` 并检查同源 Origin。现在聊天请求以 text/plain 发出，不触发跨域预检，任何第三方网页都能让访客的浏览器替它调用你的接口。
- **用 zod 校验请求体**：消息角色只允许 user/assistant，只保留最近约 10 条，限制总字符数；`language` 只允许中/英；analyze 改为只从白名单字段拼 prompt，不再整体 `JSON.stringify(data)`；请求体上限约 64 KB。
- **DeepSeek 客户端改为懒加载** [analyze/route.ts:7-10, chat/route.ts:6-9]：缺少 `DEEPSEEK_API_KEY` 时返回明确的 503；不要回落到 `OPENAI_API_KEY`（openai SDK 的默认行为会把环境里的 OpenAI 密钥发给 DeepSeek）；设置 `timeout: 30_000` 和 `maxRetries: 1`。

**SSRF** [app/api/analyze/route.ts:23-68, 124-131]

- 推荐做法：客户端只传新闻的 uuid，服务端从自己拿到的 Yahoo 结果里查出链接。
- 退而求其次：只允许 https + 新闻域名白名单 + 解析 DNS 后拒绝私网、回环、链路本地地址 + 手动处理重定向并逐跳校验。
- 顺带修掉：读取正文也要受超时约束（现在拿到响应头后计时器就被清掉了，正文可以无限期慢慢传）；按字节上限读取；使用真实的 User-Agent（现在伪装成 Googlebot）；删除会泄露抓取结果的 "[System Log]" 调试行。

**显眼的前端 bug**

- **AI 分析流不会中止** [app/page.tsx:452-455, 514-586]：切换页面后旧备忘录会继续流进新页面，两个流会交错，先结束的那个会把"分析中"状态提前关掉，被放弃的生成照样计费。用 ref 保存 AbortController 和 run id，切换视图或开始新分析时 abort，丢弃过期 run 的分块；服务端把 `request.signal` 传给 `chat.completions.create`。四个维度都独立报告了这个问题。
- **把手写的 useSWR 换成已安装的 swr** [app/page.tsx:40-88]：现在的钩子会把上一个代码的响应写到当前代码上（包括发给 AI 的模型信号），并且不检查 `res.ok`，一次失败的轮询就会用 `{error}` 覆盖好数据，界面变成全 0、空列表或骨架屏。swr 自带按 key 隔离、失败时保留旧数据、隐藏标签页暂停轮询、上一次请求结束后才发下一次。fetcher 改为在 `!res.ok` 时抛错。
- **无效代码永远骨架屏** [page.tsx:507-511, 885-890]：实测搜索 "apple" 后页面一直停在骨架屏，并且每 5 秒重复请求一次 404。路由对"代码不存在"返回 404、对上游失败返回 502；前端显示"未找到 APPLE"并停止轮询。
- **聊天组件** [page.tsx:1296-1381]：检查 `res.ok`，错误不要显示成 AI 回复，也不要作为历史回传给模型；历史只发最近约 10 轮；输入法组字时按回车不应发送（判断 `e.nativeEvent.isComposing`，搜索框同理）；欢迎语随语言切换；不要原地修改 state。
- **小问题**：回测标签的高亮和显示的数据可能不一致，没有买入信号时却显示"数据不足" [page.tsx:1008-1009]；首次挂载时没有 K 线数据，图表会一直空白 [page.tsx:222-232]；价格区间为 0 时坐标变成 NaN。

### 阶段 2：数据层与性能（1–2 周）

目标：每个标签页每小时的 Yahoo 请求从约 1 万次降到几百次，并且不再出现"一个请求失败整页清零"。

- **统一的 Yahoo 访问层 `lib/server/yahoo.ts`**：
  - 模块级单例 `new YahooFinance({ suppressNotices: ['yahooSurvey'] })`。现在每个请求都 new 一次，抑制提示的写法无效，survey 提示每个请求都会打印。
  - 带 TTL 的缓存，并缓存进行中的 promise 以合并并发请求。建议 TTL：报价 10–15 秒（休市时几分钟）、日线到下一个交易日、基本面 6–24 小时、新闻 5–10 分钟。
  - 每次请求 8 秒超时。yahoo-finance2 在整个进程里共用一个并发为 4 的队列，几个挂住的请求就会拖慢所有路由。
- **拆分个股接口**：个股页每 5 秒只轮询一个轻量的报价接口；基本面、K 线、新闻按代码一次性获取并走缓存；去掉"报价、基本面、其余"三步串行等待。
- **概览接口瘦身** [market/route.ts:314-364]：现在每 30 秒为 44 只股票各拉一次日线，只是为了画迷你走势图，而概览页根本不显示走势图。三次 quote 调用合并成一次；走势图只在进入板块或自选页时按需获取，并长期缓存。
- **轮询策略**：只轮询当前可见的视图（现在离开个股页后，5 秒一次的轮询仍在后台运行）；根据 `marketState` 调整频率，休市时降频或停止；自选股单独一个 key（现在每点一次星标都会整页重拉概览，页面加载时还会重复请求一次）。
- **服务端容错** [market/route.ts:198-219, 358-364]：用 `Promise.allSettled` 分段返回；状态码区分 400（参数错误）、404（代码不存在）、502（上游失败）。现在任何异常都返回 404。
- **统一前后端数据契约 `types/api.ts`**（可配合 zod）：
  - 聊天拿不到基本面：服务端读取 `detailSummary.pe/eps/roe`，客户端从来没有发送 [chat/route.ts:26-31，page.tsx:598-603]。
  - analyze 的 prompt 引用了客户端从不发送的字段（relevantNews、sectorNews、topHeadlines），而个股备忘录的输入里约一半是原始 K 线和重复的新闻。改为发送派生指标（均线、区间涨跌幅、RSI 原值等），新闻和模型信号各发一次。
  - `metrics.grossMargin` 实际是净利率，却以"毛利率"的名义交给模型 [market/route.ts:232, 251]。改名为 `profitMargin`。
  - 新闻的 `source` 字段里放的是时间，`time` 固定为 "Live"，媒体名被丢掉 [market/route.ts:185, 264-267, 418]。改为返回 `publisher` 和 ISO 格式的发布时间，由前端按界面语言格式化。
  - API 返回原始数值和 ISO 时间，前端用 `Intl` 格式化。现在日期按服务器的时区和语言格式化，实测英文界面里显示成 "2026/11/17"。
- **新闻相关性打分** [market/route.ts:91-132]：子串匹配导致 "ai" 命中 "said"、"war" 命中 "warehouse"；又用公司的法定名称（"apple inc."）去匹配，真正的公司新闻反而被过滤掉。单字母代码（T、C、F、V）尤其严重。改为按词边界匹配、去掉 Inc./Corporation 等后缀、额外匹配 `$TICKER` 和 `(TICKER)`。
- **依赖清理**：删除未使用的 recharts、apexcharts、react-apexcharts、@tailwindcss/postcss；cheerio 改用 `cheerio/slim`（analyze 路由的服务端代码块现在有 1.09 MB）；yahoo-finance2 升级到 3.15.4；去掉已被弃用且从未读取的 `incomeStatementHistory` 模块（库每次调用都会打印警告）。

### 阶段 3：量化模型可信度（2–3 周）

原则：先有评估工具，再改参数。没有评估证据之前，不要再调整权重和阈值。

- **先补测试和评估脚本**：
  - 用 vitest 给 `lib/signal.ts` 的纯函数写单元测试：RSI 参考值、下行波动率、镜像对称、连续性与单调性、NaN 防护、未来数据扰动测试、无信息随机游走下的标签分布。
  - 写一个离线评估脚本：固定股票池、缓存复权日线、滚动的样本外检验，输出 rank IC、各标签相对基准的超额收益、带置信区间的胜率。
- **回测改造** [lib/signal.ts:619-720, app/api/signal/route.ts:77-86]：
  - 实测见第四节：基本面强的股票几乎每天都是 Buy，回测结果等于"每 5 天买一次"；PFE、TSLA 在约 266 个交易日里一次 Buy 都没有。原因是把今天的基本面（占 30% 权重）套到了每一个历史日期。改为只用技术面因子回测并明确标注，或者在离线评估里使用时点基本面。
  - 窗口从 60 天扩到约 250 天（计算只需约 3 毫秒）；同时显示交易笔数、Wilson 置信区间、同窗口的基准胜率和超额收益；交易少于 20 笔时置灰。
  - 次日开盘价成交、扣除交易成本、使用复权价（现在除息日会被算成亏损）；"夏普"要么年化，要么改名；最大回撤按逐日盯市计算；卖出信号也要评估，否则把面板标题改为"买入信号回测"（现在卖出标签下展示的也是买入回测）。
- **"可信度"徽章** [lib/signal.ts:496-569]：数据完整时，因子一致度只要达到 49% 就显示 High；缺失数据填充的 50 分也算"一致"，完全没有数据的代码会显示"因子一致 100%"。实测 8 只股票里 6 只显示 High。应排除填充值和 50±5 以内的因子，用数据覆盖率封顶；除非能用实际命中率校准，否则改名为"因子一致度"。
- **因子校准**：
  - **波动率**：用的是绝对波动水平，相当于给低波动股票永久加分。纯随机游走下，25% 年化波动的股票有 37% 的日子是 Buy、只有 1% 是 Sell。改为相对波动（相对自身历史或相对 SPY），或者移出方向性评分、改作风险提示；RSI 映射改成以 50 对称；阈值按实际分数分布设定。
  - **下行波动率**：除以下跌天数而不是总天数，并且下跌不超过 2 天时直接归零，造成 92 分到 0 分的断崖。
  - **估值**：在增长率分档处和 P/E=7 处有断崖；亏损公司因为 Yahoo 不返回 P/E 而得到中性的 50 分（实测 INTC）。改用连续的 PEG 式映射，用 EPS ≤ 0 识别亏损。
  - **质量**：区间设置让一家典型公司的得分低于"没有数据"（ROE 15%、净利率 11%、负债率 0.9 只得 32 分），这是 7cdc7a6 提交引入的退化；金融股不应使用负债率。
  - **其他**：平坦序列的 RSI 返回 100（同样是 7cdc7a6 引入的退化）；阶梯式打分让随机游走下每 100 个交易日标签变化 9–17 次，可改为分段线性并加滞回；动量背离惩罚应向 50 收缩而不是向 0；交易时段内去掉 Yahoo 当天尚未收盘的那根日线；价格数据缺失时返回"数据不足"而不是一个 Hold/Buy 标签（实测 `/api/signal?ticker=APPLE` 返回 200 和 "Hold 50"）；所有 Yahoo 字段做 `Number.isFinite` 检查（NaN 现在会变成 Strong Sell）。
- **界面诚实度**：信号卡加中英文免责声明、计算时间和方法说明链接；翻译 Strong Buy 等标签，模型验证之前可以用更温和的措辞；"RSI 85" 实际是反向分数（超卖时显示绿色的 85），应同时显示 RSI 原值和波动率原值；图表悬停时估算出的历史 P/E 不要当作事实展示；AI prompt 引用回测胜率时附上交易笔数和基准。
- **同步文档**：`docs/signal-model.md` 与代码约有 10 处不一致。把阈值放进一个导出的常量表，文档引用它；去掉没有证据支撑的"calibrated/tuned"说法。

### 阶段 4：体验、可访问性与工程化（持续进行）

- **URL 路由**：用 App Router 拆成 `/`、`/watchlist`、`/sector/[name]`、`/stock/[ticker]`，每个路由配 loading、error、not-found。解决浏览器后退直接离开应用、刷新回到首页、无法分享链接，以及应用内"返回"丢失来源板块的问题。
- **拆分 `app/page.tsx`**（86 KB、1381 行、约 80 处 `any`），建议结构：

  ```
  app/(dashboard)/...                    路由，尽量用服务端薄页面
  components/{layout,market,stock,signal,news,ai,chat,ui}
  hooks/{useMarket,useQuote,useSignal,useWatchlist,useAiStream,useLocale}
  lib/{i18n,format,api-client}
  lib/server/{yahoo,deepseek}
  types/api.ts
  ```

  先做最便宜的一步：把 SignalCard 里的 FactorPill、StatCell 挪到模块顶层，可以消除 12 个 lint 错误和每次渲染时的重新挂载。
- **测试与 CI**：先修复 lint（目前 97 个错误）；GitHub Actions 运行 lint、`tsc --noEmit`、vitest 和 build；加一个 Playwright 冒烟测试，覆盖 375px 和 1440px，并用 axe 做可访问性检查。
- **响应式（实测）**：
  - 手机宽度 375px 下没有任何导航入口，搜索框被挤到 71px，内容横向溢出 267px。加底部标签栏，搜索框单独一行。
  - 1024px 宽度时，热力图的磁贴溢出到右侧新闻栏约 160px。flex 子项加 `min-w-0`，限制字号。
  - 板块和自选表格在 658px 以下、768–913px、1024–1234px 区间会出现列重叠。小屏改为两行卡片。
  - 聊天面板在横屏手机上会超出屏幕；`h-screen` 改为 `h-dvh`。
- **可访问性（WCAG 2.1 AA）**：10 处用 div/span 做的点击目标无法用键盘操作（A 级不达标），改为 button 或 Link；图标按钮加 aria-label；流式输出区域加 aria-live；slate-500/600 文字的对比度只有 2.3–4.1:1，次要文字最低用 slate-400；最小字号 12px；加明显的 focus-visible 样式；K 线图加坐标轴和键盘操作；尊重系统的"减少动画"设置。
- **国际化**：大量硬编码英文（"Chart data unavailable"、"Waiting for analysis..."、信号标签、板块名等）；`<html lang="zh">` 但默认界面是英文；语言选择刷新后丢失。给词典加类型约束，缺键时 tsc 报错；语言存进 cookie 并据此设置 html lang；API 返回代码而不是英文文案。
- **诚实的状态显示**：侧栏永远显示"DeepSeek 已连接"，周末也显示"Live Market"；首屏会先闪现一个全绿 0.00% 的假市场；空列表永远显示"正在获取头条"。区分加载、空、错误三种状态；状态指示灯接一个真实的健康检查，或者干脆去掉；AI 面板空闲时放一个"生成"按钮；备忘录按视图、代码、语言缓存；不要一打开新闻就自动发起一次付费分析。
- **文档与配置**：README 写的是 Next.js 14 和 Node 18（实际需要 Node 20.9 以上，yahoo-finance2 建议 22 以上），列出了不存在的路径，截图部分为空，声明 MIT 却没有 LICENSE 文件。加上 `engines` 字段和 `.nvmrc`；统一产品名（浏览器标签页标题是"DeepSeek 智能投研助手"，界面里叫 InvestSeek）；`animate-in` 等动画类因为没装 tailwindcss-animate 而不生效，`custom-scrollbar` 没有定义，要么装插件要么删掉；颜色改成主题 token。

## 四、实测证据

**本地运行**（`next dev`，1024px 与 375px 视口）

- 个股页每 5 秒请求一次 `/api/market?ticker=`，概览接口同时仍在后台每 30 秒请求一次。
- 按代码统计：概览一次约 48 次 Yahoo 调用，个股一次 5–8 次，合计每个标签页每小时约 1 万次。
- 接口耗时（本机）：概览约 0.85 秒，个股 0.04–0.4 秒，信号 0.1–0.2 秒。瓶颈在请求量，而不是速度。
- 无效代码 "apple"：页面一直是骨架屏，每 5 秒重复请求 404；`/api/signal?ticker=APPLE` 返回 200 和 "Hold 50"。
- 服务端日志：每个请求都打印 Yahoo 的 survey 提示（抑制无效）；每次信号请求都打印 `incomeStatementHistory` 已弃用的警告。
- 浏览器控制台没有报错，也没有 hydration 警告。

**依赖安全**（`npm audit --omit=dev`）：1 个严重、6 个高危。next 16.0.4 命中 44 条安全公告，其中 5 条是严重级别的远程代码执行：RSC 协议（GHSA-9qr9-h5gf-34mp，所有 App Router 应用受影响）、Windows 主机（GHSA-p293-qw3h-jr36）、图片优化 API 两条（GHSA-2xp9-vwfh-vxw4、GHSA-2464-fhr4-w9xw）、`use cache`（GHSA-673q-mjm6-r5xr，本项目未使用）。16.4.5 全部修复。传递依赖：undici（经 cheerio）、postcss/nanoid/source-map-js/sharp（经 next）、zod（经 openai），`npm audit fix` 可以修复。

**生产构建**：成功；首屏 JS 619 KB，gzip 后 184 KB，其中应用代码 gzip 后 17 KB；构建没有修改任何已跟踪的文件。

**用真实行情复算回测**（2026-11-07 的 Yahoo 数据，持有 5 日）

| 代码 | 当前信号 | 60 天窗口内 Buy 天数 | 模型回测：胜率 / 平均收益 | 同窗口每 5 天无条件买入：胜率 / 平均收益 | 约 266 天窗口内 Buy / Sell 天数 |
|---|---|---|---|---|---|
| NVDA | Hold 46 | 59 / 60 | 50% / -0.73% | 50% / -0.73% | 216 / 0 |
| AAPL | Buy 62 | 44 / 60 | 66.7% / +0.65% | 66.7% / +0.66% | 163 / 0 |
| MSFT | Buy 66 | 60 / 60 | 41.7% / +0.16% | 41.7% / +0.16% | 131 / 7 |
| JPM | Hold 50 | 43 / 60 | 60% / -0.09% | 58.3% / -0.39% | 193 / 0 |
| XOM | Hold 53 | 60 / 60 | 75% / +1.40% | 75% / +1.40% | 220 / 0 |
| PFE | Hold 45 | 0 / 60 | 无交易 | 75% / +1.18% | 0 / 78 |
| TSLA | Sell 31 | 0 / 60 | 无交易 | 66.7% / +1.80% | 0 / 182 |
| INTC | Sell 28 | 0 / 60 | 无交易 | 41.7% / -3.34% | 15 / 63 |

把基本面换成中性值以后：NVDA 的 Buy 天数从 216 降到 98，PFE 从 0 升到 153，TSLA 从 0 升到 43。可见标签主要由固定不变的基本面决定，技术面只是在上面叠加波动。

**"可信度"徽章的阈值**（数据完整时）：因子一致度 0–19% 为 Low，20–48% 为 Medium，49% 及以上即为 High。

## 五、附录：逐条问题清单

以下是验证代理保留的全部 122 条结论（英文原文），按维度和严重度排序，包含代码位置和修复建议，实施时可以逐条对照。不同维度之间有重复，正文已经合并。

### 安全（10 条）

- **[CRITICAL · S]** Next.js 16.0.4 bundles the unpatched React Server Components RCE (CVE-2025-55182 / GHSA-9qr9-h5gf-34mp)
  - 位置：`package.json:15`, `package.json:31`, `package-lock.json:5910-5913`
  - 问题：next is pinned to 16.0.4. Its bundled RSC server (react-server-dom-webpack 19.3.0-canary-52684925-20251110) still walks reply references with `parentObject[reference[key]]` and returns `moduleExports[metadata[2]]` with no own-property check (node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js:2267-2273 and 2539-2541), which is the code fixed in Next 16.0.7. The app uses the App Router, and that exposes this decoder even with no server actions defined.
  - 建议：Upgrade next and eslint-config-next to the newest 16.x patch: at least 16.0.7 for this CVE, and 16.0.10 for the follow-up RSC DoS and source-exposure fixes. Rebuild and smoke-test, then run npm audit and keep the version patched.
- **[HIGH · M]** Blind and partial-read SSRF: /api/analyze fetches any URL the client sends
  - 位置：`app/api/analyze/route.ts:124-131`, `app/api/analyze/route.ts:23-68`, `app/api/analyze/route.ts:13-21`
  - 问题：When the attacker-controlled context contains "News" or "Insight", data.link goes to fetchNewsContent. That function tries r.jina.ai first, then does a direct server-side fetch(url) with no scheme, host or IP check and with redirects followed by default. Up to 6000 chars of paragraph text from the response go into the prompt and the LLM output is streamed back; the extractor keeps only <p> text longer than 40 chars, and the debug line reports success and the character count.
  - 建议：Stop fetching arbitrary client URLs: accept only https links on an allowlist of news hosts (or have the server re-derive the link from its own Yahoo results). Use redirect:'error' or re-validate each hop, and reject private, loopback and link-local addresses at connect time with a custom undici lookup so DNS rebinding cannot bypass the check. Apply the same check before the r.jina.ai call and remove the success/char-count debug line.
- **[HIGH · M]** AI routes are open to anyone: no auth, rate limit, origin check or output cap
  - 位置：`app/api/analyze/route.ts:112-114`, `app/api/analyze/route.ts:250-258`, `app/api/chat/route.ts:11-13`, `app/api/chat/route.ts:85-93`, `app/page.tsx:1318-1324`
  - 问题：Neither POST handler checks a session, secret or Origin, and neither applies a rate limit. Both parse any body with request.json() regardless of Content-Type and call deepseek-chat with stream:true and no max_tokens. The chat client sends no Content-Type at all (page.tsx:1318-1324), so the browser sends text/plain and the server still accepts it.
  - 建议：Put both routes behind auth; for a personal app, a server-checked login that sets an httpOnly session cookie, or platform password protection, is enough. Add per-IP or per-user rate limits and a daily request budget, require Content-Type: application/json plus a same-origin Origin/Sec-Fetch-Site check, and set max_tokens on both completions.
- **[HIGH · S]** Unbounded ?watchlist= triggers one Yahoo chart call per symbol
  - 位置：`app/api/market/route.ts:329-334`, `app/api/market/route.ts:336-364`
  - 问题：The watchlist query is split on commas with no count or format check and merged into the ~44 default symbols. fetchCharts then makes one yf.chart call per unique symbol, plus one bulk yf.quote with every symbol in its query string. All yahoo-finance2 calls in a process share one module-level FIFO queue with 4 concurrent slots and no timeout (node_modules/yahoo-finance2/script/src/lib/yahooFinanceFetch.js:10, lib/options/defaults.js:19).
  - 建议：Dedupe and cap the watchlist on the server (for example at most 30 symbols, each matching ^[A-Z0-9.^=-]{1,10}$, otherwise return 400). Cache chart and quote results for a short TTL so repeated polls do not refetch them.
- **[MEDIUM · M]** AI routes put unvalidated, unbounded client input into the prompts (chat accepts any role)
  - 位置：`app/api/chat/route.ts:13`, `app/api/chat/route.ts:20-53`, `app/api/chat/route.ts:61`, `app/api/chat/route.ts:85-90`, `app/api/analyze/route.ts:189-224`, `app/api/analyze/route.ts:246-248`
  - 问题：/api/chat copies the body's messages array unchanged after the system prompt (any role including system, any count or length) and inserts context.language, context.sector and the watchlist/index/news arrays into the system prompt. /api/analyze puts the raw context string and JSON.stringify(data) into the user message and inserts data.modelSignal fields into its system prompt. Neither route has a schema or size check, and because the app has no middleware, Next applies no body limit to route handlers.
  - 建议：Validate both bodies with a schema (for example zod): only user/assistant roles with string content, the last ~10 messages, a total-character cap, language limited to English or Chinese, clamped context arrays, and a Content-Length limit around 64 KB. For analyze, build the prompt from whitelisted fields instead of JSON.stringify(data).
- **[LOW · S]** Signal and market routes return raw error strings to clients
  - 位置：`app/api/signal/route.ts:92-97`, `app/api/market/route.ts:424-425`
  - 问题：Both catch blocks return details: String(error). yahoo-finance2 builds its HTTPError and parse-error messages from Yahoo's raw response text, so upstream response bodies and internal TypeError messages reach the caller; stack traces and file paths are not included.
  - 建议：Return a generic message with a status code, as /api/analyze and /api/chat already do, and keep String(error) in server logs only.
- **[LOW · S]** No security headers or CSP configured
  - 位置：`next.config.ts:3-5`, `app/api/analyze/route.ts:275-277`, `app/api/chat/route.ts:105`
  - 问题：next.config.ts defines no headers() and leaves poweredByHeader at its default. Responses therefore carry X-Powered-By: Next.js and no CSP, frame-ancestors/X-Frame-Options, X-Content-Type-Options or Referrer-Policy. That header carries no version, but the client bootstrap exposes window.next.version = "16.0.4" anyway.
  - 建议：Add a headers() block with a CSP suited to Next, frame-ancestors 'none', X-Content-Type-Options: nosniff and Referrer-Policy: strict-origin-when-cross-origin (plus HSTS if self-hosting), and set poweredByHeader: false.
- **[LOW · S]** Scraper spoofs Googlebot and sends analysed article URLs to r.jina.ai
  - 位置：`app/api/analyze/route.ts:27-31`, `app/api/analyze/route.ts:40-45`
  - 问题：fetchNewsContent first forwards the article URL to the third-party r.jina.ai reader without an API key. If that fails, it falls back to a direct fetch with a forged Googlebot User-Agent and a google.com Referer to get past consent and paywall gating.
  - 建议：Use an honest User-Agent and drop the fake Referer. Make the jina hop optional (with a JINA_API_KEY) and subject to the same URL allowlist as the SSRF fix, and document this third-party data flow in the README.
- **[LOW · S]** Scraped article text and headlines enter the prompt with no untrusted-data framing
  - 位置：`app/api/analyze/route.ts:124-140`, `app/api/analyze/route.ts:71-110`, `app/api/analyze/route.ts:246-248`
  - 问题：Scraped article paragraphs, or the relatedNews titles and snippets, are appended to the user message as News Intelligence with no delimiters and no instruction to treat them as data. The prompt also tells the model to infer article content from the headlines.
  - 建议：Wrap external text in clearly delimited blocks and state in the system prompt that anything inside them is untrusted data whose instructions must be ignored. Keep the renderer text-only.
- **[LOW · S]** Ticker, watchlist and backtestDays inputs are not validated
  - 位置：`app/api/signal/route.ts:16-18`, `app/api/market/route.ts:166-168`, `lib/signal.ts:641-647`, `lib/signal.ts:685`, `app/page.tsx:409-421`
  - 问题：Tickers reach yahoo-finance2 as raw strings; the library only checks that they are strings and concatenates the symbol into the chart URL path. backtestDays goes through parseInt with no NaN or range check. The client also inserts tickers and the watchlist into API URLs without encodeURIComponent (page.tsx:409, 415, 421).
  - 建议：Validate tickers against a Yahoo-symbol pattern (for example ^[A-Z0-9.^=-]{1,10}$) and return 400 otherwise. Clamp backtestDays to 10-250 and fall back to 60 on NaN, and wrap tickers in encodeURIComponent on the client.

### 后端数据与 AI 集成（23 条）

- **[CRITICAL · M]** AI routes are an open, unmetered DeepSeek proxy, and the caller controls the prompt
  - 位置：`app/api/chat/route.ts:13`, `app/api/chat/route.ts:22-24`, `app/api/chat/route.ts:61`, `app/api/chat/route.ts:85-93`, `app/api/analyze/route.ts:114-118`, `app/api/analyze/route.ts:246-258`, `app/page.tsx:1318-1324`
  - 问题：/api/chat passes the request's `messages` array (any role, count or length) straight into the completion and puts `context.language` into the system prompt. /api/analyze puts `context` and `JSON.stringify(data)` into the user message, and its only body check (line 116) passes if either field is present, so a malformed body hits a TypeError that is reported as 'DeepSeek API Connection Failed' (500). Neither route has auth, rate limiting, a body-size cap or `max_tokens`, and there is no middleware.ts or proxy.ts.
  - 建议：Gate both routes with auth or a shared secret, or at least per-IP rate limiting. Validate the body with a schema and return 400 on failure (messages limited to role user|assistant, about the last 12 turns, a per-message character cap; `language` whitelisted to English|Chinese), and set `max_tokens` (about 800 for memos, 1000 for chat).
- **[CRITICAL · S]** Server-side request forgery through the News Insight `data.link`
  - 位置：`app/api/analyze/route.ts:124-125`, `app/api/analyze/route.ts:23-68`, `app/api/analyze/route.ts:39-46`, `app/api/analyze/route.ts:126-131`
  - 问题：Any POST whose `context` contains 'News' or 'Insight' makes the server fetch the caller-supplied `data.link`. It tries r.jina.ai first, then, if that fails or returns little text, does a direct `fetch(url)` with no scheme, host or IP check, following redirects by default. Up to 6000 chars of extracted `<p>` text go into the prompt, and the streamed '[System Log]' line reports success and the character count.
  - 建议：Stop accepting arbitrary URLs: have the client send a news uuid and resolve the link server-side from the server's own Yahoo results. Otherwise allowlist hosts, require https, reject private and link-local IPs after DNS resolution, and use `redirect: 'manual'` with re-validation on each hop.
- **[HIGH · S]** AI analysis streams are never aborted, so an old memo bleeds into the next view
  - 位置：`app/page.tsx:452-455`, `app/page.tsx:483-488`, `app/page.tsx:514-586`, `app/page.tsx:575-580`, `app/api/analyze/route.ts:250-258`
  - 问题：startAnalysis has no AbortController and no run id. A view or ticker change only clears `aiContent` and `isAnalyzing`, while the old reader loop keeps calling `setAiContent(prev => prev + chunk)` on the same shared state. goToNews auto-starts a second run 100 ms later, and whichever run finishes first clears `isAnalyzing` in its `finally`.
  - 建议：Keep an AbortController in a ref, abort it on view or ticker change and before each new run, pass its `signal` to fetch, and drop chunks from a stale run id.
- **[HIGH · M]** Polling makes about 160-190 Yahoo requests per minute per tab through one 4-slot queue, with no caching
  - 位置：`app/page.tsx:408-418`, `app/page.tsx:457-505`, `app/api/market/route.ts:314-364`, `app/api/market/route.ts:196-219`, `app/api/signal/route.ts:28-34`, `node_modules/yahoo-finance2/script/src/lib/yahooFinanceFetch.js:10`, `node_modules/yahoo-finance2/script/src/lib/options/defaults.js:19`
  - 问题：The overview is polled every 30 s on every view and costs 48 upstream calls (3 quotes, 44 per-symbol charts, 1 search). Detail is polled every 5 s and costs 5-8 calls (quote, then quoteSummary, then a chart and 3-5 searches), and /api/signal fetches quote and quoteSummary again plus a 540-day chart. `selectedTicker` is not cleared when going Back to a sector or watchlist or using the sidebar, so the 5-s detail poll keeps running off-screen, and yahoo-finance2 sends every request through one module-level queue with concurrency 4.
  - 建议：Cache upstream results server-side with TTLs (quotes 15-30 s, daily bars and news 5-15 min, fundamentals 1 h). Split detail into a cheap price poll and a once-per-ticker fundamentals/news call, poll detail only while it is visible, and fetch the 14-day sparklines far less often than quotes.
- **[HIGH · M]** Company-news relevance scoring drops real company headlines and boosts unrelated ones
  - 位置：`app/api/market/route.ts:98-131`, `app/api/market/route.ts:104`, `app/api/market/route.ts:199-200`, `app/api/market/route.ts:281-285`, `app/api/market/route.ts:287-299`
  - 问题：The company match is a raw substring test against the lowercased ticker or the legal `shortName` ('apple inc.', 'nvidia corporation'), and every keyword test is also a substring test ('ai' matches 'said', 'war' matches 'warehouse'). Only macro and industry items get the +8 floor, so company-track items need 5+ keyword points to pass `_score >= 5`. Title-only dedupe keeps the higher score, which relabels low-scoring shared headlines as 'macro'.
  - 建议：Match on word boundaries, derive a brand token by stripping suffixes (Inc., Corporation, Holdings), and also match '(TICKER)' and '$TICKER'. Give company-provenance items a baseline score and prefer company provenance when deduping.
- **[MEDIUM · S]** AI route streams have no error handling, and a disconnect before the response starts still pays for the full completion
  - 位置：`app/api/analyze/route.ts:260-273`, `app/api/chat/route.ts:95-103`, `app/api/analyze/route.ts:250-258`, `app/api/analyze/route.ts:123-132`, `node_modules/next/dist/server/pipe-readable.js:118-126`, `node_modules/openai/core/streaming.js:80-82`
  - 问题：Both routes drain the DeepSeek iterator eagerly inside `ReadableStream.start()` with no try/catch, no `cancel()` and no backpressure, and they call `create()` without `request.signal`, which Next 16 aborts on client disconnect. If the client is gone before the Response is returned, pipeToNodeResponse returns early on the destroyed response and never cancels the body, so the already-running `start()` loop consumes the whole completion.
  - 建议：Pass `{ signal: request.signal }` to `create()`. Build the body with `ReadableStream.from(iterator)` or a `pull()`-based stream whose `cancel()` calls `response.controller.abort()`, and wrap the loop in a try/catch that logs and enqueues a short error marker before closing.
- **[MEDIUM · S]** Late responses for a previous ticker overwrite current data, including the model signal sent to the AI
  - 位置：`app/page.tsx:49-55`, `app/page.tsx:57-73`, `app/page.tsx:75-82`, `app/page.tsx:558`, `app/api/analyze/route.ts:189-225`
  - 问题：The hand-rolled useSWR resets state on a key change, but a request still in flight for the old key resolves into the same `setData(res)` with no key or request-id check, and `setInterval` fires every 5 s whether or not the last request finished. The deep-dive payload attaches `signalData` without checking `signalData.metadata.ticker`, and the server does not check it either.
  - 建议：Replace the hook with the installed `swr` package, which ignores responses for stale keys and deduplicates requests, or guard each request with a request id or AbortController. On the server, drop `modelSignal` when `metadata.ticker !== data.symbol`.
- **[MEDIUM · S]** Clients ignore HTTP status, so error bodies are treated as data or shown as chat replies
  - 位置：`app/page.tsx:88`, `app/page.tsx:431-434`, `app/page.tsx:826`, `app/page.tsx:885`, `app/page.tsx:1318-1336`, `app/api/chat/route.ts:106-108`
  - 问题：The shared fetcher is `fetch(url).then(res => res.json())` with no `res.ok` check. The chat widget streams `res.body` into an assistant bubble without checking the status or content type.
  - 建议：Throw on `!res.ok` in the fetcher and keep the last good data (swr does this by default), and render an error or not-found state in DetailView. In chat, check `res.ok` before streaming and keep error text out of `messages`.
- **[MEDIUM · M]** One failed upstream call fails the whole response, with misleading status codes
  - 位置：`app/api/market/route.ts:198-204`, `app/api/market/route.ts:308-310`, `app/api/market/route.ts:358-364`, `app/api/market/route.ts:424-426`, `app/api/signal/route.ts:28-34`, `app/api/signal/route.ts:92-97`, `node_modules/yahoo-finance2/script/src/modules/quote.js:191`
  - 问题：The overview `Promise.all` includes three `yf.quote` calls with no catch, and default validation throws. Ticker mode wraps everything in one catch that returns 404 'Failed to fetch ticker', and it awaits quote, then quoteSummary, then the rest in sequence. The signal route's quote call has no catch although its chart and summary calls do, and both routes put `details: String(error)` in 500 bodies.
  - 建议：Use `Promise.allSettled` and return per-section data plus warnings. Map unknown symbols to 404, upstream failures to 502/503 and bad input to 400, fetch quote and quoteSummary in parallel, and log error details only on the server.
- **[MEDIUM · S]** Chat context contract is broken: the server expects fundamentals and view data the client never sends
  - 位置：`app/api/chat/route.ts:26-37`, `app/api/chat/route.ts:30`, `app/api/chat/route.ts:74`, `app/page.tsx:589-605`, `app/page.tsx:444-450`, `README.md:39`
  - 问题：The detail branch adds P/E, EPS, ROE, margin and earnings only when `detailSummary.pe` exists, but the client's `detailSummary` contains only symbol, price, change and marketCap. On the News view the server takes the 'Market Overview' branch and `currentNewsList` is empty. The model signal, the memo on screen and the sector's stocks are never sent.
  - 建议：Send `detail.metrics`, `earningsDate`, a compact signal summary, the selected news item on the News view and the sector's stocks on the Sector view. Add a 'news' branch on the server and validate the context with a schema.
- **[MEDIUM · M]** Analyze prompts ask for inputs the client never sends, while the deep-dive payload is padded with raw candles and duplicates
  - 位置：`app/api/analyze/route.ts:145-186`, `app/api/analyze/route.ts:184`, `app/api/analyze/route.ts:232`, `app/api/analyze/route.ts:206-214`, `app/api/analyze/route.ts:135-140`, `app/api/analyze/route.ts:246-248`, `app/page.tsx:526-559`
  - 问题：The prompt names 'relevantNews' (the watchlist sends no news), 'sectorNews' (the client sends `recentNews`) and 'topHeadlines' (the overview sends `marketNews`), and asks for sector concentration, beta, P/E versus growth and SMA trend, which no payload contains. It also says 'Use ONLY the data provided' and 'Infer likely content from the headline and your knowledge'. The deep dive spreads `detailData.detail` (about 62 raw OHLC bars), 8 news objects with URLs and the whole signal object, then repeats the headlines and the signal again, and the backtest line omits the trade count.
  - 建议：Define one typed payload per view, shared by client and route, and whitelist fields instead of spreading `detail`. Send precomputed indicators (SMA20/50, 1M/3M return, RSI, revenueGrowth, sector, source ticker), send each headline and the signal once, add `n=` to the backtest line, and replace 'infer from your knowledge' with 'label anything not in the data as an assumption'.
- **[MEDIUM · S]** News items put the publish time in `source`, a constant 'Live' in `time`, and drop the publisher
  - 位置：`app/api/market/route.ts:181-188`, `app/api/market/route.ts:259-271`, `app/api/market/route.ts:416-420`, `app/api/analyze/route.ts:83-105`, `app/page.tsx:527`, `app/page.tsx:597`, `app/page.tsx:956`, `app/page.tsx:1150`, `node_modules/yahoo-finance2/script/src/modules/search.d.ts:159-171`
  - 问题：All three mappers write the time of day from `providerPublishTime` into `source`, hard-code `time: "Live"` and ignore `publisher`. They also read `snippet`/`description`, which Yahoo search news items do not have, so `snippet` is always ''.
  - 建议：Return `publisher`, `publishedAt` (ISO), `uuid` and `relatedTickers`, and drop `snippet`. Render relative time on the client and pass the publisher and ISO date to the model.
- **[MEDIUM · S]** `metrics.grossMargin` actually holds net profit margin and reaches the model under that name
  - 位置：`app/api/market/route.ts:232`, `app/api/market/route.ts:251`, `app/api/chat/route.ts:30`, `app/page.tsx:19`, `app/page.tsx:934`
  - 问题：`rawMargin` is `financialData.profitMargins`, but it is emitted as `metrics.grossMargin`. The UI label was corrected to 'Profit margin (TTM)', but /api/analyze sends the raw key into the deep-dive prompt, and /api/chat calls it 'Gross Margin' (currently dead code because the client never sends it).
  - 建议：Rename the field to `profitMargin` end to end, and add `grossMargins`/`operatingMargins` from financialData if they are wanted.
- **[MEDIUM · S]** The article fetch timeout ends before the body is read, and body size is unbounded
  - 位置：`app/api/analyze/route.ts:13-21`, `app/api/analyze/route.ts:33`, `app/api/analyze/route.ts:49`, `app/api/analyze/route.ts:40-46`, `app/api/analyze/route.ts:123-132`
  - 问题：`fetchWithTimeout` clears its abort timer as soon as `fetch()` resolves on headers, so `res.text()` has no deadline and buffers the whole body before slicing it to 6000 chars. The Jina attempt and the direct fetch (8 s each) run one after the other before the model is called, and the fallback sends a spoofed Googlebot User-Agent.
  - 建议：Keep the timer running until the body is consumed, read the stream with a byte cap (e.g. 2 MB) and check that the content-type is text/html. Start the response stream immediately and do the fetch inside it, and use an honest User-Agent.
- **[MEDIUM · S]** Ticker, watchlist and backtestDays inputs are not validated or encoded
  - 位置：`app/api/market/route.ts:330-334`, `app/api/market/route.ts:336-356`, `app/api/signal/route.ts:16-18`, `app/api/signal/route.ts:28-33`, `app/page.tsx:415`, `app/page.tsx:421`, `node_modules/yahoo-finance2/script/src/modules/chart.js:173`, `node_modules/yahoo-finance2/script/src/modules/quoteSummary.js:160`
  - 问题：`?watchlist=` accepts any number of symbols, and each one adds a chart request. `ticker` goes unencoded into the chart and quoteSummary URL paths, and the client builds `?ticker=${selectedTicker}` without `encodeURIComponent`. `backtestDays` is parsed with no bounds, and negative values return `totalSignals: -5`.
  - 建议：Validate symbols with a strict regex (e.g. `^[A-Z0-9.^=-]{1,12}$`), deduplicate and cap the watchlist at about 30, and encode tickers on both client and server. Clamp `backtestDays` to 20-250.
- **[MEDIUM · S]** Module-scope OpenAI client: a missing DEEPSEEK_API_KEY breaks both AI routes at import and can send OPENAI_API_KEY to DeepSeek
  - 位置：`app/api/analyze/route.ts:7-10`, `app/api/chat/route.ts:6-9`, `node_modules/openai/client.js:67`, `node_modules/openai/client.js:91-93`, `node_modules/openai/client.js:106`, `node_modules/openai/client.js:116`
  - 问题：`new OpenAI({ baseURL, apiKey: process.env.DEEPSEEK_API_KEY })` runs at module load. In openai 6.16, an undefined `apiKey` triggers the destructuring default `readEnv('OPENAI_API_KEY')`, and if that is also unset the constructor throws 'Missing credentials'. No timeout, maxRetries or max_tokens is set, so the SDK defaults apply (10-minute timeout, 2 retries).
  - 建议：Create the client lazily in a shared `lib/deepseek.ts` getter that returns a clear 503 JSON error when DEEPSEEK_API_KEY is empty and never falls back to OPENAI_API_KEY. Set `timeout: 30_000`, `maxRetries: 1` and `max_tokens` on each call.
- **[MEDIUM · S]** Loss-making companies get a neutral value score because Yahoo omits P/E when EPS is negative
  - 位置：`app/api/signal/route.ts:54-56`, `lib/signal.ts:329-332`, `docs/signal-model.md:106`
  - 问题：`pe` comes only from `quote.trailingPE ?? summaryDetail.trailingPE`. When Yahoo omits trailing P/E for negative TTM EPS, computeValue returns the 'no data' score of 50, so the `pe < 0 -> 20` branch can never run. The spec also says a negative P/E scores 50, which contradicts the code.
  - 建议：Read `quote.epsTrailingTwelveMonths` and treat EPS <= 0 as negative earnings (score 20, counted as data present). Make docs/signal-model.md match the chosen rule.
- **[MEDIUM · S]** `validateResult:false` values are used without type checks, and NaN fundamentals become 'Strong Sell'
  - 位置：`app/api/market/route.ts:202-204`, `app/api/market/route.ts:248-251`, `app/api/signal/route.ts:31-33`, `app/api/signal/route.ts:53-75`, `lib/signal.ts:475-493`, `node_modules/yahoo-finance2/script/src/lib/moduleExec.js:168-171`, `node_modules/yahoo-finance2/script/src/lib/validate/types/number.js:23-41`
  - 问题：With validateResult:false the library swallows coercion failures and leaves the raw value, so a `{}` placeholder on a plain `number` field stays `{}`. The routes call `.toFixed` and do arithmetic on these values with no `typeof`/`Number.isFinite` check, and `scoreToSignal` has no NaN guard. Separately, /api/signal returns HTTP 200 with 'Hold', score 50 and 0% reliability for an unknown ticker.
  - 建议：Add a `num(x)` helper (finite number or undefined) and use it for every Yahoo field. Return 'Insufficient data' or an error when bars are empty, and map a non-finite composite to Hold with 0 reliability.
- **[MEDIUM · S]** Yahoo requests have no timeout, so a few hung calls can stall the shared 4-slot queue for every route
  - 位置：`app/api/market/route.ts:198-219`, `app/api/market/route.ts:336-364`, `app/api/signal/route.ts:28-34`, `node_modules/yahoo-finance2/script/src/lib/queue.js:26-45`, `node_modules/yahoo-finance2/script/src/lib/yahooFinanceFetch.js:87`
  - 问题：No call passes a timeout or AbortSignal. The library's queue runs at most 4 jobs and never uses its `timeout` field, and its fetch has no signal unless one is supplied through `fetchOptions`.
  - 建议：Give the YahooFinance instance a `fetch` wrapper that applies `AbortSignal.timeout(8000)` when the request actually starts; a per-call `fetchOptions.signal` also works, but its clock includes time spent waiting in the queue. Pair it with per-section fallbacks.
- **[LOW · S]** Dates and times are formatted on the server, in its locale and timezone
  - 位置：`app/api/market/route.ts:135-150`, `app/api/market/route.ts:185`, `app/api/market/route.ts:265`, `app/api/market/route.ts:418`, `app/api/market/route.ts:433-449`, `app/page.tsx:181-188`, `app/page.tsx:197-205`
  - 问题：`formatEarningsDate` returns `date.toLocaleDateString()` (or the untranslated 'Awaiting Update'), and the news mappers use `toLocaleTimeString([], …)`; both use the server's default locale and timezone. Prices, changes and market caps are also sent as display strings that the client parses back.
  - 建议：Send ISO strings and raw numbers from the API, and format on the client with `Intl.DateTimeFormat`/`Intl.NumberFormat` in the current language, using `timeZone: 'America/New_York'` for exchange dates.
- **[LOW · S]** `||` conflates zero and missing: absent quotes become '0.00'/'+0.00%', and a real 0 ROE or margin becomes '-'
  - 位置：`app/api/market/route.ts:231-232`, `app/api/market/route.ts:243-245`, `app/api/market/route.ts:250-251`, `app/api/market/route.ts:370-372`, `app/api/market/route.ts:380-384`, `app/api/market/route.ts:408-410`, `app/api/market/route.ts:433-436`
  - 问题：`(price || 0).toFixed(2)`, `formatChange(undefined)` returning '0.00%', and `isUp: (pct || 0) >= 0` turn absent fields into concrete zeros. The `rawRoe ?`/`rawMargin ?` truthiness checks treat an exact 0 as missing.
  - 建议：Emit null for missing numbers and render '-', use `??` or `Number.isFinite` checks, and leave missing values out of AI payloads.
- **[LOW · S]** yahoo-finance2 v3 usage: per-request require hack, notice suppression that does nothing, an unused deprecated module, dead fallbacks
  - 位置：`app/api/market/route.ts:154-163`, `app/api/signal/route.ts:8-13`, `app/api/signal/route.ts:32`, `app/api/market/route.ts:231`, `app/api/signal/route.ts:58`, `app/api/signal/route.ts:68`, `node_modules/yahoo-finance2/script/src/lib/notices.js:36-37`, `node_modules/yahoo-finance2/script/src/lib/getCrumb.js:302`, `node_modules/yahoo-finance2/script/src/modules/quoteSummary.js:148-154`
  - 问题：Each request `require`s the package and builds a new instance through an untyped branch. `yf._opts.suppressNotices` is set after construction, but Notices copies the list in its constructor and tracks 'once only' per instance, so the yahooSurvey notice (shown from getCrumb) prints on every request that calls quote or quoteSummary. The signal route requests `incomeStatementHistory`, never reads it, and triggers a library warning on every call; `defaultKeyStatistics.returnOnEquity`/`debtToEquity` do not exist in that module.
  - 建议：Create one typed instance in `lib/yahoo.ts` (`new YahooFinance({ suppressNotices: ['yahooSurvey'] })`) and import it in both routes. Remove `incomeStatementHistory` and the dead fallbacks, and use the library's result types.
- **[LOW · S]** Model output format is not limited to what the mini Markdown renderer supports
  - 位置：`app/page.tsx:1263-1282`, `app/page.tsx:1350-1368`, `app/api/analyze/route.ts:234-238`, `app/api/chat/route.ts:79-81`, `app/api/analyze/route.ts:128-130`
  - 问题：The renderers handle only '#' headings, '> ' quotes, '-'/'*'/'•' bullets and **bold**, while both prompts ask for general Markdown. The analyze route also injects English-only '[System Log]' lines into the stream in zh mode.
  - 建议：Either restrict the prompts to headings, bullets and bold, or render with react-markdown plus remark-gfm. Send status lines as separate metadata, or localise them.

### 前端正确性（19 条）

- **[HIGH · M]** AI analysis streams are never aborted: text leaks into the next view, parallel streams interleave, and abandoned memos still bill DeepSeek
  - 位置：`app/page.tsx:452-455`, `app/page.tsx:483-488`, `app/page.tsx:514-586`, `app/page.tsx:575-585`, `app/page.tsx:740`, `app/api/analyze/route.ts:250-273`
  - 问题：startAnalysis calls fetch('/api/analyze') with no AbortController or run id and appends every chunk to the one top-level aiContent via setAiContent(prev => prev + chunk). The navigation effect only resets aiContent and isAnalyzing, so the old reader loop keeps appending. goToNews starts another run 100 ms after every headline click, and every run's finally sets isAnalyzing=false whether or not it is the current run.
  - 建议：Keep an AbortController and a run id in a ref. Abort in the navigation effect and before each new run, pass signal to fetch, and drop chunks and errors from stale ids (ideally store memos in a map keyed by context, e.g. detail:NVDA). Pass the context to startAnalysis explicitly instead of the setTimeout, and on the server pass { signal: request.signal } to chat.completions.create.
- **[HIGH · S]** Hand-rolled useSWR applies responses for a previous key, so one ticker's quote, chart or Model Signal can render on another ticker's page
  - 位置：`app/page.tsx:49-55`, `app/page.tsx:57-73`, `app/page.tsx:414-429`, `app/page.tsx:476-481`, `app/page.tsx:490-505`, `app/page.tsx:558`
  - 问题：execute() runs fetcher(key).then(setData).finally(() => setIsLoading(false)) with no cancellation and no key check. A response for the old key that resolves after the key-change reset therefore overwrites the new key's state and clears its loading flag. selectedTicker is cleared only in goToOverview (line 479), so after Back to a sector or the watchlist the 5 s detail poll keeps running and can be in flight when another stock is clicked.
  - 建议：Replace the hook with the already-installed swr 2.3.8, which caches per key and never applies an old key's response to a new key. If you keep the custom hook, use a per-effect active flag or AbortController and skip setData and setIsLoading after cleanup. Also check signalData.metadata.ticker against selectedTicker before sending it to /api/analyze.
- **[HIGH · S]** Non-2xx JSON responses are stored as data, so a single failed poll replaces good data with fake zeros, empty states or a skeleton
  - 位置：`app/page.tsx:88`, `app/page.tsx:66-72`, `app/page.tsx:84`, `app/page.tsx:431-434`, `app/page.tsx:781`, `app/page.tsx:826`, `app/page.tsx:885-890`, `app/api/market/route.ts:308-309`, `app/api/market/route.ts:424-425`
  - 问题：The fetcher is fetch(url).then(res => res.json()) with no res.ok check, so a 500 {error:'Failed'} or a 404 {error:...} body resolves as data and overwrites the last good payload. error is set only when fetch or JSON parsing rejects, is never cleared, and no caller reads it. The overview route returns 500 whenever one of its uncaught yf.quote calls throws, and the ticker route returns 404 for any exception.
  - 建议：Make the fetcher throw on !res.ok, with the status and body attached. Keep the previous data when a revalidation fails (swr does this once the fetcher throws), and show error as a 'data delayed, retrying' notice or a real error state.
- **[HIGH · M]** Polling never pauses: the 5 s detail poll keeps running on other views and in hidden tabs, and requests can overlap
  - 位置：`app/page.tsx:75-82`, `app/page.tsx:408-418`, `app/page.tsx:457-474`, `app/page.tsx:490-505`, `app/api/market/route.ts:196-219`, `app/api/market/route.ts:336-364`
  - 问题：setInterval(execute, refreshInterval) fires regardless of tab visibility, the active view, or whether the previous request has finished, and the revalidateOnFocus option is silently ignored. The detail key stays live after goToSector, goToWatchlist and Back, because none of them clear selectedTicker.
  - 建议：With swr, set refreshInterval to currentView === 'detail' ? 5000 : 0 and keep refreshWhenHidden false (the default); swr schedules the next refresh only after the previous one finishes, so polls never overlap. Serve the 5 s price tick from a light quote-only endpoint, and refresh the chart and news every few minutes.
- **[HIGH · M]** Ticker search is not trimmed, validated or URL-encoded, and an unknown symbol leaves a permanent skeleton while polling continues
  - 位置：`app/page.tsx:507-511`, `app/page.tsx:415`, `app/page.tsx:421`, `app/page.tsx:885-890`, `app/api/market/route.ts:196-199`, `app/api/market/route.ts:308-309`, `node_modules/yahoo-finance2/esm/src/modules/quote.js:184-186`
  - 问题：handleSearch passes searchQuery.toUpperCase() straight to goToDetail, and the request keys insert the ticker without encodeURIComponent. For an unknown symbol yf.quote returns undefined (results[0] of an empty array), so quote.shortName throws and the route returns 404 {error}. The client stores that as data, and DetailView shows skeletons whenever detail is missing.
  - 建议：Trim and validate the input (e.g. /^[A-Z0-9.^=-]{1,12}$/), run every key parameter through encodeURIComponent, and have the route return 404 only when quote is undefined (502 for upstream failures). Treat a 404 as a final 'No match for APPLE' state that stops polling, and show removable rows for watchlist symbols that come back without a quote.
- **[MEDIUM · S]** In-app Back loses the sector or watchlist you came from after you open a headline or search from a stock page
  - 位置：`app/page.tsx:463-468`, `app/page.tsx:483-488`, `app/page.tsx:490-505`, `app/page.tsx:720-728`
  - 问题：goToNews, and a search from the detail view, set lastView='detail'; handleBack from news restores the view but not the earlier lastView. The detail branch of handleBack only recognises 'sector' and 'watchlist' and otherwise calls goToOverview, because lastView holds a single entry, not a history.
  - 建议：Replace lastView with a navigation stack: push {view, sector, ticker, news} on each navigation and pop on Back. Or adopt URL routes and use router.back().
- **[MEDIUM · M]** No URL state: browser Back leaves the app, refresh resets to the overview, and nothing can be bookmarked or shared
  - 位置：`app/page.tsx:372-383`, `app/page.tsx:457-505`
  - 问题：All navigation lives in useState (currentView, selectedSector, selectedTicker, selectedNews), and page.tsx uses no useRouter, no useSearchParams and no History API.
  - 建议：Move views to App Router routes (/stock/[ticker], /sector/[name], /watchlist), or at least mirror {view, ticker, sector} into the query string with router.push and read it with useSearchParams. The in-app Back button then becomes router.back(), with an overview fallback.
- **[MEDIUM · S]** The saved watchlist is read after the first fetch: a duplicate overview request on load, a stale-response race, and a full refetch on every star toggle
  - 位置：`app/page.tsx:385-395`, `app/page.tsx:397-406`, `app/page.tsx:408-412`, `app/page.tsx:49-55`
  - 问题：watchlist starts as ['NVDA','AAPL'] and is replaced from localStorage inside an effect, so the market key changes right after the first overview request has started, and the hook has no stale-response guard. Every toggleWatchlist also changes the key, which resets marketData to undefined and refetches the whole overview. The JSON.parse result is never validated.
  - 建议：Keep the market key null until storage has been read (or use useSyncExternalStore with a 'storage' listener), and check that the parsed value is a string[]. Fetch watchlist quotes separately from the fixed 44-symbol payload (or use keepPreviousData), and add app/error.tsx.
- **[MEDIUM · S]** Chat shows server error JSON as the AI's reply and sends UI-only messages back to the model as history
  - 位置：`app/page.tsx:1303-1307`, `app/page.tsx:1311-1337`, `app/api/chat/route.ts:85-93`, `app/api/chat/route.ts:106-107`
  - 问题：sendMessage never checks res.ok, so a 500 body {"error":"Chat failed"} is streamed into the assistant bubble. The welcome text, error bubbles and that JSON stay in messages and go out as assistant turns on the next request; the full history is resent every turn, and the updater mutates the last message object it shares with the previous state.
  - 建议：Check res.ok and add a localized error bubble flagged uiOnly. When sending, drop uiOnly and welcome messages and keep only the last ~10 turns. Update state immutably (p.map((m, i) => i === p.length - 1 ? { ...m, content } : m)), and add an AbortController with a Stop button.
- **[MEDIUM · S]** Chat and analysis requests leave out fields the server prompts tell the model to use
  - 位置：`app/page.tsx:589-605`, `app/page.tsx:444-450`, `app/page.tsx:530-547`, `app/api/chat/route.ts:26-37`, `app/api/analyze/route.ts:150`, `app/api/analyze/route.ts:158`, `app/api/analyze/route.ts:173`
  - 问题：The chat route adds P/E, EPS, ROE, margin and earnings date only when detailSummary.pe exists, but the client sends just {symbol, price, change, marketCap}. On the news view visibleNews is [] and the open article is never sent, so the route describes the view as 'Market Overview'. The analyze prompts refer to 'relevantNews' (watchlist), 'sectorNews' and 'topHeadlines', but the client sends no news for the watchlist, recentNews for sectors and marketNews for the overview.
  - 建议：Send metrics, earningsDate and the open news item, and make the payload keys match the names used in the prompts. Share one TypeScript payload type between page.tsx and the routes.
- **[MEDIUM · S]** Pressing Enter to confirm IME input sends the chat message or runs the ticker search
  - 位置：`app/page.tsx:507-511`, `app/page.tsx:733`, `app/page.tsx:1376`
  - 问题：Both onKeyDown handlers act on e.key === 'Enter' without checking e.nativeEvent.isComposing, or keyCode 229.
  - 建议：Return early when e.nativeEvent.isComposing || e.keyCode === 229, or track composition with onCompositionStart and onCompositionEnd, in both handlers.
- **[MEDIUM · S]** The backtest panel can highlight one holding period while showing another's zero-trade stats, and 'no Buy signals' is labelled 'Insufficient data'
  - 位置：`app/page.tsx:973`, `app/page.tsx:1008-1009`, `app/page.tsx:1076`, `app/page.tsx:1083-1091`, `app/page.tsx:1126-1129`, `lib/signal.ts:681-687`, `app/api/signal/route.ts:80-86`
  - 问题：btKeys keeps only holding periods with sampleSize > 0, but bt = backtests[activePeriod] reads the unfiltered map, and backtest() returns an all-zero object (sampleSize 0) instead of null when no Buy fired. The tab highlight falls back to btKeys[0] when '5d' is not in btKeys.
  - 建议：Compute const selected = btKeys.includes(activePeriod) ? activePeriod : btKeys[0] and use it for both bt and the highlighted tab. Give 'no Buy signals in 60 sessions' its own string, and keep 'Insufficient data' for an empty backtests object.
- **[MEDIUM · S]** The candlestick chart stays blank if it first mounted with no candles, because the ResizeObserver is attached only once
  - 位置：`app/page.tsx:222-232`, `app/page.tsx:303`, `app/page.tsx:316`, `app/page.tsx:260`, `app/page.tsx:251-252`, `app/page.tsx:305-307`, `app/api/market/route.ts:216`
  - 问题：The observer effect has [] deps and returns early when containerRef is null, which is the case when the first render took the 'Chart data unavailable' branch (that div has no ref). A later non-empty history then renders with dimensions {0,0}. Separately, if every high equals every low, priceRange is 0 and every y value becomes NaN.
  - 建议：Always render the container div with the ref and put the empty state inside it, or attach the observer through a callback ref. Guard priceRange with || 1.
- **[LOW · S]** AI buttons send placeholder data before market data loads, and two early returns would leave isAnalyzing stuck
  - 位置：`app/page.tsx:740`, `app/page.tsx:530-547`, `app/page.tsx:163-168`, `app/page.tsx:515`, `app/page.tsx:524`, `app/page.tsx:549`
  - 问题：The Header button is disabled for missing data only on the detail view, so on the overview, sector and watchlist views it can send INITIAL_INDICES ('-', '0.00%'), empty news or an empty stock list to DeepSeek. startAnalysis sets isAnalyzing=true before the early returns at lines 524 and 549, which sit outside the try/finally.
  - 建议：Disable the button until the current view's inputs exist (market data loaded, watchlist not empty), and move the guards before setIsAnalyzing(true).
- **[LOW · S]** The server-rendered first paint shows six 0.00% heatmap tiles instead of a loading skeleton
  - 位置：`app/page.tsx:43`, `app/page.tsx:49-55`, `app/page.tsx:781`, `app/page.tsx:1155-1156`, `app/page.tsx:163-168`
  - 问题：isLoading starts as false and becomes true only inside an effect, so the server HTML and the first client render take the heatmap branch with empty stocks. There SectorBlock's average is 0, which counts as 'up'.
  - 建议：Derive loading as key != null && data === undefined && error === undefined, as swr's isLoading does, so the very first render shows the skeleton; use neutral styling for the placeholder indices.
- **[LOW · S]** Formatting edge cases: a hover market cap of '0', NaN single-point sparklines, and a news 'source' that is really a server-timezone time
  - 位置：`app/page.tsx:181-195`, `app/page.tsx:282-292`, `app/page.tsx:894`, `app/page.tsx:1238-1241`, `app/page.tsx:956`, `app/page.tsx:527`, `app/api/market/route.ts:185-186`, `app/api/market/route.ts:264-267`, `app/api/market/route.ts:418-419`
  - 问题：parseMarketCap('-') returns 0, so the hover estimate is formatted as the string '0', which is truthy and replaces '-' at line 894. A sparkline with a single close computes x = 0/0. The routes put toLocaleTimeString(providerPublishTime) into source, hard-code time as 'Live', and drop Yahoo's publisher field.
  - 建议：Return null instead of 0 and fall back to '-', and skip sparklines with fewer than 2 points. Send publisher plus an ISO publishedAt from the server and format it on the client with Intl in the viewer's time zone.
- **[LOW · S]** Misleading clickable styling and empty states
  - 位置：`app/page.tsx:1146`, `app/page.tsx:748`, `app/page.tsx:1175`, `app/page.tsx:1183`, `app/page.tsx:650`, `app/page.tsx:840`, `app/page.tsx:1150`, `app/page.tsx:446`
  - 问题：EtfRow has cursor-pointer and hover styling but no onClick, and OverviewView never uses onStockClick, so clicking a heatmap stock chip opens its sector (the click bubbles up to SectorBlock), not the stock. The watchlist's 'Related News' panel shows general market news, NewsPanel shows 'Fetching latest headlines...' for any empty list, and sectorNewsData?.news || generalNews never falls back, because [] is truthy.
  - 建议：Wire ETF rows and chips to goToDetail (with stopPropagation on the chips), or drop the hover styling. Fetch watchlist-specific news or rename the panel, and tell loading apart from empty using the fetch state rather than the array length.
- **[LOW · S]** Chinese mode is partly English, the language resets on reload, and <html lang> is hard-coded
  - 位置：`app/page.tsx:376`, `app/page.tsx:854`, `app/page.tsx:871-874`, `app/page.tsx:944-946`, `app/page.tsx:1047`, `app/page.tsx:1150`, `app/page.tsx:1264`, `app/page.tsx:1288`, `app/page.tsx:1303-1307`, `app/page.tsx:1336`, `app/layout.tsx:7-10`, `app/layout.tsx:18`
  - 问题：DetailView passes title='DeepSeek Analysis' even though t.detail.analysis exists, and SectorView uses the raw English sector name and the word 'News'. Signal labels, empty and loading texts, chart tooltip labels and the chat error are hard-coded literals. lang lives only in useState('en'), while layout.tsx hard-codes lang='zh' and Chinese metadata.
  - 建议：Route every string through t, and type TRANSLATIONS with satisfies Record<'en' | 'zh', typeof en> so a missing key fails tsc. Persist lang in localStorage (read it after mount) and set document.documentElement.lang when the language is toggled.
- **[LOW · S]** Avoidable re-render and remount work: the whole tree per streamed chunk, DetailView per mouse move, and components declared inside SignalCard
  - 位置：`app/page.tsx:579`, `app/page.tsx:882-883`, `app/page.tsx:1001-1006`, `app/page.tsx:1011-1016`, `app/page.tsx:368`, `app/page.tsx:433-434`, `app/page.tsx:827`, `app/page.tsx:861`, `app/page.tsx:1267`
  - 问题：Each chunk sets the top-level aiContent, which re-renders Sidebar, Header, the active view and ChatWidget and re-parses the whole memo. Chart hover state lives in DetailView, so SignalCard, NewsPanel and the markdown re-render on every mouse move, each time running the chart's JSON.stringify comparator twice. FactorPill and StatCell are new component types on each render, so their 12 subtrees remount every time; rows use index keys, and the || [] fallbacks make the useMemo deps change on every render.
  - 建议：Move FactorPill and StatCell to module scope, put the hover readout in a small child component (or React.memo its siblings), and batch stream chunks with a ref plus requestAnimationFrame. Use stable empty-array constants, key rows by symbol, and drop the custom comparator once data references stay stable (swr) or the React Compiler is enabled.

### 性能与数据获取（18 条）

- **[HIGH · M]** No server-side cache or in-flight de-duplication: every poll from every tab goes straight to Yahoo through one shared 4-lane queue
  - 位置：`app/api/market/route.ts:3`, `app/api/market/route.ts:152-163`, `app/api/market/route.ts:358-364`, `app/api/signal/route.ts:4-34`, `app/page.tsx:408-424`, `node_modules/yahoo-finance2/script/src/lib/yahooFinanceFetch.js:10`, `node_modules/yahoo-finance2/script/src/lib/yahooFinanceFetch.js:40-42`, `node_modules/yahoo-finance2/script/src/lib/options/defaults.js:18-20`
  - 问题：Both Yahoo routes are force-dynamic. Each builds a new YahooFinance client per request, caches nothing and sends no Cache-Control header, so every client poll turns into the same Yahoo calls again. yahoo-finance2 sends every request in the process through one module-level FIFO queue (yahooFinanceFetch.js:10) with a default concurrency of 4.
  - 建议：Add lib/yahoo.ts with one shared client and typed getters behind a TTL cache that stores in-flight promises (key -> {promise, expiresAt}). Suggested lifetimes: quotes 10-15 s during the session (minutes when closed), daily bars until the next session, fundamentals 6-24 h, news 5-10 min, computed signals until the next bar. For multi-instance hosting, back it with unstable_cache or a KV store, and send Cache-Control: public, s-maxage, stale-while-revalidate on responses that are the same for every user.
- **[HIGH · M]** Overview poll re-downloads 44 daily charts every 30 s for sparklines the overview never shows
  - 位置：`app/api/market/route.ts:314-327`, `app/api/market/route.ts:336-364`, `app/page.tsx:408-412`, `app/page.tsx:784-793`, `app/page.tsx:831`, `app/page.tsx:865`
  - 问题：Each overview request makes one yf.chart call per stock for 25 days of closes: 44 symbols plus any extra watchlist symbols, in sequential batches of 12. It also makes three separate yf.quote calls and one news search. The hook polls this every 30 s in every view, yet Sparkline is drawn only in the sector and watchlist tables, never in the overview heatmap.
  - 建议：Cache each symbol's daily closes until the next session and overwrite the last point with the live quote. Merge the three quote calls into one quote([...indices, ...stocks, ...etfs]) and fetch sparklines only for the sector or watchlist on screen. A steady-state overview poll then costs 1-2 Yahoo calls.
- **[HIGH · M]** Detail poll refetches fundamentals, 90-day bars and up to five news searches every 5 s, behind a needless waterfall
  - 位置：`app/page.tsx:414-418`, `app/api/market/route.ts:196-219`
  - 问题：Every 5 s poll awaits yf.quote, then awaits quoteSummary (5 modules), then runs Promise.all over the company news search, the 90-day chart, 1-2 macro searches and 0-2 industry searches. That is up to 8 Yahoo calls over 3 back-to-back round trips. quoteSummary and chart do not depend on the quote, and the searches only need the name, sector and industry, which never change.
  - 建议：Poll a light quote-only endpoint every 5-10 s. Serve fundamentals (6-24 h), bars (until the close, with the last candle updated from the quote) and news (5-10 min, cached per search term) from separate cache keys. Start quote, quoteSummary and chart in one Promise.all, and cache name, sector and industry so the searches no longer wait on two round trips.
- **[HIGH · S]** AI analysis streams are never cancelled: abandoned memos keep streaming into other views and onto the DeepSeek bill
  - 位置：`app/page.tsx:452-455`, `app/page.tsx:483-488`, `app/page.tsx:514-585`, `app/api/analyze/route.ts:250-273`, `app/api/chat/route.ts:85-103`
  - 问题：startAnalysis has no AbortController and no run id. On navigation the reset effect clears aiContent and isAnalyzing, but the reader loop keeps calling setAiContent(prev => prev + chunk), and its finally block clears isAnalyzing even while a newer run is streaming. On the server, chat.completions.create gets no abort signal and the ReadableStream has no cancel().
  - 建议：Keep an AbortController and a run id in a ref, abort on view change, on a new analysis and on unmount, and ignore chunks from older runs. On the server, pass { signal: request.signal } in the request options of chat.completions.create and abort the SDK stream from a ReadableStream cancel() callback, in both /api/analyze and /api/chat.
- **[HIGH · S]** Detail polling keeps running after the user leaves the detail view
  - 位置：`app/page.tsx:414-424`, `app/page.tsx:457-461`, `app/page.tsx:470-481`, `app/page.tsx:483-488`, `app/page.tsx:490-505`
  - 问题：The detail and signal keys depend only on selectedTicker, and only goToOverview clears it. Going Back from a stock to its sector or watchlist, using the sidebar Sector or Watchlist buttons, or opening a news item all leave it set, and the hook lives in the root component, which never unmounts.
  - 建议：Make the detail key depend on currentView === 'detail', or move the detail and signal hooks into DetailView, and keep selectedTicker for the breadcrumbs and the Quote nav item. Do this together with the switch to swr so returning to the same ticker renders from cache instead of a skeleton.
- **[HIGH · S]** LLM calls have no input or output caps, so per-request cost is controlled by the client
  - 位置：`app/api/chat/route.ts:13`, `app/api/chat/route.ts:85-93`, `app/api/analyze/route.ts:114`, `app/api/analyze/route.ts:246-258`, `app/page.tsx:1318-1324`
  - 问题：/api/chat appends the client-supplied messages array, with any roles and any length, after the system prompt, and the chat widget resends the whole history every turn. /api/analyze JSON.stringifies whatever data object is posted. Neither route limits body size or sets max_tokens, and the repo has no middleware or proxy file, no auth and no rate limiting.
  - 建议：Reject bodies over about 32 KB. Keep only the last ~10 messages on the server, force roles to user/assistant and cap their length, whitelist the fields read from data, and set max_tokens (about 800 for memos, 600 for chat). Add per-IP rate limiting before any public deploy.
- **[HIGH · S]** Unbounded ?watchlist= fan-out lets one request trigger thousands of Yahoo calls
  - 位置：`app/api/market/route.ts:329-334`, `app/api/market/route.ts:336-356`, `app/api/market/route.ts:358-364`
  - 问题：The watchlist query is split on commas with no check on count, length or format. Every symbol adds a yf.chart call, and the whole list goes into one yf.quote URL. fetchCharts runs as a separate async loop, so it keeps issuing batches of 12 even after Promise.all has rejected and the route has returned.
  - 建议：Validate symbols (for example /^[A-Z0-9.^=-]{1,10}$/), remove duplicates and cap the list at 25-50 on both client and server, and serve watchlist sparklines from the shared bar cache. Add per-IP rate limiting at the host edge or in a proxy.
- **[MEDIUM · S]** Hand-rolled useSWR polls blindly and has no cache or stale-response guard
  - 位置：`app/page.tsx:40-85`, `app/page.tsx:408-424`, `app/page.tsx:476-481`
  - 问题：The hook runs a bare setInterval (30 s overview, 5 s detail) with no visibility check, no guard against overlapping requests, no error backoff and no awareness of market hours, and it ignores the revalidateOnFocus option the callers pass. It resets data to undefined on every key change and calls setData without aborting old requests or checking that the response still matches the current key. The real swr 2.3.8 package is installed but never imported.
  - 建议：Replace the hook with swr's useSWR (same call shape) and make the fetcher throw on !res.ok. swr pauses polling in hidden tabs by default, waits for the previous request before the next poll, backs off on errors, caches per key and ignores outdated responses; use keepPreviousData where flicker matters. Return marketState from the API and pass refreshInterval as a function of it (for example 5-10 s REGULAR, 60 s PRE/POST, 5 min or off when CLOSED).
- **[MEDIUM · S]** One failed Yahoo call blanks the dashboard until the next successful poll
  - 位置：`app/page.tsx:88`, `app/api/market/route.ts:358-364`, `app/api/market/route.ts:424-426`, `app/api/market/route.ts:308-310`
  - 问题：The fetcher calls res.json() without checking res.ok, so an {error} body replaces the last good data. On the server the three overview yf.quote calls have no catch and validate results by default (moduleExec rethrows validation errors), so a single 429, timeout or schema mismatch turns the whole overview into a 500.
  - 建议：Throw on !res.ok in the fetcher so the last good data stays on screen and the error is reported separately. On the server, use Promise.allSettled or a .catch on each call with { validateResult: false }, and return partial data or the last cached value with a stale flag.
- **[MEDIUM · S]** The watchlist is part of the overview key: double fetch on load and a full overview reload on every star toggle
  - 位置：`app/page.tsx:385`, `app/page.tsx:390-395`, `app/page.tsx:397-406`, `app/page.tsx:408-412`, `app/page.tsx:49-55`
  - 问题：The overview key embeds watchlist.join(','). State starts as ['NVDA','AAPL'] and the saved list is applied by an effect, so the first render already fetches with the default key and a second fetch follows. Each star toggle changes the key, which resets data to undefined.
  - 建议：Move the watchlist to its own key and endpoint, backed by the quote and bar caches, so the overview key stays constant and can be cached by a CDN. Keep that key null until localStorage has been read, and use keepPreviousData or optimistic updates on toggle.
- **[MEDIUM · S]** Each news click auto-runs an uncached analysis that can wait 16 s or more before streaming
  - 位置：`app/page.tsx:483-488`, `app/api/analyze/route.ts:13-21`, `app/api/analyze/route.ts:23-68`, `app/api/analyze/route.ts:124-132`, `app/api/analyze/route.ts:250-258`
  - 问题：goToNews starts an analysis automatically. Before calling DeepSeek the route awaits a Jina fetch and, if that fails, a direct fetch, each with an 8 s timeout that is cleared as soon as headers arrive. The res.text() body reads are therefore limited only by undici's default 300 s body timeout, and neither the article text nor the memo is cached.
  - 建议：Cache article text by URL (1-24 h) and memos by (url, lang) for a few minutes. Race the two fetchers under one ~4 s budget that also covers the body read, and start the response stream immediately with the status line, doing the fetch inside it. Consider making the analysis on click opt-in.
- **[LOW · S]** Opening a ticker fetches the quote, fundamentals and bars twice, including an unused module
  - 位置：`app/api/market/route.ts:198-216`, `app/api/signal/route.ts:28-34`, `app/page.tsx:414-424`
  - 问题：Opening a ticker fires /api/market?ticker (quote, 5-module quoteSummary, 90-day chart, searches) and /api/signal (quote, 540-day chart, 4-module quoteSummary) at the same time. The quote is fetched twice, three quoteSummary modules overlap, the 90-day bars are a subset of the 540-day bars, and incomeStatementHistory is requested but never read.
  - 建议：Once shared cached getters exist, serve both routes from one quote, one quoteSummary with the union of the modules, and one 540-day bar series cut to 90 days for the chart. Drop incomeStatementHistory.
- **[LOW · M]** Root-level state makes polls, streamed chunks and chart hover re-render large parts of the page
  - 位置：`app/page.tsx:371-388`, `app/page.tsx:579`, `app/page.tsx:216`, `app/page.tsx:255-295`, `app/page.tsx:368`, `app/page.tsx:881-883`, `app/page.tsx:942`, `app/page.tsx:1001-1016`, `app/page.tsx:1263-1282`, `app/page.tsx:671`
  - 问题：All data and aiContent live in the root component, and only ChartComponent is memoised; its comparator JSON.stringifies both histories on every parent render and ignores its other props. Every chart mousemove, even within one candle, calls setHoverData in DetailView, which re-renders SignalCard (whose nested FactorPill and StatCell components remount each time), NewsPanel and AiInsightBox (which re-parses the whole memo). Every streamed chunk and every poll re-renders the whole app.
  - 建议：Keep hover state inside ChartComponent (or a small price-header component), report hover only when the candle index changes, move FactorPill and StatCell to module scope, and wrap SignalCard, NewsPanel, AiInsightBox, Sidebar, Header and ChatWidget in React.memo with stable callbacks. Memoise the parsed markdown, flush streamed chunks once per animation frame, and replace the JSON.stringify comparator with a stable history reference or a check on length plus the last bar.
- **[LOW · S]** Analysis prompts carry raw OHLC bars and duplicated sections, and the chat prompt layout defeats prefix caching
  - 位置：`app/page.tsx:551-559`, `app/api/analyze/route.ts:135-140`, `app/api/analyze/route.ts:189-225`, `app/api/analyze/route.ts:246-248`, `app/api/chat/route.ts:57-83`
  - 问题：The detail memo spreads detailData.detail, so the full ~62-bar chartHistory is JSON-stringified into the user message. relatedNews is sent in the JSON and again as the News Intelligence block, and modelSignal appears both in the JSON and in the system prompt. In /api/chat the live context sits in the middle of the system prompt, ahead of the static guidelines and the history.
  - 建议：Send derived indicators instead of bars (last close, 5/20/60-day returns, MA5/10/20, 90-day high/low), whitelist fields, and send the news and the signal once. In /api/chat put the static system prompt first and add the live context after the history (or as the last message), so the system prompt and history form a stable prefix that can be cached.
- **[LOW · S]** Four unused runtime dependencies plus an unused Tailwind v4 PostCSS plugin
  - 位置：`package.json:12`, `package.json:18`, `package.json:20`, `package.json:21`, `package.json:25`, `postcss.config.mjs:1-8`, `app/globals.css:1-3`
  - 问题：No source file imports recharts, apexcharts, react-apexcharts or swr. postcss.config.mjs loads the v3 tailwindcss plugin and globals.css uses v3 @tailwind directives, so @tailwindcss/postcss 4 (with its own tailwindcss 4, lightningcss and oxide binaries) is never used.
  - 建议：Run npm uninstall recharts apexcharts react-apexcharts @tailwindcss/postcss. Then either adopt swr in place of the hand-rolled hook (recommended) or remove it too.
- **[LOW · S]** The analyze route bundles full cheerio (undici, parse5, iconv-lite) just to call load()
  - 位置：`app/api/analyze/route.ts:3`, `app/api/analyze/route.ts:51`
  - 问题：import * as cheerio from 'cheerio' loads cheerio's main entry, which also pulls in undici, parse5, parse5-parser-stream and encoding-sniffer for URL and stream loading. The built analyze chunk is 1,094,663 bytes and contains undici and iconv-lite code, versus 100,698 bytes for the openai chunk.
  - 建议：Use import { load } from 'cheerio/slim', which uses htmlparser2 only, or a lazy await import('cheerio/slim') inside the fallback branch.
- **[LOW · S]** API payloads ship unrounded floats and pre-formatted strings that the client parses back
  - 位置：`app/api/market/route.ts:346-348`, `app/api/market/route.ts:375-386`, `app/page.tsx:181-188`, `app/page.tsx:197-205`, `app/page.tsx:1153-1162`
  - 问题：Sparkline closes are sent at full float precision (Yahoo values like 181.36000061035156). Prices, changes and market caps are sent as display strings ('+1.23%', '4.43T') that the client parses back with parseFloat and regex replaces for sorting, heatmap weights and hover estimates.
  - 建议：Return rounded numbers and format them on the client with Intl.NumberFormat, keeping display strings out of the API.
- **[LOW · S]** Documented runtime is out of date for the installed dependencies
  - 位置：`README.md:55`, `README.md:73`, `package.json:1-10`
  - 问题：The README says Next.js 14 and Node 18.17+, but next 16.0.4 requires Node >=20.9.0 and cheerio 1.1.2 requires >=20.18.1. yahoo-finance2 3.x warns 'Things might break' below Node 22, and the repo has no engines field in package.json and no .nvmrc.
  - 建议：Add "engines": { "node": ">=22" } and an .nvmrc, update the README stack and prerequisites, and build the yahoo-finance2 client once at module scope.

### 量化模型与回测（21 条）

- **[HIGH · M]** Composite is tilted by absolute volatility: on pure noise a 25%-vol stock is labelled Buy 37% of days and Sell 1%
  - 位置：`lib/signal.ts:400-429`, `lib/signal.ts:264-270`, `lib/signal.ts:475-493`, `lib/signal.ts:81`
  - 问题：The volatility factor maps absolute 20-day vol through inverseNormalize(0.08, 0.70) at 15% weight, so it acts as a permanent level offset rather than a timing signal. The RSI table is also asymmetric (neutral 55, mild bands 70/40, strong 85/20). Labels use fixed cut-offs (58/72 and 42/28) that are not centred on the resulting score distribution.
  - 建议：Make volatility relative (a percentile of the stock's own 1-year vol, or vol versus SPY or the sector), or move it into a risk overlay outside the directional score, and make the RSI map symmetric around 50. Then check that the label mix is roughly symmetric on driftless simulations, and set thresholds from the empirical score distribution.
- **[HIGH · M]** 'Reliability' badge is HIGH for virtually every Buy: imputed 50s count as agreement and coverage barely constrains it
  - 位置：`lib/signal.ts:496-505`, `lib/signal.ts:564-569`, `lib/signal.ts:587-589`, `app/page.tsx:994-996`, `app/page.tsx:1028-1040`, `app/page.tsx:20`, `app/page.tsx:32`
  - 问题：computeFactorAgreement counts v >= 50 as agreeing whenever the composite is >= 50, so neutral-imputed 50s (missing P/E or quality data, short history) always agree with a bullish composite and never with a bearish one. Reliability = round(sqrt(agreement x completeness)), so 49% agreement with full data reaches HIGH (70), and 100% agreement with only 20% coverage reaches MEDIUM (45). The UI labels this 'Reliability'/'综合可信度' with High/Medium/Low.
  - 建议：Have each factor report whether it was imputed, and exclude imputed factors and those within a ±5 dead-band around 50 from agreement. Cap the badge by coverage (e.g. min(agreement, completeness), or LOW below 70% completeness), and rename it 'Factor consensus' unless it is calibrated against realised hit rates.
- **[HIGH · M]** Backtest stats come from at most 20/12/6 trades, with no interval or base-rate comparison, yet are colour-coded as evidence
  - 位置：`lib/signal.ts:635-647`, `lib/signal.ts:658-677`, `app/api/signal/route.ts:77-86`, `app/page.tsx:1098-1124`
  - 问题：backtest() evaluates only the last 60 sessions with non-overlapping holds, so sampleSize is capped at 20 (3d), 12 (5d, the default tab) and 6 (10d), although about 372 bars are fetched. The UI colours Win Rate green at >=50% and Avg Ret green at >=0 whatever n is. There is no confidence interval and no comparison with the unconditional forward win rate or buy-and-hold over the same window.
  - 建议：Show n with a Wilson interval plus the same-window base rate and the excess over it, and grey out the stats when n < 20. Extend the window to about 250 sessions (measured about 3 ms per request vs about 1 ms now). Longer term, move the evidence to a universe-level offline evaluation.
- **[MEDIUM · S]** Strong Buy/Sell labels are shown with no disclaimer, as-of time or methodology note anywhere in the app
  - 位置：`app/page.tsx:1046-1048`, `app/page.tsx:1075-1081`, `app/page.tsx:20`, `app/page.tsx:32`, `README.md:124-132`, `docs/signal-model.md:228-233`
  - 问题：SignalCard renders the raw English label in a coloured badge next to the score and 'Reliability'. It shows no disclaimer, no computedAt time, and no note that fundamentals are today's or that the backtest only tests Buy signals. A grep of app/ for disclaimer/advice/免责/投资建议 finds nothing (disclaimers exist only in the README and docs), and the label is not translated in the zh UI.
  - 建议：Add a persistent bilingual disclaimer and an 'as of <computedAt>' line under SignalCard and in a layout footer, with a tooltip or link to the methodology. Translate the labels, and consider softer wording (e.g. 'Bullish tilt') until the model is validated.
- **[MEDIUM · S]** Downside deviation divides by the number of down days and is zeroed with two or fewer, creating a 92-to-0 cliff
  - 位置：`lib/signal.ts:411-428`, `docs/signal-model.md:131-138`
  - 问题：downsideVariance is the sum of r^2 over negative days divided by the count of negative days, and is forced to 0 unless there are more than 2 negative returns. The standard semideviation divides by all N returns and has no cut-off. The result is blended 70% downside plus 30% total vol.
  - 建议：Use sqrt(sum(min(r,0)^2)/N) over all N returns with no cut-off, and add unit tests for the crash-day and loss-frequency cases.
- **[MEDIUM · M]** Value factor has large cliffs at the growth-tier and P/E-7 boundaries, and loss-makers score neutral
  - 位置：`lib/signal.ts:326-353`, `app/api/signal/route.ts:54-56`, `app/api/signal/route.ts:63-64`
  - 问题：P/E is mapped through three discrete revenue-growth tiers (>15%, >5%, else) and capped at 60 only when P/E < 7 and growth is unknown or negative. P/E comes only from trailingPE, which Yahoo omits when EPS is negative, so the pe < 0 -> 20 branch is effectively unreachable and loss-makers fall back to a neutral 50. revenueGrowth is the latest quarter's YoY figure.
  - 建议：Interpolate the P/E band continuously in growth (or use a floored PEG-style ratio) and taper the P/E-7 cap. Flag loss-makers explicitly (e.g. quote.epsTrailingTwelveMonths <= 0) so they get the intended penalty, and add continuity tests.
- **[MEDIUM · M]** Quality uses absolute ranges that score a typical company well below 'no data' (a regression from commit 7cdc7a6)
  - 位置：`lib/signal.ts:368-393`, `app/api/signal/route.ts:57-72`, `docs/signal-model.md:114-122`
  - 问题：ROE is mapped linearly over 0-100% and net margin over -5-50% (both widened in 7cdc7a6 from 0-35% and -5-30%). D/E is mapped over 0-3 with negative values clamped to 0, which earns a perfect score, and the result blends 24% weakest metric with 76% mean. Missing metrics are imputed at 50 and there is no sector adjustment.
  - 建议：Re-centre the ranges so a median company lands near 50, or score as a sector or universe percentile. Treat a negative D/E as missing or worst-case, and skip D/E for financials using the assetProfile sector.
- **[MEDIUM · M]** Backtest applies today's fundamentals to every past day, which largely decides whether any trades exist
  - 位置：`lib/signal.ts:619-629`, `lib/signal.ts:658-660`, `app/api/signal/route.ts:83`, `docs/signal-model.md:179-180`, `docs/signal-model.md:218-219`
  - 问题：computeSignalAtIndex reuses the current fundamentals for every historical day, so value and quality (30% of the weight) act as a constant offset on the whole score series relative to the 58 Buy threshold. The doc admits this under Known Limitations, but its backtest step 1 says 'only data available at day t', and the UI says nothing.
  - 建议：Backtest a technical-only composite (the price factors re-weighted to sum to 1) and label it as such, or use point-in-time fundamentals in an offline harness.
- **[MEDIUM · M]** Backtest tests only Buy signals but is shown under any label, and fills at the signal bar's own close on split-only-adjusted prices with no costs
  - 位置：`lib/signal.ts:658-676`, `lib/signal.ts:661-664`, `app/api/signal/route.ts:36-45`, `app/page.tsx:1075-1124`
  - 问题：Trades open only on Buy/Strong Buy, enter at bars[i].close (the same close used to compute the signal) and exit at bars[i+h].close with no costs. sellSignals is counted but never evaluated or displayed. The route maps q.close, which is split-adjusted only, even though yahoo-finance2 chart() also returns adjclose (chart.js:260-273).
  - 建议：Label the panel as a Buy-signal backtest, or show the backtest that matches the current label and evaluate Sell signals against the base rate. Enter at bars[i+1].open, subtract a 5-10 bps round-trip cost, and compute returns from adjclose-scaled prices.
- **[MEDIUM · S]** 'Sharpe' is per-trade and 'Max DD' counts only exits, so both are non-standard and not comparable across tabs
  - 位置：`lib/signal.ts:691-705`, `lib/signal.ts:645-646`, `app/page.tsx:1109-1118`
  - 问题：Sharpe is mean/std of 1-20 per-trade returns with no annualisation or risk-free rate, and the UI colours values >= 0.5 green. Max drawdown compounds only exit-to-exit returns and ignores losses while a position is open. Each hold period also uses a slightly different 60-day window, because endIdx depends on holdDays.
  - 建议：Report mean/std x sqrt(252/h) net of a risk-free rate (or rename it 'return/vol per trade'). Compute drawdown from a daily mark-to-market equity curve, and use one signal window for all hold periods.
- **[MEDIUM · S]** A labelled signal is returned even when the price history is missing
  - 位置：`app/api/signal/route.ts:30`, `app/api/signal/route.ts:36`, `app/api/signal/route.ts:75`, `lib/signal.ts:579-589`
  - 问题：If yf.chart fails, `.catch(() => null)` leaves bars = [], and computeSignal still returns a label because there is no minimum-bars check and every price factor imputes 50.
  - 建议：Return an explicit insufficient-data response (signal: null plus a reason) when the chart fails or bars.length is below about 120, and have SignalCard render that state.
- **[MEDIUM · S]** Factor pills show inverted scores under raw-metric names ('RSI', 'Vol Risk')
  - 位置：`app/page.tsx:1059`, `app/page.tsx:1069`, `app/page.tsx:20`, `app/page.tsx:32`, `lib/signal.ts:264-270`, `lib/signal.ts:428`
  - 问题：The 'RSI' pill shows the inverted RSI score (an RSI of 15-30 maps to 85), and 'Vol Risk'/'波动风险' shows inverseNormalize of volatility, so low risk gives a high value; both pills turn green when high. The actual RSI14 and annualised vol in metadata are never rendered.
  - 建议：Show the raw values (e.g. 'RSI14 27.3', 'Vol 22%') next to the factor score, or rename the pills ('RSI signal', 'Low-vol score') and add a 'higher = more bullish' tooltip.
- **[MEDIUM · L]** No unit tests or evaluation harness, and the last commit retuned the model with no recorded evidence
  - 位置：`package.json:5-10`, `lib/signal.ts:73-82`, `docs/signal-model.md:210`
  - 问题：There is no test runner, test script, test file or CI. The weights are commented 'tuned' and the doc calls the thresholds 'Calibrated', yet commit 7cdc7a6 changed the ROE/margin ranges and volume cut-offs and added vol-scaled momentum, the MA20 slope, the RSI regime blend and Wilder RSI, with no evaluation anywhere in the repo.
  - 建议：Add vitest tests for the exported pure functions: reference RSI values, downside deviation, mirror symmetry, continuity/monotonicity, NaN guards, a future-bar perturbation test for the backtest, and a label-mix check on driftless simulations. Then add an offline evaluation script over a fixed universe with cached adjclose bars (rank IC, label-bucket excess returns vs base rate, hit rates with CIs, walk-forward splits), and run it before changing any weight or threshold.
- **[LOW · S]** Momentum divergence penalty multiplies toward 0 instead of toward 50
  - 位置：`lib/signal.ts:155-163`, `docs/signal-model.md:40-41`
  - 问题：When the 5-day and 60-day sub-scores disagree in direction, the whole 0-100 score is multiplied by 0.90 or 0.80 (divergence above 30 or 50 points). That always pulls it down rather than toward neutral 50.
  - 建议：Damp toward neutral with score = 50 + (score - 50) x k, bring the doc in line (it says >40 points gives 15% damping), and add a mirror-symmetry test.
- **[LOW · S]** Live signal likely includes Yahoo's in-progress daily bar, which biases the volume factor during the session
  - 位置：`app/api/signal/route.ts:24-45`, `lib/signal.ts:284-294`, `lib/signal.ts:591-594`, `lib/signal.ts:614`, `lib/signal.ts:669`
  - 问题：chart() is called without period2, which yahoo-finance2 defaults to now (chart.js:172-173), and the route keeps every row, so during the session the last bar likely carries partial volume and a live 'close'. A zero or missing volume on the last bar switches the volume factor off, because every recent bar must have volume > 0. metadata.volumeRatio uses means while the factor uses medians.
  - 建议：Drop the last bar when it is dated today and the market is open (check quote.marketState or regularMarketTime), or scale its volume to a full day. Compute metadata.volumeRatio with the factor's median definition.
- **[LOW · S]** SignalCard shows an empty 5d result while another tab is highlighted
  - 位置：`app/page.tsx:973`, `app/page.tsx:1008-1009`, `app/page.tsx:1086-1092`, `app/api/signal/route.ts:83-84`
  - 问题：The route stores the 5d result even when its sampleSize is 0. `bt = backtests[activePeriod] || ...` then picks that truthy empty object, while the tab highlight falls back to btKeys[0].
  - 建议：Derive one key, `const key = btKeys.includes(activePeriod) ? activePeriod : btKeys[0]`, and use it for both bt and the highlight (or drop zero-sample results in the route).
- **[LOW · S]** Non-finite fundamentals silently turn into a 'Strong Sell'
  - 位置：`lib/signal.ts:487-493`, `lib/signal.ts:326-345`, `app/api/signal/route.ts:31-33`, `app/api/signal/route.ts:47-73`
  - 问题：quoteSummary runs with validateResult: false, and yahoo-finance2 leaves values it cannot coerce in place: number.js only unwraps {raw} and parses strings, and {} stays {} for these non-nullable fields. The route forwards any non-null value, lib/signal.ts has no Number.isFinite guards, and scoreToSignal returns 'Strong Sell' for NaN because every comparison is false.
  - 建议：Coerce each fundamental with a toFiniteNumber helper (`typeof x === 'number' && Number.isFinite(x) ? x : undefined`), and map a non-finite composite to an insufficient-data result instead of a label.
- **[LOW · S]** AI memo prompt quotes backtest win rates without sample sizes and labels reliability HIGH
  - 位置：`app/api/analyze/route.ts:193`, `app/api/analyze/route.ts:206-219`, `app/page.tsx:558`
  - 问题：btSummary renders e.g. '5d: 83% win, +1.2% avg' with no n, base rate or interval, and the block passes on the model's HIGH/MEDIUM/LOW reliability label. The raw backtests, including sampleSize, do reach the model inside the JSON user message, and the prompt asks it to treat the signal as one analyst's view.
  - 建议：Include n and the base rate in btSummary, leave win rates out when n < 20, and tell the model not to cite backtest statistics as evidence.
- **[LOW · S]** docs/signal-model.md disagrees with lib/signal.ts in about ten places, including the backtest and 'confidence' definitions
  - 位置：`docs/signal-model.md:6-7`, `docs/signal-model.md:34-41`, `docs/signal-model.md:51-54`, `docs/signal-model.md:80-89`, `docs/signal-model.md:106`, `docs/signal-model.md:114`, `docs/signal-model.md:131-134`, `docs/signal-model.md:179-188`, `docs/signal-model.md:210`, `lib/signal.ts:137-163`, `lib/signal.ts:199-224`, `lib/signal.ts:447-456`
  - 问题：The code adds momentum vol-scaling, trend partial credits plus an MA20-slope bonus, and an RSI regime blend that the doc never mentions, and its divergence penalty (x0.90/x0.80 at >30/>50 points, only when directions disagree) differs from the doc's '>40 points, 15%'. Volume uses medians with 1.35/1.05/0.75 cut-offs (doc: averages, 1.3/0.7); negative P/E scores 20 and there is an undocumented P/E<7 cap (doc: neutral 50); quality uses a weakest-link blend (doc: equal average); and downside deviation is taken over down days only. The doc also calls 'confidence' factor agreement, says backtest signals use only data available at day t and that every Buy day is a trade, and defines Sample Size as buySignals/totalSignals, whereas the code uses today's fundamentals, non-overlapping trades and sampleSize = executed trades.
  - 建议：Update the spec in one pass after fixing the bugs above, keep the thresholds in one exported constants table that the doc refers to, and drop 'calibrated'/'tuned' unless evaluation output backs them.
- **[LOW · M]** Step-function scoring causes cliffs and label churn, and a flat series scores RSI 100 (a regression from 7cdc7a6)
  - 位置：`lib/signal.ts:253`, `lib/signal.ts:264-270`, `lib/signal.ts:297`, `lib/signal.ts:301-317`, `lib/signal.ts:199-207`
  - 问题：RSI goes through a step table that is non-monotone at 15 and drops 15 points between 55.0 and 55.1; the volume and trend scores are also stepwise, and the volume factor's price direction spans only 4 of its 5 bars. The new Wilder RSI returns 100 whenever avgLoss is 0, including on a perfectly flat series, whereas the code before 7cdc7a6 returned 50.
  - 建议：Use piecewise-linear mappings, return RSI 50 when both averages are 0, use the full 5-day change, and add hysteresis to label changes (e.g. a 2-point margin or 2 sessions).
- **[LOW · S]** backtestDays is unvalidated, and the backtest uses 60 of about 260 available sessions
  - 位置：`app/api/signal/route.ts:17-18`, `app/api/signal/route.ts:31-33`, `app/api/signal/route.ts:80-85`, `lib/signal.ts:635-647`
  - 问题：parseInt has no bounds, so ?backtestDays=abc silently produces no backtests (NaN fails the minBars check) and a negative value returns results with a negative totalSignals. The incomeStatementHistory module is requested but never read.
  - 建议：Clamp backtestDays to an integer in [20, bars.length - 110], default it to about 250, and drop the unused quoteSummary module.

### 体验、可访问性与架构（31 条）

- **[HIGH · S]** AI analysis streams are never cancelled, so a memo leaks into the next view and keeps spending tokens
  - 位置：`app/page.tsx:452-455`, `app/page.tsx:483-488`, `app/page.tsx:514-586`, `app/page.tsx:740-741`, `app/api/analyze/route.ts:250-273`
  - 问题：The reset effect only clears aiContent and isAnalyzing when the view, sector or ticker changes. startAnalysis has no AbortController or request id, so its reader loop keeps calling setAiContent(prev => prev + chunk) and its finally block sets isAnalyzing(false) whenever it ends. goToNews starts an analysis automatically via setTimeout(..., 100) so it runs after that reset, and the route never passes request.signal to the DeepSeek call.
  - 建议：Keep an AbortController and a request id in a ref (or a useAiStream hook). Abort in the reset effect and before each new analysis, and ignore chunks and finally calls from stale ids. On the server, pass request.signal to client.chat.completions.create so that aborting the fetch stops generation.
- **[HIGH · M]** No loading, empty or error states: first paint and failed polls show a fake flat, all-green market
  - 位置：`app/page.tsx:43`, `app/page.tsx:66-72`, `app/page.tsx:88`, `app/page.tsx:163-168`, `app/page.tsx:408-434`, `app/page.tsx:781`, `app/page.tsx:804`, `app/page.tsx:875`, `app/page.tsx:981`, `app/page.tsx:1150`, `app/api/market/route.ts:424-425`
  - 问题：The hook starts with isLoading=false and the fetcher never checks res.ok, so a 500 {error} body from /api/market is stored as data. The prerendered HTML shows four INITIAL_INDICES cards ('-' with green '0.00%' chips and up-arrows) and six green '0.00%' heatmap tiles. No view reads `error`, empty lists show 'Loading ETFs...' and 'Fetching latest headlines...', and SignalCard returns null on error.
  - 建议：Make the fetcher throw on !res.ok and keep the last good data when a request fails (SWR does this by default). Model each request as loading, error, empty or success: skeletons for the index cards and lists, an inline error card with Retry and an 'as of' time, separate empty-state text, and a 'Signal unavailable' state instead of null.
- **[HIGH · L]** No URL routes: browser Back leaves the app, refresh resets state, and views can't be linked
  - 位置：`app/page.tsx:372-383`, `app/page.tsx:457-505`, `app/page.tsx:611`, `app/page.tsx:712-729`
  - 问题：View, ticker, sector and news exist only in useState, and nothing uses next/navigation, Link or the History API. handleBack remembers a single lastView, so Sector > Stock > News > Back > Back lands on Overview (goToNews overwrites lastView with 'detail'). Breadcrumbs are built from leftover selectedTicker (a story opened from Watchlist can show 'Market > NVDA > Insight'), and the main scroll container is never reset when the view changes.
  - 建议：Move the views to App Router routes (/, /watchlist, /sector/[name], /stock/[ticker], /news?url=...) using <Link>/router.push, with loading, error and not-found files per route. As a cheaper first step, mirror view, ticker and sector into search params with router.push so Back and refresh work.
- **[HIGH · S]** A mistyped or unknown ticker shows a skeleton forever and is re-requested every 5 s
  - 位置：`app/page.tsx:507-511`, `app/page.tsx:88`, `app/page.tsx:414-418`, `app/page.tsx:885-890`, `app/page.tsx:740`, `app/api/market/route.ts:198-199`, `app/api/market/route.ts:308-309`
  - 问题：handleSearch uppercases the raw input without trimming, validating or encodeURIComponent and navigates immediately. For an unknown symbol, yahoo-finance2's quote() returns undefined, quote.shortName throws, and the route returns 404 {error}. The fetcher stores that body as data, DetailView shows the skeleton whenever detail is missing, the 5 s interval keeps re-requesting, and the header AI button stays disabled.
  - 建议：Trim, validate (e.g. /^[A-Z0-9.^=-]{1,12}$/) and encode the symbol, and make the fetcher throw on !res.ok. Show a 'Ticker not found' state (not-found.tsx once routes exist) and stop polling on error. A yf.search typeahead is an optional extra.
- **[HIGH · M]** Sector and Watchlist 12-column tables overlap on phones, tablets and small laptops
  - 位置：`app/page.tsx:821-836`, `app/page.tsx:855-870`, `app/page.tsx:828`, `app/page.tsx:1249-1250`
  - 问题：Rows use grid-cols-12 gap-4 px-6 at every width. The Trend cell holds a fixed 80px SVG, and the company cell needs 56px for the avatar plus up to 140px for the name. Computed from the Tailwind classes, the col-span-2 cell is 33px wide at 375px and stays under 80px below 658px, at 768-913px and at 1024-1234px (sidebar plus 3-column layout).
  - 建议：Extract one StockTable. Below md, render each row as a two-line card (symbol/name on the left, price/change on the right) and hide Trend and Mkt Cap. From md up, use explicit tracks such as grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_96px_minmax(0,1fr)] or a real <table> inside overflow-x-auto.
- **[HIGH · S]** Core interactions only work with a mouse (clickable div/span elements)
  - 位置：`app/page.tsx:681`, `app/page.tsx:718-727`, `app/page.tsx:827`, `app/page.tsx:861`, `app/page.tsx:1150`, `app/page.tsx:1175`, `app/page.tsx:1211`, `app/page.tsx:690`
  - 问题：Ten click targets are div or span elements with onClick but no role, tabIndex or key handler: the logo, four breadcrumb spans, both table row types, news items, sector tiles and the watchlist tile. page.tsx contains no aria-*, role or tabIndex attributes at all.
  - 建议：Render these as <button type='button'> (or <Link> once routes exist), give each table row one focusable link on the symbol, and add visible focus-visible styles.
- **[MEDIUM · S]** The Buy/Sell signal and thin backtests are shown prominently with no in-app disclaimer
  - 位置：`app/page.tsx:939-943`, `app/page.tsx:986-993`, `app/page.tsx:1046-1048`, `app/page.tsx:1098-1124`, `lib/signal.ts:619-629`, `lib/signal.ts:656-676`, `app/api/signal/route.ts:18`, `app/api/analyze/route.ts:185`, `app/api/analyze/route.ts:238`, `app/api/chat/route.ts:77`
  - 问题：SignalCard ('Strong Buy'/'Strong Sell' with a glow) sits between the price header and the chart. The backtest covers 60 days of non-overlapping trades (at most 20, 12 or 6 trades for 3-, 5- and 10-day holds) and uses today's fundamentals for every past day, yet results are coloured green/red with one or two decimals. No disclaimer exists in app/ or lib/, although README.md:124-132 and docs/signal-model.md:218-233 have one, and the AI prompts ask for a Buy/Hold/Sell framework and 'actionable' advice.
  - 建议：Put the chart directly under the price header. Move the signal into a collapsible 'Model view (experimental)' card with an inline en/zh disclaimer and a 'low sample (n trades)' badge when sampleSize < 30. Add a persistent footer disclaimer and a one-line note under every AI memo and chat answer.
- **[MEDIUM · M]** The chat and analyze payloads have drifted from what the prompts expect, and `any` hides it
  - 位置：`app/page.tsx:598-603`, `app/api/chat/route.ts:26-30`, `app/api/analyze/route.ts:150`, `app/api/analyze/route.ts:158`, `app/api/analyze/route.ts:173`, `app/page.tsx:532-547`, `app/page.tsx:12`, `app/page.tsx:110-130`, `app/api/market/route.ts:302`, `lib/signal.ts:37-71`
  - 问题：The chat route reads detailSummary.pe/eps/roe/grossMargin/earningsDate, but the client sends only symbol, price, change and marketCap. The analyze prompts refer to 'relevantNews', 'sectorNews' and 'topHeadlines', while the client sends no news, 'recentNews' and 'marketNews' for the watchlist, sector and overview views. page.tsx has 49 no-explicit-any errors, StockDetail is unused, NewsItem.id is typed number while detail ids are 'news-N' strings, and SignalCard takes any even though lib/signal exports SignalResult.
  - 建议：Add types/api.ts (optionally with zod schemas) for MarketOverview, QuoteDetail, NewsItem, SignalResponse, AnalyzeRequest and ChatRequest, shared by the routes and the client fetcher. Send the full metrics in detailSummary, align the prompt key names with the payload, and import SignalResult/BacktestResult in SignalCard.
- **[MEDIUM · S]** Freshness and status labels are hard-coded: 'CONNECTED', 'Live Market', and 'Live' news whose source is a clock time
  - 位置：`app/page.tsx:693-700`, `app/page.tsx:897`, `app/page.tsx:923-926`, `app/page.tsx:956`, `app/page.tsx:1150`, `app/page.tsx:527`, `app/api/market/route.ts:183-187`, `app/api/market/route.ts:264-267`, `app/api/market/route.ts:416-419`
  - 问题：The sidebar always shows 'DeepSeek Status: CONNECTED' with a pulsing green dot, and the quote badge always says 'Live Market'/'Live Market Data'. Every news item gets time: 'Live', and its source field holds providerPublishTime formatted with toLocaleTimeString([]) in the server's locale and timezone, with no date. Yahoo's publisher field is discarded, and the same source/timestamp values are sent to the AI for news analysis.
  - 建议：Map SearchNews.publisher to source and providerPublishTime to an ISO publishedAt, rendered on the client with Intl.RelativeTimeFormat in the UI language. Derive the quote badge from quote.marketState and regularMarketTime, and remove the status pill or back it with a /api/health check.
- **[MEDIUM · S]** The hand-rolled useSWR has race conditions, never clears errors and keeps polling in hidden tabs
  - 位置：`app/page.tsx:40-88`, `app/page.tsx:385-395`, `app/page.tsx:397-412`, `app/page.tsx:417`, `app/page.tsx:423`
  - 问题：Responses are never checked against the current key, `error` is never reset or read, the revalidateOnFocus option is ignored, and setInterval keeps running when the tab is hidden. The watchlist starts as ['NVDA','AAPL'] and is replaced from localStorage after mount, so two overview requests race and the one that finishes last wins. Every star toggle changes the key and wipes the overview data.
  - 建议：Switch to swr 2.3.8, which is already installed, with a fetcher that throws, keepPreviousData, and SWR's default behaviour for hidden tabs and focus. Hold back the market key until the watchlist is read (or read localStorage with useSyncExternalStore), and fetch the watchlist separately from the fixed sector list.
- **[MEDIUM · S]** Chat widget shows raw error bodies, sends on IME Enter, and never re-translates its welcome text
  - 位置：`app/page.tsx:1303-1307`, `app/page.tsx:1318-1336`, `app/page.tsx:1376`, `app/api/chat/route.ts:106-107`
  - 问题：sendMessage never checks res.ok, so a 500 streams {"error":"Chat failed"} into the assistant bubble. A failure mid-stream leaves a partial or empty bubble followed by an English '⚠️ Connection Failed'. Enter sends without checking isComposing, and the welcome message is stored once in state, so it keeps the first language after a toggle.
  - 建议：Send only when !e.nativeEvent.isComposing && e.keyCode !== 229. Check res.ok and show a translated error with Retry, build the welcome bubble from t at render time, and update the streaming message immutably instead of mutating it.
- **[MEDIUM · S]** <html lang='zh'> with an English default UI, and the language choice isn't saved
  - 位置：`app/layout.tsx:5`, `app/layout.tsx:7-10`, `app/layout.tsx:18`, `app/page.tsx:376-378`, `app/page.tsx:737-739`
  - 问题：The layout renders <html lang='zh'> with Chinese-only metadata, while the UI defaults to 'en'. The toggle never updates document.documentElement.lang, isn't saved, and ignores navigator.language. Inter loads only the latin subset.
  - 建议：Save the language in a cookie that layout.tsx reads to set lang ('en' or 'zh-CN') and generateMetadata, default from Accept-Language/navigator.language, and update documentElement.lang on toggle. Add a Chinese fallback font stack (PingFang SC, Microsoft YaHei, Noto Sans SC).
- **[MEDIUM · M]** Many user-facing strings bypass TRANSLATIONS, on both client and server
  - 位置：`app/page.tsx:303`, `app/page.tsx:353-356`, `app/page.tsx:737`, `app/page.tsx:854`, `app/page.tsx:871-874`, `app/page.tsx:944-946`, `app/page.tsx:956`, `app/page.tsx:1047`, `app/page.tsx:1150`, `app/page.tsx:1232`, `app/page.tsx:1264`, `app/page.tsx:1288`, `app/page.tsx:1336`, `app/api/market/route.ts:144`, `app/api/market/route.ts:186-187`, `app/api/market/route.ts:274-276`, `app/api/analyze/route.ts:128-130`
  - 问题：English is hard-coded in page.tsx: 'Chart data unavailable', Open/High/Low/Close, 'Switch Language', '{sector} News', 'DeepSeek Analysis' (although t.detail.analysis exists), '{symbol} News', 'Fetching latest headlines...', 'No Data', 'Waiting for analysis...', 'ANALYZING...' and '⚠️ Connection Failed'. The signal badge prints the raw label, and the Sector view titles use untranslated sector names. The API adds 'Awaiting Update', 'Live', English tags and Yahoo sector names, analyze injects English '[System Log]' lines into memos, and nine dictionary keys are never used.
  - 建议：Move all text into typed dictionaries (en declared as const, zh typed as typeof en). Map API values to keys (t.signal.labels[signal], t.sectors[name]) and have the API return codes such as earningsStatus: 'awaiting' instead of English text. Lint JSX literals with eslint-plugin-i18next.
- **[MEDIUM · S]** Chart hover presents estimated historical market cap and P/E as fact
  - 位置：`app/page.tsx:280-293`, `app/page.tsx:181-195`, `app/page.tsx:892-898`, `app/page.tsx:929-931`, `app/page.tsx:942`
  - 问题：On hover, the Market Cap and P/E cards are recalculated as today's value × (candle close / current price) and highlighted under a 'Historical View' badge, using inputs parsed back from the server's formatted strings. When marketCap is '-', the client's formatMarketCap(0) returns '0', which is a non-empty string and gets displayed.
  - 建议：On hover, show only the candle's OHLC, volume and % change and keep fundamentals at their current values. Otherwise label the estimates explicitly (e.g. '≈ at today's EPS') and fall back to '-' when inputs are missing.
- **[MEDIUM · M]** The candlestick chart has no axes, works only with a mouse and has no text alternative
  - 位置：`app/page.tsx:315-343`, `app/page.tsx:316`, `app/page.tsx:353-356`, `app/page.tsx:941-943`
  - 问题：The SVG draws grid lines, candles and moving-average lines but no price or date labels, and the 90-day range is never stated. Interaction uses only onMouseMove/onMouseLeave, and the svg has no role, title or aria-label.
  - 建议：Add price ticks on the right and date ticks along the bottom, formatted with Intl.DateTimeFormat. Switch to pointer events (onPointerMove/onPointerDown with touch-action: pan-y) and add arrow-key scrubbing on a focusable wrapper. Give it role='img' with an aria-label summarising the range, high and low, and a caption such as 'Daily candles · 90 days'.
- **[MEDIUM · S]** There is no navigation below the md breakpoint
  - 位置：`app/page.tsx:680`, `app/page.tsx:687-692`
  - 问题：The sidebar (hidden md:flex) is the only navigation, and there is no menu or bottom bar. On phones, Watchlist and the sectors can only be reached through the heatmap tiles (clickable divs), and stocks only through search or table rows.
  - 建议：Add a md:hidden bottom tab bar (Market, Watchlist, Sectors, Search) or a drawer that reuses NavItem, in the shared layout with pb-[env(safe-area-inset-bottom)].
- **[MEDIUM · M]** The header, detail cards and chat panel aren't sized for small screens
  - 位置：`app/page.tsx:608`, `app/page.tsx:709-743`, `app/page.tsx:906-920`, `app/page.tsx:1023-1049`, `app/page.tsx:1166-1178`, `app/page.tsx:1340-1342`
  - 问题：The h-16 header puts breadcrumbs, search, the language button and the AI button in one non-wrapping row (327px at 375px). The SignalCard header fits four blocks into about 285px, the text-5xl price row shares about 261px with the status badge, and heatmap titles grow to text-2xl/3xl inside tiles about 105px wide. The chat panel is a fixed 340x450px at bottom-6 right-6 (left edge at -44px on a 320px phone, top edge at -156px on an 844x390 landscape phone), and the root uses h-screen.
  - 建议：Below sm, make the AI and language buttons icon-only and move search to its own row or a sheet. Add flex-wrap to the SignalCard header and the price row, and cap heatmap font sizes below sm. Size the chat as w-[min(340px,calc(100vw-2rem))] h-[min(450px,calc(100dvh-7rem))] (or a full-screen sheet below sm), and replace h-screen with h-dvh (supported in Tailwind 3.4).
- **[MEDIUM · S]** Controls and streaming AI output have no accessible names, states or announcements
  - 位置：`app/page.tsx:713-715`, `app/page.tsx:733`, `app/page.tsx:737-739`, `app/page.tsx:911-913`, `app/page.tsx:1083-1095`, `app/page.tsx:1284-1294`, `app/page.tsx:1343-1379`
  - 问题：lucide-react 0.554 marks icons aria-hidden='true' (dist/esm/Icon.js:32), so the Back, watchlist toggle, chat open/close and send buttons have no accessible name. Inputs rely on placeholders, and the watchlist toggle, chat button and backtest period tabs expose no aria-pressed, aria-expanded or aria-selected. The AI box and chat list have no aria-live, role='log' or aria-busy.
  - 建议：Add translated aria-labels, aria-pressed on the watchlist toggle and aria-expanded/aria-controls on the chat button. Label the inputs (search inside <form role='search'>) and render the backtest periods as role='tablist'/'tab' with aria-selected. Give the chat list role='log' aria-live='polite', set aria-busy on the AI box while it streams, and make one polite announcement on completion or failure.
- **[MEDIUM · S]** Secondary text fails contrast and uses fixed 9-10px sizes; candle direction relies on hue alone
  - 位置：`app/page.tsx:695`, `app/page.tsx:733`, `app/page.tsx:772`, `app/page.tsx:780`, `app/page.tsx:822`, `app/page.tsx:1013`, `app/page.tsx:1031-1043`, `app/page.tsx:1139`, `app/page.tsx:1150`, `app/page.tsx:1178`, `app/page.tsx:1232`, `app/page.tsx:323`
  - 问题：slate-500 (41 uses) measures 3.63:1 on #161b22, 3.98:1 on #0d1117, 4.11:1 on #0a0c10 and 3.07:1 on the slate-800 chip. slate-600 (news source, search placeholder) is 2.28:1 and the slate-700 'No Data' is 1.67:1. Labels use text-[9px] 9 times and text-[10px] 15 times, heatmap averages have no '+' sign, and rising and falling candles differ only in hue (#34d399 vs #f43f5e, 1.91:1).
  - 建议：Use slate-400 (6.75:1 on #161b22) as the minimum for secondary text and slate-300 for text under 12px, defined as semantic tokens (text-muted, text-subtle). Make text-xs (0.75rem) the smallest size, prefix positive values with '+', and draw rising candles hollow.
- **[MEDIUM · S]** The focus indicator is weak and focus is not managed
  - 位置：`app/page.tsx:733`, `app/page.tsx:1376`, `app/page.tsx:712-716`, `app/page.tsx:1340-1379`, `app/page.tsx:632-667`
  - 问题：The search input uses focus:outline-none with a 1px indigo-500/50 ring and border that measure about 1.9:1 against their background (WCAG 1.4.11 needs 3:1), and the chat input also removes the outline. Going back to Overview unmounts the focused Back button, so focus drops to <body>. Opening chat doesn't move focus, Escape doesn't close it, and there is no skip link and no h1 on Overview, Sector or Watchlist.
  - 建议：Add a global :focus-visible outline (2px #818cf8, offset 2px) and remove focus:outline-none. Give every view an h1 and move focus to it (tabIndex={-1}) after navigation. Make the chat a non-modal dialog that focuses its input on open and closes on Escape, returning focus to the chat button.
- **[MEDIUM · L]** page.tsx is an 86 KB, 1,381-line client-side monolith
  - 位置：`app/page.tsx:371-674`, `app/page.tsx:707`, `app/page.tsx:1001-1016`, `app/page.tsx:368`
  - 问题：One 'use client' file holds 21 components, 7 hooks/helpers, the i18n dictionary, data fetching, AI streaming and navigation. The roughly 300-line root component owns all state and passes 18 any-typed props to Header. SignalCard declares FactorPill and StatCell inside render (the 12 react-hooks/static-components errors), and ChartComponent's memo compares only JSON.stringify(history), ignoring the price and P/E props.
  - 建议：Split by route and feature: app/(dashboard) routes with thin server pages; components/{layout,market,stock,signal,news,ai,chat,ui}; hooks/{useMarket,useQuote,useSignal,useWatchlist,useAiStream,useLocale}; lib/{i18n,format,api-client,server/{yahoo,deepseek}}; and types/api.ts. Use 'use client' only on interactive leaves, and move FactorPill/StatCell to module scope first, which takes minutes.
- **[MEDIUM · M]** No tests or CI, and lint already fails
  - 位置：`package.json:5-10`, `eslint.config.mjs:5-16`, `lib/signal.ts:130-470`, `lib/signal.ts:635-720`
  - 问题：The only scripts are dev, build, start and lint. There are no test files, no typecheck script and no .github workflows, and ESLint reports 97 errors across the repo (63 in page.tsx: 49 no-explicit-any, 12 static-components, 2 set-state-in-effect).
  - 建议：Add Vitest tests for lib/signal.ts (its factor functions are exported and pure) and the new format and i18n helpers, React Testing Library tests for loading, error and empty states, and one Playwright smoke test at 375px and 1440px with @axe-core/playwright. Run lint, tsc --noEmit, tests and build in a GitHub Actions workflow on every PR.
- **[LOW · M]** Numbers, currency and dates are formatted on the server, ignoring the UI language
  - 位置：`app/api/market/route.ts:146`, `app/api/market/route.ts:243-251`, `app/api/market/route.ts:370`, `app/api/market/route.ts:433-449`, `app/page.tsx:272`, `app/page.tsx:290`, `app/page.tsx:916`, `app/page.tsx:1146`
  - 问题：The API returns pre-formatted strings: toFixed(2) with no thousands separators, 'T/B/M' market caps and '+1.23%'. It formats earnings dates in the server's default locale (toLocaleDateString()), while the client tooltip uses the browser locale instead of the selected language. Prices get a hard-coded '$' whatever quote.currency is, and the client parses the strings back in several places.
  - 建议：Return raw numbers, ISO timestamps and the currency from the API, and format on the client with Intl.NumberFormat (currency, compact notation, percent with signDisplay) and Intl.DateTimeFormat, keyed by the UI language.
- **[LOW · S]** The idle AI panel is misleading, button and panel labels don't match, and memos are thrown away on navigation
  - 位置：`app/page.tsx:1264`, `app/page.tsx:741`, `app/page.tsx:871`, `app/page.tsx:452-455`, `app/page.tsx:487`
  - 问题：Every view shows an AI panel reading 'Waiting for analysis...' even when nothing is running. The only trigger is the header button, whose label doesn't match the panel (Sector view: button 'AI Deep Dive', panel 'Technology AI Scan'). Any view change wipes the result, while opening a news story starts a paid analysis automatically.
  - 建议：Put a Generate button with a one-line description inside the empty panel and use one label per view. Cache memos per view+ticker+lang with a timestamp and a Regenerate action, and don't start an analysis automatically when a news story opens.
- **[LOW · M]** Duplicated UI and server code, and the copies have already diverged
  - 位置：`app/page.tsx:821-836`, `app/page.tsx:855-870`, `app/page.tsx:1153-1229`, `app/page.tsx:1263-1282`, `app/page.tsx:1350-1368`, `app/page.tsx:571-580`, `app/page.tsx:1325-1335`, `app/page.tsx:190-195`, `app/api/market/route.ts:154-163`, `app/api/market/route.ts:438-443`, `app/api/signal/route.ts:8-13`, `app/api/analyze/route.ts:7-10`, `app/api/chat/route.ts:6-9`
  - 问题：The Sector and Watchlist tables are copy-pasted, SectorBlock and WatchlistBlock repeat the same average/sort logic, and the change-string parsing appears 7 times. There are two markdown renderers, two stream-reading loops, and client and server copies of formatMarketCap. The yahoo-finance2 require hack, getMetric, the OpenAI client and the ReadableStream wrapper are each duplicated across routes.
  - 建议：Extract StockTable, HeatTile, one Markdown component (or react-markdown with remark-gfm), readTextStream(), lib/format.ts, lib/server/yahoo.ts (a single YahooFinance instance via a normal import) and lib/server/deepseek.ts (the client plus toTextStream()).
- **[LOW · S]** The README and model doc are out of date and render poorly, and the branding is inconsistent
  - 位置：`README.md:35`, `README.md:45-51`, `README.md:55`, `README.md:73`, `README.md:81-89`, `README.md:106-122`, `README.md:134-136`, `docs/signal-model.md:40-41`, `docs/signal-model.md:106`, `docs/signal-model.md:188`, `app/layout.tsx:8`
  - 问题：The README says Next.js 14 and Node 18.17+, but next 16.0.4 needs Node >=20.9.0. It lists app/analyze, app/chat, app/market and next.config.mjs, claims a 5-second refresh (the overview polls every 30 s), has an empty Screenshots section, claims MIT without a LICENSE file, never mentions the Model Signal, and has no headings or code fences ('# or' renders as an H1). docs/signal-model.md disagrees with lib/signal.ts on the divergence penalty, negative P/E and sample size, and the tab title 'DeepSeek 智能投研助手' doesn't match the InvestSeek name used in the app.
  - 建议：Rewrite the README with real headings and fenced code blocks, and correct the versions, paths and refresh interval. Add screenshots, a LICENSE file and a 'Model signal' section linking the doc, update the doc's tables from the code constants, and use one product name in metadata, sidebar and chat.
- **[LOW · S]** Animation classes do nothing and custom-scrollbar is undefined
  - 位置：`app/page.tsx:768`, `app/page.tsx:814`, `app/page.tsx:852`, `app/page.tsx:903`, `app/page.tsx:954`, `app/page.tsx:1266`, `app/page.tsx:1342`, `app/page.tsx:825`, `app/page.tsx:859`, `tailwind.config.js:18`
  - 问题：animate-in, fade-in and slide-in-from-* come from tailwindcss-animate, which isn't installed (plugins: []), and custom-scrollbar isn't defined anywhere. The compiled CSS contains none of these rules, only the pulse and spin keyframes.
  - 建议：Either add tailwindcss-animate (with motion-safe: variants) or delete the classes. Define .custom-scrollbar in globals.css under @layer utilities, or remove it.
- **[LOW · S]** Unused dependencies, a stray Tailwind v4 plugin and a hard-coded colour palette
  - 位置：`package.json:12`, `package.json:18`, `package.json:20-21`, `package.json:25`, `postcss.config.mjs:3-6`, `tailwind.config.js:12-15`, `app/globals.css:6-9`
  - 问题：PostCSS runs the v3 tailwindcss plugin (3.4.19), while @tailwindcss/postcss 4.1.18 is installed but unused, and apexcharts, react-apexcharts, recharts and swr are never imported. tailwind.config.js maps background/foreground to CSS variables that are never declared (or used), and colours are hex literals in page.tsx (#161b22 ×15, #0d1117 ×6).
  - 建议：Remove @tailwindcss/postcss (or migrate fully to v4 with @import 'tailwindcss' and @theme), and drop the unused libraries (or adopt swr as recommended above). Move the colours into theme tokens such as bg-canvas, bg-surface, bg-panel and text-muted.
- **[LOW · S]** ETF rows look clickable but do nothing
  - 位置：`app/page.tsx:1145-1147`, `app/page.tsx:748`, `app/page.tsx:804`, `app/page.tsx:875`
  - 问题：EtfRow has cursor-pointer and hover styles but no onClick, and OverviewView receives onStockClick but never uses it.
  - 建议：Make the row a button or link that calls onStockClick(data.symbol), or remove the pointer and hover styles.
- **[LOW · S]** The watchlist can only be edited from a small unlabelled icon on the stock page
  - 位置：`app/page.tsx:911-913`, `app/page.tsx:826-833`, `app/page.tsx:397-406`, `app/api/market/route.ts:400-403`
  - 问题：The only add/remove control is a 28px icon-only button on the stock page (a '+' that turns into a filled star). The Watchlist table has no remove or reorder controls and no undo, and the API silently drops symbols that Yahoo no longer returns.
  - 建议：Use a labelled 'Add to watchlist / In watchlist' toggle with aria-pressed, add a remove button with an undo toast on each row, and list any symbols the API couldn't resolve.
- **[LOW · S]** Never-ending pulse animations ignore reduced-motion settings
  - 位置：`app/page.tsx:697`, `app/page.tsx:738`, `app/page.tsx:923`, `app/page.tsx:1252`, `app/page.tsx:1288`, `app/page.tsx:611`
  - 问题：animate-pulse runs forever on the status dot, on the end dot of every sparkline, on the hover badge and on 'ANALYZING...'. The globe rotates on hover and the main area uses scroll-smooth, with no motion-safe/motion-reduce variants and no prefers-reduced-motion rule in the compiled CSS.
  - 建议：Remove the pulse from the sparkline and status dots, use motion-safe:animate-pulse and motion-reduce:animate-none elsewhere, and put scroll-smooth and the rotate/scale effects behind motion-safe:.
