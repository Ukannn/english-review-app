import type { ReactNode } from "react";
export function PageHeading({ eyebrow, title, description, action, today = false }: { eyebrow: string; title: string; description: string; action?: ReactNode; today?: boolean }) {
  return <header className={`page-heading ${today ? "today-heading" : ""}`}><div><p className="eyebrow">{eyebrow}</p><h1>{title}{today && title.includes("已完成") && <span className="title-check" aria-hidden="true">✓</span>}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}
