import type { LookupAddress } from "node:dns";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSafeLookup,
  extractArticleText,
  fetchArticleText,
  isAllowedArticleHost,
  isPublicIpAddress,
  MAX_ARTICLE_CHARS,
  parseArticleUrl,
  parseIPv6,
  type ArticleResponse,
  type ArticleTransport,
} from "./article";

const PARAGRAPH = "Shares of the company rose after it reported quarterly revenue ahead of analyst expectations.";

function articleHtml(paragraphs: string[], extra = ""): string {
  return `<!doctype html><html><head><meta name="oath:guce:consent-host" content="guce.yahoo.com" /><script>var x = "<p>not text</p>";</script></head>
<body><nav><p>Navigation link text that is long enough to count as a paragraph.</p></nav>
<article><div class="article-wrap"><div class="body">
<div class="tooltip-content"><p>The above button links to a broker. This site is not a broker-dealer or adviser.</p></div>
${paragraphs.map((text) => `<p>${text}</p>`).join("\n")}
</div></div></article>${extra}</body></html>`;
}

describe("parseArticleUrl", () => {
  it("accepts https URLs on allowlisted hosts and their subdomains", () => {
    for (const url of [
      "https://finance.yahoo.com/news/some-story-123.html",
      "https://uk.finance.yahoo.com/news/x.html",
      "https://yahoo.com/x",
      "https://www.reuters.com/markets/us/story/",
      "https://www.fool.com/investing/2026/11/07/x/",
      "https://FINANCE.YAHOO.COM./news/x.html",
      "https://finance.yahoo.com:443/news/x.html",
    ]) {
      expect(parseArticleUrl(url), url).not.toBeNull();
    }
  });

  it("drops the fragment", () => {
    expect(parseArticleUrl("https://www.cnbc.com/a.html#section")?.href).toBe("https://www.cnbc.com/a.html");
  });

  it("rejects other schemes, credentials, ports and malformed input", () => {
    for (const url of [
      "http://finance.yahoo.com/news/x.html",
      "ftp://finance.yahoo.com/x",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://user:pass@finance.yahoo.com/x",
      "https://finance.yahoo.com:8443/x",
      "not a url",
      "",
      `https://finance.yahoo.com/${"a".repeat(2100)}`,
    ]) {
      expect(parseArticleUrl(url), url).toBeNull();
    }
  });

  it("rejects hosts outside the allowlist, including look-alikes", () => {
    for (const url of [
      "https://finance.yahoo.com.evil.com/news/x.html",
      "https://evilyahoo.com/x",
      "https://yahoo.com-news.example/x",
      "https://reuters.com.attacker.net/x",
      "https://example.com/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data/",
      "https://xn--yhoo-5qa.com/",
    ]) {
      expect(parseArticleUrl(url), url).toBeNull();
    }
  });

  it("rejects Yahoo consent hosts", () => {
    expect(parseArticleUrl("https://consent.yahoo.com/v2/collectConsent?sessionId=1")).toBeNull();
    expect(parseArticleUrl("https://guce.yahoo.com/consent")).toBeNull();
  });

  it("matches domains on label boundaries", () => {
    expect(isAllowedArticleHost("news.bloomberg.com")).toBe(true);
    expect(isAllowedArticleHost("notbloomberg.com")).toBe(false);
    expect(isAllowedArticleHost("bloomberg.com.cn")).toBe(false);
  });
});

describe("isPublicIpAddress", () => {
  it("rejects non-public IPv4 addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.255",
      "0.0.0.0",
      "0.1.2.3",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
      "192.0.2.10",
      "198.18.0.1",
    ]) {
      expect(isPublicIpAddress(ip), ip).toBe(false);
    }
  });

  it("accepts public IPv4 addresses next to the blocked ranges", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "69.147.92.11", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1"]) {
      expect(isPublicIpAddress(ip), ip).toBe(true);
    }
  });

  it("rejects non-public IPv6 addresses, including IPv4-mapped forms", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "fe80::1%eth0",
      "febf::1",
      "fec0::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::127.0.0.1",
      "64:ff9b::7f00:1",
      "64:ff9b::a00:1",
      "2001:db8::1",
      "2001::1",
      "2002:7f00:1::1",
      "100::1",
    ]) {
      expect(isPublicIpAddress(ip), ip).toBe(false);
    }
  });

  it("accepts public IPv6 addresses", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4009:81e::200e", "::ffff:8.8.8.8", "64:ff9b::808:808", "[2001:4860:4860::8888]"]) {
      expect(isPublicIpAddress(ip), ip).toBe(true);
    }
  });

  it("treats anything unparsable as not public", () => {
    for (const value of ["", "localhost", "1.2.3", "1.2.3.4.5", "256.1.1.1", "01.2.3.4", "1::2::3", "12345::1", ":::"]) {
      expect(isPublicIpAddress(value), value).toBe(false);
    }
  });

  it("parses IPv6 forms", () => {
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6("2001:db8::8a2e:370:7334")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0x8a2e, 0x370, 0x7334]);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6("1:2:3:4:5:6:7")).toBeNull();
    expect(parseIPv6("1:2:3:4::5:6:7:8")).toBeNull();
  });
});

describe("createSafeLookup", () => {
  type Callback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

  function runLookup(addresses: LookupAddress[] | Error, options: { all?: boolean; family?: number } = {}) {
    const lookup = createSafeLookup(() => (addresses instanceof Error ? Promise.reject(addresses) : Promise.resolve(addresses)));
    return new Promise<{ error: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>((resolve) => {
      const callback: Callback = (error, address, family) => resolve({ error, address, family });
      lookup("news.example", options, callback);
    });
  }

  it("passes public answers through in both callback shapes", async () => {
    const answers: LookupAddress[] = [
      { address: "69.147.92.11", family: 4 },
      { address: "2606:4700::1", family: 6 },
    ];
    expect(await runLookup(answers)).toEqual({ error: null, address: "69.147.92.11", family: 4 });
    expect(await runLookup(answers, { all: true })).toEqual({ error: null, address: answers, family: undefined });
    expect(await runLookup(answers, { family: 6 })).toEqual({ error: null, address: "2606:4700::1", family: 6 });
  });

  it("refuses hosts with any non-public answer", async () => {
    const blocked = await runLookup([{ address: "127.0.0.1", family: 4 }]);
    expect(blocked.error?.code).toBe("ERR_ARTICLE_BLOCKED_ADDRESS");
    const mixed = await runLookup(
      [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
      { all: true },
    );
    expect(mixed.error?.code).toBe("ERR_ARTICLE_BLOCKED_ADDRESS");
    expect((await runLookup([{ address: "::ffff:192.168.0.1", family: 6 }])).error?.code).toBe("ERR_ARTICLE_BLOCKED_ADDRESS");
  });

  it("reports empty answers and resolver failures as errors", async () => {
    expect((await runLookup([])).error?.code).toBe("ENOTFOUND");
    expect((await runLookup(new Error("dns down"))).error?.message).toBe("dns down");
    expect((await runLookup([{ address: "8.8.8.8", family: 4 }], { family: 6 })).error?.code).toBe("ENOTFOUND");
  });
});

describe("extractArticleText", () => {
  it("returns the article paragraphs without scripts, navigation or tooltip boilerplate", () => {
    const text = extractArticleText(articleHtml([PARAGRAPH, `${PARAGRAPH} Guidance was raised for the full year.`, PARAGRAPH, "Too short."]));
    expect(text).toBe(`${PARAGRAPH}\n\n${PARAGRAPH} Guidance was raised for the full year.`);
  });

  it("is not fooled by the consent-host meta tag that normal Yahoo pages carry", () => {
    expect(extractArticleText(articleHtml([PARAGRAPH, `${PARAGRAPH} Second.`, `${PARAGRAPH} Third.`]))).not.toBeNull();
  });

  it("returns null for consent walls and thin pages", () => {
    const consent = articleHtml([PARAGRAPH, `${PARAGRAPH} 2`, `${PARAGRAPH} 3`], '<form action="https://consent.yahoo.com/v2/collectConsent" method="post"></form>');
    expect(extractArticleText(consent)).toBeNull();
    expect(extractArticleText(articleHtml([PARAGRAPH]))).toBeNull();
    expect(extractArticleText("<html><body><p>Hi</p></body></html>")).toBeNull();
  });

  it("caps the text at 6000 characters", () => {
    const paragraphs = Array.from({ length: 120 }, (_, i) => `${PARAGRAPH} Paragraph number ${i}.`);
    const text = extractArticleText(articleHtml(paragraphs)) ?? "";
    expect(text.length).toBeLessThanOrEqual(MAX_ARTICLE_CHARS);
    expect(text.length).toBeGreaterThan(MAX_ARTICLE_CHARS - 200);
  });

  it("falls back to generic containers", () => {
    const html = `<html><body><main>${[1, 2, 3].map((i) => `<p>${PARAGRAPH} (${i})</p>`).join("")}</main></body></html>`;
    expect(extractArticleText(html)?.split("\n\n")).toHaveLength(3);
  });
});

describe("fetchArticleText", () => {
  const html = articleHtml([PARAGRAPH, `${PARAGRAPH} Second paragraph.`, `${PARAGRAPH} Third paragraph.`]);

  function ok(body = html, contentType = "text/html; charset=utf-8"): ArticleResponse {
    return { status: 200, location: null, contentType, body };
  }

  function redirect(location: string, status = 302): ArticleResponse {
    return { status, location, contentType: null, body: null };
  }

  function transportOf(...responses: ArticleResponse[]) {
    const calls: string[] = [];
    const transport: ArticleTransport = async (url) => {
      calls.push(url.href);
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    };
    return { transport, calls };
  }

  it("returns the extracted text for an allowlisted page", async () => {
    const { transport, calls } = transportOf(ok());
    const text = await fetchArticleText("https://finance.yahoo.com/news/a.html", { transport });
    expect(text).toContain(PARAGRAPH);
    expect(calls).toEqual(["https://finance.yahoo.com/news/a.html"]);
  });

  it("never sends a request for a disallowed URL", async () => {
    const { transport, calls } = transportOf(ok());
    expect(await fetchArticleText("http://finance.yahoo.com/news/a.html", { transport })).toBeNull();
    expect(await fetchArticleText("https://intranet.local/a.html", { transport })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("follows allowlisted redirects and validates every hop", async () => {
    const { transport, calls } = transportOf(redirect("/news/b.html", 301), redirect("https://www.reuters.com/c", 307), ok());
    expect(await fetchArticleText("https://finance.yahoo.com/news/a.html", { transport })).not.toBeNull();
    expect(calls).toEqual(["https://finance.yahoo.com/news/a.html", "https://finance.yahoo.com/news/b.html", "https://www.reuters.com/c"]);
  });

  it("stops at redirects to disallowed targets", async () => {
    for (const location of ["https://evil.example/", "http://finance.yahoo.com/x", "https://127.0.0.1/", "https://finance.yahoo.com:8080/x", "https://user@finance.yahoo.com/x"]) {
      const { transport, calls } = transportOf(redirect(location), ok());
      expect(await fetchArticleText("https://finance.yahoo.com/news/a.html", { transport }), location).toBeNull();
      expect(calls).toHaveLength(1);
    }
  });

  it("treats a redirect to the consent wall as unavailable", async () => {
    const { transport, calls } = transportOf(redirect("https://guce.yahoo.com/consent?brandType=nonEu"), ok());
    expect(await fetchArticleText("https://finance.yahoo.com/news/a.html", { transport })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("gives up after three redirects", async () => {
    const hops = ["b", "c", "d", "e"].map((page) => redirect(`https://finance.yahoo.com/news/${page}.html`));
    const { transport, calls } = transportOf(...hops, ok());
    expect(await fetchArticleText("https://finance.yahoo.com/news/a.html", { transport })).toBeNull();
    expect(calls).toHaveLength(4);
  });

  it("requires a successful HTML response", async () => {
    expect(await fetchArticleText("https://finance.yahoo.com/a", { transport: transportOf({ status: 404, location: null, contentType: "text/html", body: null }).transport })).toBeNull();
    expect(await fetchArticleText("https://finance.yahoo.com/a", { transport: transportOf(ok(html, "application/json")).transport })).toBeNull();
    expect(await fetchArticleText("https://finance.yahoo.com/a", { transport: transportOf(ok(html, "text/html-sandboxed")).transport })).toBeNull();
    expect(await fetchArticleText("https://finance.yahoo.com/a", { transport: transportOf(redirect("")).transport })).toBeNull();
  });

  it("returns null when the transport fails (timeouts, blocked addresses, TLS errors)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: ArticleTransport = async () => {
      throw Object.assign(new Error("blocked"), { code: "ERR_ARTICLE_BLOCKED_ADDRESS" });
    };
    expect(await fetchArticleText("https://finance.yahoo.com/a", { transport: failing })).toBeNull();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      event: "article.fetch_failed",
      host: "finance.yahoo.com",
      reason: "ERR_ARTICLE_BLOCKED_ADDRESS",
    });
    warn.mockRestore();
  });

  it("honours an already aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport, calls } = transportOf(ok());
    expect(await fetchArticleText("https://finance.yahoo.com/a", { transport, signal: controller.signal })).toBeNull();
    expect(calls).toEqual([]);
  });
});
