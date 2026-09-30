import { X } from "lucide-react";
import type { ReactNode } from "react";

export function ResourceViewerDialogShell({ eyebrow, title, meta, children, actions, onClose }: {
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>{eyebrow}</small><h2>{title}</h2>{meta != null && <p>{meta}</p>}</div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        {children}
        {actions != null && <div className="modal-actions">{actions}</div>}
      </section>
    </div>
  );
}
