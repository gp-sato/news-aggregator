import Parser from "rss-parser";

const parser = new Parser();

const SOURCES = [
  {
    id: "google",
    name: "Google News",
    url: "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    id: "nhk",
    name: "NHK ニュース",
    url: "https://news.web.nhk/n-data/conf/na/rss/cat0.xml",
  },
  {
    id: "bbc",
    name: "BBC News (JP)",
    url: "https://feeds.bbci.co.uk/japanese/rss.xml",
  },
  {
    id: "itmedia",
    name: "ITmedia",
    url: "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml",
  },
];

export async function GET() {
  try {
    const feedPromises = SOURCES.map(async (source) => {
      try {
        const feed = await parser.parseURL(source.url);
        return feed.items.map((item) => ({
          ...item,
          sourceName: source.name,
          sourceId: source.id,
        }));
      } catch (error) {
        console.error(`Failed to fetch ${source.name}:`, error);
        return [];
      }
    });

    const allFeeds = await Promise.all(feedPromises);
    const flattenedItems = allFeeds.flat();

    // Sort by date (newest first)
    // rss-parser provides isoDate for most feeds
    const sortedItems = flattenedItems.sort((a, b) => {
      const dateA = new Date(a.isoDate || a.pubDate || 0);
      const dateB = new Date(b.isoDate || b.pubDate || 0);
      return dateB.getTime() - dateA.getTime();
    });

    return Response.json({ items: sortedItems });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to fetch feeds" }, { status: 500 });
  }
}
