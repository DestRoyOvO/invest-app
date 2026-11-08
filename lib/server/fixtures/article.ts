import "server-only";

import { pick } from "./random";

// News article text in fixture mode. Fixture stories (search.ts) link to https://example.com/fixtures/news/<id>; the
// article reader answers those with a canned article, built from the id, and treats every other link as unavailable,
// so a test never reaches the network.

/** Links of fixture news stories start with this. */
export const FIXTURE_NEWS_PREFIX = "https://example.com/fixtures/news/";

const PATTERN = /^https:\/\/example\.com\/fixtures\/news\/([a-z0-9-]{8,64})$/i;

const OPENINGS = [
  "Investors spent the session weighing fresh data on demand, costs and the outlook for interest rates.",
  "Trading was orderly as market participants reviewed company updates and the latest economic releases.",
  "The story drew attention from analysts who follow the sector closely and track its quarterly results.",
];

const BODY = [
  "Executives said they expect conditions to remain broadly stable over the coming months, while noting that pricing and supply remain the main variables to watch.",
  "Several analysts said the update matched their expectations and left their estimates for the full year largely unchanged.",
  "Volumes were close to their recent average, and price moves stayed within the range seen over the past few weeks.",
  "The company plans to share more detail at its next scheduled update, including figures for each of its main business lines.",
  "Market strategists cautioned that a single report rarely changes the longer-term picture and pointed to upcoming data releases.",
];

/** Canned article text for a fixture news link; null for any other link (the article is "unavailable"). */
export function fixtureArticleText(link: string): string | null {
  const match = PATTERN.exec(link.trim());
  if (!match || !link.trim().startsWith(FIXTURE_NEWS_PREFIX)) return null;
  const id = match[1].toLowerCase();
  const paragraphs = [OPENINGS[pick(OPENINGS.length, id, "open")]];
  const start = pick(BODY.length, id, "body");
  for (let i = 0; i < 4; i++) paragraphs.push(BODY[(start + i) % BODY.length]);
  paragraphs.push(`This article is synthetic fixture text (story ${id.slice(0, 8)}) used by InvestSeek's automated tests; it does not describe real events.`);
  return paragraphs.join("\n\n");
}
