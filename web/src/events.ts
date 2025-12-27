// Events - Typed event emitter for cross-module communication
// Replaces callback coupling pattern with a decoupled pub/sub system

// Event type definitions
export type EventMap = {
  'schema:loaded': void;
  'table:selected': string;
  'table:navigate': string;
  'search:clear': void;
  'search:highlight': Set<string>;
  'list:render': void;
};

type EventHandler<T> = (data: T) => void;

class EventEmitter {
  private listeners = new Map<keyof EventMap, Set<EventHandler<unknown>>>();
  private registeredKeys = new Set<string>();

  // Subscribe to an event, but only once per unique key.
  // Use this to prevent duplicate subscriptions when init() may be called multiple times.
  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>, key: string): void {
    if (this.registeredKeys.has(key)) return;
    this.registeredKeys.add(key);
    this.on(event, handler);
  }

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<unknown>);
    }
  }

  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K] extends void ? [] : [EventMap[K]]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const data = args[0] as EventMap[K];
      handlers.forEach((handler) => {
        try {
          (handler as EventHandler<EventMap[K]>)(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }
}

// Singleton event bus
export const events = new EventEmitter();
