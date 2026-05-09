'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useSongShareStore } from '@/store/songshare'
import { usePeerShare } from '@/hooks/usePeerShare'
import { LandingScreen } from '@/components/songshare/LandingScreen'
import { RoomScreen } from '@/components/songshare/RoomScreen'

export default function Home() {
  const { phase, isConnected, isDragOver, setIsDragOver } =
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
    leaveRoom,
  } = usePeerShare()

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
            onLeave={leaveRoom}
            isDragOver={isDragOver}
            setIsDragOver={setIsDragOver}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
