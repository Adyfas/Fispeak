import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AiProviderId,
  AiSettings,
  CardRect,
  ChecklistItem,
  IslandState,
  PanelTab,
  PomodoroConfig,
  PomodoroMode,
  Settings,
  TranslateMode
} from '@shared/api'
import { IPC } from '@shared/api'
import { taskRouting } from '@shared/providers'
import { listModels, testConnection } from '../engine/engineClient'
import { clearSecret, hasSecret, secretName, setSecret } from '../security/credentials'
import type { IslandWindow } from '../island/islandWindow'
import type { PanelWindow } from '../windows/panelWindow'
import type { NotesStore } from '../db/notesStore'
import type { SettingsStore } from '../db/settingsStore'
import type { SessionStore } from '../db/sessionStore'
import type { PomodoroController } from '../pomodoro'
import type { TranslateController } from '../translate/translateController'
import type { ModelManager } from '../models/modelManager'
import type { SckCapture } from '../audio/sckCapture'
import type { TtsEngine } from '../tts/sayEngine'
import type { AudioFilePlayer } from '../tts/filePlayer'
import { getPrivacyStatus, openMicrophoneSettings, openScreenRecordingSettings } from '../audio/privacy'
import { openAccessibilitySettings } from '../dictation/paste'
import { logger } from '../logger'

export interface IpcContext {
  island: IslandWindow
  panel: PanelWindow
  notes: NotesStore
  settings: SettingsStore
  pomodoro: PomodoroController
  sessions: SessionStore
  translate: TranslateController
  models: ModelManager
  sck: SckCapture
  tts: TtsEngine
  player: AudioFilePlayer
  onSettingsChanged(settings: Settings): void
  onToggleTranslate(): void
}

export function registerIpc(context: IpcContext): void {
  const { island, panel, notes, settings, pomodoro, sessions, translate, models, sck, tts, player } = context

  ipcMain.on(IPC.islandSetState, (_event, state: IslandState) => {
    island.setState(state)
  })

  ipcMain.on(IPC.islandRequestMetrics, () => {
    island.requestMetrics()
  })

  ipcMain.on(IPC.islandReportCardRect, (_event, rect: CardRect) => {
    island.reportCardRect(rect)
  })

  ipcMain.on(IPC.islandNavVisible, (_event, visible: boolean) => {
    island.setNavVisible(visible)
  })

  ipcMain.on(IPC.islandHide, () => island.setVisible(false))
  ipcMain.on(IPC.islandShow, () => island.setVisible(true))
  ipcMain.on(IPC.islandToggleTranslate, () => context.onToggleTranslate())
  ipcMain.on(IPC.islandDragStart, () => island.dragStart())
  ipcMain.on(IPC.islandDragEnd, () => island.dragEnd())
  ipcMain.on(IPC.islandOpenPanel, (_event, tab: PanelTab | undefined) => {
    panel.open(tab ?? 'settings')
  })

  ipcMain.handle(IPC.notesList, () => notes.list())
  ipcMain.handle(IPC.notesCreate, (_event, body: string, items?: ChecklistItem[]) =>
    notes.create(body, items)
  )
  ipcMain.handle(IPC.notesUpdate, (_event, id: string, body: string, items?: ChecklistItem[]) =>
    notes.update(id, body, items)
  )
  ipcMain.handle(IPC.notesRemove, (_event, id: string) => notes.remove(id))

  ipcMain.handle(IPC.pomodoroGet, () => pomodoro.get())
  ipcMain.handle(IPC.pomodoroStart, () => pomodoro.start())
  ipcMain.handle(IPC.pomodoroPause, () => pomodoro.pause())
  ipcMain.handle(IPC.pomodoroReset, () => pomodoro.reset())
  ipcMain.handle(IPC.pomodoroSetMode, (_event, mode: PomodoroMode) => pomodoro.setMode(mode))
  ipcMain.handle(IPC.pomodoroConfigure, (_event, patch: Partial<PomodoroConfig>) =>
    pomodoro.configure(patch)
  )

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<Settings>) => {
    const next = settings.set(patch)
    logger.debug('ipc', 'settings updated', { keys: Object.keys(patch) })
    context.onSettingsChanged(next)
    return next
  })

  // --- external engines ---------------------------------------------------------------------
  ipcMain.handle(IPC.engineTest, (_event, ai: AiSettings) => testConnection(ai))
  ipcMain.handle(
    IPC.engineModels,
    (_event, provider: AiProviderId, baseUrl: string, accountId?: string) =>
      listModels(provider, baseUrl, accountId ?? '')
  )
  ipcMain.handle(
    IPC.engineKeySet,
    (_event, provider: AiProviderId, key: string) => {
      const ok = setSecret(secretName(provider), key)
      if (ok) translate.updateSettings(settings.get())
      logger.info('engine', `api key ${ok ? 'saved' : 'not saved'} for ${provider}`)
      return ok
    }
  )
  ipcMain.handle(IPC.engineKeyHas, (_event, provider: AiProviderId) =>
    hasSecret(secretName(provider))
  )
  ipcMain.handle(IPC.engineKeyClear, (_event, provider: AiProviderId) => {
    const ok = clearSecret(secretName(provider))
    if (ok) translate.updateSettings(settings.get())
    logger.info('engine', `api key cleared for ${provider}`)
    return ok
  })

  // -- live translate ----------------------------------------------------------------------
  ipcMain.on(IPC.captureStart, () => {
    void translate.start()
  })
  ipcMain.on(IPC.captureStop, () => {
    translate.stop()
  })
  ipcMain.on(IPC.sessionStart, () => {
    void translate.start()
  })
  ipcMain.on(IPC.sessionStop, () => {
    translate.stop()
  })
  ipcMain.handle(IPC.sessionList, () => sessions.list())
  ipcMain.handle(IPC.sessionTurns, (_event, sessionId: string) => sessions.turns(sessionId))
  ipcMain.handle(IPC.sessionTakes, (_event, sessionId: string) => sessions.takes(sessionId))
  ipcMain.handle(IPC.sessionResume, async (_event, sessionId: string) => {
    await translate.resume(sessionId)
    island.setState('TRANSLATE_ON')
    return sessionId
  })
  ipcMain.handle(IPC.sessionRename, (_event, sessionId: string, name: string) => {
    sessions.rename(sessionId, name)
  })
  ipcMain.handle(IPC.sessionCreate, (_event, name?: string) => {
    const id = sessions.start({
      myLang: settings.get().myLang,
      remoteLang: settings.get().remoteLang,
      whisperModel: settings.get().whisperModel
    })
    if (name) sessions.rename(id, name)
    return id
  })
  ipcMain.handle(
    IPC.voiceSave,
    async (
      _event,
      bytes: ArrayBuffer,
      refText: string
    ): Promise<{ ok: boolean; path?: string; error?: string }> => {
      const folder = join(app.getPath('userData'), 'voices')
      mkdirSync(folder, { recursive: true })
      const temp = join(folder, `recording-${Date.now()}.webm`)
      const wav = join(folder, 'voice.wav')
      try {
        writeFileSync(temp, Buffer.from(bytes))
        await promisify(execFile)('ffmpeg', [
          '-y',
          '-loglevel',
          'error',
          '-i',
          temp,
          '-ar',
          '16000',
          '-ac',
          '1',
          wav
        ])
        writeFileSync(
          join(folder, 'voice.json'),
          JSON.stringify({ ref_text: refText.trim(), created_at: Date.now() })
        )
        logger.info('voice', 'voice sample saved', { path: wav })
        return { ok: true, path: wav }
      } catch (error) {
        logger.warn('voice', 'voice sample save failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not save the voice sample'
        }
      } finally {
        try {
          unlinkSync(temp)
        } catch {
          // ignore
        }
      }
    }
  )
  ipcMain.handle(IPC.languagesGet, () => translate.getLanguages())
  ipcMain.on(IPC.translateMode, (_event, mode: TranslateMode) => {
    void translate.setMode(mode)
  })
  ipcMain.on(IPC.translateSpeak, (_event, text: string, lang: string, record = true) => {
    // SPEAK `Putar`: translate the (possibly edited) source first, then speak the translation.
    void translate.translateForSpeak(text, lang, record).then(async (result) => {
      if (!result) return
      const current = settings.get()
      const speakRoute = taskRouting(current.ai, 'speak')
      const localModel = ['kokoro-onnx', 'cloned', 'supertonic-3', 'kokoro-82m'].includes(
        current.ttsModel
      )
      // Cloud TTS and a local model both return a WAV path from the sidecar.
      if (speakRoute.mode === 'cloud' || localModel) {
        let audio = await translate.synthesize(
          result.text,
          result.lang,
          current.ttsVoice,
          current.ttsModel
        )
        if (!audio && current.ttsModel === 'cloned') {
          // Clone sample/model missing: use the default local voice instead of failing.
          audio = await translate.synthesize(
            result.text,
            result.lang,
            current.ttsVoice,
            'kokoro-onnx'
          )
        }
        if (audio) {
          await player.play(
            audio.path,
            current.ttsOutput === 'blackhole' ? 'BlackHole 2ch' : undefined
          )
          return
        }
      }
      // Fallback: system `say` (also covers a provider without TTS).
      await tts.speak(result.text, { lang: result.lang })
    })
  })
  ipcMain.handle(IPC.translateFinishSpeak, () => translate.finishSpeak())
  ipcMain.on(IPC.translateEnsureCapture, () => {
    void translate.ensureCapture()
  })
  ipcMain.handle(IPC.dictationStart, () => translate.startDictation())
  ipcMain.handle(IPC.dictationStop, (_event, localText: string) =>
    translate.stopDictation(localText ?? '')
  )
  ipcMain.on(IPC.dictationCancel, () => translate.cancelDictation())

  // -- models & permissions ----------------------------------------------------------------
  ipcMain.handle(IPC.modelsList, () => models.list())
  ipcMain.handle(IPC.modelsDownload, (_event, id: string) => models.download(id).then(() => models.list()))
  ipcMain.on(IPC.modelsCancel, (_event, id: string) => models.cancel(id))
  ipcMain.handle(IPC.privacyStatus, () => getPrivacyStatus(sck))
  ipcMain.on(IPC.privacyOpen, (_event, target: 'screen' | 'microphone' | 'accessibility') => {
    if (target === 'microphone') openMicrophoneSettings()
    else if (target === 'accessibility') openAccessibilitySettings()
    else openScreenRecordingSettings()
  })

  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.on(IPC.appQuit, () => app.quit())
}
