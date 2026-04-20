import Parser from "rss-parser";

const parser = new Parser();

export async function GET() {
  try {
    const feed = await parser.parseURL("https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja");
    return Response.json(feed);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to fetch RSS feed" }, { status: 500 });
  }
}
