"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { hashId } from "@/components/shell/hash-landing";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { parsePastedPositions } from "@/lib/broker-import";

import { ImportDone, ImportReview, useImportOutcome } from "./ImportReview";
import { focusSoon, TOUCH } from "./styles";

/** Paste positions as text: "AAPL, 25, 201.30" per line, or rows copied from a spreadsheet or a broker's page. */
export function PastePanel() {
  const { t } = usePrefs();
  const [text, setText] = useState("");
  const deferred = useDeferredValue(text);
  const rows = useMemo(() => parsePastedPositions(deferred), [deferred]);
  const { outcome, record, undo, clear } = useImportOutcome();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Links such as "Paste positions" on the overview open /data#paste: put the cursor in the box, ready to paste. The
  // shell's HashLanding settles the address in a layout effect, before this effect reads it, and scrolls the panel into
  // place, so the focus itself does not scroll.
  useEffect(() => {
    const focusOnHash = () => {
      if (hashId(window.location.hash) === "paste") inputRef.current?.focus({ preventScroll: true });
    };
    focusOnHash();
    window.addEventListener("hashchange", focusOnHash);
    return () => window.removeEventListener("hashchange", focusOnHash);
  }, []);

  return (
    <Panel
      id="paste"
      title={t.data.paste.title}
      className="scroll-mt-2"
      actions={
        text ? (
          <Button size="sm" variant="ghost" onClick={() => setText("")} className={TOUCH}>
            {t.data.paste.clear}
          </Button>
        ) : null
      }
    >
      <div className="px-3 py-3">
        <Field label={t.data.paste.label} hint={t.data.paste.hint}>
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (outcome) clear();
            }}
            placeholder={t.data.paste.placeholder}
            rows={5}
            spellCheck={false}
            autoComplete="off"
            className="mono"
          />
        </Field>
      </div>
      {outcome ? (
        <ImportDone
          outcome={outcome}
          onUndo={() => {
            undo(outcome.changes);
            focusSoon(inputRef);
          }}
        />
      ) : null}
      {rows.length > 0 ? (
        <ImportReview
          rows={rows}
          onImported={(result) => {
            record(result);
            setText("");
          }}
        />
      ) : null}
    </Panel>
  );
}
