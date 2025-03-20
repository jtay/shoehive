import { EventBus } from "../events/EventBus";
import { Table } from "./Table";
import { TABLE_EVENTS } from "../events/EventTypes";

/**
 * Factory class for creating tables.
 * This class is responsible for creating new tables and emitting events when tables are created.
 */
export class TableFactory {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Creates a new table with the specified number of seats and maximum seats per player.
   * Emits a TABLE_EVENTS.CREATED event when the table is created.
   * 
   * @param totalSeats - The total number of seats at the table.
   * @param maxSeatsPerPlayer - The maximum number of seats a player can occupy.
   * @returns The newly created table.
   */
  public createTable(totalSeats: number, maxSeatsPerPlayer: number): Table {
    const table = new Table(this.eventBus, totalSeats, maxSeatsPerPlayer);
    this.eventBus.emit(TABLE_EVENTS.CREATED, table);
    return table;
  }
} 