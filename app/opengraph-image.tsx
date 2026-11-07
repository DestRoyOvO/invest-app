import { ImageResponse } from "next/og";

import { BRAND_COLORS, BRAND_HEAT, markSvg } from "@/components/ui/brand";

export const alt = "InvestSeek: the market terminal that publishes its own track record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Two rows of heatmap tiles: [relative width, index into BRAND_HEAT (0 = down 4, 4 = flat, 8 = up 4)].
const ROWS: Array<Array<[number, number]>> = [
  [[15, 6], [11, 3], [9, 7], [8, 5], [7, 2], [7, 6], [6, 4], [5, 8], [5, 5], [4, 3], [4, 6], [3, 1], [3, 5], [3, 7], [2, 4], [2, 6]],
  [[12, 5], [10, 7], [9, 4], [8, 2], [7, 6], [6, 5], [6, 0], [5, 6], [4, 3], [4, 8], [4, 5], [3, 4], [3, 6], [2, 2], [2, 5], [2, 7]],
];

const CODES = ["MKT", "WL", "GP", "FA", "EVTS"];

/**
 * Social card (1200x630): the wordmark, the product line and a strip of heatmap tiles in the dark theme's colors.
 * Uses only the font bundled with next/og and inline images, so it never fetches anything.
 */
export default function OpenGraphImage() {
  const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg({ size: 64 })).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BRAND_COLORS.background, color: BRAND_COLORS.text }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "56px 72px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
            <img src={mark} width={64} height={64} alt="" />
            <div style={{ display: "flex", fontSize: 52, letterSpacing: -1 }}>
              <span>Invest</span>
              {/* Separate spans lose the kerning between "t" and "S"; pull the second half back. */}
              <span style={{ color: BRAND_COLORS.muted, marginLeft: -4 }}>Seek</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {CODES.map((code) => (
              <div key={code} style={{ display: "flex", padding: "6px 12px", border: `2px solid ${BRAND_COLORS.glyph}80`, borderRadius: 4, color: BRAND_COLORS.glyph, fontSize: 22 }}>
                {code}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", padding: "0 72px" }}>
          <div style={{ display: "flex", maxWidth: 940, fontSize: 68, lineHeight: 1.1, letterSpacing: -1.5 }}>The market terminal that publishes its own track record</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {ROWS.map((row, r) => (
            <div key={r} style={{ display: "flex", gap: 3, height: r === 0 ? 68 : 52 }}>
              {row.map(([weight, step], i) => (
                <div key={i} style={{ display: "flex", flexGrow: weight, flexBasis: 0, background: BRAND_HEAT[step] }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
