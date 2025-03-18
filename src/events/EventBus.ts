import { EventEmitter } from "events";

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Increase max listeners to avoid memory leak warnings
    this.emitter.setMaxListeners(100);
  }

  public on(event: string, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);
  }

  public once(event: string, listener: (...args: any[]) => void): void {
    this.emitter.once(event, listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    this.emitter.off(event, listener);
  }

  public emit(event: string, ...args: any[]): boolean {
    return this.emitter.emit(event, ...args);
  }

  public listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }
} 