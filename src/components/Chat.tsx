import React, { useRef } from 'react';
import type { ChatMessage } from '../hooks/useChat';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
}

const Chat: React.FC<ChatProps> = ({ messages, onSendMessage, bottomRef, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const text = inputRef.current?.value.trim();
    if (text) {
      onSendMessage(text);
      inputRef.current!.value = '';
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">💬 Chat</span>
      </div>
      <div className="chat-messages">
        {messages.map(msg =>
          msg.type === 'system' ? (
            <div key={msg.id} className="chat-msg system">
              <span>{msg.text}</span>
            </div>
          ) : (
            <div key={msg.id} className={`chat-msg user ${msg.isMe ? 'me' : 'them'}`}>
              <span className="chat-sender">{msg.isMe ? 'You' : `${msg.sender?.substring(0, 8)}…`}</span>
              <span className="chat-text">{msg.text}</span>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          placeholder={disabled ? 'Waiting for opponent…' : 'Type a message…'}
          onKeyDown={handleKey}
          disabled={disabled}
          className="chat-input"
        />
        <button onClick={handleSend} disabled={disabled} className="chat-send-btn">Send</button>
      </div>
    </div>
  );
};

export default Chat;
