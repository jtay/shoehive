import { EventEmitter } from "events";
import { EventType } from "./EventTypes";

/**
 * EventBus
 * 
 * A wrapper around Node.js EventEmitter that provides a central event bus
 * for the entire application. This class is responsible for dispatching events
 * and registering event handlers.
 * 
 * Event naming convention:
 * Events follow a namespaced pattern with colon separators: "domain:action"
 * For example: "player:connected", "table:player:joined", etc.
 * 
 * Use the EventTypes constants to ensure consistent event naming across the application.
 * 
 * External Usage:
 * Developers can extend the EventBus with their own custom events:
 * 
 * ```typescript
 * // Define your custom events
 * const MY_EVENTS = {
 *   CUSTOM_ACTION: "myGame:customAction"
 * } as const;
 * 
 * // Use the predefined event constants in your code
 * eventBus.on(MY_EVENTS.CUSTOM_ACTION, (data) => {
 *   console.log(`Custom action received: ${data}`);
 * });
 * 
 * // You can also use string literals, but you lose type safety
 * eventBus.on("myGame:anotherAction", (data) => {
 *   console.log(`Another action received: ${data}`);
 * });
 * ```
 */
export class EventBus {
  private emitter: EventEmitter;
  private debugEnabled: boolean = false;
  private debugFilter?: (event: string) => boolean;
  private debugLogger: (event: string, ...args: any[]) => void = console.log;
  private originalEmit: EventEmitter['emit'];

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    
    // Store the original emit method
    this.originalEmit = this.emitter.emit;
  }

  /**
   * Register an event listener
   * @param event The event to listen for
   * @param listener The callback function to execute when the event occurs
   */
  public on(event: EventType | string, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);
  }

  /**
   * Register a one-time event listener
   * @param event The event to listen for
   * @param listener The callback function to execute when the event occurs
   */
  public once(event: EventType | string, listener: (...args: any[]) => void): void {
    this.emitter.once(event, listener);
  }

  /**
   * Remove an event listener
   * @param event The event to stop listening for
   * @param listener The callback function to remove
   */
  public off(event: EventType | string, listener: (...args: any[]) => void): void {
    this.emitter.off(event, listener);
  }

  /**
   * Emit an event
   * @param event The event to emit
   * @param args Arguments to pass to event listeners
   * @returns Whether the event had listeners
   */
  public emit(event: EventType | string, ...args: any[]): boolean {
    const result = this.originalEmit.call(this.emitter, event, ...args);
    
    // If debug monitoring is enabled, log the event
    if (this.debugEnabled) {
      if (!this.debugFilter || this.debugFilter(event)) {
        this.debugLogger(`[EVENT] ${event}`, ...args);
      }
    }
    
    return result;
  }

  /**
   * Get the number of listeners for an event
   * @param event The event to check
   * @returns The number of listeners for the event
   */
  public listenerCount(event: EventType | string): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Debug monitor for all events
   * Logs all events and their payloads to the console
   * Useful during development or debugging
   * 
   * @param enabled Whether to enable debug monitoring
   * @param filter Optional filter function to only log certain events
   * @param logger Custom logger function (defaults to console.log)
   */
  public debugMonitor(
    enabled: boolean = true, 
    filter?: (event: string) => boolean,
    logger: (event: string, ...args: any[]) => void = console.log
  ): void {
    this.debugEnabled = enabled;
    this.debugFilter = filter;
    this.debugLogger = logger;
    
    // For testing purposes, add a listener to a special event named '*'
    // This doesn't actually catch all events, but it's useful for testing the listenerCount
    if (enabled) {
      this.emitter.on('*', () => {});
    } else {
      this.emitter.removeAllListeners('*');
    }
  }
} 