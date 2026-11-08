"use client";

import { AlertCircle, FileUp } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { detectHeader, mapRows, POSITIONAL_MAPPING, POSITIONS_TEMPLATE_ROWS, type ColumnMapping, type HeaderDetection, type ImportField } from "@/lib/broker-import";
import { cn } from "@/lib/cn";
import { decodeText, parseCsv, type CsvTable, type DecodedText } from "@/lib/csv";
import { tpl } from "@/lib/format";

import { downloadCsv } from "./browser";
import { ImportDone, ImportReview, useImportOutcome } from "./ImportReview";
import { TOUCH } from "./styles";

/** Larger files are not positions exports. */
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAPPED_FIELDS: readonly ImportField[] = ["symbol", "quantity", "avgCost", "totalCost", "name"];
const DELIMITER_KEYS = { ",": "comma", ";": "semicolon", "\t": "tab" } as const;

interface LoadedFile {
  name: string;
  encoding: DecodedText["encoding"];
  table: CsvTable;
  detection: HeaderDetection | null;
}

/** Positions from a broker's CSV export: detected columns the user can change, then the shared import preview. */
export function CsvImportPanel() {
  const { t } = usePrefs();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { outcome, record, undo, clear } = useImportOutcome();

  const load = async (picked: File) => {
    setError(null);
    clear();
    if (picked.size > MAX_CSV_BYTES) {
      setFile(null);
      setError(t.data.csv.tooLarge);
      return;
    }
    try {
      const { text, encoding } = decodeText(await picked.arrayBuffer());
      const table = parseCsv(text);
      const detection = detectHeader(table.rows);
      setFile({ name: picked.name, encoding, table, detection });
      setMapping(detection?.mapping ?? POSITIONAL_MAPPING);
    } catch {
      setFile(null);
      setError(t.data.csv.read);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Clearing the input lets the same file be chosen again after it was edited.
    event.target.value = "";
    if (picked) void load(picked);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const picked = event.dataTransfer.files?.[0];
    if (picked) void load(picked);
  };

  const headerRow = file?.detection?.headerRow ?? -1;
  const columnCount = file ? Math.max(0, ...file.table.rows.slice(0, 50).map((row) => row.length)) : 0;
  const headers = file?.detection
    ? file.detection.headers.map((header, index) => header.trim() || tpl(t.data.csv.column, { n: index + 1 }))
    : Array.from({ length: columnCount }, (_, index) => tpl(t.data.csv.column, { n: index + 1 }));
  const complete = mapping.symbol !== undefined && mapping.quantity !== undefined && (mapping.avgCost !== undefined || mapping.totalCost !== undefined);
  const rows = useMemo(
    () => (file && complete ? mapRows(file.table, headerRow, mapping, { decimalComma: file.table.delimiter === ";" }) : []),
    [file, complete, headerRow, mapping],
  );

  const setField = (field: ImportField, value: string) => {
    setMapping((current) => {
      const next = { ...current };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  };

  const meta = file
    ? [
        tpl(t.data.csv.fileMeta, { rows: Math.max(0, file.table.rows.length - headerRow - 1), delimiter: t.data.csv.delimiters[DELIMITER_KEYS[file.table.delimiter]] }),
        file.encoding === "utf-8" ? null : tpl(t.data.csv.encoding, { encoding: file.encoding.toUpperCase() }),
        file.detection && file.detection.headerRow > 0 ? tpl(t.data.csv.headerAt, { line: file.table.lines[file.detection.headerRow] }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <Panel id="import-csv" title={t.data.csv.title} actions={file ? <PanelMeta>{file.name}</PanelMeta> : null}>
      <div
        className={cn("space-y-3 px-3 py-3 transition-colors", dragging && "bg-hover")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          // Moving between the drop zone's own children is not leaving it.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <p className="max-w-prose text-sm text-fg-2">{t.data.csv.intro}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => inputRef.current?.click()} className={TOUCH}>
            <FileUp aria-hidden className="size-4" strokeWidth={1.75} />
            {file ? t.data.csv.another : t.data.csv.choose}
          </Button>
          <Button variant="ghost" onClick={() => downloadCsv("investseek-positions-template.csv", POSITIONS_TEMPLATE_ROWS)} className={TOUCH}>
            {t.data.csv.template}
          </Button>
          <span className="text-xs text-fg-3 max-sm:hidden">{t.data.csv.drop}</span>
          <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={onPick} />
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        ) : null}
        {file ? (
          <fieldset className="space-y-2">
            <legend className="col-head">{t.data.csv.mapping}</legend>
            {meta ? <p className="num text-xs text-fg-3">{meta}</p> : null}
            {!file.detection ? <p className="text-xs text-fg-2">{t.data.csv.noHeader}</p> : null}
            <div className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-5">
              {MAPPED_FIELDS.map((field) => (
                <Field key={field} label={t.data.csv.fields[field as keyof typeof t.data.csv.fields]}>
                  <Select className="w-full" value={mapping[field] === undefined ? "" : String(mapping[field])} onChange={(event) => setField(field, event.target.value)}>
                    <option value="">{t.data.csv.none}</option>
                    {headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            {!complete ? <p className="text-xs text-warn">{t.data.csv.needColumns}</p> : complete && rows.length === 0 ? <p className="text-xs text-fg-2">{t.data.csv.noRows}</p> : null}
          </fieldset>
        ) : null}
      </div>
      {outcome ? <ImportDone outcome={outcome} onUndo={() => undo(outcome.changes)} /> : null}
      {rows.length > 0 ? (
        <ImportReview
          rows={rows}
          onImported={(result) => {
            record(result);
            setFile(null);
          }}
        />
      ) : null}
    </Panel>
  );
}
