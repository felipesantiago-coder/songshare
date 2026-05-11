'use client'

import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Music2,
  Upload,
  X,
  Plus,
  ListMusic,
  FileText,
  FileUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useSongShareStore } from '@/store/songshare'
import { formatDuration } from './utils'

interface PlaylistProps {
  onAddTrack: (file: File, lyrics?: string) => void
  onRemoveTrack: (trackId: string) => void
  isDragOver: boolean
  setIsDragOver: (over: boolean) => void
}

interface PendingFile {
  file: File
  name: string
}

export function Playlist({
  onAddTrack,
  onRemoveTrack,
  isDragOver,
  setIsDragOver,
}: PlaylistProps) {
  const { room, socket, audioCache } = useSongShareStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lrcInputRef = useRef<HTMLInputElement>(null)

  // Dialog state for lyrics input
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [lyricsDialogOpen, setLyricsDialogOpen] = useState(false)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [lyricsDraft, setLyricsDraft] = useState('')

  const isHost = room?.hostId === socket?.id

  // Process files: if single file, show lyrics dialog; if multiple, add directly
  // Also auto-pairs .lrc files with same-name audio files
  const processFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      const validFiles: PendingFile[] = []
      const lrcPromises: Promise<{ baseName: string; content: string }>[] = []

      Array.from(files).forEach((file) => {
        const name = file.name
        // Check for .lrc files
        if (name.match(/\.lrc$/i)) {
          const baseName = name.replace(/\.lrc$/i, '')
          lrcPromises.push(
            new Promise((resolve) => {
              const reader = new FileReader()
              reader.onload = () => resolve({ baseName, content: reader.result as string })
              reader.onerror = () => resolve({ baseName, content: '' })
              reader.readAsText(file)
            })
          )
          return
        }
        if (
          file.type.startsWith('audio/') ||
          name.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i)
        ) {
          if (file.size <= 50 * 1024 * 1024) {
            validFiles.push({ file, name: name.replace(/\.[^.]+$/, '') })
          }
        }
      })

      if (validFiles.length === 0) return

      // Wait for ALL LRC files to be read before processing
      Promise.all(lrcPromises).then((lrcResults) => {
        const lrcMap = new Map<string, string>()
        lrcResults.forEach(({ baseName, content }) => {
          if (content) lrcMap.set(baseName, content)
        })

        if (validFiles.length === 1) {
          // Single file: open lyrics dialog, pre-fill if .lrc found
          const lrcContent = lrcMap.get(validFiles[0].name) || ''
          setPendingFiles(validFiles)
          setCurrentFileIndex(0)
          setLyricsDraft(lrcContent)
          setLyricsDialogOpen(true)
        } else {
          // Multiple files: add directly, auto-pair .lrc if available
          validFiles.forEach(({ file, name }) => {
            const lrcContent = lrcMap.get(name) || ''
            onAddTrack(file, lrcContent)
          })
        }
      })
    },
    [onAddTrack]
  )

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      processFiles(files)
    },
    [processFiles]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      handleFileSelect(e.dataTransfer.files)
    },
    [handleFileSelect, setIsDragOver]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(true)
    },
    [setIsDragOver]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
    },
    [setIsDragOver]
  )

  const handleDialogSubmit = () => {
    const { file } = pendingFiles[currentFileIndex]
    onAddTrack(file, lyricsDraft.trim())

    // Reset inputs for next file
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (lrcInputRef.current) lrcInputRef.current.value = ''

    setLyricsDialogOpen(false)
    setPendingFiles([])
    setLyricsDraft('')
  }

  const handleDialogSkip = () => {
    const { file } = pendingFiles[currentFileIndex]
    onAddTrack(file, '')

    if (fileInputRef.current) fileInputRef.current.value = ''
    if (lrcInputRef.current) lrcInputRef.current.value = ''

    setLyricsDialogOpen(false)
    setPendingFiles([])
    setLyricsDraft('')
  }

  const handleLrcUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setLyricsDraft(reader.result as string)
    }
    reader.readAsText(file)
    // Reset so same file can be re-selected
    e.target.value = ''
  }

  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  return (
    <>
      <div
        className="flex flex-col h-full"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
          <div className="flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-zinc-200">Playlist</h2>
            <Badge
              variant="secondary"
              className="bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0 h-5"
            >
              {room?.playlist.length || 0}
            </Badge>
          </div>
          {isHost && (
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Adicionar
            </Button>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.wma,.lrc"
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        {/* Hidden LRC file input */}
        <input
          ref={lrcInputRef}
          type="file"
          accept=".lrc"
          className="hidden"
          onChange={handleLrcUpload}
        />

        {/* Playlist items */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            <AnimatePresence>
              {room?.playlist.map((track, index) => {
                const isCurrent = index === room.currentTrackIndex
                const hasAudio = audioCache.has(track.id)
                const hasLyrics = !!track.lyrics

                return (
                  <motion.div
                    key={track.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150 ${
                      isCurrent
                        ? 'bg-rose-500/10 border border-rose-500/20'
                        : 'hover:bg-zinc-800/50'
                    }`}
                  >
                    {/* Track number / playing indicator */}
                    <div className="w-6 text-center flex-shrink-0">
                      {isCurrent ? (
                        <div className="flex items-center justify-center gap-0.5">
                          <motion.div
                            className="w-0.5 bg-rose-500 rounded-full"
                            animate={{ height: [4, 12, 6, 10, 4] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                          />
                          <motion.div
                            className="w-0.5 bg-rose-500 rounded-full"
                            animate={{ height: [10, 4, 12, 6, 10] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
                          />
                          <motion.div
                            className="w-0.5 bg-rose-500 rounded-full"
                            animate={{ height: [6, 10, 4, 12, 6] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600">{index + 1}</span>
                      )}
                    </div>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p
                          className={`text-sm truncate ${
                            isCurrent ? 'text-rose-400 font-medium' : 'text-zinc-300'
                          }`}
                        >
                          {track.name}
                        </p>
                        {hasLyrics && (
                          <FileText className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 truncate">
                        {track.artist}
                        {!hasAudio && (
                          <span className="text-amber-500 ml-2">Carregando...</span>
                        )}
                      </p>
                    </div>

                    {/* Duration */}
                    <span className="text-xs text-zinc-600 flex-shrink-0">
                      {formatDuration(track.duration)}
                    </span>

                    {/* Remove button (host only) */}
                    {isHost && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemoveTrack(track.id)}
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {(!room?.playlist || room.playlist.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-800/50 flex items-center justify-center mb-3">
                  <Music2 className="w-6 h-6 text-zinc-600" />
                </div>
                <p className="text-sm text-zinc-500 text-center">
                  Nenhuma musica na playlist
                </p>
                {isHost && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-3 border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg text-xs"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Adicionar musicas
                  </Button>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Drag overlay */}
        <AnimatePresence>
          {isDragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-rose-500/5 border-2 border-dashed border-rose-500/30 rounded-xl flex items-center justify-center z-10 pointer-events-none"
            >
              <div className="text-center">
                <Upload className="w-8 h-8 text-rose-400 mx-auto mb-2" />
                <p className="text-sm text-rose-400 font-medium">
                  Solte os arquivos de audio aqui
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Lyrics Dialog */}
      <Dialog open={lyricsDialogOpen} onOpenChange={setLyricsDialogOpen}>
        <DialogContent 
          className="bg-zinc-900 border-zinc-800 sm:max-w-md max-h-[85dvh] flex flex-col"
          aria-describedby="lyrics-dialog-description"
        >
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="text-zinc-200 flex items-center gap-2">
              <FileText className="w-5 h-5 text-rose-500" />
              Adicionar letra
            </DialogTitle>
            <DialogDescription id="lyrics-dialog-description" className="sr-only">
              Adicione ou carregue a letra da música atual
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
            <p className="text-sm text-zinc-400 flex-shrink-0">
              Musica: <span className="text-zinc-200 font-medium">{pendingFiles[currentFileIndex]?.name}</span>
            </p>
            <Textarea
              value={lyricsDraft}
              onChange={(e) => setLyricsDraft(e.target.value)}
              placeholder={`Cole ou digite a letra de "${pendingFiles[currentFileIndex]?.name}" aqui...`}
              className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-600 text-sm resize-none rounded-lg focus:border-rose-500/50 min-h-[150px] max-h-[40dvh]"
              autoFocus
            />
            <p className="text-xs text-zinc-600 flex-shrink-0">
              Voce podera editar a letra depois, pela aba de letras.
            </p>
            <div className="flex-shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => lrcInputRef.current?.click()}
                className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg text-xs"
              >
                <FileUp className="w-3.5 h-3.5 mr-1.5" />
                Carregar arquivo .lrc
              </Button>
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0 flex-shrink-0 pt-2">
            <Button
              variant="ghost"
              onClick={handleDialogSkip}
              className="text-zinc-400 hover:text-white rounded-lg text-sm"
            >
              Pular
            </Button>
            <Button
              onClick={handleDialogSubmit}
              className="bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm"
            >
              Adicionar com letra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
