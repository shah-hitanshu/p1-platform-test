import "./card-grid.css";

export interface CardGridItem {
  title: string;
  subtitle: string;
  imageUrl: string;
}

export interface CardGridProps {
  heading: string;
  columns: "2" | "3" | "4";
  items: CardGridItem[];
}

export function CardGridRender({ heading, columns, items }: CardGridProps) {
  return (
    <div className="p1-card-grid p1-block">
      <div className="p1-card-grid__inner">
        {heading && <h2 className="p1-card-grid__heading">{heading}</h2>}
        <div className="p1-card-grid__grid" data-columns={columns}>
          {(items || []).map((item, i) => (
            <div key={i} className="p1-card-grid__card">
              {item.imageUrl && (
                <div className="p1-card-grid__img-wrap">
                  <img src={item.imageUrl} alt="" className="p1-card-grid__img" />
                </div>
              )}
              <div className="p1-card-grid__body">
                <div className="p1-card-grid__title">{item.title}</div>
                <div className="p1-card-grid__subtitle">{item.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
