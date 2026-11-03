import React, { useEffect, useMemo, useState } from 'react'

interface Props {
  onMicAvailable: (micType: 'blackhole' | 'pulse' | 'wasapi' | 'none') => void
  onClose: () => void
}

type VirtualMicType = 'blackhole' | 'pulse' | 'wasapi' | 'none'

const VirtualMicSetup: React.FC<Props> = ({ onMicAvailable, onClose }) => {
  const [showWizard, setShowWizard] = useState(false)

  // The platform never changes during a session, so derive everything during render instead of
  // pushing it into state from an effect (react-hooks/set-state-in-effect).
  const platform = useMemo<{ micType: VirtualMicType; status: string; instruction: string }>(() => {
    const ua = navigator.userAgent
    if (ua.includes('Mac')) {
      return {
        micType: 'blackhole',
        status: 'BlackHole required on macOS',
        instruction: 'Install BlackHole 2ch: https://github.com/ExistentialAudio/BlackHole'
      }
    }
    if (ua.includes('Linux')) {
      return {
        micType: 'pulse',
        status: 'Linux: PulseAudio virtual sink',
        instruction: 'Linux: pactl load-module module-null-sink sink_name=fispeak_virtual_mic'
      }
    }
    if (ua.includes('Windows')) {
      return {
        micType: 'wasapi',
        status: 'Windows: VB-CABLE required',
        instruction: 'Windows: Install VB-CABLE or similar virtual audio driver'
      }
    }
    return {
      micType: 'none',
      status: 'No virtual mic detected',
      instruction: 'Unknown OS - install virtual audio driver manually'
    }
  }, [])

  useEffect(() => {
    onMicAvailable(platform.micType)
  }, [onMicAvailable, platform.micType])

  return (
    <div className="virtual-mic-wizard">
      <div className="wizard-header">
        <h3>Virtual Mic Setup</h3>
        <p>
          Status: {platform.status} ({platform.micType})
        </p>
        <button onClick={onClose} className="close-btn">
          Close
        </button>
      </div>
      {showWizard && (
        <div className="wizard-content">
          <h4>Setup Instructions</h4>
          <p>{platform.instruction}</p>
          <div className="wizard-actions">
            <button onClick={() => setShowWizard(false)} className="cancel-btn">
              Cancel
            </button>
            <button onClick={onClose} className="confirm-btn">
              Done
            </button>
          </div>
        </div>
      )}
      {!showWizard && (
        <button onClick={() => setShowWizard(true)} className="open-btn">
          Open Virtual Mic Setup
        </button>
      )}
    </div>
  )
}

export default VirtualMicSetup
