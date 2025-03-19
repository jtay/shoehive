import * as http from "http";
import { Player } from "../core/Player";

/**
 * Interface defining authentication functionality for the Shoehive framework.
 * Implementations should provide methods to authenticate players during connection.
 */
export interface AuthModule {
  /**
   * Authenticates a player based on their HTTP request during WebSocket connection.
   * @param request The incoming HTTP request during WebSocket connection
   * @returns A promise that resolves to a player ID if authentication is successful, or null if it fails
   */
  authenticatePlayer(request: http.IncomingMessage): Promise<string | null>;
} 