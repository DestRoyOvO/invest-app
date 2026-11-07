# InvestSeek design system

Source of truth: `app/globals.css` (tokens and text roles), `components/ui/**` (primitives) and this file. If they
disagree, the code wins and this file is the bug. `npx tsx scripts/check-contrast.ts` prints the measured contrast of
every token pair; `lib/design-tokens.test.ts` fails when a pair drops below its minimum.

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
  `flex flex-col gap-px` 的列，面板按内容自然高度排列，不再整行拉伸留白。
- **组件**：Panel（可带琥珀色功能代码）、DataTable（排序、aria-sort、行链接、悬停操作、加载/空状态）、Segmented、Select、
  Switch、Field/Input、Checkbox、Badge/AiChip、Sparkline（中性线条 + 按当日涨跌着色的端点）、Delta 与热力图分档
  （heatStep/heatStyle）、TickNumber（只闪变化的那个数字）、Whisker（置信区间须线）、Meter、StatTile、HoverCard/Tooltip、
  Toast（可撤销）、Drawer（右侧或底部）、EmptyState（左对齐 + 快捷代码按钮）、Wordmark。
- **无障碍**：文字对比度 ≥ 4.5:1、图形 ≥ 3:1（两套主题、三种配色全部实测通过）；桌面点击区 ≥ 24px、手机 ≥ 40px；
  可排序表头带 aria-sort；实时更新用礼貌型 live region；尊重"减少动态效果"。

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
| `data-theme` | `dark` (default), `light`, `system` | Surfaces, text, accent and every ramp. `system` follows `prefers-color-scheme` in pure CSS. |
| `data-updown` | `intl` (green up), `cn` (red up), `cb` (blue up, orange down) | `--up`, `--down`, the heatmap steps, and `--series-1` in `cb`. |
| `data-density` | comfortable (default, no attribute), `compact` | `--row-h` 32px to 24px and `--text-data` 13px to 12px. |

`lib/prefs.ts` currently stores `dark | light` and `intl | cn`; the shell work package adds `system`, `cb` and the
density setting to the settings menu. The tokens already support them.

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

### Accent and status

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--accent` | `#f2a33a` | `#a35f00` | Focus ring, the current marker, function codes, primary buttons, selected tab underline |
| `--accent-fg` | `#140d02` | `#ffffff` | Text on an accent fill |
| `--accent-soft` | 13% accent | 7% accent | Active icon buttons, accent badges |
| `--info` | `#5aa9f0` | `#1f6fc4` | Links, info badges, chart series 1 |
| `--warn` | `#e3b341` | `#8a5f00` | Stale data, caveats such as "No reliable edge" |
| `--danger` | red | red | Errors. Stays red in every price convention |

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
| `--text-data` | 13 / 20 (12 / 16 compact) | `text-data` | Tables and number-heavy rows |
| `--text-body` | 14 / 22 | `text-body` | Prose: AI notes, news summaries |
| `--text-figure` | 20 / 24 | `text-figure` | Board values, KPI tiles, portfolio value |
| `--text-display` | 30 / 36 | `text-display` | The quote price, one headline number per view |

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

## Color rules

1. `--up` and `--down` only for prices, returns and P&L (Delta, TickNumber flashes, sparkline end dots, candles, the
   heatmap). Never for model readings, factor scores, percentiles, risk levels or verdicts.
2. Readings, percentiles and risk use neutral ink: `Meter`, `--fg-2` / `--fg-3`, at most `--info`. Caveats use `--warn`
   with words.
3. `--accent` marks focus, the current item (the current row dot, the meter marker, a selected tab) and function codes.
   One accent element per group.
4. Errors use `--danger` with words and an icon; never a color alone.
5. Text never takes a series color; a swatch or line key next to the text carries identity.

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
    <Panel title={t.stock.news} code="CN">...</Panel>
  </div>
</div>
```

- DOM order is the phone order (one column below xl): put what a phone user needs first first.
- No `row-span`, no `h-full` on panels. A panel that should fill space (the heatmap) gets `bodyClassName="flex flex-col"`
  and a `min-h-[420px] flex-1` child.
- Cap long or streaming bodies: `max-h-[min(70vh,720px)] overflow-y-auto`.
- Full-width bands (quote header, KPI strips) sit above the grid or span both columns with `xl:col-span-2`.

## Panel codes

`<Panel code="GP">` shows a Bloomberg-style function code as a small amber mono chip before the title. Codes are 2 to 4
capital letters, decorative for screen readers, and match what the command bar accepts (the shell package's function
registry is the source of truth once it exists). Suggested codes:

| Panel | Code | Panel | Code |
| --- | --- | --- | --- |
| Markets board | WEI | Price chart | GP |
| Sector heatmap | HMAP | Key statistics | FA |
| Sector performance | SECT | Company profile | DES |
| Movers, market-wide discover | MOV, MOST | Model signal | SIG |
| Headlines, company news | NEWS, CN | Risk forecast | RISK |
| Watchlist | WL | Factor profile | FCTR |
| Positions, portfolio | PORT | Earnings | ERN |
| Correlation | CORR | Analysts | ANR |
| Events calendar, week ahead | EVTS | Notes | NOTE |
| Screener | EQS | Alerts | ALRT |
| Rates and curve | GC | AI note, scan or brief | AI |

## Primitives

All live in `components/ui`. Each has a doc comment; the snippets show the common case. Message keys in the snippets
that do not exist yet (for example `t.common.undo`) are placeholders for the strings each feature package adds.

### Panel, PanelMeta, PanelCode

```tsx
<Panel title={t.market.heatmap} code="HMAP" actions={<HeatLegend />} bodyClassName="flex flex-col">
  ...
</Panel>
<Panel title={t.watchlist.title} code="WL" actions={<PanelMeta>{tpl(t.watchlist.count, { n })}</PanelMeta>}>...</Panel>
```

The header is 36px on `--panel-2` with a hairline under it. `title` may be omitted for headless panels.

### Button, IconButton

```tsx
<Button variant="primary" onClick={save}>{t.portfolio.save}</Button>
<Button size="sm">{t.common.cancel}</Button>
<IconButton size="sm" label={tpl(t.watchlist.remove, { symbol })} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={remove} />
```

One primary button per view. A disabled primary turns gray (`--fg-3` on `--panel-2`), never half-transparent amber.
IconButton is 28 or 32px on desktop and 40px below `sm`; `active` marks an open menu or a pressed toggle.

### Badge, Kbd, AiChip

```tsx
<Badge tone="warn">{t.signal.track.verdict.none}</Badge>
<Kbd>/</Kbd>
<Button variant="secondary"><AiChip tone="current" />{t.ai.generate}</Button>
```

Badges are sans 600 11px caps. `up` / `down` tones only for price or P&L. AiChip replaces sparkle icons: `accent`,
`muted` (unavailable) or `current` (inherits the button text color).

### Tabs and Segmented

```tsx
<Tabs label={t.stock.chart} value={range} onChange={setRange} options={ranges} />
<Segmented label={t.settings.colors} value={updown} onChange={setUpdown} options={[...]} size="sm" />
```

Tabs switch views inside a panel header. Segmented picks one of two to four settings (radiogroup, one tab stop,
arrows, Home and End). Use `hideLabel` inside headers.

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
error text below. Switch applies at once; Checkbox is for forms that submit.

### Delta, heatStep, heatStyle, HeatLegend

```tsx
<Delta value={q.changePercent} />                       // +1.35% / −0.52%, colored by direction
<Delta value={q.change} kind="change" lang={lang} />
<div style={heatStyle(heatStep(q.changePercent))}>...</div>
<HeatLegend />                                           // −3.5 [9 swatches] +3.5%
```

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
only when the interval excludes the base rate. `label` (the exact numbers in words) is required. Narrow `min`/`max` so the interval is
visible.

### Meter and StatTile

```tsx
<Meter value={factor.percentile} marker={50} label={t.lab.momentum} valueText={tpl(t.lab.pct, { n })} />
<div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
  <StatTile label={t.portfolio.portfolioValue} value={formatNumber(value, 2, lang)} delta={<Delta value={dayPct} />} sub={costLine} />
</div>
```

Meter is a neutral 0 to 100 bar with a midline and an optional accent marker (role="meter"). StatTile is one KPI:
column-head label, 20px figure (30px with `size="lg"`), optional delta and sub-line.

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
  caption={t.watchlist.title}
  rowHref={(q) => stockPath(q.symbol)}
  rowActions={(q) => <IconButton size="sm" label={tpl(t.watchlist.remove, { symbol: q.symbol })} icon={<X className="size-3.5" />} onClick={() => remove(q.symbol)} />}
  loading={!data}
  empty={<EmptyState chips={starters}>{t.watchlist.empty}</EmptyState>}
/>
```

- Widths come from a `<colgroup>`; give number columns fixed widths (last 5.5rem, change 4.5rem, change % 5rem, volume
  5.5rem, market cap 5.25rem, P/E 3.75rem, trend 6.5rem) and leave the name column free so it takes the rest.
- Sorting: a header click cycles the column's first direction (descending for right-aligned columns), the opposite, then
  the natural order. `aria-sort` marks the sorted header. Missing values sort last both ways; equal values keep their
  `tieBreak` order, then their original order. Pass `sort`/`onSortChange` to control it, for example to keep a
  watchlist's custom order as the unsorted state.
- `rowHref` makes the row clickable (Ctrl or Cmd opens a new tab) and renders the first cell as a real link.
- `rowActions` are revealed on hover and keyboard focus and always shown on touch screens. The column is
  `actionsWidth` wide (4.5rem) and `actionsTouchWidth` (5.5rem) below `sm`, where icon buttons grow to 40px.
- `stickyHeader` with `maxHeight` keeps the header visible while the body scrolls; `minWidth` scrolls horizontally on
  phones instead of squeezing.

### HoverCard and Tooltip

```tsx
<HoverCard side="top" content={<QuoteCard quote={q} />}>
  <Link href={stockPath(q.symbol)}>{q.symbol}</Link>
</HoverCard>
<Tooltip label={t.help.wl}><IconButton label="WL" icon={...} /></Tooltip>
```

No library. The child must be one focusable element. The card opens after 200ms on hover or at once on keyboard focus,
renders in a portal (overflow cannot clip it), flips and clamps to the viewport, links itself with
`aria-describedby`, stays open while hovered and closes on Escape or blur. Touch screens get no hover: never put the
only copy of a number in a hover card.

### Toast

```tsx
const toast = useToast();
toast.show({ message: tpl(t.watchlist.removed, { symbol }), action: { label: t.common.undo, onAction: () => add(symbol) } });
```

`ToastProvider` is mounted in `components/providers/Providers.tsx`. Toasts sit above the phone tab bar or the status
bar, in a polite live region, at most three at a time; they close after 5s (8s with an action) and pause while hovered
or focused.

### Drawer

```tsx
<Drawer open={open} onClose={close} title={tpl(t.portfolio.edit, { symbol })} side="auto">...</Drawer>
```

`side="right"` (default) is a side panel, `"bottom"` a sheet, `"auto"` a sheet on phones and a side panel from `sm`.
Focus moves in, Tab is trapped, Escape closes and focus returns. Mark the first field with `data-autofocus`.

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

### Wordmark and BrandMark

`<Wordmark />` is the mark plus "InvestSeek" (Plex Sans 600, 15px, "Seek" in `--fg-2`); the name hides below `sm`.
`<BrandMark className="size-5 text-accent" />` is the glyph alone.

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
  All 45 promised pairs pass in both themes and all three conventions (`scripts/check-contrast.ts`, 270 checks).
  Selected results:

  | Pair | Dark | Light |
  | --- | --- | --- |
  | `--fg-3` on panel / panel-2 / hover | 5.34 / 5.10 / 4.82 | 5.23 / 4.87 / 4.61 |
  | `--up` on hover (intl / cn / cb) | 7.27 / 5.00 / 6.49 | 4.60 / 5.07 / 5.36 |
  | `--accent` on panel-2 (code chips) | 8.79 | 4.66 |
  | Heatmap text, weakest step | 4.88 | 6.23 |
  | `--input-border` on panel / panel-2 | 3.50 / 3.34 | 3.66 / 3.41 |

- **Focus**: every interactive element shows the 2px accent outline (`:focus-visible`), or an accent border and ring on
  fields. Never remove it without a replacement.
- **Targets**: at least 24px on desktop and 40px below `sm` (IconButton, toast actions, empty-state chips do this).
- **Tables**: a caption (visually hidden), `scope="col"` heads, `aria-sort` on the sorted head, one link per row.
- **Live regions**: toasts and the stale banner are polite; errors use `role="alert"`. Ticking prices are not announced.
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
