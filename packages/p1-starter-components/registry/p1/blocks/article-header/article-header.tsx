import "./article-header.css";

export interface ArticleHeaderProps {
  category: string;
  title: string;
  standfirst: string;
  authorName: string;
  authorAvatar: string;
  date: string;
  readTime: string;
  align: "left" | "center";
  rule: "on" | "off";
}

export function ArticleHeaderRender({
  category,
  title,
  standfirst,
  authorName,
  authorAvatar,
  date,
  readTime,
  align,
  rule,
}: ArticleHeaderProps) {
  return (
    <div className="p1-article-header p1-block" data-align={align}>
      <div className="p1-article-header__inner">
        {category && <div className="p1-article-header__category">{category}</div>}
        <h1 className="p1-article-header__title">{title}</h1>
        {standfirst && <p className="p1-article-header__standfirst">{standfirst}</p>}
        <div className="p1-article-header__byline">
          <div className="p1-article-header__avatar">
            {authorAvatar && <img src={authorAvatar} alt={authorName} className="p1-article-header__avatar-img" />}
          </div>
          <div className="p1-article-header__author-info">
            <div className="p1-article-header__author-name">{authorName}</div>
            {(date || readTime) && (
              <div className="p1-article-header__meta">
                {date}
                {date && readTime && <span className="p1-article-header__sep">·</span>}
                {readTime}
              </div>
            )}
          </div>
        </div>
        {rule !== "off" && <hr className="p1-article-header__rule" />}
      </div>
    </div>
  );
}
