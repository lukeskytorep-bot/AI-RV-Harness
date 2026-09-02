import type { ReactNode } from "react";

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3>{body && <p>{body}</p>}{action}</div>;
}
