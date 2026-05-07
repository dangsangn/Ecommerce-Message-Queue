// Abstraction for consumers
export interface IMessageHandler {
  handle(message: any): Promise<void>
}
