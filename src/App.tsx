import { PanelApp } from './routes/PanelApp'
import { PillApp } from './routes/PillApp'

export function App({ kind }: { kind: 'island' | 'panel' }): JSX.Element {
  return kind === 'panel' ? <PanelApp /> : <PillApp />
}
