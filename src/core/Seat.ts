import { Player } from "./Player";
import { Hand } from "./Card";

export class Seat {
  private player: Player | null = null;
  private hands: Map<string, Hand> = new Map();
  private attributes: Map<string, any> = new Map();

  constructor() {
    // Initialize with a main hand by default
    this.hands.set("main", new Hand("main"));
  }

  public setPlayer(player: Player | null): void {
    this.player = player;
  }

  public getPlayer(): Player | null {
    return this.player;
  }

  public addHand(handId: string): boolean {
    if (this.hands.has(handId)) {
      return false;
    }
    
    this.hands.set(handId, new Hand(handId));
    return true;
  }

  public removeHand(handId: string): boolean {
    if (handId === "main") {
      return false; // Cannot remove the main hand
    }
    
    return this.hands.delete(handId);
  }

  public getHand(handId: string = "main"): Hand | null {
    return this.hands.get(handId) || null;
  }

  public getAllHands(): Map<string, Hand> {
    return new Map(this.hands);
  }

  public clearHand(handId: string = "main"): boolean {
    const hand = this.hands.get(handId);
    if (!hand) return false;
    
    hand.clear();
    return true;
  }

  public clearAllHands(): void {
    for (const [_, hand] of this.hands) {
      hand.clear();
    }
  }

  public setAttribute(key: string, value: any): void {
    this.attributes.set(key, value);
  }

  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  public canPlayerModify(playerId: string): boolean {
    // Only the player who owns the seat can modify their hand
    return this.player !== null && this.player.id === playerId;
  }
} 