import type { ReactNode } from "react";
export function PageHeading({ eyebrow, title, description, action, today = false }: { eyebrow: string; title: string; description: string; action?: ReactNode; today?: boolean }) {
  return <header className={`page-heading ${today ? "today-heading" : ""}`}><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
