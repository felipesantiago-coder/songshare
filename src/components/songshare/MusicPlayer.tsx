'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { formatTime } from './utils'
import { Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useSongShareStore } from '@/store/songshare'
import { isLrcFormat } from '@/lib/lrc-parser'

interface MusicPlayerProps {
  audioRef: RefObject<HTMLAudioElement | null>
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrevious: () => void
}

export function MusicPlayer({
  audioRef,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrevious,
}: MusicPlayerProps) {
  const { room, socket } = useSongShareStore()
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  // Smooth progress: read audio.currentTime directly via rAF (no Zustand re-renders)
  const [smoothTime, setSmoothTime] = useState(0)
  const rafRef = useRef<number>(0)

  const isHost = room?.hostId === socket?.id
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  const hasSyncedLyrics = currentTrack?.lyrics ? isLrcFormat(currentTrack.lyrics) : false

  // rAF loop reads audio element directly for smooth progress (~10fps)
  // This avoids updating Zustand store on every timeupdate, preventing
  // all room subscribers from re-rendering 4x/sec
  useEffect(() => {
    let active = true
    let lastUpdate = 0
    const tick = () => {
      if (!active) return
      const now = performance.now()
      if (now - lastUpdate >= 100) {
        lastUpdate = now
        setSmoothTime(audioRef.current?.currentTime ?? 0)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [audioRef])

  const handleSeek = useCallback((value: number[]) => {
    onSeek(value[0])
  }, [onSeek])

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [audioRef, isMuted])

  const handleVolumeChange = useCallback((value: number[]) => {
    const vol = value[0]
    if (vol > 0 && isMuted) {
      setIsMuted(false)
      if (audioRef.current) audioRef.current.muted = false
    }
    setVolume(vol)
    if (audioRef.current) {
      audioRef.current.volume = vol
    }
  }, [audioRef, isMuted])

  // Volume popup state — toggle-based, closes on outside tap
  const [showVolume, setShowVolume] = useState(false)
  const volumePopupRef = useRef<HTMLDivElement>(null)
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggleVolumePopup = useCallback(() => {
    setShowVolume((prev) => {
      if (prev && volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current)
        volumeTimeoutRef.current = null
      }
      return !prev
    })
  }, [])

  const scheduleVolumeClose = useCallback(() => {
    if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current)
    volumeTimeoutRef.current = setTimeout(() => setShowVolume(false), 2500)
  }, [])

  const cancelVolumeClose = useCallback(() => {
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current)
      volumeTimeoutRef.current = null
    }
  }, [])

  // Close volume popup on outside tap (mobile) or mouse leave (desktop)
  useEffect(() => {
    if (!showVolume) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const popup = volumePopupRef.current
      if (popup && !popup.contains(e.target as Node)) {
        setShowVolume(false)
      }
    }

    // Delay adding listener to avoid immediate close from the toggle click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside, { passive: true })
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [showVolume])

  // Volume icon based on level
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className="w-full">
      {/* Now playing info */}
      <div className="flex items-center gap-3 sm:gap-3 mb-2 sm:mb-4 min-w-0">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
          <div className={`w-4 h-4 sm:w-3.5 sm:h-3.5 rounded-full ${currentTrack ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm sm:text-sm font-semibold text-white truncate">
            {currentTrack?.name || 'Nenhuma musica selecionada'}
            {hasSyncedLyrics && (
              <FileText className="w-3 h-3 text-rose-400 ml-1.5 inline-block" title="Letra sincronizada" />
            )}
          </p>
          <p className="text-xs sm:text-xs text-zinc-500 truncate">
            {currentTrack?.artist || 'Adicione musicas para comecar'}
          </p>
        </div>
        {/* Volume — integrated on the right side of now playing info */}
        <div ref={volumePopupRef} className="relative flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              toggleVolumePopup()
            }}
            className="text-zinc-400 hover:text-white h-9 w-9 rounded-full"
          >
            <VolumeIcon className="w-4 h-4" />
          </Button>

          {/* Volume slider popup */}
          {showVolume && (
            <div
              className="absolute bottom-full right-0 mb-2 bg-zinc-800 border border-zinc-700/50 rounded-xl p-3 shadow-xl shadow-black/50 z-50"
              onMouseEnter={cancelVolumeClose}
              onMouseLeave={scheduleVolumeClose}
              onTouchStart={cancelVolumeClose}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-2" style={{ height: '120px' }}>
                <button
                  onClick={toggleMute}
                  className="text-zinc-400 hover:text-white transition-colors active:scale-90"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  min={0}
                  step={0.01}
                  onValueChange={(v) => {
                    handleVolumeChange(v)
                    cancelVolumeClose()
                    scheduleVolumeClose()
                  }}
                  onPointerDown={cancelVolumeClose}
                  orientation="vertical"
                  className="h-[70px] [&_[data-slot=slider-track]]:w-1.5 [&_[data-slot=slider-thumb]]:h-5 [&_[data-slot=slider-thumb]]:w-5 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 [&_[data-slot=slider-range]]:bg-rose-500"
                />
                <span className="text-[10px] text-zinc-500 font-medium tabular-nums">
                  {Math.round((isMuted ? 0 : volume) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar — enabled for both host and guests */}
      <div className="space-y-1 mb-2 sm:mb-3">
        <Slider
          value={[smoothTime]}
          max={currentTrack?.duration || 100}
          step={0.1}
          onValueChange={currentTrack ? handleSeek : undefined}
          disabled={!currentTrack}
          className="w-full [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:h-5 [&_[data-slot=slider-thumb]]:w-5 sm:[&_[data-slot=slider-thumb]]:h-4 sm:[&_[data-slot=slider-thumb]]:w-4 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 sm:[&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-range]]:bg-rose-500"
        />
        <div className="flex justify-between text-xs sm:text-xs text-zinc-500">
          <span>{formatTime(smoothTime)}</span>
          <span>{currentTrack ? formatTime(currentTrack.duration) : '0:00'}</span>
        </div>
      </div>

      {/* Transport controls — enabled for both host and guests */}
      <div className="flex items-center justify-center gap-5 sm:gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          disabled={!currentTrack}
          className="text-zinc-400 hover:text-white h-11 w-11 sm:h-10 sm:w-10 rounded-full active:scale-95"
        >
          <SkipBack className="w-5 h-5 sm:w-4 sm:h-4" />
        </Button>

        <Button
          size="icon"
          onClick={room?.isPlaying ? onPause : onPlay}
          disabled={!currentTrack}
          className="h-14 w-14 sm:h-14 sm:w-14 rounded-full bg-white text-zinc-900 hover:bg-zinc-200 shadow-lg shadow-white/10 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
        >
          {room?.isPlaying ? (
            <Pause className="w-6 h-6 sm:w-6 sm:h-6" />
          ) : (
            <Play className="w-6 h-6 sm:w-6 sm:h-6 ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!currentTrack}
          className="text-zinc-400 hover:text-white h-11 w-11 sm:h-10 sm:w-10 rounded-full active:scale-95"
        >
          <SkipForward className="w-5 h-5 sm:w-4 sm:h-4" />
        </Button>
      </div>

      {!isHost && currentTrack && (
        <p className="text-[10px] text-zinc-600 text-center mt-1.5">
          Controle local — use para ajustar sua reproducao
        </p>
      )}
    </div>
  )
}
