'use client'

import { useEffect, useRef, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FileText } from 'lucide-react'
import type { LrcLine } from '@/lib/lrc-parser'
import { findActiveLine } from '@/lib/lrc-parser'

interface SyncedLyricsViewProps {
  lines: LrcLine[]
  currentTime: number
  isPlaying: boolean
  className?: string
}

export function SyncedLyricsView({
  lines,
  currentTime,
  isPlaying,
  className = '',
}: SyncedLyricsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isAutoScrolling = useRef(false)

  // Only consider timed lines (not metadata) for display
  const timedLines = useMemo(
    () => lines.filter((l) => l.time >= 0),
    [lines]
  )

  const activeIndex = useMemo(
    () => findActiveLine(timedLines, currentTime),
    [timedLines, currentTime]
  )

  // Auto-scroll to keep active line centered
  const scrollToLine = useCallback((index: number) => {
    if (!containerRef.current || index < 0) return
    const container = containerRef.current
    const lineEl = container.querySelector(`[data-line-index="${index}"]`)
    if (!lineEl) return

    isAutoScrolling.current = true
    const containerRect = container.getBoundingClientRect()
    const lineRect = lineEl.getBoundingClientRect()
    const offset =
      lineRect.top -
      containerRect.top -
      containerRect.height / 2 +
      lineRect.height / 2

    container.scrollTo({
      top: container.scrollTop + offset,
      behavior: 'smooth',
    })

    // Reset auto-scroll flag after animation completes
    setTimeout(() => {
      isAutoScrolling.current = false
    }, 500)
  }, [])

  useEffect(() => {
    scrollToLine(activeIndex)
  }, [activeIndex, scrollToLine])

  // Reset scroll when track changes (lines change)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
    }
  }, [lines])

  if (timedLines.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-center ${className}`}
      >
        <div className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center mb-3">
          <FileText className="w-5 h-5 text-zinc-600" />
        </div>
        <p className="text-sm text-zinc-500">Sem letra sincronizada</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto scroll-smooth no-scrollbar ${className}`}
    >
      {/* Top padding so first line can be centered */}
      <div className="h-[40%]" />

      <div className="space-y-1 px-1">
        {timedLines.map((line, index) => {
          const isActive = index === activeIndex
          const isPast = index < activeIndex
          const isNear = !isPast && !isActive && index <= activeIndex + 3

          return (
            <motion.div
              key={`${index}-${line.time}`}
              data-line-index={index}
              layout
              transition={{
                type: 'tween',
                duration: 0.3,
                ease: 'easeOut',
              }}
              className={`
                py-1.5 px-3 rounded-lg text-center transition-all duration-300 ease-out
                cursor-default select-none
                ${
                  isActive
                    ? 'text-rose-400 font-semibold text-base scale-[1.05]'
                    : isPast
                      ? 'text-zinc-600 text-sm opacity-60'
                      : isNear
                        ? 'text-zinc-300 text-sm'
                        : 'text-zinc-500 text-sm'
                }
              `}
              style={
                isActive
                  ? {
                      textShadow: '0 0 20px rgba(244, 63, 94, 0.3)',
                    }
                  : undefined
              }
            >
              {line.text || '♪'}
            </motion.div>
          )
        })}
      </div>

      {/* Bottom padding so last line can be centered */}
      <div className="h-[40%]" />
    </div>
  )
}
