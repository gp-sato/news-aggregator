import robotsParser from 'robots-parser';

interface CacheEntry {
  parser: ReturnType<typeof robotsParser> | null;
  expiresAt: number;
}

const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間キャッシュ

export class RobotsTxtCache {
  private static cache = new Map<string, CacheEntry>();

  /**
   * 指定したURLが robots.txt によってクロール許可されているか判定します。
   * ホスト単位で robots.txt をキャッシュします。
   */
  static async isAllowed(url: string, userAgent = '*'): Promise<boolean> {
    try {
      const parsedUrl = new URL(url);
      const origin = parsedUrl.origin;
      const robotsUrl = `${origin}/robots.txt`;

      const now = Date.now();
      const cached = this.cache.get(origin);

      let parser: ReturnType<typeof robotsParser> | null = null;

      if (cached && cached.expiresAt > now) {
        parser = cached.parser;
      } else {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // タイムアウト5秒
          const res = await fetch(robotsUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });

          if (res.ok) {
            const text = await res.text();
            parser = robotsParser(robotsUrl, text);
          } else {
            console.log(`robots.txt not found (Status ${res.status}) for ${origin}, treating as Fail Open.`);
          }
          clearTimeout(timeoutId);
        } catch (error) {
          console.warn(`Failed to fetch robots.txt for ${origin}, treating as Fail Open:`, error);
        }

        this.cache.set(origin, {
          parser,
          expiresAt: now + ROBOTS_CACHE_TTL_MS,
        });
      }

      if (!parser) {
        // robots.txt 取得失敗または 404 等の場合は Fail Open
        return true;
      }

      return parser.isAllowed(url, userAgent) ?? true;
    } catch (e) {
      console.error(`Invalid URL provided to RobotsTxtCache: ${url}`, e);
      return true; // 不正なURLでも Fail Open
    }
  }
}
