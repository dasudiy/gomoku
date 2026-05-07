import { useState, useCallback, useRef, useEffect } from 'react';

export type MessageType = 'user' | 'system';

export interface ChatMessage {
  sender?: string; // pubkey, only for user messages
  text: string;
  isMe?: boolean;
  type: MessageType;
  id: number;
}

let msgId = 0;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const addSystem = useCallback((text: string) => {
    setMessages(prev => [...prev, { text, type: 'system', id: msgId++ }]);
  }, []);

  const addUser = useCallback((text: string, sender: string, isMe: boolean) => {
    setMessages(prev => [...prev, { text, sender, isMe, type: 'user', id: msgId++ }]);
  }, []);

  // Auto-scroll to bottom whenever new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return { messages, addSystem, addUser, bottomRef };
}
