import { doc, setDoc, getDoc, collection, getDocs, query, orderBy, deleteDoc, writeBatch, limit, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase.config';
import { ChatMessage, SessionTask, AISettings, AIProvider, ScheduledTask } from '../types';

export interface ChatState {
  task: string | null;
  currentTaskId: string | null;
}

export interface SessionMeta {
  sessionId: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
  task?: string | null;
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
 * Settings Sync (not session-scoped — settings persist across sessions)
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

// ─── Session Management ──────────────────────────────────────────────

/**
 * Create a new session metadata document
 */
export const createSession = async (uid: string, sessionId: string, date: string) => {
  if (!isFirebaseConfigured || !db) return;
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  await setDoc(sessionRef, {
    sessionId,
    date,
    createdAt: Date.now(),
  }, { merge: true });
};

/**
 * Load metadata for a specific session
 */
export const loadSessionMeta = async (uid: string, sessionId: string): Promise<SessionMeta | null> => {
  if (!isFirebaseConfigured || !db) return null;
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  const snap = await getDoc(sessionRef);
  if (snap.exists()) {
    const data = snap.data();
    return {
      sessionId: data.sessionId,
      date: data.date,
      createdAt: data.createdAt,
      task: data.task ?? null,
    };
  }
  return null;
};

/**
 * List all sessions for a user, ordered by creation date (newest first)
 */
export const listSessions = async (uid: string): Promise<SessionMeta[]> => {
  if (!isFirebaseConfigured || !db) return [];
  const sessionsCol = collection(db, 'users', uid, 'sessions');
  const q = query(sessionsCol, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);

  const sessions: SessionMeta[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    sessions.push({
      sessionId: data.sessionId || docSnap.id,
      date: data.date,
      createdAt: data.createdAt,
      task: data.task ?? null,
    });
  });
  return sessions;
};

// ─── Session-scoped Messages ─────────────────────────────────────────

/**
 * Messages Sync (scoped to session)
 */
export const saveMessage = async (uid: string, sessionId: string, message: ChatMessage) => {
  if (!isFirebaseConfigured || !db || !message.id) return;
  const msgRef = doc(db, 'users', uid, 'sessions', sessionId, 'messages', message.id);
  
  // Strip undefined values for Firestore compatibility
  const msgData = JSON.parse(JSON.stringify({
    ...message,
    // Add timestamp for sorting if not present
    createdAt: Date.now()
  }));

  await setDoc(msgRef, msgData, { merge: true });
};

export const loadMessages = async (uid: string, sessionId: string): Promise<ChatMessage[]> => {
  if (!isFirebaseConfigured || !db) return [];
  const msgsCol = collection(db, 'users', uid, 'sessions', sessionId, 'messages');
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

// ─── Session-scoped Tasks ────────────────────────────────────────────

/**
 * Tasks Sync (scoped to session)
 */
export const saveTask = async (uid: string, sessionId: string, task: SessionTask) => {
  if (!isFirebaseConfigured || !db) return;
  const taskRef = doc(db, 'users', uid, 'sessions', sessionId, 'tasks', task.id);
  await setDoc(taskRef, {
    id: task.id,
    title: task.title,
    createdAt: task.createdAt
  }, { merge: true });
};

export const loadTasks = async (uid: string, sessionId: string): Promise<SessionTask[]> => {
  if (!isFirebaseConfigured || !db) return [];
  const tasksCol = collection(db, 'users', uid, 'sessions', sessionId, 'tasks');
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

// ─── Session-scoped Chat State ───────────────────────────────────────

/**
 * Chat State Sync (main task and active subtask ID, scoped to session)
 */
export const saveChatState = async (uid: string, sessionId: string, state: ChatState) => {
  if (!isFirebaseConfigured || !db) return;
  const stateRef = doc(db, 'users', uid, 'sessions', sessionId, 'chatState', 'current');
  await setDoc(stateRef, {
    ...state,
    updatedAt: Date.now()
  }, { merge: true });
};

export const loadChatState = async (uid: string, sessionId: string): Promise<ChatState | null> => {
  if (!isFirebaseConfigured || !db) return null;
  const stateRef = doc(db, 'users', uid, 'sessions', sessionId, 'chatState', 'current');
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

// ─── Migration & Sync ────────────────────────────────────────────────

/**
 * Migrate existing flat (un-sessioned) data into a session.
 * Reads from the old paths (users/{uid}/messages, etc.) and writes
 * into users/{uid}/sessions/{sessionId}/... then cleans up old docs.
 */
export const migrateUnsessionedData = async (uid: string, sessionId: string): Promise<boolean> => {
  if (!isFirebaseConfigured || !db) return false;

  // Check if old-style data exists by probing for any message in the flat collection
  const oldMsgsCol = collection(db, 'users', uid, 'messages');
  const probe = query(oldMsgsCol, limit(1));
  const probeSnap = await getDocs(probe);

  if (probeSnap.empty) {
    // Also check old chatState
    const oldStateRef = doc(db, 'users', uid, 'chatState', 'current');
    const oldStateSnap = await getDoc(oldStateRef);
    if (!oldStateSnap.exists()) {
      return false; // No legacy data to migrate
    }
  }

  const batch = writeBatch(db);

  // 1. Create session meta
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  batch.set(sessionRef, {
    sessionId,
    date: sessionId.replace('session-', ''),
    createdAt: Date.now(),
  }, { merge: true });

  // 2. Migrate messages
  const oldMsgsSnap = await getDocs(query(oldMsgsCol, orderBy('createdAt', 'asc')));
  oldMsgsSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const newMsgRef = doc(db, 'users', uid, 'sessions', sessionId, 'messages', docSnap.id);
    batch.set(newMsgRef, data);
    // Mark old doc for deletion
    batch.delete(doc(db, 'users', uid, 'messages', docSnap.id));
  });

  // 3. Migrate tasks
  const oldTasksCol = collection(db, 'users', uid, 'tasks');
  const oldTasksSnap = await getDocs(query(oldTasksCol, orderBy('createdAt', 'asc')));
  oldTasksSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const newTaskRef = doc(db, 'users', uid, 'sessions', sessionId, 'tasks', docSnap.id);
    batch.set(newTaskRef, data);
    batch.delete(doc(db, 'users', uid, 'tasks', docSnap.id));
  });

  // 4. Migrate chat state
  const oldStateRef = doc(db, 'users', uid, 'chatState', 'current');
  const oldStateSnap = await getDoc(oldStateRef);
  if (oldStateSnap.exists()) {
    const stateData = oldStateSnap.data();
    const newStateRef = doc(db, 'users', uid, 'sessions', sessionId, 'chatState', 'current');
    batch.set(newStateRef, stateData);
    batch.delete(oldStateRef);

    // Also update session meta with the task name
    if (stateData.task) {
      batch.set(sessionRef, { task: stateData.task }, { merge: true });
    }
  }

  await batch.commit();
  return true;
};

/**
 * Sync local data to Firebase in a batch on sign-in (migration), scoped to a session
 */
export const syncLocalDataToFirebase = async (
  uid: string,
  sessionId: string,
  localMessages: ChatMessage[],
  localTasks: SessionTask[],
  localChatState: ChatState
) => {
  if (!isFirebaseConfigured || !db) return;
  const batch = writeBatch(db);

  // Ensure session exists
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  batch.set(sessionRef, {
    sessionId,
    date: sessionId.replace('session-', ''),
    createdAt: Date.now(),
    task: localChatState.task,
  }, { merge: true });

  // Sync state
  const stateRef = doc(db, 'users', uid, 'sessions', sessionId, 'chatState', 'current');
  batch.set(stateRef, {
    ...localChatState,
    updatedAt: Date.now()
  }, { merge: true });

  // Sync messages
  localMessages.forEach((msg, idx) => {
    const msgId = msg.id || `msg-migrated-${Date.now()}-${idx}`;
    const msgRef = doc(db, 'users', uid, 'sessions', sessionId, 'messages', msgId);
    const msgData = JSON.parse(JSON.stringify({
      ...msg,
      id: msgId,
      createdAt: Date.now() + idx // maintain sequence
    }));
    batch.set(msgRef, msgData, { merge: true });
  });

  // Sync tasks
  localTasks.forEach((task) => {
    const taskRef = doc(db, 'users', uid, 'sessions', sessionId, 'tasks', task.id);
    batch.set(taskRef, {
      id: task.id,
      title: task.title,
      createdAt: task.createdAt
    }, { merge: true });
  });

  await batch.commit();
};

// ─── Scheduled Tasks (user-level, not session-scoped) ────────────────

/**
 * Save a task scheduled for a future date.
 * Stored at user level so it persists across sessions.
 */
export const saveScheduledTask = async (uid: string, task: ScheduledTask) => {
  if (!isFirebaseConfigured || !db) return;
  const taskRef = doc(db, 'users', uid, 'scheduledTasks', task.id);
  await setDoc(taskRef, {
    id: task.id,
    title: task.title,
    scheduledDate: task.scheduledDate,
    createdAt: task.createdAt,
    consumed: task.consumed,
  });
};

/**
 * Load all unconsumed scheduled tasks for a specific date.
 */
export const loadScheduledTasksForDate = async (uid: string, date: string): Promise<ScheduledTask[]> => {
  if (!isFirebaseConfigured || !db) return [];
  const tasksCol = collection(db, 'users', uid, 'scheduledTasks');
  const q = query(
    tasksCol,
    where('scheduledDate', '==', date),
    where('consumed', '==', false)
  );
  const snap = await getDocs(q);

  const tasks: ScheduledTask[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    tasks.push({
      id: data.id || docSnap.id,
      title: data.title,
      scheduledDate: data.scheduledDate,
      createdAt: data.createdAt,
      consumed: data.consumed ?? false,
    });
  });
  return tasks;
};

/**
 * Mark scheduled tasks as consumed so they are not re-loaded.
 */
export const markScheduledTasksConsumed = async (uid: string, taskIds: string[]) => {
  if (!isFirebaseConfigured || !db || taskIds.length === 0) return;
  const batch = writeBatch(db);
  for (const taskId of taskIds) {
    const taskRef = doc(db, 'users', uid, 'scheduledTasks', taskId);
    batch.update(taskRef, { consumed: true });
  }
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
  // Settings are not session-scoped, so we delete them at user level.
  const settingsRef = doc(db, 'users', uid, 'settings', 'ai');
  batch.delete(settingsRef);

  await batch.commit();
};
