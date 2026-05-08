import { useState, useRef } from 'react';

interface Props {
  mySignal: string | null;   // our offer/answer to share
  isHost: boolean;
  onApply: (encoded: string) => void;
  onDismiss: () => void;
}

/**
 * Manual SDP exchange panel.
 * - Both sides copy their compressed signal and send it to the other side.
 * - The receiving side pastes it here to establish the connection.
 */
export default function ManualExchange({ mySignal, isHost, onApply, onDismiss }: Props) {
  const [pasteValue, setPasteValue] = useState('');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = () => {
    if (!mySignal) return;
    navigator.clipboard.writeText(mySignal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    const trimmed = pasteValue.trim();
    if (trimmed) onApply(trimmed);
  };

  return (
    <div className="manual-exchange-overlay">
      <div className="manual-exchange-modal">
        <h3>🔌 Manual Connection Required</h3>
        <p className="manual-hint">
          Automatic relay connection failed. Exchange the connection data below via any messaging app.
        </p>

        {/* Step 1: Copy own signal */}
        <div className="manual-section">
          <label>① Your connection data — send this to {isHost ? 'the guest' : 'the host'}:</label>
          <div className="manual-copy-row">
            <textarea
              className="manual-textarea"
              readOnly
              value={mySignal ?? 'Generating…'}
              rows={3}
            />
            <button className="btn-manual-copy" onClick={handleCopy} disabled={!mySignal}>
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Step 2: Paste their signal */}
        <div className="manual-section">
          <label>② Paste {isHost ? "the guest's" : "the host's"} connection data here:</label>
          <div className="manual-copy-row">
            <textarea
              ref={textareaRef}
              className="manual-textarea"
              placeholder="Paste here…"
              value={pasteValue}
              onChange={e => setPasteValue(e.target.value)}
              rows={3}
            />
            <button
              className="btn-primary"
              onClick={handleApply}
              disabled={!pasteValue.trim()}
            >
              Connect
            </button>
          </div>
        </div>

        <button className="btn-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
