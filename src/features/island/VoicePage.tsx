import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { MicIcon, PlayIcon, StopIcon } from '@/components/icons'
import { getApi } from '@/lib/ipc'
import { PageShell } from './PageShell'

const MIN_SECONDS = 6
const MAX_SECONDS = 30
const REF_TEXT =
  'Hello, this is my voice. I am recording a short sample for fispeak.'

type Phase = 'idle' | 'recording' | 'review'

/**
 * Voice feature page (owner request 2026-10-31): record a short sample for a local clone,
 * with the system voice as the default when the user skips it. The clone engine lands in
 * Phase 3.3d; this page owns the capture UX and the default/clone choice.
 */
export function VoicePage(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const level = useTranslateStore((state) => state.levels.you)

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [sampleUrl, setSampleUrl] = useState<string | null>(null)
  const [sampleBlob, setSampleBlob] = useState<Blob | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordLevel, setRecordLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  const stopTracks = (): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearTimer()
      stopTracks()
    }
  }, [])

  const stopRecording = (): void => {
    clearTimer()
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    void audioContextRef.current?.close()
    audioContextRef.current = null
    setRecordLevel(0)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    recorderRef.current = null
    stopTracks()
  }

  const startRecording = async (): Promise<void> => {
    setError(null)
    stopPlayback()
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone capture is not available in this window.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setSampleUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous)
          return url
        })
        setSampleBlob(blob)
        setSaved(false)
        setPhase('review')
      }
      recorder.start()
      setElapsed(0)
      setPhase('recording')

      // Live waveform from the recording stream (not the sidecar level).
      try {
        const context = new AudioContext()
        audioContextRef.current = context
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = (): void => {
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (const value of data) {
            const centered = (value - 128) / 128
            sum += centered * centered
          }
          setRecordLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // Waveform is optional; recording still works.
      }

      timerRef.current = window.setInterval(() => {
        setElapsed((seconds) => {
          const next = seconds + 1
          if (next >= MAX_SECONDS) stopRecording()
          return next
        })
      }, 1000)
    } catch (mediaError) {
      stopTracks()
      setError(
        mediaError instanceof Error
          ? `Microphone unavailable: ${mediaError.message}`
          : 'Microphone unavailable'
      )
      setPhase('idle')
    }
  }

  const playSample = (): void => {
    if (!sampleUrl) return
    const audio = audioRef.current ?? new Audio(sampleUrl)
    audioRef.current = audio
    audio.src = sampleUrl
    void audio.play()
  }

  const stopPlayback = (): void => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }

  const saveVoice = async (): Promise<void> => {
    if (!sampleBlob) return
    setError(null)
    const result = await getApi().voice.saveSample(await sampleBlob.arrayBuffer(), REF_TEXT)
    if (!result.ok) {
      setError(result.error ?? 'Could not save the voice sample')
      return
    }
    setSaved(true)
    void update({
      ttsModel: 'cloned',
      ai: { ...settings.ai, models: { ...settings.ai.models, speak: 'cloned' } }
    })
  }

  const reset = (): void => {
    stopRecording()
    if (sampleUrl) URL.revokeObjectURL(sampleUrl)
    setSampleUrl(null)
    setSampleBlob(null)
    setSaved(false)
    setElapsed(0)
    setPhase('idle')
    if (settings.ttsModel === 'cloned') {
      void update({
        ttsModel: 'kokoro-onnx',
        ai: { ...settings.ai, models: { ...settings.ai.models, speak: 'kokoro-onnx' } }
      })
    }
  }

  const canStop = elapsed >= MIN_SECONDS
  const status = saved || settings.ttsModel === 'cloned' ? 'My voice' : 'Default voice'

  return (
    <PageShell title="Voice" subtitle={status}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div
            aria-hidden
            className="gradient-neon pointer-events-none absolute -left-12 -top-16 h-48 w-48 rounded-full opacity-15 blur-2xl"
          />

          {/* Record button with the animated RGB conic ring; it is also the safety Stop. */}
          <button
            type="button"
            onClick={phase === 'recording' ? stopRecording : startRecording}
            aria-label={phase === 'recording' ? 'Stop recording' : 'Record voice sample'}
            className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white transition active:scale-95 ${
              phase === 'recording' ? 'rgb-border' : 'rgb-border opacity-80 hover:opacity-100'
            }`}
          >
            <span className="relative z-10 flex h-[86px] w-[86px] items-center justify-center rounded-full bg-[#0b0b0d]">
              {phase === 'recording' ? (
                <StopIcon className="h-7 w-7 text-white/85" />
              ) : (
                <MicIcon className="h-7 w-7 text-white/85" />
              )}
            </span>
          </button>

          {phase === 'recording' ? (
            <>
              <p className="text-[11px] tabular-nums text-white/60">
                {String(elapsed).padStart(2, '0')}s / {MAX_SECONDS}s
                {!canStop && <span className="ml-2 text-white/30">min {MIN_SECONDS}s</span>}
              </p>
              <Waveform level={recordLevel || level} />
            </>
          ) : phase === 'review' ? (
            <>
              <Waveform level={0} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={playSample}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
                >
                  <PlayIcon className="h-3 w-3" /> Play sample
                </button>
                <button
                  type="button"
                  onClick={stopPlayback}
                  aria-label="Stop sample playback"
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] text-white/60 transition hover:bg-white/20"
                >
                  <StopIcon className="h-3 w-3" /> Stop
                </button>
                <button
                  type="button"
                  onClick={startRecording}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/70 transition hover:bg-white/20"
                >
                  Re-record
                </button>
                <button
                  type="button"
                  onClick={saveVoice}
                  className="rounded-full bg-[#0A84FF] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85"
                >
                  {saved ? 'Saved' : 'Save voice'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="max-w-[320px] text-center text-[11px] leading-relaxed text-white/55">
                Read this aloud:
              </p>
              <p className="max-w-[320px] text-center text-[12px] leading-relaxed text-white/80">
                “{REF_TEXT}”
              </p>
              <p className="text-[9px] text-white/30">6–30s · optional</p>
              {sampleUrl && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={playSample}
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[10px] text-white/70 transition hover:bg-white/20"
                  >
                    <PlayIcon className="h-2.5 w-2.5" /> Play last sample
                  </button>
                  <button
                    type="button"
                    onClick={stopPlayback}
                    aria-label="Stop sample playback"
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[10px] text-white/60 transition hover:bg-white/20"
                  >
                    <StopIcon className="h-2.5 w-2.5" /> Stop
                  </button>
                </div>
              )}
            </>
          )}

          {error && <p className="max-w-[300px] text-center text-[10px] text-amber-300/80">{error}</p>}
        </div>

        {saved && (
          <p className="px-1 text-[9px] text-[#4CD964]">Voice sample saved.</p>
        )}

        <div className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-black/25 px-3 py-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
              Voice source
            </p>
            <p className="text-[12px] text-white/80">{status}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSaved(false)
                void update({
                  ttsModel: 'say',
                  ai: { ...settings.ai, models: { ...settings.ai.models, speak: 'say' } }
                })
              }}
              className={`rounded-full px-2.5 py-1 text-[10px] transition ${
                settings.ttsModel !== 'cloned'
                  ? 'bg-white/15 text-white'
                  : 'bg-white/[0.06] text-white/50 hover:bg-white/10'
              }`}
            >
              Default
            </button>
            <button
              type="button"
              disabled={!saved}
              onClick={() => void update({ ttsModel: 'cloned' })}
              className={`rounded-full px-2.5 py-1 text-[10px] transition disabled:opacity-35 ${
                settings.ttsModel === 'cloned'
                  ? 'bg-[#0A84FF] text-white'
                  : 'bg-white/[0.06] text-white/50 hover:bg-white/10'
              }`}
            >
              My voice
            </button>
            {(sampleUrl || saved) && (
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/45 transition hover:bg-white/10"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  )
}

function Waveform({ level }: { level: number }): JSX.Element {
  const bars = 28
  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, index) => {
        const distance = Math.abs(index - bars / 2) / (bars / 2)
        const falloff = 1 - distance * 0.7
        const height = Math.max(3, Math.min(34, level * 220 * falloff + 3))
        return (
          <span
            key={index}
            className="w-[3px] rounded-full bg-white/45 transition-[height] duration-100"
            style={{ height }}
          />
        )
      })}
    </div>
  )
}
