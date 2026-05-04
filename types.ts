
export type MessageSender = 'user' | 'ai';

export interface ChatMessage {
  id?: string;
  sender: MessageSender;
  text: string;
  showTaskActionStatus?: boolean;
  taskActionStatusText?: string;
  showTaskList?: boolean;
  taskListSnapshot?: SessionTask[];
  currentTaskSnapshot?: string;
}

export interface SessionTask {
  id: string;
  title: string;
  createdAt: number;
}
