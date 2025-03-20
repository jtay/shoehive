import { EventBus } from "../events/EventBus";
import { Table } from "./Table";

export class TableFactory {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  public createTable(totalSeats: number, maxSeatsPerPlayer: number): Table {
    const table = new Table(this.eventBus, totalSeats, maxSeatsPerPlayer);
    this.eventBus.emit("table:created", table);
    return table;
  }
} 