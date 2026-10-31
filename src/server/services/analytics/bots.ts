/**
 * Crawler and automation filter for the beacon. Real browsers always send a normal user agent, so a
 * missing/very short one, or one that names a bot, a crawler, a headless browser or a scripting
 * library, is dropped silently (the response is still 204, so scrapers learn nothing).
 */
const BOT_PATTERN =
  /(?<!cu)bot|crawl|spider|slurp|scrape|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|facebookexternalhit|whatsapp|telegram|preview|curl\/|wget|httpie|python-requests|python-urllib|aiohttp|go-http-client|java\/|okhttp|libwww|node-fetch|axios\/|undici|postman|phantomjs|selenium|puppeteer|playwright|chrome-lighthouse|vercel|mediapartners|bingpreview|yandex|baidu|duckduck|semrush|ahrefs|mj12|dotbot/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 20) return true;
  return BOT_PATTERN.test(userAgent);
}
