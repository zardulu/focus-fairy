
export type MessageSender = 'user' | 'ai';

export interface ChatMessage {
  sender: MessageSender;
  text: string;
}
