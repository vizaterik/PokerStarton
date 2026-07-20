import { Link } from "react-router-dom";
import { archivedNews, latestNews, type NewsItem } from "../data/news";

function formatDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className="news-card">
      <time className="news-date" dateTime={item.date}>
        {formatDate(item.date)}
      </time>
      <h2 className="news-title">{item.title}</h2>
      <p className="news-summary">{item.summary}</p>
      {item.points.length > 0 ? (
        <ul className="news-points">
          {item.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

type Props = {
  archive?: boolean;
};

export default function NewsPage({ archive = false }: Props) {
  const items = archive ? archivedNews(5) : latestNews(5);
  const hasArchive = archivedNews(5).length > 0;

  return (
    <section className="page news-page">
      <header className="news-page-head">
        <div>
          <h1>{archive ? "Архив новостей" : "Новости"}</h1>
          <p className="lead">
            {archive
              ? "Более ранние обновления приложения."
              : "Что изменилось в приложении — последние 5 обновлений."}
          </p>
        </div>
        {archive ? (
          <Link to="/news" className="news-archive-link">
            ← К новостям
          </Link>
        ) : hasArchive ? (
          <Link to="/news/archive" className="news-archive-link">
            Архив →
          </Link>
        ) : null}
      </header>

      {items.length === 0 ? (
        <p className="muted">{archive ? "Архив пуст." : "Пока нет новостей."}</p>
      ) : (
        <div className="news-list">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {!archive && hasArchive ? (
        <p className="news-archive-foot">
          <Link to="/news/archive">Смотреть архив</Link>
        </p>
      ) : null}
    </section>
  );
}
