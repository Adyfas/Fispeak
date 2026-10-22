import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/global.css'

const kind = document.body.dataset.window === 'panel' ? 'panel' : 'island'
const container = document.getElementById('root')

if (!container) throw new Error('Missing #root element')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App kind={kind} />
  </React.StrictMode>
)
