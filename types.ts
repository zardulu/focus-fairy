
export type MessageSender = 'user' | 'ai';

export interface ChatMessage {
  sender: MessageSender;
  text: string;
  showTaskList?: boolean;
  taskListSnapshot?: SessionTask[];
  currentTaskSnapshot?: string;
}

export interface SessionTask {
  id: string;
  title: string;
  createdAt: number;
}
