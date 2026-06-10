import { useSyncExternalStore } from 'react';
import { subscribe, getState, type ChatState } from './chat-store';

/**
 * Subscribe to a slice of chat state. Selectors must return values whose
 * identity changes when their contents change; the store replaces arrays,
 * maps, and wire objects immutably for exactly this reason.
 */
export function useChatState<T>(selector: (state: ChatState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState()),
  );
}
