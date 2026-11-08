"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Drawer } from "@/components/ui/Drawer";
import { Field, Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { formatShares } from "@/components/watchlist/format";
import { useQuotes } from "@/hooks/useApi";
import { clearPosition, setPosition, type Position } from "@/hooks/useHoldings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { formatPrice, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { normalizeSymbol } from "@/lib/symbols";

import { applyChange, previewAt, type EditorMode, type FieldError } from "./editor-math";
import { Money, SignedMoney } from "./money";
import { SymbolCombobox } from "./SymbolCombobox";

function errorText(error: FieldError | undefined, t: Messages, held: number | undefined, lang: "en" | "zh"): string | undefined {
  if (!error) return undefined;
  if (error === "tooMany") return tpl(t.portfolio.tooMany, { n: held === undefined ? "" : formatShares(held, lang) });
  return error === "shares" ? t.portfolio.sharesError : error === "cost" ? t.portfolio.costError : t.portfolio.priceError;
}

/** A label and value in the preview grid. */
function PreviewItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="col-head truncate">{label}</dt>
      <dd className="mt-0.5 truncate text-data">{children}</dd>
    </div>
  );
}

/** Shares and average cost for one symbol: set them, add shares at a price, or reduce the position. */
export function PositionEditor({ symbol, onClose }: { symbol: string | null; onClose: () => void }) {
  if (symbol === null) return null;
  // A new symbol starts a fresh form (and a fresh drawer, so focus moves in again).
  return <EditorDrawer key={symbol} initial={symbol} onClose={onClose} />;
}

function EditorDrawer({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const { holdings, quotes } = usePortfolio();
  const startSymbol = normalizeSymbol(initial);
  const picking = startSymbol === null;
  const [symbolText, setSymbolText] = useState(startSymbol ?? "");
  const [symbolError, setSymbolError] = useState(false);
  const [chosen, setChosen] = useState<string | null>(startSymbol);
  const current: Position | undefined = chosen ? holdings[chosen] : undefined;
  const [mode, setMode] = useState<EditorMode>("edit");
  const [shares, setShares] = useState(current ? String(current.shares) : "");
  const [price, setPrice] = useState(current ? String(current.cost) : "");
  const [attempted, setAttempted] = useState(false);
  const sharesRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  // Quotes of the watchlist and holdings are already loaded; a symbol outside them gets its own request.
  const ownQuote = chosen ? quotes.get(chosen) : undefined;
  const { data: extra } = useQuotes(chosen && !ownQuote ? [chosen] : []);
  const quote = ownQuote ?? extra?.quotes.find((q) => q.symbol === chosen);
  const last = quote?.price ?? null;

  const resetFields = (position: Position | undefined, nextMode: EditorMode) => {
    setMode(nextMode);
    setAttempted(false);
    if (nextMode === "edit") {
      setShares(position ? String(position.shares) : "");
      setPrice(position ? String(position.cost) : "");
    } else {
      setShares("");
      setPrice(last !== null ? last.toFixed(2) : "");
    }
  };

  const choose = (raw: string) => {
    const symbol = normalizeSymbol(raw);
    setSymbolText(symbol ?? raw);
    setSymbolError(!symbol);
    if (!symbol) return;
    setChosen(symbol);
    resetFields(holdings[symbol], "edit");
    window.requestAnimationFrame(() => sharesRef.current?.focus());
  };

  const result = applyChange({ mode, current: current ?? null, shares, price });
  const preview = previewAt(result.next, last);
  const sharesError = attempted ? errorText(result.errors.shares, t, current?.shares, lang) : undefined;
  const priceError = attempted ? errorText(result.errors.price, t, current?.shares, lang) : undefined;

  const restore = (symbol: string, previous: Position | undefined) => () => {
    if (previous) setPosition(symbol, previous);
    else clearPosition(symbol);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    // Typed a ticker without picking a suggestion: take it as the symbol first.
    const typed = normalizeSymbol(symbolText);
    if (picking && (!chosen || (typed && typed !== chosen))) {
      choose(symbolText);
      return;
    }
    if (!chosen) return;
    if (!result.valid) {
      setAttempted(true);
      (result.errors.shares ? sharesRef : priceRef).current?.focus();
      return;
    }
    const undo = { label: t.watchlist.undo, onAction: restore(chosen, current) };
    if (result.closes) {
      clearPosition(chosen);
      toast.show({ message: tpl(t.portfolio.removedPosition, { symbol: chosen }), action: undo });
    } else if (result.next) {
      setPosition(chosen, result.next);
      toast.show({ message: tpl(t.portfolio.saved, { symbol: chosen }), action: undo });
    }
    onClose();
  };

  const remove = () => {
    if (!chosen || !current) return;
    clearPosition(chosen);
    toast.show({ message: tpl(t.portfolio.removedPosition, { symbol: chosen }), action: { label: t.watchlist.undo, onAction: restore(chosen, current) } });
    onClose();
  };

  const title = chosen ? tpl(current ? t.portfolio.edit : t.watchlist.addPositionFor, { symbol: chosen }) : t.portfolio.addTitle;
  const labels =
    mode === "add" && current
      ? [t.portfolio.sharesToAdd, t.portfolio.pricePaid]
      : mode === "reduce" && current
        ? [t.portfolio.sharesToSell, t.portfolio.salePrice]
        : [t.portfolio.shares, t.portfolio.avgCost];

  return (
    <Drawer open onClose={onClose} title={title} side="auto" widthClassName="sm:w-[400px]">
      <form onSubmit={onSubmit} noValidate className="space-y-4 p-4">
        {picking ? (
          <Field label={t.portfolio.symbol} error={symbolError ? t.portfolio.symbolRequired : undefined}>
            <SymbolCombobox
              data-autofocus
              value={symbolText}
              onValueChange={(next) => {
                setSymbolText(next);
                setSymbolError(false);
              }}
              onPick={choose}
              placeholder={t.portfolio.symbolPlaceholder}
              inline
            />
          </Field>
        ) : null}

        {chosen ? (
          <>
            {current ? (
              <div className="space-y-3">
                <p className="num text-sm text-fg-2">{tpl(t.portfolio.current, { shares: formatShares(current.shares, lang), cost: formatPrice(current.cost, lang) })}</p>
                <Segmented
                  label={t.portfolio.mode}
                  value={mode}
                  onChange={(next) => resetFields(current, next)}
                  options={[
                    { value: "edit", label: t.portfolio.modeEdit },
                    { value: "add", label: t.portfolio.modeAdd },
                    { value: "reduce", label: t.portfolio.modeReduce },
                  ]}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label={labels[0]} error={sharesError}>
                <Input ref={sharesRef} data-autofocus={picking ? undefined : true} inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} className="num" />
              </Field>
              <Field label={labels[1]} error={priceError}>
                <Input ref={priceRef} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="num" />
              </Field>
            </div>

            <section aria-live="polite" className="rounded-xs border border-line bg-panel-2 px-3 py-2.5">
              <h3 className="text-xs text-fg-2">{last !== null ? tpl(t.portfolio.preview, { price: formatPrice(last, lang) }) : t.portfolio.previewNoQuote}</h3>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                <PreviewItem label={t.portfolio.value}>
                  <Money value={preview?.value} lang={lang} />
                </PreviewItem>
                <PreviewItem label={t.portfolio.pnlShort}>
                  <SignedMoney value={preview?.pnl} lang={lang} />
                </PreviewItem>
                <PreviewItem label={t.portfolio.pnlPct}>
                  <Delta value={preview?.pnlPct} kind="ratio" digits={1} />
                </PreviewItem>
                {current && mode === "add" ? (
                  <>
                    <PreviewItem label={t.portfolio.newShares}>
                      <span className="num text-fg">{result.next ? formatShares(result.next.shares, lang) : "—"}</span>
                    </PreviewItem>
                    <PreviewItem label={t.portfolio.newAvgCost}>
                      <span className="num text-fg">{result.next ? formatPrice(result.next.cost, lang) : "—"}</span>
                    </PreviewItem>
                  </>
                ) : null}
                {current && mode === "reduce" ? (
                  <>
                    <PreviewItem label={t.portfolio.newShares}>
                      <span className="num text-fg">{result.valid ? formatShares(result.next?.shares ?? 0, lang) : "—"}</span>
                    </PreviewItem>
                    <PreviewItem label={t.portfolio.realized}>
                      <SignedMoney value={result.realized} lang={lang} />
                    </PreviewItem>
                  </>
                ) : null}
              </dl>
              {current && mode === "reduce" ? (
                <p className="mt-2 text-xs text-fg-3">
                  {result.closes ? t.portfolio.closes : tpl(t.portfolio.avgCostStays, { cost: formatPrice(current.cost, lang) })} {t.portfolio.realizedNote}
                </p>
              ) : null}
            </section>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary">
            {result.closes ? t.portfolio.closePosition : t.portfolio.save}
          </Button>
          <Button onClick={onClose}>
            {t.common.cancel}
          </Button>
          {current ? (
            <Button variant="ghost" onClick={remove} className="ml-auto">
              {t.portfolio.clear}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-fg-3">
          {t.portfolio.storedLocally}{" "}
          <Link href="/data" onClick={onClose} className="text-fg-2 underline underline-offset-2 hover:text-fg">
            {t.portfolio.manageData}
          </Link>
        </p>
      </form>
    </Drawer>
  );
}
