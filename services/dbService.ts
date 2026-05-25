import { doc, setDoc, getDoc, collection, getDocs, query, orderBy, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase.config';
import { ChatMessage, SessionTask, AISettings, AIProvider } from '../types';

export interface ChatState {
  task: string | null;
  currentTaskId: string | null;
}

// Helper to ensure Firebase is active
const checkFirebase = () => {
  if (!isFirebaseConfigured || !db) {
    throw new Error('Firebase is not configured.');
  }
};

/**
 * Upsert user profile on sign in
 */
export const syncUserProfile = async (uid: string, profile: { displayName: string | null; email: string | null; photoURL: string | null }) => {
  if (!isFirebaseConfigured || !db) return;
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    ...profile,
    updatedAt: Date.now()
  }, { merge: true });
};

/**
 * Settings Sync
 */
export const saveSettings = async (uid: string, settings: AISettings) => {
  if (!isFirebaseConfigured || !db) return;
  const settingsRef = doc(db, 'users', uid, 'settings', 'ai');
  await setDoc(settingsRef, {
    provider: settings.provider,
    apiKeys: settings.apiKeys,
    updatedAt: Date.now()
  }, { merge: true });
};

export const loadSettings = async (uid: string): Promise<AISettings | null> => {
  if (!isFirebaseConfigured || !db) return null;
  const settingsRef = doc(db, 'users', uid, 'settings', 'ai');
  const snap = await getDoc(settingsRef);
  if (snap.exists()) {
    const data = snap.data();
    return {
      provider: data.provider,
      apiKeys: data.apiKeys || {}
    } as AISettings;
  }
  return null;
};

/**
 * Messages Sync
 */
export const saveMessage = async (uid: string, message: ChatMessage) => {
  if (!isFirebaseConfigured || !db || !message.id) return;
  const msgRef = doc(db, 'users', uid, 'messages', message.id);
  
  // Strip undefined values for Firestore compatibility
  const msgData = JSON.parse(JSON.stringify({
    ...message,
    // Add timestamp for sorting if not present
    createdAt: Date.now()
  }));

  await setDoc(msgRef, msgData, { merge: true });
};

export const loadMessages = async (uid: string): Promise<ChatMessage[]> => {
  if (!isFirebaseConfigured || !db) return [];
  const msgsCol = collection(db, 'users', uid, 'messages');
  const q = query(msgsCol, orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  
  const msgs: ChatMessage[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    // Return ChatMessage conforming objects
    msgs.push({
      id: docSnap.id,
      sender: data.sender,
      text: data.text,
      showTaskActionStatus: data.showTaskActionStatus,
      taskActionStatusText: data.taskActionStatusText,
      showTaskList: data.showTaskList,
      taskListSnapshot: data.taskListSnapshot,
      currentTaskSnapshot: data.currentTaskSnapshot
    });
  });
  return msgs;
};

/**
 * Tasks Sync
 */
export const saveTask = async (uid: string, task: SessionTask) => {
  if (!isFirebaseConfigured || !db) return;
  const taskRef = doc(db, 'users', uid, 'tasks', task.id);
  await setDoc(taskRef, {
    id: task.id,
    title: task.title,
    createdAt: task.createdAt
  }, { merge: true });
};

export const loadTasks = async (uid: string): Promise<SessionTask[]> => {
  if (!isFirebaseConfigured || !db) return [];
  const tasksCol = collection(db, 'users', uid, 'tasks');
  const q = query(tasksCol, orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  
  const tasks: SessionTask[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    tasks.push({
      id: data.id || docSnap.id,
      title: data.title,
      createdAt: data.createdAt
    });
  });
  return tasks;
};

/**
 * Chat State Sync (main task and active subtask ID)
 */
export const saveChatState = async (uid: string, state: ChatState) => {
  if (!isFirebaseConfigured || !db) return;
  const stateRef = doc(db, 'users', uid, 'chatState', 'current');
  await setDoc(stateRef, {
    ...state,
    updatedAt: Date.now()
  }, { merge: true });
};

export const loadChatState = async (uid: string): Promise<ChatState | null> => {
  if (!isFirebaseConfigured || !db) return null;
  const stateRef = doc(db, 'users', uid, 'chatState', 'current');
  const snap = await getDoc(stateRef);
  if (snap.exists()) {
    const data = snap.data();
    return {
      task: data.task ?? null,
      currentTaskId: data.currentTaskId ?? null
    };
  }
  return null;
};

/**
 * Sync local data to Firebase in a batch on sign-in (migration)
 */
export const syncLocalDataToFirebase = async (
  uid: string,
  localMessages: ChatMessage[],
  localTasks: SessionTask[],
  localChatState: ChatState
) => {
  if (!isFirebaseConfigured || !db) return;
  const batch = writeBatch(db);

  // Sync state
  const stateRef = doc(db, 'users', uid, 'chatState', 'current');
  batch.set(stateRef, {
    ...localChatState,
    updatedAt: Date.now()
  }, { merge: true });

  // Sync messages
  localMessages.forEach((msg, idx) => {
    const msgId = msg.id || `msg-migrated-${Date.now()}-${idx}`;
    const msgRef = doc(db, 'users', uid, 'messages', msgId);
    const msgData = JSON.parse(JSON.stringify({
      ...msg,
      id: msgId,
      createdAt: Date.now() + idx // maintain sequence
    }));
    batch.set(msgRef, msgData, { merge: true });
  });

  // Sync tasks
  localTasks.forEach((task) => {
    const taskRef = doc(db, 'users', uid, 'tasks', task.id);
    batch.set(taskRef, {
      id: task.id,
      title: task.title,
      createdAt: task.createdAt
    }, { merge: true });
  });

  await batch.commit();
};

/**
 * Clear user data on sign out (optional helper, usually we just reset client memory,
 * but this is here if needed for resetting database state)
 */
export const clearUserDatabaseData = async (uid: string) => {
  if (!isFirebaseConfigured || !db) return;
  const batch = writeBatch(db);

  // Note: Firestore doesn't support recursive collection deletion in client SDK,
  // but we can delete the core state documents.
  const stateRef = doc(db, 'users', uid, 'chatState', 'current');
  batch.delete(stateRef);
  
  const settingsRef = doc(db, 'users', uid, 'settings', 'ai');
  batch.delete(settingsRef);

  await batch.commit();
};
