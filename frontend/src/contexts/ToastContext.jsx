import React, { createContext, useContext, useCallback } from 'react';
import { toast as sonner } from 'sonner';

const ToastContext = createContext(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

export function ToastProvider({ children }) {
  const success = useCallback((message, duration) =>
    sonner.success(message, duration != null ? { duration } : undefined), []);
  const error = useCallback((message, duration) =>
    sonner.error(message, duration != null ? { duration } : undefined), []);
  const warning = useCallback((message, duration) =>
    sonner.warning(message, duration != null ? { duration } : undefined), []);
  const info = useCallback((message, duration) =>
    sonner.info(message, duration != null ? { duration } : undefined), []);

  return (
    <ToastContext.Provider value={{ success, error, warning, info, toasts: [], addToast: sonner, removeToast: () => {} }}>
      {children}
    </ToastContext.Provider>
  );
}

export default ToastContext;
