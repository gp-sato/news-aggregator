async function getNews() {
  const res = await fetch("http://localhost:3000/api/rss");
  const data = await res.json();
  return data;
}

export default async function NewsPage() {
  const news = await getNews();
  return (
    <div>
      <h1>News</h1>
      <ul>
        {news.items.map((item: any) => (
          <li key={item.link}>
            <a href={item.link}>{item.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
