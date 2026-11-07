import { ImageResponse } from "next/og";

import { BRAND_COLORS, markSvg } from "@/components/ui/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The glyph covers the middle 60%, inside the safe zone of masked launcher icons.
const GLYPH = 108;

/** Home-screen icon: the prompt-candle mark on the brand background, full bleed (iOS rounds the corners itself). */
export default function AppleIcon() {
  const src = `data:image/svg+xml;base64,${Buffer.from(markSvg({ size: GLYPH })).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND_COLORS.background }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements, not next/image */}
        <img src={src} width={GLYPH} height={GLYPH} alt="" />
      </div>
    ),
    size,
  );
}
