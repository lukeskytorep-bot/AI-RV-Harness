import type { ReactNode } from "react";
import { TooltipButton } from "./TooltipButton";

/** Shared Training history layout; collapse changes presentation only. */
export function HistoryPanelShell({ open, onToggle, panelId, label, className = "", toggleClassName = "", panelClassName = "", children }: {
  open: boolean;
  onToggle(): void;
  panelId: string;
  label: string;
  className?: string;
  toggleClassName?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  return <div className={`training-history-shell ${open ? "open" : "collapsed"} ${className}`.trim()}>
    <TooltipButton className={`training-history-toggle ${toggleClassName}`.trim()} label={label}
      ariaExpanded={open} ariaControls={panelId} onClick={onToggle}>
      <span aria-hidden="true">{open ? "›" : "‹"}</span>
    </TooltipButton>
    <aside id={panelId} className={`training-runs panel ${panelClassName}`.trim()} hidden={!open} aria-hidden={!open}>
      {children}
    </aside>
  </div>;
}
