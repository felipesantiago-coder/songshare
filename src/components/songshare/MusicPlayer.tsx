'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import { formatTime } from './utils'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useSongShareStore } from '@/store/songshare'

interface MusicPlayerProps {
  audioRef: React.RefObject<HTMLAudioElement | null>
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
  const { room, socket, audioCache } = useSongShareStore()
  const [isMuted, setIsMuted] = React.useState(false)
  const [volume, setVolume] = React.useState(1)
  const [localTime, setLocalTime] = React.useState(0)

  const isHost = room?.hostId === socket?.id
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  const audioUrl = currentTrack ? audioCache.get(currentTrack.id) : null

  // Update local time from audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setLocalTime(audio.currentTime)
    }

    const handleEnded = () => {
      if (isHost) {
        onNext()
      }
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [audioRef, isHost, onNext])

  // Sync when host changes track
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return

    const url = audioCache.get(currentTrack.id)
    if (url && audio.src !== url) {
      audio.src = url
      if (room?.isPlaying) {
        audio.currentTime = room.currentTime || 0
        audio.play().catch(() => {})
      }
    }
  }, [currentTrack?.id, audioCache, room?.isPlaying])

  const handleSeek = useCallback((value: number[]) => {
    const time = value[0]
    setLocalTime(time)
    onSeek(time)
  }, [onSeek])

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [audioRef, isMuted])

  const handleVolumeChange = useCallback((value: number[]) => {
    const vol = value[0]
    setVolume(vol)
    if (audioRef.current) {
      audioRef.current.volume = vol
    }
  }, [audioRef])

  const progress = currentTrack ? (localTime / currentTrack.duration) * 100 : 0

  return (
    <div className="w-full">
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" />

      {/* Now playing info - larger on mobile */}
      <div className="flex items-center gap-3 sm:gap-3 mb-4 min-w-0">
        <div className="w-12 h-12 sm:w-10 sm:h-10 rounded-xl sm:rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
          <div className={`w-4 h-4 sm:w-3 sm:h-3 rounded-full ${currentTrack ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm sm:text-sm font-medium text-white truncate">
            {currentTrack?.name || 'Nenhuma musica selecionada'}
          </p>
          <p className="text-xs sm:text-xs text-zinc-500 truncate">
            {currentTrack?.artist || 'Adicione musicas para comecar'}
          </p>
        </div>
      </div>

      {/* Progress bar - larger touch target on mobile */}
      <div className="space-y-2 sm:space-y-1 mb-4 sm:mb-3">
        <div className="pt-2 pb-1 sm:py-0">
          <Slider
            value={[localTime]}
            max={currentTrack?.duration || 100}
            step={0.1}
            onValueChange={isHost ? handleSeek : undefined}
            disabled={!isHost || !currentTrack}
            className="w-full [&_[data-slot=slider-track]]:h-1.5 sm:h-1.5 [&_[data-slot=slider-thumb]]:h-5 [&_[data-slot=slider-thumb]]:w-5 sm:[&_[data-slot=slider-thumb]]:h-4 sm:[&_[data-slot=slider-thumb]]:w-4 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 sm:[&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-range]]:bg-rose-500"
          />
        </div>
        <div className="flex justify-between text-xs sm:text-xs text-zinc-500">
          <span>{formatTime(localTime)}</span>
          <span>{currentTrack ? formatTime(currentTrack.duration) : '0:00'}</span>
        </div>
      </div>

      {/* Transport controls - large touch targets on mobile */}
      <div className="flex items-center justify-center gap-3 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          disabled={!isHost || !currentTrack}
          className="text-zinc-400 hover:text-white h-12 w-12 sm:h-9 sm:w-9 rounded-full"
        >
          <SkipBack className="w-5 h-5 sm:w-4 sm:h-4" />
        </Button>

        <Button
          size="icon"
          onClick={room?.isPlaying ? onPause : onPlay}
          disabled={!isHost || !currentTrack}
          className="h-16 w-16 sm:h-12 sm:w-12 rounded-full bg-white text-zinc-900 hover:bg-zinc-200 shadow-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
        >
          {room?.isPlaying ? (
            <Pause className="w-7 h-7 sm:w-5 sm:h-5" />
          ) : (
            <Play className="w-7 h-7 sm:w-5 sm:h-5 ml-1 sm:ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!isHost || !currentTrack}
          className="text-zinc-400 hover:text-white h-12 w-12 sm:h-9 sm:w-9 rounded-full"
        >
          <SkipForward className="w-5 h-5 sm:w-4 sm:h-4" />
        </Button>
      </div>

      {/* Volume row - always visible, full row on mobile */}
      <div className="flex items-center gap-3 mt-4 sm:mt-3 sm:ml-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMute}
          className="text-zinc-400 hover:text-white h-12 w-12 sm:h-8 sm:w-8 rounded-full"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 sm:w-4 sm:h-4" />
          ) : (
            <Volume2 className="w-5 h-5 sm:w-4 sm:h-4" />
          )}
        </Button>
        <div className="flex-1 sm:flex-none sm:w-20">
          <Slider
            value={[isMuted ? 0 : volume]}
            max={1}
            step={0.01}
            onValueChange={handleVolumeChange}
            className="[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:h-5 [&_[data-slot=slider-thumb]]:w-5 sm:[&_[data-slot=slider-thumb]]:h-3 sm:[&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 sm:[&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-range]]:bg-rose-500"
          />
        </div>
      </div>

      {!isHost && currentTrack && (
        <p className="text-xs text-zinc-600 text-center mt-3 sm:mt-2">
          Apenas o host pode controlar a reproducao
        </p>
      )}
    </div>
  )
}
