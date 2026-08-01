export class Agent {
  id: string;
  name: string;

  constructor(config: { id: string; name: string }) {
    this.id = config.id;
    this.name = config.name;
  }
}
