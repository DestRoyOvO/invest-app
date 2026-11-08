# InvestSeek design system

Source of truth: `app/globals.css` (tokens and text roles), `components/ui/**` (primitives) and this file. If they
disagree, the code wins and this file is the bug. `npx tsx scripts/check-contrast.ts` prints the measured contrast of
every token pair; `lib/design-tokens.test.ts` fails when a pair drops below its minimum or is listed twice.

## 中文摘要

- **配色语义**：红绿（`--up` / `--down`）只用于价格、涨跌幅和盈亏。模型读数、因子分位、风险一律用中性色；琥珀色
  `--accent` 只表示焦点、当前标记、功能代码和主要按钮。三种涨跌配色：绿涨（intl）、红涨（cn）、蓝涨橙跌（cb，色弱友好），
  由 `<html data-updown>` 切换，组件只用语义变量，所以自动跟随。
- **主题**：`data-theme` 支持 dark、light、system（跟随系统，纯 CSS，无闪烁）。浅色值只写一次，放在
  `@variant theme-light` 里，同时作用于 light 和"系统为浅色时的 system"。
- **字体**：数字用 IBM Plex Sans 的等宽数字（`.num`，比 Plex Mono 窄 11–14%），代码、功能代码、命令行和 OHLC 图例用
  Plex Mono（`.mono`）。面板标题 `.panel-title`（12px 600 大写），表头 `.col-head`（11px 500 大写，中文 12px）；
  `.label` 只留给键盘提示和代码。
- **布局**：页面用"列式"网格：`grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`，里面两个
  `flex flex-col gap-px` 的列，面板按内容自然高度排列，不再整行拉伸留白。DOM 顺序就是手机上的顺序；唯一的例外是报价页：
  640px 以下用 `order` 在视觉上重排面板，DOM 保持桌面顺序。各面板相互独立，含义和操作不依赖先后顺序（WCAG 1.3.2、
  2.4.3），而把面板挂载两次更糟，所以接受这种做法。
- **组件**：Panel（可带琥珀色功能代码）、DataTable（排序时文字按界面语言比较，中文名按拼音；aria-sort、行链接、悬停操作、
  加载/空状态，可关闭行悬停高亮，列可按视口隐藏，也可按表格自身宽度隐藏：`hideBelowContainer`，容器查询）、
  Segmented、Select、Switch、Field/Input、Checkbox、Badge/AiChip、Sparkline（中性线条 + 按当日涨跌着色的端点）、Delta（价格
  变动取旁边价格的小数位）与热力图分档（heatStep/heatStyle）、TickNumber（只闪变化的那个数字）、Whisker（置信区间须线，
  `neutral` 时整体变灰）、Meter（当前标记带 1px 面板色描边）、StatTile（以标签命名的 group）、HoverCard/Tooltip、
  Toast（可撤销）、Drawer（右侧或底部，打开时提示条显示在抽屉内）、EmptyState（左对齐 + 快捷代码按钮）、Wordmark。
- **无障碍**：文字对比度 ≥ 4.5:1、图形 ≥ 3:1（两套主题、三种配色全部实测通过，含悬停状态；带透明度的颜色先按透明度
  叠加到底色上再测，如评级色阶 `bg-fg/85` 到 `/50`）；`--fg-3` 只用在面板上，直接放在画布上的文字用 `--fg-2`；桌面点击区
  ≥ 24px、手机 ≥ 40px：Button、IconButton、Segmented、Select、Tabs、Input 在手机上自带 40px 高度，页面不再加覆盖
  （conventions.test.ts 会拦下这类覆盖；可排序表头整格可点）；面板标题栏最少 36px，在手机上随 40px 控件长高，所以标题栏里的
  控件在手机上也留在标题栏；紧凑密度下行内小图标按钮为 24px，带操作的行也保持约 24px；可排序表头带 aria-sort；表格横向或
  纵向放不下时，滚动框成为以表格标题命名、可用 Tab 聚焦的区域，方向键即可滚动，所以表格标题要描述表格内容，不能与所在
  面板或分区的名称相同（lib/i18n/captions.test.ts 和 conventions.test.ts 检查）；Esc 只关闭最内层（先关悬停卡片，再关
  抽屉）；提示条在悬停或键盘焦点时暂停，键盘关闭后焦点移到下一条或回到原处；抽屉打开时提示条移到抽屉里自己的一栏（侧栏在
  内容与底栏之间，底部弹层在顶部），不遮挡抽屉的输入框和按钮，仍可用 Tab 操作并被读屏播报；提示条来去时抽屉内容在屏幕上
  保持不动（底部弹层到达高度上限后，内容滚动同样的距离），被这一栏挡住的焦点控件会滚回视野；提示条的关闭按钮叫"关闭提示"，
  与抽屉的"关闭"区分；实时更新用礼貌型 live region；尊重"减少动态效果"。
- **缺失值**：一律显示 `lib/format.ts` 的 `DASH`（U+2014），格式化函数遇到 null 也返回它；不用 U+2013、连字符或
  "N/A"。它只是数据占位符，文案里仍然不用破折号。
- **非价格的正负读数**（相关系数、z 分数、因子倾向）：只按绝对值深浅着色，用一种中性色阶并标出带符号的数字，不用红绿或
  热力图分档。

## Principles

1. **Data is the only loud thing.** Chrome is hairlines and quiet text; numbers, prices and the one current marker carry
   the contrast.
2. **Color has one meaning per hue.** Red and green mean a price went up or down, nothing else.
3. **Terminal, not code editor.** Mono is for anchors (tickers, codes, the command line). Everything else, numbers
   included, is IBM Plex Sans.
4. **Honest states.** Loading, empty, stale and failed are shown as such, with what to do next.
5. **Tokens, not values.** Components use semantic tokens; a new theme or convention only touches `app/globals.css`.

## Runtime switches

Three attributes on `<html>` switch everything at runtime, without a reload:

| Attribute | Values | Effect |
| --- | --- | --- |
| `data-theme` | `dark`, `light`, `system` | Surfaces, text, accent and every ramp. `system` follows `prefers-color-scheme` in pure CSS. The `:root` values are dark. |
| `data-updown` | `intl` (green up), `cn` (red up), `cb` (blue up, orange down) | `--up`, `--down`, the heatmap steps, and `--series-1` in `cb`. |
| `data-density` | `comfortable`, `compact` | `--row-h` 32px to 24px, `--text-data` 13px to 12px, small icon buttons 28px to 24px (from `sm` up). |

`lib/prefs.ts` keeps all three in cookies, so the server renders the attributes on the first paint (no flash), and the
settings menu (`components/shell/SettingsMenu.tsx`) switches them at runtime. Without cookies a visitor gets the
`system` theme, the price colors of their language (`cn` in Chinese, `intl` otherwise) and the `comfortable` density.

To add a token: declare the dark value on `:root` and the light value inside the `@variant theme-light` block right below
it, then expose it to Tailwind in `@theme inline` if components need a utility. The variant writes the light value once
and Tailwind expands it to `:root[data-theme="light"]` and to `:root[data-theme="system"]` inside
`@media (prefers-color-scheme: light)`. Never use the raw hues (`--green`, `--red`, `--blue`, `--orange`) in components.

## Tokens

All colors are CSS variables with a Tailwind utility of the same name (`bg-panel`, `text-fg-3`, `border-input-border`).

### Surfaces

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--canvas` | `#06080b` | `#e4e8ed` | Page background, visible in the 1px gaps between panels |
| `--panel` | `#0c0f13` | `#ffffff` | Panel body |
| `--panel-2` | `#11151a` | `#f5f7f9` | Panel and drawer headers, table footers, the current row, toasts |
| `--hover` | `#161b21` | `#eef1f4` | Hovered rows and controls |
| `--line` | `#1d232b` | `#dde2e8` | Hairlines, page grid gaps, skeletons |
| `--line-2` | `#2a313b` | `#c6cdd5` | Stronger rules, tracks (meter, whisker), dashed baselines |
| `--input-bg` | canvas | panel | Field background: recessed in dark, white in light |
| `--input-border` | `#5f6a7a` | `#7b8794` | Inputs, selects, checkboxes, the command button (3.3:1 or more on panels) |

### Text

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--fg` | `#e6e9ed` | `#0e1318` | Values, titles, typed text |
| `--fg-2` | `#a9b2be` | `#39424d` | Secondary text: names, descriptions, prose |
| `--fg-3` | `#7d8897` | `#646d7b` | Labels, column heads, meta, placeholders, disabled buttons |

The light `--fg-3` is `#646d7b` rather than the audit's `#687180`: the latter measured 4.35:1 on the hover row. It is
4.6:1 on `--hover`, 4.9:1 on `--panel-2` and still 1.95:1 apart from `--fg-2`, so the two stay distinct.

`--fg-3` is for text on panels. It is only 4.25:1 on the light `--canvas`, so text placed straight on the canvas (the
404 page, anything outside a panel) uses `--fg-2` (8.3:1) or `--fg`.

### Accent and status

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--accent` | `#f2a33a` | `#965800` | Focus ring, the current marker, function codes, primary buttons, selected tab underline |
| `--accent-fg` | `#140d02` | `#ffffff` | Text on an accent fill |
| `--accent-soft` | 13% accent | 7% accent | Active icon buttons, accent badges |
| `--info` | `#5aa9f0` | `#1f6fc4` | Links, info badges, chart series 1 |
| `--warn` | `#e3b341` | `#8a5f00` | Stale data, caveats such as "No reliable edge" |
| `--danger` | red | red | Errors. Stays red in every price convention |

The light accent is dark enough for accent text on every surface it meets: 5.0:1 on a hovered row (ticker links turn
accent there), 4.8:1 for an accent badge in a panel header and 4.6:1 for one on a hovered row.

### Price direction

| Token | intl | cn | cb dark / light |
| --- | --- | --- | --- |
| `--up` | green | red | `#4ea1ff` / `#1a63b0` |
| `--down` | red | green | `#ff9f43` / `#a65400` |

Raw hues per theme: `--green` (`#2fbf71` / `#0b7d43`), `--red` (`#f0525a` / `#c4252f`), `--blue` and `--orange` as
above.

### Heatmap steps

`heatStep(changePercent)` returns -4 to 4: flat below 0.10%, then edges at 0.10, 0.75, 1.75 and 3.5%. `heatStyle(step)`
returns `{ background, color }` from these tokens:

| Step | Background | Text |
| --- | --- | --- |
| 0 | `--heat-flat` (`#262c33` / `#eceff2`) | `--heat-fg` |
| ±1, ±2, ±3 | `--heat-up-N` / `--heat-down-N` | `--heat-fg` (light text in dark, dark text in light) |
| ±4 | `--heat-up-4` / `--heat-down-4` (the full hue) | `--heat-fg-strong` (canvas in dark, white in light) |

The semantic `--heat-up-N` / `--heat-down-N` map to `--heat-green-N`, `--heat-red-N`, `--heat-blue-N` or
`--heat-orange-N` by convention. Neighbouring steps are 0.057 to 0.30 apart in OKLab (the old linear tint put +2.8% and
+11% 0.013 apart), and every tile text is 4.88:1 or more.

### Charts and glyphs

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--spark` | fg-3 | fg-2 | Sparkline stroke (neutral; only the end dot is colored) |
| `--series-1` | info `#5aa9f0` | info `#1f6fc4` | MA20, first comparison. `var(--fg)` in the `cb` convention so it never reads as "up" |
| `--series-2` | `#c792ea` | `#7b4bb7` | MA50, second comparison |
| `--series-3` | `#2ec4b6` | `#008b80` | MA200, third comparison |
| `--series-4` | `#e8dca8` | `#94821e` | Fourth overlay |
| `--series-5` | `#f075b5` | `#b8327a` | Fifth overlay |
| `--series-6` | `#b9c2cc` | `#3f4853` | Benchmark (deliberately neutral) |

Series colors are identity, never direction or quality. Always show a legend. Series 1 and 2 (blue and violet) look
alike to people with red-green color blindness, so draw series 2 dashed when both are on screen; series 3 to 6 keep
adjacent pairs at least 15 apart (OKLab x100) for normal vision. Never use red, green or amber for a series.

### Type scale

| Token | Size / line | Utility | Use |
| --- | --- | --- | --- |
| `--text-micro` | 11 / 16 | `text-micro` | Column heads, panel meta, the "1M" tag |
| `--text-xs` | 12 / 16 | `text-xs` | Supporting text: small controls (`size="sm"`), field labels and hints, tabs, chips, status lines, and a quieter line beside a name, such as the quote header's English name after a Chinese one (`text-fg-3`, `lang="en"`) |
| `--text-data` | 13 / 20 (12 / 16 compact) | `text-data` | Tables and number-heavy rows |
| `--text-sm` | 14 / 20 | `text-sm` | Interface text: controls (`size="md"`), menus, empty states, names in headers (the quote header's name) |
| `--text-body` | 14 / 22 | `text-body` | Prose: AI notes, news summaries |
| `--text-base` | 16 / 24 | `text-base` | The command bar's and the 404 page's text fields on phones (`max-sm:text-base`: iOS zooms into a field with smaller text), the quote header's changes |
| `--text-figure` | 20 / 24 | `text-figure` | Board values, KPI tiles, portfolio value |
| `--text-display` | 30 / 36 | `text-display` | The quote price, one headline number per view |

`text-xs`, `text-sm` and `text-base` are Tailwind's own sizes; `app/globals.css` adds the other five. The quote header's
English name steps back one size and one ink from the name before it: `text-xs text-fg-3` after `text-sm text-fg-2`,
with `lang="en"` so screen readers read it as English.

### Density

`--row-h` (32px, 24px compact) drives table rows through the `h-row` utility; `--text-data` shrinks with it. DataTable
uses both, so tables follow the setting with no extra code. Use `h-row` for any custom table row.

## Text roles

| Class | Face | Use |
| --- | --- | --- |
| `.num` | Plex Sans, `tabular-nums lining-nums` | Every number: prices, changes, volumes, dates in tables |
| `.mono` | Plex Mono, tabular | Tickers, function codes, the command line, the OHLC legend, currency codes |
| `.panel-title` | Plex Sans 600, 12px caps, 0.04em, `--fg` | Panel and drawer titles (Panel and Drawer apply it) |
| `.col-head` | Plex Sans 500, 11px caps, 0.04em, `--fg-3` | Table column heads, stat and KPI labels. 12px without tracking in Chinese |
| `.label` | Plex Mono 12px caps, `--fg-3` | Keyboard hints and codes only (G W, SPX). Not for titles or headers |

Plex Sans figures are fixed width, so columns still align, and they set 11 to 14% narrower than Plex Mono. Tickers stay
mono as visual anchors. Display negatives with the true minus (U+2212): `Delta` does it, and `withTrueMinus(text)` does it
for text you format yourself.

**Missing values.** A value that is missing (null, not a number, not loaded or not reported) shows `DASH` from
`lib/format.ts`: U+2014, the em dash. The formatters in `lib/format.ts` already return it for null, and `TickNumber`
falls back to it, so import `DASH` rather than typing the character. A missing value is never U+2013 (en dash), a
hyphen, "N/A" or an empty cell. The em dash is a data placeholder only: copy never uses dashes (CONTRIBUTING).

Row actions must fit the row too: `IconButton size="sm"` is 28px, and 24px from `sm` up in the compact density, so a
compact row with actions measures 24.5 to 25px (the button plus half of each collapsed hairline) instead of 29px.
Keep larger controls out of table rows. For other density-specific styles use the `compact:` variant, for example
`sm:compact:size-6`; keep phone touch targets at 40px.

## Color rules

1. `--up` and `--down` only for prices, returns and P&L (Delta, TickNumber flashes, sparkline end dots, candles, the
   heatmap). Never for model readings, factor scores, percentiles, risk levels or verdicts.
2. Readings, percentiles and risk use neutral ink: `Meter`, `--fg-2` / `--fg-3`, at most `--info`. Caveats use `--warn`
   with words.
3. `--accent` marks focus, the current item (the current row dot, the meter marker, a selected tab) and function codes.
   One accent element per group.
4. Errors use `--danger` with words and an icon; never a color alone.
5. Text never takes a series color; a swatch or line key next to the text carries identity.
6. Signed readings that are not prices (correlations, z-scores, factor tilts) shade by magnitude only, with one
   neutral ramp, and print the signed number in `--fg`: for example
   `background: color-mix(in oklab, var(--info) N%, var(--panel))` with N = |r| x 40, which keeps `--fg` above 7:1 in
   both themes. Never the heat steps: a red/green or blue/orange diverging scale reads as price direction in one of
   the three conventions.

## Layout: column flow

Pages are one grid with two independent column stacks. Panels keep their natural height, so no panel stretches to the
tallest one in its row.

```tsx
<div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
  <div className="flex min-w-0 flex-col gap-px">
    <PriceChart symbol={symbol} />
    <SignalPanel report={report} />
    <ResearchNote title={t.stock.aiNote} request={request} />
  </div>
  <div className="flex min-w-0 flex-col gap-px">
    <KeyStats stats={stats} quote={quote} />
    <Panel title={t.stock.news} code="NEWS">...</Panel>
  </div>
</div>
```

- DOM order is the phone order (one column below xl): put what a phone user needs first first.
- The quote page is the one exception (decision Q-3). Below 640px its overview panels are reordered visually
  (`max-sm:order-*` in `StockView.tsx`: chart, news, AI note, key statistics, risk, earnings, signal, factors, analysts,
  notes, company) while the DOM keeps the desktop order (the chart, signal, risk, factors, AI note and notes column, then
  key statistics, earnings, analysts, news and company). This is accepted because the panels are independent: none
  refers to another or needs another read first, and each panel's own content and focus order are untouched, so meaning
  (WCAG 1.3.2) and operation (2.4.3) do not depend on the order. Mounting the panels twice, once per order, would be
  worse: twice the requests, the live regions and the focusable controls. Do not copy it elsewhere; order the DOM.
- No `row-span`, no `h-full` on panels. A panel that should fill space (the heatmap) gets `bodyClassName="flex flex-col"`
  and a `min-h-[420px] flex-1` child.
- Cap long or streaming bodies: `max-h-[min(70vh,720px)] overflow-y-auto`.
- Full-width bands (quote header, KPI strips) sit above the grid or span both columns with `xl:col-span-2`.

## Panel codes

`<Panel code="GP">` shows a Bloomberg-style function code as a small amber mono chip before the title. Codes are 2 to 4
capital letters and decorative for screen readers. The function registry in `lib/functions.ts` is the source of truth:
a panel shows the code of the function that covers its subject, which the command bar accepts (the overview's My day
panel shows PORT, the watchlist page's Upcoming panel EVTS). These are the codes in use:

| Panel | Code | Panel | Code |
| --- | --- | --- | --- |
| Markets board (overview, world markets) | WEI | Price chart | GP |
| Rates and curve | GC | Key statistics, financials | FA |
| Sector performance | SECT | Company profile | DES |
| Screener | EQS | Earnings | ERN |
| Market-wide discover | MOST | Analysts | ANR |
| Watchlist | WL | Dividends | DVD |
| Positions, my day, portfolio analytics | PORT | Ownership | HDS |
| Correlation | CORR | Risk forecast | RISK |
| Events calendar, week ahead, upcoming | EVTS | Factor lab | LAB |
| Alerts | ALRT | Your data | DATA |
| Notes | NOTE | Help | HELP |

Panels whose subject has no function carry a label-only code, which the command bar does not accept:

| Panel | Code | Panel | Code |
| --- | --- | --- | --- |
| Sector heatmap | HMAP | Model signal | SIG |
| Movers | MOV | Factor profile | FCT |
| Headlines, company and sector news | NEWS | Sector constituents | MEMB |
| Breadth | BRTH | Sector ETF returns | ETF |
| Currencies, commodities, crypto | FX, CMDT, CRYP | AI note, scan or brief | AI |

A new panel reuses the code of the function that covers its subject; a new label-only code must not collide with a
registry code or alias.

## Primitives

All live in `components/ui`. Each has a doc comment; the snippets show the common case. Some message keys in the
snippets (for example `t.common.undo`) are placeholders: use the feature's own key.

**Phone sizes.** The controls bring their own 40px phone target: below `sm`, Button (both sizes), Segmented, Select,
Tabs and Input take a 40px minimum height (`PHONE_TARGET` in `Button.tsx`) and IconButton is 40px square; from `sm` up
they keep their desktop sizes. Pages add no `max-sm:h-10` (or `[&_[role=radio]]:max-sm:h-10`, `[&>select]:...`) to
them: `conventions.test.ts` fails on such an override. Elements that are not these primitives keep their own phone
height: a raw element styled as a control (filter and tag chips, a link styled as a button, the chart's range picker)
and Switch and Checkbox rows, which have no built-in target. A Panel header grows to fit them, so header controls stay in
the header on phones too.

### Panel, PanelMeta, PanelCode

```tsx
<Panel title={t.market.heatmap} code="HMAP" actions={<HeatLegend />} bodyClassName="flex flex-col">
  ...
</Panel>
<Panel title={t.watchlist.title} code="WL" actions={<PanelMeta>{tpl(t.watchlist.count, { n })}</PanelMeta>}>...</Panel>
```

The header is 36px on `--panel-2` with a hairline under it. The 36px is a minimum: on phones a header that holds a 40px
control grows to fit it instead of letting the control cover the hairline. `title` may be omitted for headless panels.

### Button, IconButton

```tsx
<Button variant="primary" onClick={save}>{t.portfolio.save}</Button>
<Button size="sm">{t.common.cancel}</Button>
<IconButton size="sm" label={tpl(t.watchlist.remove, { symbol })} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={remove} />
```

One primary button per view. A disabled primary turns gray (`--fg-3` on `--panel-2`), never half-transparent amber.
Button is 28px (`sm`) or 32px (`md`) on desktop and at least 40px tall below `sm`; `touchTarget={false}` keeps the
desktop height on phones and is only for a container that cannot fit 40px (the 32px ticker strip). IconButton is 28
or 32px on desktop and 40px below `sm`; `size="sm"` drops to 24px from `sm` up in the compact density. `active` marks
an open menu or a pressed toggle.

### Badge, Kbd, AiChip

```tsx
<Badge tone="warn">{t.signal.track.verdict.none}</Badge>
<Kbd>/</Kbd>
<Button variant="secondary"><AiChip tone="current" />{t.ai.generate}</Button>
```

Badges are sans 600 11px caps. `up` / `down` tones only for price or P&L. AiChip replaces sparkle icons: `accent`,
`muted` (unavailable) or `current` (inherits the button text color). The chip already says AI, so the text after it
drops the word ("[AI] ready", not "[AI] AI ready"); the accessible name then still starts with the visible text.

### Tabs and Segmented

```tsx
<Tabs label={t.stock.chart} value={range} onChange={setRange} options={ranges} />
<Segmented label={t.settings.colors} value={updown} onChange={setUpdown} options={[...]} size="sm" />
```

Tabs switch views inside a panel (in a hairline bar under its header) or a page; they are 36px (`sm`) or 40px (`md`)
tall. Segmented picks one of two to four settings (radiogroup, one tab stop, arrows, Home and End); segments are 28px
(`sm`) or 32px (`md`). Use `hideLabel` inside headers. Both are at least 40px tall below `sm`.

### Field, Input, Textarea, Select, Checkbox, Switch

```tsx
<Field label={t.portfolio.shares} hint={hint} error={error}>
  <Input inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} />
</Field>
<Field label={t.port.benchmark}>
  <Select className="w-full" value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>...</Select>
</Field>
<Checkbox label={t.screener.etfs} checked={etfs} onChange={(e) => setEtfs(e.target.checked)} />
<Switch label={t.settings.compact} checked={compact} onCheckedChange={setCompact} />
```

Field wires the label, `aria-describedby` (hint and error) and `aria-invalid` into its control. Controls use
`--input-bg` and `--input-border`; focus adds an accent border and ring; an invalid control has a red border and the
error text below. Input and Select are 28px (`sm`) or 32px (`md`) on desktop and at least 40px tall below `sm`. Switch
applies at once; Checkbox is for forms that submit.

### Delta, heatStep, heatStyle, HeatLegend

```tsx
<Delta value={q.changePercent} />                       // +1.35% / −0.52%, colored by direction
const digits = priceDigits(q.symbol, q.quoteType);      // the price's decimals, or null
<Delta value={q.change} kind="change" digits={digits ?? undefined} lang={lang} />
<div style={heatStyle(heatStep(q.changePercent))}>...</div>
<HeatLegend />                                           // −3.5 [9 swatches] +3.5%
```

A change takes the decimals of the price beside it: format the price with `formatQuotePrice(price, digits, lang)` and
pass the same `digits` from `priceDigits(symbol, quoteType)` (`lib/quote-figures.ts`) to the `kind="change"` Delta. A
currency pair keeps its pips (USD/JPY at 158.425 moved +0.770, not +0.77), a yield its three decimals and a world-board
instrument the board's digits. Where `priceDigits` is null (stocks and funds, for example), leave `digits` out: the
change then follows `formatChange`, 2 decimals or 4 for a sub-cent move.

`directionOf(value)` gives `"up" | "down" | "flat"` for glyph tones.

### Sparkline

```tsx
<Sparkline data={spark} width={64} height={18} tone={directionOf(q.changePercent)} />
<span className="text-micro text-fg-3">{t.columns.trend}</span>
```

Neutral 1.25px stroke; the end dot (radius 2.5) takes the direction of the day, so the line never contradicts the
number beside it. `baseline` adds a dashed line at the first value. Label the period ("1M") next to it on cards.

### TickNumber and useTickFlash

```tsx
<TickNumber value={q.price}>{formatPrice(q.price, lang)}</TickNumber>
const ref = useTickFlash<HTMLTableCellElement>(q.price);   // for a custom element
```

Flashes only the value that changed, for 600ms, green or red by direction. Never on first render, never for unchanged
values, off with reduced motion. Use it for last price, change and P&L cells.

### Whisker

```tsx
<Whisker estimate={row.hitRate} low={row.hitCI[0]} high={row.hitCI[1]} base={base.hitRate} min={0.3} max={0.7}
  label={tpl(t.signal.whisker, { hit, lo, hi, base })} />
```

72x12 interval glyph: track, 1px base-rate tick, 1px interval line and an estimate dot (radius 3). The dot turns accent
only when the interval excludes the base rate. `label` (the exact numbers in words) is required. Narrow `min`/`max` so
the interval is visible. `neutral` greys the whole glyph (interval and dot in `--fg-3`, never accent) for a row the color
rules grey out, such as a reading concentrated in too few episodes: pass it wherever the row text turns `--fg-3`.

### Meter and StatTile

```tsx
<Meter value={factor.percentile} marker={50} label={t.lab.momentum} valueText={tpl(t.lab.pct, { n })} />
<div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
  <StatTile label={t.portfolio.portfolioValue} value={formatNumber(value, 2, lang)} delta={<Delta value={dayPct} />} sub={costLine} />
</div>
```

Meter is a neutral 0 to 100 bar with a midline and an optional accent marker (role="meter"). The marker has a 1px
`--panel` halo (`shadow-[0_0_0_1px_var(--panel)]`, as on the risk band), so it stays visible where it sits on the
`--fg-3` fill: accent on `--fg-3` is about 1.1:1 in the light theme. StatTile is one KPI: column-head label, 20px
figure (30px with `size="lg"`), optional delta and sub-line. The tile is a `role="group"` labelled by its label
(`aria-labelledby`, an id from `useId`), so a screen reader names the figure it enters and a spec finds the tile with
`getByRole("group", { name })`. Give the tiles of one page distinct labels, so no two groups share a name.

### DataTable

```tsx
const columns: DataTableColumn<Quote>[] = [
  { key: "symbol", header: t.columns.symbol, width: "5.5rem", render: (q) => <span className="mono font-medium text-fg">{q.symbol}</span>, sortValue: (q) => q.symbol },
  { key: "name", header: t.columns.name, render: (q) => <span className="text-fg-2" title={q.name}>{q.name}</span>, hideBelow: "sm" },
  { key: "last", header: t.columns.last, align: "right", width: "5.5rem", render: (q) => <TickNumber value={q.price}>{formatPrice(q.price, lang)}</TickNumber>, sortValue: (q) => q.price },
  { key: "chg", header: t.columns.changePct, align: "right", width: "5rem", render: (q) => <Delta value={q.changePercent} />, sortValue: (q) => q.changePercent },
];

<DataTable
  rows={quotes}
  columns={columns}
  rowKey={(q) => q.symbol}
  caption={t.watchlist.quotesCaption}
  rowHref={(q) => stockPath(q.symbol)}
  rowActions={(q) => <IconButton size="sm" label={tpl(t.watchlist.remove, { symbol: q.symbol })} icon={<X className="size-3.5" />} onClick={() => remove(q.symbol)} />}
  loading={!data}
  empty={<EmptyState chips={starters}>{t.watchlist.empty}</EmptyState>}
/>
```

- Widths come from a `<colgroup>`; give number columns fixed widths (last 5.5rem, change 4.5rem, change % 5rem, volume
  5.5rem, market cap 5.25rem, P/E 3.75rem, trend 6.5rem) and leave the name column free so it takes the rest.
- Columns hide below a viewport breakpoint (`hideBelow: "sm"`) or while the table's own box is narrower than a container
  size (`hideBelowContainer: "md"`; Tailwind's `@` sizes: 3xs 16rem, 2xs 18rem, xs 20rem, sm 24rem, md 28rem, lg 32rem,
  xl 36rem, 2xl 42rem, 3xl 48rem). Use the container size for a table that can sit in the 22rem right-hand column at xl,
  a box of 356px at 1280px and 410px at 1440px, where `hideBelow` only sees a wide viewport: the overview's watchlist
  drops its 1M line below `sm` (its four columns need 360px), Trending drops the price below `md` so the names keep
  room, and the analyst actions hide their date column below `md`. The wide left-hand column at xl is a box of 713px at
  1280px and 819px at 1440px: Discover's movers and ideas tables hide their 120px rating below `3xl`, which left the
  names 13 and 29px at 1280px (133 and 149px without it). They show it wherever the table is at least 48rem wide: in
  that column from about 1363px (names 68 and 84px there, 119 and 135px at 1440px) and in the single column below xl
  from about 834px (958px at 1024px); the 702px single column at 768px hides it, as phones do. The container size takes
  the place of `hideBelow`. When a column uses it, the scroll box becomes the query container (`@container`), so cells
  can carry container classes too: the analyst actions show the date under the firm with `@md:hidden`. A table whose
  cells adapt while every column stays makes its box the container itself with `className="@container"`: the reported
  quarters on the quote page set the report date after the quarter, and under it with `@max-sm:block` below `sm` (the
  quarter column gets 104px at 1280px and 106px on 360px phones; "3Q2025 10月30日" needs 127). A footer row a caller
  builds hides its cells with `hideClass(column)`. The compact world tables (currencies, commodities, crypto) keep all
  four columns at 1280px and let a long name truncate ("EUR/U…", "欧元/…"): the code beside it (EURUSD) stays whole and
  says the same.
- Sorting: a header click cycles the column's first direction (descending for right-aligned columns), the opposite, then
  the natural order. `aria-sort` marks the sorted header. Missing values sort last both ways; equal values keep their
  `tieBreak` order, then their original order. Pass `sort`/`onSortChange` to control it, for example to keep a
  watchlist's custom order as the unsorted state. The sort button fills its whole header cell (32px tall, 40px below
  `sm`), so even a narrow "P/E" head is an easy target.
- Text columns sort in the app language, whatever the browser's: DataTable passes the language's collator to `sortRows`
  (`htmlLang(lang)`: `zh-CN` in Chinese, `en` otherwise), so Chinese names sort in pinyin order (埃克森美孚, 苹果, 微软, 英伟达)
  before names in Latin letters, and numbers within text in natural order ("A2" before "A10"). A name column sorts by
  the name it shows (`sortValue: (q) => displayName(q.symbol, q.name, lang)`), not by the English name behind it. Rows
  listed outside the table follow the same rules: the screener's CSV takes its order from `sortScreenRows`, which uses
  the table's sort values (`screenSortValue`) and collator, so the file lists the rows as the table shows them.
- `rowHref` makes the row clickable (Ctrl or Cmd opens a new tab) and renders the first cell as a real link.
- `rowActions` are revealed on hover and keyboard focus and always shown on touch screens. The column is
  `actionsWidth` wide (4.5rem) and `actionsTouchWidth` (5.5rem) below `sm`, where icon buttons grow to 40px. Its head
  is an empty `aria-hidden` cell: each action names its row ("Remove AAPL").
- Rows highlight on hover. `rowHover={false}` turns that off for rows that are not links and carry status colors
  measured on `--panel` (the data import review and the restore diff); `rowClassName` still adds classes per row.
- `stickyHeader` with `maxHeight` keeps the header visible while the body scrolls; `minWidth` scrolls horizontally on
  phones instead of squeezing.
- The scroll box is positioned (`relative`), so the rows' absolutely positioned sr-only text stays inside it: rows
  scrolled out of a `maxHeight` box no longer stretch the page with blank space. While the table overflows the box
  (wider than `minWidth` allows, or taller than `maxHeight`), the box is a focusable region named by the caption
  (`role="region"`, `tabIndex={0}`), so keyboard users can scroll it with the arrow keys; when everything fits it adds
  no tab stop. Its focus ring sits inside the box, or just outside it with `stickyHeader`, whose cells would cover the
  top of an inset ring. A caller that scrolls the table in its own wrapper turns the box off with
  `className="overflow-x-visible!"`, and the box then never becomes a region. The caption names that region, so it
  describes the table and never repeats the name of the panel or section around it, in either language: two regions of
  one name are an axe landmark-unique violation. Give the caption its own key next to the title: the alerts page
  captions its tables "Alert rules" and "Alert history" inside the Rules and History panels, the watchlist page "Watchlist
  quotes" and "Positions with value and P&L", world markets "Benchmarks in the Americas" under the Americas heading and
  "Currency rates" in the Currencies panel, and the sector page "Information Technology constituents".
  `lib/i18n/captions.test.ts` keeps each caption apart from its panel title, and `components/ui/conventions.test.ts`
  fails when a page passes the `title` of a Panel (or the `aria-label` of a section) in the same file as the caption of
  a DataTable, QuoteTable, WatchlistTable or WorldTable. To check a page, force every table to overflow
  (`table.table-fixed { min-width: 1600px }` or a 360px viewport) and run axe: landmark-unique must not fire.

### HoverCard and Tooltip

```tsx
<HoverCard side="top" content={<QuoteCard quote={q} />}>
  <Link href={stockPath(q.symbol)}>{q.symbol}</Link>
</HoverCard>
<Tooltip label={t.help.wl}><IconButton label="WL" icon={...} /></Tooltip>
```

No library. The child must be one focusable element. The card opens after 200ms on hover or at once on keyboard focus,
renders in a portal (overflow cannot clip it), flips and clamps to the viewport, links itself with
`aria-describedby`, stays open while hovered and closes on Escape or blur. Escape closes only the card: a Drawer or
menu around it stays open until the next Escape. Touch screens get no hover: never put the only copy of a number in a
hover card.

### Toast

```tsx
const toast = useToast();
toast.show({ message: tpl(t.watchlist.removed, { symbol }), action: { label: t.common.undo, onAction: () => add(symbol) } });
```

`ToastProvider` is mounted in `components/providers/Providers.tsx`. Toasts sit above the phone tab bar or the status
bar, in a polite live region, at most three at a time; they close after 5s (8s with an action). The countdowns pause
while the pointer is over the toasts or keyboard focus is inside them, and resume with the time that was left (at
least 1.5s). When a toast closes under keyboard focus (Undo, Dismiss), focus moves to the toast that took its place, or
back to where it was before the toasts. The list and countdowns live in `createToastStore` (`toast-queue.ts`, unit
tested). A toast's action and its Dismiss button (the X) are described by its message (`aria-describedby`), so they say
what they act on. Dismiss is not called Close (`t.common.dismiss`), so it differs from the Close of a drawer the toast
sits in, for a screen reader's list of buttons and for voice control alike.

While a Drawer is open the toasts show inside it, in the `ToastOutlet` the Drawer renders: a strip of their own in the
dialog's layout. There they cover none of the drawer's fields or buttons, stay reachable with Tab (the drawer traps
focus) and are announced (under `aria-modal`, assistive technology may ignore a live region outside the dialog). In a
side panel the strip sits between the content and the footer, and the content gives up the room at its bottom edge.
In a bottom sheet it sits at the top (after the content in the reading and Tab order), and the sheet grows past 85dvh
into the backdrop while it shows toasts, up to 2.75rem below the top of the screen. Once a sheet is at that limit, a
toast that comes or goes moves the top edge of the content, and the drawer scrolls the content by as much (as far as
its scroll range allows), so what is on screen stays where it is. If the strip takes the room where the focused control
sat, the content scrolls just enough to show it again. The outlet's `watch` does this: the provider calls it before
and after every change of the toasts (`createContentKeeper` in `Drawer.tsx`, unit tested). Hover and focus pause the
toasts, Undo and the focus return work as at the screen's edge. A toast is announced once, where it first shows: toasts that move as a drawer
opens or closes sit beside the live region of their new place, not in it (`ToastStacks`). The live region at the
screen's edge stays mounted meanwhile, so a toast shown as a drawer closes (Save, Delete) lands in a live region that
already existed and is announced. The specs check what reaches a screen reader with `watchToasts`
(`e2e/support/notes.ts`). With two drawers open, the newer one hosts the toasts. Another modal layer can render a
`ToastOutlet` the same way.

### Drawer

```tsx
<Drawer open={open} onClose={close} title={tpl(t.portfolio.edit, { symbol })} side="auto">...</Drawer>
```

`side="right"` (default) is a side panel, `"bottom"` a sheet, `"auto"` a sheet on phones and a side panel from `sm`.
Focus moves in, Tab is trapped, Escape closes and focus returns. Mark the first field with `data-autofocus`. The title
bar is a `div` with the `h2` that labels the dialog, not a `<header>`: inside `role="dialog"` a header would be a
second banner landmark next to the top bar's. While open, the drawer hosts the toasts in its own strip (see Toast):
between the content and the footer of a side panel, at the top of a sheet. Its scrolling content (`data-drawer-content`)
stays where it is on screen as they come and go.

### States

```tsx
<SkeletonRows rows={6} />
<EmptyState chips={["AAPL", "MSFT", "NVDA"].map((s) => ({ label: s, onSelect: () => add(s) }))} chipsLabel={t.common.add}
  actions={<Button size="sm" onClick={openPaste}>{t.data.paste}</Button>} hint={<><Kbd>/</Kbd> {t.shell.typeTicker}</>}>
  {t.watchlist.empty}
</EmptyState>
<ErrorState error={error} onRetry={() => mutate()} compact />
<StaleBanner show={Boolean(error && data)} since={data?.asOf} />
```

ErrorState's Retry is a small Button: 28px on desktop, 40px on phones.

### Wordmark and BrandMark

`<Wordmark />` is the mark plus "InvestSeek" (Plex Sans 600, 15px, "Seek" in `--fg-2`); the name hides below `sm`
unless `alwaysShowName` is set (the unlock page). `<BrandMark className="size-5 text-accent" />` is the glyph alone.

## Loading, empty and error patterns

- **Loading**: keep the panel and its header; show skeleton rows on `--line` (DataTable does this under its column
  heads), or the real layout with dashes as the ticker strip does. Never a blank panel.
- **Empty**: a left-aligned prompt line that says what is missing and how to start, then one-click starters (ticker
  chips) or actions, then an optional keyboard hint. No icons, no centered void. Copy is descriptive, never advice.
- **Stale**: when a refresh fails and older data is shown, put `StaleBanner` (with `since`) above it. Do not present old
  prices as live.
- **Error**: `ErrorState` with a retry. Compact inside a panel that still has other content.
- **Idle AI**: a compact panel with an outline of what the note will contain and a secondary Generate button with the
  AiChip, not a tall empty box.

## Accessibility

- **Contrast**: text 4.5:1, large text and non-text marks (input borders, focus rings, chart lines, meter fills) 3:1.
  All 59 promised pairs pass in both themes and all three conventions (`scripts/check-contrast.ts`, 354 checks),
  hover states included. A pair a component starts to use goes into `CONTRAST_PAIRS` in `lib/design-tokens.ts`, once:
  the script and the token test fail on a pair listed twice, so a new role for an existing pair joins its entry.
  A color drawn at an opacity (a Tailwind `/NN` modifier) is a pair too: `fgAlpha` for a foreground or a fill
  (`{ fg: "fg", fgAlpha: 0.6, bg: "panel" }`, named "fg/60 on panel"), or `bgAlpha` with the surface under it (`over`)
  for a translucent background with text on it. The checker composites the color at that opacity over the surface in
  each theme before it measures. The analyst rating shades (`RATING_SHADES` in the earnings model: bg-fg, bg-fg/85, /72,
  /60 and /50 on the panel) are checked this way as marks; no text is drawn on them, the legend sets each label beside
  its swatch. Selected results:

  | Pair | Dark | Light |
  | --- | --- | --- |
  | `--fg-3` on panel / panel-2 / hover | 5.34 / 5.10 / 4.82 | 5.23 / 4.87 / 4.61 |
  | `--fg-2` on the bare canvas | 9.36 | 8.28 |
  | `--up` on hover (intl / cn / cb) | 7.27 / 5.00 / 6.49 | 4.60 / 5.07 / 5.36 |
  | `--accent` on panel-2 / hover (code chips, hovered links) | 8.79 / 8.31 | 5.30 / 5.02 |
  | `--accent` on accent-soft over panel-2 / hover (badges) | 7.03 / 6.56 | 4.82 / 4.57 |
  | `--accent` on line-2 (the current marker on a track) | 6.29 | 3.55 |
  | Heatmap tile text, weakest tile | 4.88 | 5.21 |
  | `--input-border` on panel / panel-2 | 3.50 / 3.34 | 3.66 / 3.41 |
  | Rating shades `fg/85`, `/72`, `/60`, `/50` on panel | 11.48 / 8.42 / 6.13 / 4.58 | 12.11 / 7.50 / 4.88 / 3.51 |

- **Focus**: every interactive element shows the 2px accent outline (`:focus-visible`), or an accent border and ring on
  fields. Never remove it without a replacement.
- **Targets**: at least 24px on desktop and 40px below `sm`. Button, IconButton, Segmented, Select, Tabs, Input, toast
  actions, empty-state chips and DataTable sort heads do this by themselves; compact icon buttons stop at 24px.
- **Tables**: a caption (visually hidden), `scope="col"` heads, `aria-sort` on the sorted head, one link per row. A
  table that overflows its scroll box makes the box a focusable region named by the caption (DataTable does this), so
  the caption never repeats the name of the panel around it.
- **Escape**: closes the innermost layer only (a hover card before the drawer it sits in).
- **Live regions**: toasts and the stale banner are polite; errors use `role="alert"`. Ticking prices are not announced.
  While a drawer is open, the toasts' live region is inside its dialog.
- **Motion**: flashes and pulses are off with `prefers-reduced-motion`.
- **Language**: CJK column heads are 12px; never letter-space Chinese prose; keep the CJK fallbacks in `--font-sans`.
- **Color is never alone**: direction also shows as a sign (+ or −), state as a word, identity as a legend.

## Brand

- The mark ("prompt-candle") is a command-line chevron followed by a candlestick, defined once in
  `components/ui/brand.ts`. `app/icon.svg` is generated from it (a test fails if they drift): regenerate with
  `markSvg({ size: 32, background: BRAND_COLORS.background, radius: 6, padding: 3 })`.
- `app/apple-icon.tsx` renders the 180px home-screen icon; `app/manifest.ts` makes the app installable with shortcuts to
  the watchlist and the overview; `app/opengraph-image.tsx` renders the 1200x630 social card with the bundled font and
  no network requests. `SITE_URL` sets `metadataBase` for absolute card URLs.
- The browser `theme-color` follows the rendered theme (`themeColorFor` in `brand.ts`).

## Migrating a page

1. Replace `.label` on headings and table heads with `.panel-title` (through Panel) or `.col-head`.
2. Put tickers in `.mono`; leave numbers in `.num`.
3. Move tables to DataTable with colgroup widths; drop `table-fixed` equal columns.
4. Replace red/green on readings with neutral Meter or text; keep Delta for prices and P&L.
5. Rebuild the grid as two column stacks; remove `row-span` and stretched panels.
6. Add a panel `code`, a StaleBanner with `since`, a left-aligned EmptyState and TickNumber on live values.
7. Drop `max-sm:h-10` overrides on Button, Segmented, Select, Tabs and Input (they are 40px on phones by themselves),
   and show missing values with `DASH`.
