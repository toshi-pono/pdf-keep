import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function Help({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 100);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(anchor.right - box.width, window.innerWidth - box.width - 8),
      ),
      top: Math.max(
        8,
        anchor.bottom + box.height + 8 <= window.innerHeight
          ? anchor.bottom + 6
          : anchor.top - box.height - 6,
      ),
    });
  }, [open, children]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimeout(timer.current);
        close();
      }
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="help-anchor" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={trigger}
        type="button"
        className="help-trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={hide}
      >
        ⓘ
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={tooltip}
            role="tooltip"
            className="help-tooltip"
            style={position}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
