import { Icon } from "@/registry/p1/internal/icons";
import "./faq.css";

export interface FaqItem {
  q: string;
  a: string;
}
export interface FaqProps {
  heading: string;
  items: FaqItem[];
}

export function FaqRender({ heading, items }: FaqProps) {
  return (
    <div className="p1-faq p1-block">
      <div className="p1-faq__inner">
        {heading && <h2 className="p1-faq__heading">{heading}</h2>}
        <div className="p1-faq__list">
          {(items || []).map((item, i) => (
            <div key={i} className="p1-faq__item">
              <div className="p1-faq__question-row">
                <h3 className="p1-faq__question">{item.q}</h3>
                <Icon name="plus" className="p1-faq__icon" />
              </div>
              <p className="p1-faq__answer">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
