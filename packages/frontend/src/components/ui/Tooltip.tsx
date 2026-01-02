import { cn } from "@/utils/cn";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  children: ReactNode;
  content: string;
  position?: TooltipPosition;
  className?: string;
}

interface TooltipCoords {
  x: number;
  y: number;
  actualPosition: TooltipPosition;
}

const OFFSET = 8;
const VIEWPORT_PADDING = 8;

export function Tooltip({ children, content, position = "top", className }: TooltipProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const positions: Record<TooltipPosition, { x: number; y: number }> = {
      top: {
        x: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        y: triggerRect.top - tooltipRect.height - OFFSET,
      },
      bottom: {
        x: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        y: triggerRect.bottom + OFFSET,
      },
      left: {
        x: triggerRect.left - tooltipRect.width - OFFSET,
        y: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
      },
      right: {
        x: triggerRect.right + OFFSET,
        y: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
      },
    };

    const fitsInViewport = (pos: TooltipPosition): boolean => {
      const { x, y } = positions[pos];
      switch (pos) {
        case "top":
          return y >= VIEWPORT_PADDING;
        case "bottom":
          return y + tooltipRect.height <= viewportHeight - VIEWPORT_PADDING;
        case "left":
          return x >= VIEWPORT_PADDING;
        case "right":
          return x + tooltipRect.width <= viewportWidth - VIEWPORT_PADDING;
      }
    };

    const fallbackOrder: Record<TooltipPosition, TooltipPosition[]> = {
      top: ["top", "bottom", "right", "left"],
      bottom: ["bottom", "top", "right", "left"],
      left: ["left", "right", "top", "bottom"],
      right: ["right", "left", "top", "bottom"],
    };

    let actualPosition = position;
    for (const pos of fallbackOrder[position]) {
      if (fitsInViewport(pos)) {
        actualPosition = pos;
        break;
      }
    }

    let { x, y } = positions[actualPosition];

    // Clamp horizontal position
    if (actualPosition === "top" || actualPosition === "bottom") {
      x = Math.max(VIEWPORT_PADDING, Math.min(x, viewportWidth - tooltipRect.width - VIEWPORT_PADDING));
    }

    // Clamp vertical position
    if (actualPosition === "left" || actualPosition === "right") {
      y = Math.max(VIEWPORT_PADDING, Math.min(y, viewportHeight - tooltipRect.height - VIEWPORT_PADDING));
    }

    setCoords({ x, y, actualPosition });
  }, [position]);

  useEffect(() => {
    if (isVisible) {
      // Use requestAnimationFrame to ensure tooltip is rendered before calculating position
      requestAnimationFrame(calculatePosition);
    }
  }, [isVisible, calculatePosition]);

  const handleMouseEnter = useCallback(() => {
    setIsVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsVisible(false);
    setCoords(null);
  }, []);

  const arrowStyles: Record<TooltipPosition, string> = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-x-transparent border-b-transparent",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-x-transparent border-t-transparent",
    left: "left-full top-1/2 -translate-y-1/2 border-l-gray-900 border-y-transparent border-r-transparent",
    right: "right-full top-1/2 -translate-y-1/2 border-r-gray-900 border-y-transparent border-l-transparent",
  };

  const tooltipElement = (
    <div
      ref={tooltipRef}
      role="tooltip"
      style={{
        position: "fixed",
        left: coords?.x ?? -9999,
        top: coords?.y ?? -9999,
        zIndex: 9999,
      }}
      className={cn(
        "pointer-events-none w-max max-w-sm rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-lg transition-opacity duration-150",
        isVisible && coords ? "opacity-100" : "opacity-0"
      )}
    >
      {content}
      <div
        className={cn(
          "absolute h-0 w-0 border-[6px]",
          arrowStyles[coords?.actualPosition ?? position]
        )}
      />
    </div>
  );

  return (
    <>
      <div
        ref={triggerRef}
        className={cn("inline-flex", className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {isVisible && createPortal(tooltipElement, document.body)}
    </>
  );
}
