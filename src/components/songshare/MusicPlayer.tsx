'use client'

import React, { useCallback } from 'react'
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
  const { room, socket } = useSongShareStore()
  const [isMuted, setIsMuted] = React.useState(false)
  const [volume, setVolume] = React.useState(1)

  const isHost = room?.hostId === socket?.id
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  // Use room.currentTime — updated by usePeerShare via timeupdate (host) or time-sync (guests)
  const currentTime = room?.currentTime ?? 0

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
    setVolume(vol)
    if (audioRef.current) {
      audioRef.current.volume = vol
    }
  }, [audioRef])

  return (
    <div className="w-full">
      {/* Now playing info */}
      <div className="flex items-center gap-3 sm:gap-3 mb-3 sm:mb-4 min-w-0">
        <div className="w-14 h-14 sm:w-11 sm:h-11 rounded-2xl sm:rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
          <div className={`w-5 h-5 sm:w-3.5 sm:h-3.5 rounded-full ${currentTrack ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base sm:text-sm font-semibold text-white truncate">
            {currentTrack?.name || 'Nenhuma musica selecionada'}
          </p>
          <p className="text-sm sm:text-xs text-zinc-500 truncate">
            {currentTrack?.artist || 'Adicione musicas para comecar'}
          </p>
        </div>
      </div>

      {/* Progress bar - large touch target on mobile */}
      <div className="space-y-1.5 sm:space-y-1 mb-3 sm:mb-3">
        <div className="pt-3 pb-2 sm:py-0">
          <Slider
            value={[currentTime]}
            max={currentTrack?.duration || 100}
            step={0.1}
            onValueChange={isHost ? handleSeek : undefined}
            disabled={!isHost || !currentTrack}
            className="w-full [&_[data-slot=slider-track]]:h-2 sm:h-1.5 [&_[data-slot=slider-thumb]]:h-6 [&_[data-slot=slider-thumb]]:w-6 sm:[&_[data-slot=slider-thumb]]:h-4 sm:[&_[data-slot=slider-thumb]]:w-4 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 sm:[&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-range]]:bg-rose-500"
          />
        </div>
        <div className="flex justify-between text-sm sm:text-xs text-zinc-500">
          <span>{formatTime(currentTime)}</span>
          <span>{currentTrack ? formatTime(currentTrack.duration) : '0:00'}</span>
        </div>
      </div>

      {/* Transport controls - large touch targets on mobile */}
      <div className="flex items-center justify-center gap-5 sm:gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          disabled={!isHost || !currentTrack}
          className="text-zinc-400 hover:text-white h-14 w-14 sm:h-10 sm:w-10 rounded-full active:scale-95"
        >
          <SkipBack className="w-6 h-6 sm:w-4 sm:h-4" />
        </Button>

        <Button
          size="icon"
          onClick={room?.isPlaying ? onPause : onPlay}
          disabled={!isHost || !currentTrack}
          className="h-[4.5rem] w-[4.5rem] sm:h-14 sm:w-14 rounded-full bg-white text-zinc-900 hover:bg-zinc-200 shadow-lg shadow-white/10 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
        >
          {room?.isPlaying ? (
            <Pause className="w-8 h-8 sm:w-6 sm:h-6" />
          ) : (
            <Play className="w-8 h-8 sm:w-6 sm:h-6 ml-1 sm:ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!isHost || !currentTrack}
          className="text-zinc-400 hover:text-white h-14 w-14 sm:h-10 sm:w-10 rounded-full active:scale-95"
        >
          <SkipForward className="w-6 h-6 sm:w-4 sm:h-4" />
        </Button>
      </div>

      {/* Volume row */}
      <div className="flex items-center gap-3 mt-4 sm:mt-3 sm:ml-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMute}
          className="text-zinc-400 hover:text-white h-12 w-12 sm:h-9 sm:w-9 rounded-full"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 sm:w-4 sm:h-4" />
          ) : (
            <Volume2 className="w-5 h-5 sm:w-4 sm:h-4" />
          )}
        </Button>
        <div className="flex-1 sm:flex-none sm:w-24">
          <Slider
            value={[isMuted ? 0 : volume]}
            max={1}
            step={0.01}
            onValueChange={handleVolumeChange}
            className="[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:h-6 [&_[data-slot=slider-thumb]]:w-6 sm:[&_[data-slot=slider-thumb]]:h-4 sm:[&_[data-slot=slider-thumb]]:w-4 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 sm:[&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-range]]:bg-rose-500"
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
