"use client";

import { useState, type FormEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import type { Position } from "@/hooks/useHoldings";
import { tpl } from "@/lib/format";

interface PositionEditorProps {
  symbol: string | null;
  current: Position | undefined;
  onSave: (symbol: string, position: Position) => boolean;
  onClear: (symbol: string) => void;
  onClose: () => void;
}

function parsePositive(value: string): number | null {
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function Form({ symbol, current, onSave, onClear, onClose }: PositionEditorProps & { symbol: string }) {
  const { t } = usePrefs();
  const [shares, setShares] = useState(current ? String(current.shares) : "");
  const [cost, setCost] = useState(current ? String(current.cost) : "");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const s = parsePositive(shares);
    const c = parsePositive(cost);
    if (s === null || c === null || !onSave(symbol, { shares: s, cost: c })) {
      setError(t.portfolio.invalid);
      return;
    }
    onClose();
  };

  const field = "num h-9 w-full rounded-xs border border-line-2 bg-canvas px-2.5 text-sm text-fg focus:border-accent focus:outline-none";
  return (
    <form onSubmit={onSubmit} className="space-y-4 p-4">
      <div className="space-y-1.5">
        <label htmlFor="position-shares" className="label block">
          {t.portfolio.shares}
        </label>
        <input id="position-shares" data-autofocus inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} className={field} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="position-cost" className="label block">
          {t.portfolio.avgCost}
        </label>
        <input id="position-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={field} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary">
          {t.portfolio.save}
        </Button>
        {current ? (
          <Button
            variant="ghost"
            onClick={() => {
              onClear(symbol);
              onClose();
            }}
          >
            {t.portfolio.clear}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-fg-3">{t.portfolio.storedLocally}</p>
    </form>
  );
}

/** Shares and average cost for one symbol. */
export function PositionEditor(props: PositionEditorProps) {
  const { t } = usePrefs();
  return (
    <Drawer open={props.symbol !== null} onClose={props.onClose} title={props.symbol ? tpl(t.portfolio.edit, { symbol: props.symbol }) : ""} widthClassName="sm:w-[380px]">
      {props.symbol ? <Form key={props.symbol} {...props} symbol={props.symbol} /> : null}
    </Drawer>
  );
}
