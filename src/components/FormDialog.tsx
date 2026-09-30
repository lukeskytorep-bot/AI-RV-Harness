import { X } from "lucide-react";
import type { ReactNode } from "react";

export function FormDialog({ title, onCancel, children, modalClassName = "" }: { title: string; onCancel: () => void; children: ReactNode; modalClassName?: string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><section className={`modal form-modal ${modalClassName}`.trim()} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onCancel}><X size={19} /></button></div>{children}</section></div>;
}
