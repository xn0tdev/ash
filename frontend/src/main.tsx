import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import '@xterm/xterm/css/xterm.css'
import App from './App'

const container = document.getElementById('root')
const root = createRoot(container!)
// No StrictMode: its double-mounted effects would spawn every ConPTY twice.
root.render(<App/>)
