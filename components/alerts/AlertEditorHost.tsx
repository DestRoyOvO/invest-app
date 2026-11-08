"use client";

import { useState, type FormEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Drawer } from "@/components/ui/Drawer";
import { Field, Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useQuotes } from "@/hooks/useApi";
import { requestNotificationPermission, setAlertEditTarget, useAlertEditTarget, useAlertRules } from "@/hooks/useAlerts";
import { useHoldings } from "@/hooks/useHoldings";
import { useDebounced } from "@/hooks/useLocalValue";
import { useNow } from "@/hooks/useNotes";
import {
  addAlertRule,
  ALERT_KINDS,
  alertsStore,
  baselineFromQuote,
  MAX_ALERT_NOTE_CHARS,
  MAX_ALERT_RULES,
  removeAlertRule,
  restoreAlertRule,
  updateAlertRule,
  validateRuleInput,
  type AlertKind,
  type AlertRepeat,
  type AlertRule,
  type AlertRuleInput,
} from "@/lib/alerts";
import { formatPrice, tpl } from "@/lib/format";
import { normalizeSymbol } from "@/lib/symbols";
import type { Quote } from "@/types/api";

import { AlertContext } from "./AlertContext";
import { describeRule } from "./describe";
import { formFromRule, parseNumberInput, valueAfterKindChange } from "./form";
import { SymbolField } from "./SymbolField";

/** The symbol's name, last price and day change under the symbol field; a stale quote says so. */
function QuoteLine({ quote }: { quote: Quote }) {
  const { t, lang } = usePrefs();
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="truncate text-fg-2">{quote.name}</span>
      <span className="num text-fg-2">{tpl(t.alerts.editor.context.last, { price: formatPrice(quote.price, lang) })}</span>
      <Delta value={quote.changePercent} />
      {quote.stale ? <span className="text-warn">{t.alerts.reasons.stale}</span> : null}
    </span>
  );
}

/** Quiet time after typing in the symbol field before its quote is looked up. */
const LOOKUP_DELAY_MS = 350;

interface EditorFormProps {
  /** The rule being edited, or null for a new one. */
  rule: AlertRule | null;
  /** Symbol to start a new rule with ("" for none). */
  initialSymbol: string;
  onClose: () => void;
}

function EditorForm({ rule, initialSymbol, onClose }: EditorFormProps) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const { holdings } = useHoldings();
  const now = useNow(60_000);
  const start = rule ? formFromRule(rule) : { symbol: initialSymbol, kind: "above" as AlertKind, value: "", repeat: "once" as AlertRepeat, note: "" };
  const [symbol, setSymbol] = useState(start.symbol);
  const [kind, setKind] = useState<AlertKind>(start.kind);
  const [value, setValue] = useState(start.value);
  const [repeat, setRepeat] = useState<AlertRepeat>(start.repeat);
  const [note, setNote] = useState(start.note);
  const [submitted, setSubmitted] = useState(false);
  const [full, setFull] = useState(false);

  const normalized = normalizeSymbol(symbol);
  // Look the quote up once typing pauses, not for every prefix of a ticker: "M" and "MS" are tickers too, and their
  // quotes would show other companies (and cost upstream calls) while "MSFT" is being typed.
  const lookup = useDebounced(normalized, LOOKUP_DELAY_MS);
  const { data, isLoading } = useQuotes(lookup ? [lookup] : []);
  const current = lookup === normalized;
  const quote = current ? (data?.quotes.find((q) => q.symbol === normalized) ?? null) : null;
  const quoteLoading = isLoading || !current;
  const parsed = kind === "cross_ma200" ? null : parseNumberInput(value);
  const input: AlertRuleInput = { symbol, kind, value: parsed, repeat, note };
  const error = validateRuleInput(input);
  const editor = t.alerts.editor;
  const unit = kind === "above" || kind === "below" ? (quote?.currency ?? "") : kind === "earnings_within" ? "" : "%";

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (error) return;
    const at = new Date();
    const baseline = baselineFromQuote(quote, at);
    const ruleText = describeRule({ kind, value: parsed }, t, lang);
    const shown = normalized ?? symbol;
    if (rule) {
      updateAlertRule(rule.id, input, { now: at, baseline });
    } else {
      const first = alertsStore.getSnapshot().length === 0;
      const result = addAlertRule(input, { now: at, baseline });
      if (result.status === "full") {
        setFull(true);
        return;
      }
      // Ask once, from this click, when the first rule exists; never on page load.
      if (first) void requestNotificationPermission();
    }
    toast.show({ message: tpl(editor.saved, { symbol: shown, rule: ruleText }) });
    onClose();
  };

  const remove = () => {
    if (!rule) return;
    const removed = removeAlertRule(rule.id);
    onClose();
    if (!removed) return;
    toast.show({
      message: tpl(editor.deleted, { symbol: rule.symbol, rule: describeRule(rule, t, lang) }),
      action: { label: t.alerts.undo, onAction: () => restoreAlertRule(removed.rule, removed.index) },
    });
  };

  const symbolError = submitted && error === "symbol" ? editor.errors.symbol : full ? tpl(editor.errors.full, { n: MAX_ALERT_RULES }) : undefined;
  const valueError = submitted && error === "value" && kind !== "cross_ma200" ? editor.errors[kind] : undefined;
  const hint = kind === "day_move" || kind === "pnl_from_cost" || kind === "earnings_within" ? editor.valueHint[kind] : undefined;

  return (
    <form onSubmit={save} noValidate>
      <div className="space-y-4 p-4">
        <Field label={editor.symbol} error={symbolError} hint={quote ? <QuoteLine quote={quote} /> : undefined}>
          <SymbolField value={symbol} onChange={setSymbol} placeholder={editor.symbolPlaceholder} autoFocus={!rule && !initialSymbol} />
        </Field>

        <Field label={editor.condition}>
          <Select
            className="w-full"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as AlertKind;
              setValue((current) => valueAfterKindChange(kind, next, current));
              setKind(next);
            }}
          >
            {ALERT_KINDS.map((option) => (
              <option key={option} value={option}>
                {t.alerts.kinds[option]}
              </option>
            ))}
          </Select>
        </Field>

        {kind !== "cross_ma200" ? (
          <Field label={editor.value[kind]} hint={hint} error={valueError}>
            <div className="flex items-center gap-2">
              <Input
                inputMode={kind === "earnings_within" ? "numeric" : "decimal"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                data-autofocus={!rule && initialSymbol ? true : undefined}
                className="num"
              />
              {unit ? <span className="mono shrink-0 text-xs text-fg-3">{unit}</span> : null}
            </div>
          </Field>
        ) : null}

        <AlertContext symbol={normalized} quote={quote} loading={quoteLoading} kind={kind} value={parsed} holdings={holdings} now={now} />

        <Segmented
          label={editor.repeat}
          value={repeat}
          onChange={setRepeat}
          options={[
            { value: "once", label: t.alerts.repeat.once },
            { value: "daily", label: t.alerts.repeat.daily },
          ]}
        />
        <p className="-mt-2 text-xs text-fg-3">{t.alerts.repeatHint[repeat]}</p>

        <Field label={editor.note}>
          <Input value={note} maxLength={MAX_ALERT_NOTE_CHARS} onChange={(event) => setNote(event.target.value)} placeholder={editor.notePlaceholder} />
        </Field>
      </div>

      <div className="space-y-2 border-t border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary">
            {rule ? editor.saveChanges : editor.save}
          </Button>
          <Button onClick={onClose}>
            {t.common.cancel}
          </Button>
          {rule ? (
            <Button variant="ghost" onClick={remove} className="ml-auto">
              {editor.delete}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-fg-3">{t.alerts.honest}</p>
      </div>
    </form>
  );
}

/**
 * Global alert rule editor bound to UiProvider.alertEditor: openAlertEditor(symbol) from anywhere starts a new rule for
 * that symbol (or a blank one), and /alerts edits a rule through setAlertEditTarget. Mounted once in the shell.
 */
export function AlertEditorHost() {
  const { t } = usePrefs();
  const { alertEditor, closeAlertEditor } = useUi();
  const target = useAlertEditTarget();
  const rules = useAlertRules();
  const open = alertEditor !== null;
  const rule = open && target ? (rules.find((r) => r.id === target) ?? null) : null;

  const close = () => {
    closeAlertEditor();
    setAlertEditTarget(null);
  };

  return (
    <Drawer open={open} onClose={close} title={rule ? tpl(t.alerts.editor.editTitle, { symbol: rule.symbol }) : t.alerts.editor.newTitle} side="auto" widthClassName="sm:w-[420px]">
      {open ? <EditorForm key={rule ? `edit:${rule.id}` : `new:${alertEditor}`} rule={rule} initialSymbol={alertEditor ?? ""} onClose={close} /> : null}
    </Drawer>
  );
}
