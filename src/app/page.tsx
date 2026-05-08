'use client'

import { useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSongShareStore } from '@/store/songshare'
import { usePeerShare } from '@/hooks/usePeerShare'
import { LandingScreen } from '@/components/songshare/LandingScreen'
import { RoomScreen } from '@/components/songshare/RoomScreen'

export default function Home() {
  const { phase, isConnected, isDragOver, setIsDragOver, reset } =
    useSongShareStore()

  const {
    audioRef,
    createRoom,
    joinRoom,
    addTrack,
    removeTrack,
    play,
    pause,
    seek,
    nextTrack,
    previousTrack,
    sendChatMessage,
    updateTrackLyrics,
    toggleMic,
    toggleMute,
    setPeerVolume,
    resyncIsConnected,
  } = usePeerShare()

  const handleLeave = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    reset()
    // reset() sets isConnected=false, but the PeerJS peer may still be alive.
    // Re-sync to prevent showing "reconnecting" when already connected.
    setTimeout(() => resyncIsConnected(), 50)
  }, [audioRef, reset, resyncIsConnected])

  return (
    <AnimatePresence mode="wait">
      {phase === 'landing' ? (
        <motion.div
          key="landing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <LandingScreen
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            isConnected={isConnected}
          />
        </motion.div>
      ) : (
        <motion.div
          key="room"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <RoomScreen
            audioRef={audioRef}
            onPlay={play}
            onPause={pause}
            onSeek={seek}
            onNext={nextTrack}
            onPrevious={previousTrack}
            onAddTrack={addTrack}
            onRemoveTrack={removeTrack}
            onSendMessage={sendChatMessage}
            onUpdateLyrics={updateTrackLyrics}
            onToggleMic={toggleMic}
            onToggleMute={toggleMute}
            onSetPeerVolume={setPeerVolume}
            onLeave={handleLeave}
            isDragOver={isDragOver}
            setIsDragOver={setIsDragOver}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
