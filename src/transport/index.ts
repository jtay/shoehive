import { AuthModule } from './AuthModule';
import { ServerTransportModule } from './ServerTransportModule';

export { AuthModule } from './AuthModule';
export { ServerTransportModule } from './ServerTransportModule';
export * from './implementations';

/**
 * Combines all transport modules into a single interface.
 * Implementations can provide both authentication and server transport functionality.
 */
export interface TransportModule {
  auth: AuthModule;
  server: ServerTransportModule;
} 