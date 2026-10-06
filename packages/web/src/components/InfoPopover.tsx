import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8;

/** A small "i" icon that shows rich content (tables, lists) on hover or
 * keyboard focus. The popover is portalled to <body> with fixed positioning
 * so scroll containers can't clip it, is kept inside the viewport, and stays
 * open while the pointer moves from the icon into it. */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const show = () => {
    cancelClose();
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left });
    setOpen(true);
  };
  const hide = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };

  // Keep the popover on screen: shift left if it overflows the right edge,
  // flip above the icon if it overflows the bottom.
  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || !anchorRef.current) return;
    const pop = popRef.current.getBoundingClientRect();
    const anchor = anchorRef.current.getBoundingClientRect();
    let { top, left } = pos;
    if (left + pop.width > window.innerWidth - MARGIN) left = Math.max(MARGIN, window.innerWidth - MARGIN - pop.width);
    if (top + pop.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, anchor.top - 6 - pop.height);
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Only a scroll that moves the icon (its own container, or the page)
    // invalidates the position — not, say, the live log auto-scrolling.
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target === document || (target instanceof Node && target.contains(anchorRef.current))) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  return (
    <>
      <span
        ref={anchorRef}
        className="info-icon"
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
      >
        i
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="info-popover"
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={hide}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
