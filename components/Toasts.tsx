import React, { useCallback, useEffect, useRef, useState } from 'react';

export type ToastKind = 'error' | 'warning' | 'info';

export interface ToastItem {
    id: number;
    text: string;
    kind: ToastKind;
}

const TOAST_DURATION_MS = 6000;

export const useToasts = () => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextIdRef = useRef(1);
    const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    const dismissToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
        const timeout = timeoutsRef.current.get(id);
        if (timeout) {
            clearTimeout(timeout);
            timeoutsRef.current.delete(id);
        }
    }, []);

    const pushToast = useCallback((text: string, kind: ToastKind = 'info') => {
        const id = nextIdRef.current++;
        setToasts(prev => [...prev, { id, text, kind }]);
        const timeout = setTimeout(() => {
            timeoutsRef.current.delete(id);
            setToasts(prev => prev.filter(toast => toast.id !== id));
        }, TOAST_DURATION_MS);
        timeoutsRef.current.set(id, timeout);
    }, []);

    useEffect(() => {
        const timeouts = timeoutsRef.current;
        return () => {
            timeouts.forEach(timeout => clearTimeout(timeout));
        };
    }, []);

    return { toasts, pushToast, dismissToast };
};

interface ToastContainerProps {
    toasts: ToastItem[];
    onDismiss: (id: number) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => (
    <div className="toast-container" role="status" aria-live="polite">
        {toasts.map(toast => (
            <div key={toast.id} className={`toast toast-${toast.kind} animate-fadeIn`}>
                <span className={`toast-dot toast-dot-${toast.kind}`} aria-hidden="true" />
                <span className="toast-text">{toast.text}</span>
                <button
                    type="button"
                    className="toast-close"
                    onClick={() => onDismiss(toast.id)}
                    aria-label="Dismiss notification"
                >
                    ✕
                </button>
            </div>
        ))}
    </div>
);
