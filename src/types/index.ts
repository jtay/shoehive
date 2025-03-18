export interface GameConfig {
  totalSeats: number;
  maxSeatsPerPlayer: number;
}

export interface PlayerAttributes {
  [key: string]: any;
}

export interface TableOptions {
  id?: string;
  config?: GameConfig;
}

export enum GameEvents {
  PLAYER_CONNECTED = "playerConnected",
  PLAYER_DISCONNECTED = "playerDisconnected",
  PLAYER_JOINED_TABLE = "playerJoinedTable",
  PLAYER_LEFT_TABLE = "playerLeftTable",
  PLAYER_SEATED = "playerSeated",
  PLAYER_UNSEATED = "playerUnseated",
  TABLE_CREATED = "tableCreated",
  TABLE_STATE_CHANGED = "tableStateChanged",
  TABLE_EMPTY = "tableEmpty"
} 