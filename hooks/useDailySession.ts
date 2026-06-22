import { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import * as dbService from '../services/dbService';

/**
 * Get today's date as YYYY-MM-DD in local timezone
 */
export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Convert a date string to a session ID
 */
export const dateToSessionId = (date: string): string => `session-${date}`;

/**
 * Get today's session ID
 */
export const getTodaySessionId = (): string => dateToSessionId(getTodayDateString());

/**
 * Calculate milliseconds until next midnight (local time)
 */
const msUntilNextMidnight = (): number => {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0, 0
  );
  return nextMidnight.getTime() - now.getTime();
};

/**
 * Format a date string (YYYY-MM-DD) to a human-readable string
 * e.g. "Monday, June 22"
 */
export const formatSessionDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

interface UseDailySessionResult {
  /** Current session ID, e.g. "session-2026-06-22" */
  sessionId: string;
  /** Whether a brand-new session was just created (first load of the day) */
  isNewSession: boolean;
  /** Today's date formatted for display, e.g. "Monday, June 22" */
  displayDate: string;
  /** Whether the session is still being initialized */
  sessionLoading: boolean;
}

/**
 * Hook that manages daily chat sessions for signed-in users.
 *
 * - Computes today's session ID on mount
 * - Creates a session document in Firestore if it doesn't exist
 * - Migrates legacy flat data on first use
 * - Sets a timer for midnight to trigger session rotation
 *
 * @param user - Firebase User (null when signed out)
 * @param onSessionChange - Callback fired when session rotates at midnight
 */
export const useDailySession = (
  user: User | null,
  onSessionChange?: (newSessionId: string) => void
): UseDailySessionResult => {
  const [sessionId, setSessionId] = useState<string>(getTodaySessionId());
  const [isNewSession, setIsNewSession] = useState<boolean>(false);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const midnightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);

  // Keep callback ref current
  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  const todayDate = getTodayDateString();
  const displayDate = formatSessionDate(todayDate);

  // Initialize session when user signs in or on mount
  useEffect(() => {
    if (!user) {
      // No user — just use today's session ID locally, no Firestore work
      setSessionId(getTodaySessionId());
      setIsNewSession(false);
      setSessionLoading(false);
      return;
    }

    let cancelled = false;

    const initSession = async () => {
      setSessionLoading(true);
      const currentSessionId = getTodaySessionId();
      const currentDate = getTodayDateString();

      try {
        // 1. Check if today's session already exists
        const existingSession = await dbService.loadSessionMeta(user.uid, currentSessionId);

        if (existingSession) {
          // Session already exists — just load it
          if (!cancelled) {
            setSessionId(currentSessionId);
            setIsNewSession(false);
          }
        } else {
          // 2. No session for today — try migration first
          const migrated = await dbService.migrateUnsessionedData(user.uid, currentSessionId);

          if (!migrated) {
            // No legacy data either — create a fresh session
            await dbService.createSession(user.uid, currentSessionId, currentDate);
          }

          if (!cancelled) {
            setSessionId(currentSessionId);
            setIsNewSession(true);
          }
        }
      } catch (error) {
        console.error('Error initializing daily session:', error);
        // Fall back to using today's session ID even if Firestore fails
        if (!cancelled) {
          setSessionId(currentSessionId);
          setIsNewSession(false);
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    void initSession();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Schedule midnight session rotation
  useEffect(() => {
    if (!user) return;

    const scheduleMidnightRotation = () => {
      // Clear any existing timer
      if (midnightTimerRef.current) {
        clearTimeout(midnightTimerRef.current);
      }

      const ms = msUntilNextMidnight();

      midnightTimerRef.current = setTimeout(() => {
        const newSessionId = getTodaySessionId();
        const newDate = getTodayDateString();

        setSessionId(newSessionId);
        setIsNewSession(true);

        // Create the new session in Firestore
        if (user) {
          void dbService.createSession(user.uid, newSessionId, newDate);
        }

        // Notify parent to reset state
        onSessionChangeRef.current?.(newSessionId);

        // Schedule the next midnight
        scheduleMidnightRotation();
      }, ms);
    };

    scheduleMidnightRotation();

    return () => {
      if (midnightTimerRef.current) {
        clearTimeout(midnightTimerRef.current);
        midnightTimerRef.current = null;
      }
    };
  }, [user]);

  return { sessionId, isNewSession, displayDate, sessionLoading };
};
