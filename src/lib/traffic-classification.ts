export type DeviceClass = "desktop" | "mobile" | "tablet" | "unknown";
export type ReferrerGroup = "direct" | "internal" | "search" | "x" | "other";

const BOT_PATTERN = /bot|crawler|spider|preview|facebookexternalhit|twitterbot|slackbot|discordbot|whatsapp|telegrambot|headlesschrome|vercel-screenshot/i;

export function classifyTraffic(headers: Headers, appOrigin: string) {
  const userAgent = headers.get("user-agent") ?? "";
  const mobileHint = headers.get("sec-ch-ua-mobile");
  return {
    deviceClass: classifyDevice(userAgent, mobileHint),
    referrerGroup: classifyReferrer(headers.get("referer"), appOrigin),
    suspectedBot: !userAgent || BOT_PATTERN.test(userAgent),
  } as const;
}

export function classifyDevice(userAgent: string, mobileHint: string | null = null): DeviceClass {
  if (/ipad|tablet|kindle|silk|playbook/i.test(userAgent)) return "tablet";
  if (/android/i.test(userAgent) && !/mobile/i.test(userAgent)) return "tablet";
  if (mobileHint === "?1" || /mobile|iphone|ipod|android/i.test(userAgent)) return "mobile";
  if (/windows|macintosh|linux|cros/i.test(userAgent)) return "desktop";
  return "unknown";
}

export function classifyReferrer(referrer: string | null, appOrigin: string): ReferrerGroup {
  if (!referrer) return "direct";
  try {
    const hostname = new URL(referrer).hostname.toLowerCase();
    const appHostname = new URL(appOrigin).hostname.toLowerCase();
    if (hostname === appHostname || hostname.endsWith(`.${appHostname}`)) return "internal";
    if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com") || hostname === "t.co") return "x";
    if (/^(www\.)?(google|bing|duckduckgo|yahoo|baidu)\./.test(hostname)) return "search";
    return "other";
  } catch {
    return "other";
  }
}
