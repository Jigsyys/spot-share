import { useRef, useCallback } from "react"

/**
 * Returns a ref to attach to a scrollable container.
 * When the user swipes down from scrollTop=0, calls onClose.
 */
export function useSwipeToClose(onClose: () => void, disabled = false) {
  const ref = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)
  const startScrollTop = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return
    startY.current = e.touches[0].clientY
    startScrollTop.current = ref.current?.scrollTop ?? 0
  }, [disabled])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (disabled || startY.current === null) return
    const dy = e.changedTouches[0].clientY - startY.current
    // Only close when scroll was at top AND user swiped down far enough
    if (startScrollTop.current === 0 && dy > 80) {
      onClose()
    }
    startY.current = null
  }, [disabled, onClose])

  return { ref, onTouchStart, onTouchEnd }
}
