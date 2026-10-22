import { PlayIcon, SettingsIcon, HistoryIcon } from '@/components/icons'
import { Block } from '@/components/Block'
import { getApi } from '@/lib/ipc'

/** Live translate launcher: the block itself is the button. */
export function TranslateBlock(): JSX.Element {
  return (
    <Block label="Translate" className="shrink-0" bodyClassName="justify-center">
      <button
        type="button"
        onClick={() => getApi().island.toggleTranslate()}
        aria-label="Start live translate"
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0A84FF] py-1.5 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85 active:scale-[0.98]"
      >
        <PlayIcon className="h-2.5 w-2.5" /> Live translate
      </button>
    </Block>
  )
}

/** Settings and history live in the panel window. */
export function PanelBlock(): JSX.Element {
  return (
    <Block label="Panel" className="shrink-0" bodyClassName="justify-center">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => getApi().island.openPanel('settings')}
          aria-label="Open settings"
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white/[0.06] py-1.5 text-[10px] text-white/70 transition hover:bg-white/[0.12] hover:text-white active:scale-[0.98]"
        >
          <SettingsIcon className="h-3 w-3" /> Settings
        </button>
        <button
          type="button"
          onClick={() => getApi().island.openPanel('history')}
          aria-label="Open history"
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white/[0.06] py-1.5 text-[10px] text-white/70 transition hover:bg-white/[0.12] hover:text-white active:scale-[0.98]"
        >
          <HistoryIcon className="h-3 w-3" /> History
        </button>
      </div>
    </Block>
  )
}
