import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
export type TrainingTooltipPosition = { left: number; top: number; placement: "above" | "below" };

export function computeTrainingTooltipPosition({
  button, tooltip, viewportWidth, viewportHeight, margin = 10, gap = 8,
}: {
  button: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  tooltip: { width: number; height: number };
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
  gap?: number;
}): TrainingTooltipPosition {
  const maxLeft = Math.max(margin, viewportWidth - margin - tooltip.width);
  const centeredLeft = button.left + button.width / 2 - tooltip.width / 2;
  const left = Math.min(maxLeft, Math.max(margin, centeredLeft));
  const aboveTop = button.top - gap - tooltip.height;
  const belowTop = button.bottom + gap;
  if (aboveTop >= margin) return { left, top: aboveTop, placement: "above" };
  const maxTop = Math.max(margin, viewportHeight - margin - tooltip.height);
  return { left, top: Math.min(maxTop, Math.max(margin, belowTop)), placement: "below" };
}

export function TooltipButton({
  label, children, className, disabled = false, ariaExpanded, ariaControls, onClick,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
  onClick: () => void;
}) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TrainingTooltipPosition | null>(null);

  const place = useCallback(() => {
    if (typeof window === "undefined") return;
    const button = buttonRef.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current?.getBoundingClientRect();
    if (!button || !tooltip || tooltip.width <= 0 || tooltip.height <= 0) return;
    setPosition(computeTrainingTooltipPosition({
      button,
      tooltip,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [label, open, place]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const update = () => place();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, place]);

  return <>
    <button
      ref={buttonRef}
      className={className}
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-describedby={open ? tooltipId : undefined}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={onClick}
    >{children}</button>
    {open && typeof document !== "undefined" && createPortal(
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        className={`training-tooltip ${position?.placement ?? "above"}`}
        style={position ? { left: `${position.left}px`, top: `${position.top}px`, visibility: "visible" } : { left: "0px", top: "0px", visibility: "hidden" }}
      >{label}</div>,
      document.body,
    )}
  </>;
}

