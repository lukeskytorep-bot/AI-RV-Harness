import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function ModuleHelpButton({ label, icon: Icon, expanded, controlsId, onToggle }: {
  label: string;
  icon: LucideIcon;
  expanded: boolean;
  controlsId: string;
  onToggle: () => void;
}) {
  return <button type="button" className="module-help-button" aria-expanded={expanded} aria-controls={controlsId} onClick={onToggle}><Icon size={16} />{label}</button>;
}

export function ModuleHelpPanel({ id, title, icon: Icon, children }: {
  id: string;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return <section id={id} className="module-help-panel" role="region" aria-label={title}>
    <div className="module-help-panel-title"><Icon size={17} /><h2>{title}</h2></div>
    <div className="module-help-content">{children}</div>
  </section>;
}
