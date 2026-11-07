import { describe, expect, it } from "vitest";

import { decodeText, parseCsv, sniffDelimiter, stringifyCsv } from "./csv";

describe("parseCsv", () => {
  it("reads quoted fields with delimiters, doubled quotes and line breaks", () => {
    const table = parseCsv('symbol,name,note\r\nBRK-B,"Berkshire Hathaway, Inc.","said ""hold""\r\nline two"\r\nAAPL,Apple,\r\n', ",");
    expect(table.rows).toEqual([
      ["symbol", "name", "note"],
      ["BRK-B", "Berkshire Hathaway, Inc.", 'said "hold"\nline two'],
      ["AAPL", "Apple", ""],
    ]);
    expect(table.lines).toEqual([1, 2, 4]);
    expect(table.unterminated).toBe(false);
  });

  it("accepts LF and CR line ends, a byte order mark and a missing final line break", () => {
    expect(parseCsv("\ufeffa,b\nc,d", ",").rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\rc,d\r", ",").rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("skips empty lines but keeps their line numbers for the records after them", () => {
    const table = parseCsv("Positions as of Nov 7\n\nSymbol,Qty\n\nAAPL,25\n", ",");
    expect(table.rows).toEqual([["Positions as of Nov 7"], ["Symbol", "Qty"], ["AAPL", "25"]]);
    expect(table.lines).toEqual([1, 3, 5]);
  });

  it("keeps a line of delimiters as empty fields and keeps unquoted spaces", () => {
    expect(parseCsv(",,\n a , b \n", ",").rows).toEqual([
      ["", "", ""],
      [" a ", " b "],
    ]);
  });

  it("is lenient with spaces around quotes, stray quotes and an unterminated quote", () => {
    expect(parseCsv('AAPL,  "1,234.50"  ,x\n', ",").rows).toEqual([["AAPL", "1,234.50", "x"]]);
    expect(parseCsv('5" screen,ok\n', ",").rows).toEqual([['5" screen', "ok"]]);
    expect(parseCsv('"abc"def,x\n', ",").rows).toEqual([["abcdef", "x"]]);
    const open = parseCsv('a,"unfinished\nmore', ",");
    expect(open.rows).toEqual([["a", "unfinished\nmore"]]);
    expect(open.unterminated).toBe(true);
  });

  it("returns no rows for empty text", () => {
    expect(parseCsv("", ",").rows).toEqual([]);
    expect(parseCsv("\n\n", ",").rows).toEqual([]);
  });
});

describe("sniffDelimiter", () => {
  it("finds comma, semicolon and tab files", () => {
    expect(sniffDelimiter("Symbol,Quantity,Cost\nAAPL,25,201.30\nMSFT,10,415\n")).toBe(",");
    expect(sniffDelimiter("Symbol;Quantity;Cost\nAAPL;25;201,30\nMSFT;10;415,00\n")).toBe(";");
    expect(sniffDelimiter("Symbol\tName\tQty\nBRK-B\tBerkshire Hathaway, Inc.\t10\n")).toBe("\t");
  });

  it("ignores delimiters inside quotes and a title line before the header", () => {
    const schwab = '"Positions for account Individual ...123 as of 09:30 PM ET, 2026/11/06"\n\n"Symbol","Description","Quantity","Price"\n"AAPL","APPLE INC","25","$268.47"\n"MSFT","MICROSOFT CORP","10","$497.10"\n';
    expect(sniffDelimiter(schwab)).toBe(",");
  });

  it("falls back to comma when nothing splits consistently", () => {
    expect(sniffDelimiter("AAPL 25 201.30\nMSFT 10 415")).toBe(",");
    expect(sniffDelimiter("")).toBe(",");
  });
});

describe("stringifyCsv", () => {
  it("quotes only what needs quoting and ends lines with CRLF", () => {
    const text = stringifyCsv([
      ["Symbol", "Name", "Shares"],
      ["BRK-B", "Berkshire Hathaway, Inc.", 10],
      ["X", 'say "hi"', 1.5],
      ["Y", "two\nlines", null],
      ["Z", " padded ", undefined],
    ]);
    expect(text).toBe('Symbol,Name,Shares\r\nBRK-B,"Berkshire Hathaway, Inc.",10\r\nX,"say ""hi""",1.5\r\nY,"two\nlines",\r\nZ," padded ",\r\n');
  });

  it("neutralizes spreadsheet formulas but keeps negative numbers", () => {
    expect(stringifyCsv([["=HYPERLINK(1)", "+1+1", "@SUM(A1)", "-12.30", -5, "-2%"]])).toBe("'=HYPERLINK(1),'+1+1,'@SUM(A1),-12.30,-5,-2%\r\n");
  });

  it("writes non-finite numbers as empty fields and quotes the chosen delimiter", () => {
    expect(stringifyCsv([[Number.NaN, Number.POSITIVE_INFINITY, "a;b", "c,d"]], ";")).toBe(';;"a;b";c,d\r\n');
    expect(stringifyCsv([])).toBe("");
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      ["a", "b,c", 'd"e'],
      ["multi\nline", "", "x"],
    ];
    expect(parseCsv(stringifyCsv(rows)).rows).toEqual(rows);
    expect(parseCsv(stringifyCsv(rows, "\t")).rows).toEqual(rows);
    expect(parseCsv(stringifyCsv(rows, ";")).rows).toEqual(rows);
  });
});

describe("decodeText", () => {
  it("reads UTF-8 with or without a byte order mark", () => {
    const utf8 = new TextEncoder().encode("代码,数量\n");
    expect(decodeText(utf8)).toEqual({ text: "代码,数量\n", encoding: "utf-8" });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])).text).toBe("代码,数量\n");
  });

  it("reads UTF-16 with a byte order mark", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x09, 0x00, 0x31, 0x00]);
    expect(decodeText(le)).toEqual({ text: "A\t1", encoding: "utf-16le" });
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41]);
    expect(decodeText(be)).toEqual({ text: "A", encoding: "utf-16be" });
  });

  it("falls back to GB18030 for bytes that are not UTF-8", () => {
    // "代码" in GBK.
    const gbk = new Uint8Array([0xb4, 0xfa, 0xc2, 0xeb, 0x2c, 0x31]);
    expect(decodeText(gbk)).toEqual({ text: "代码,1", encoding: "gb18030" });
  });
});
