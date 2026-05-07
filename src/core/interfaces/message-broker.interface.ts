// Abstraction for the broker

import { IMessageHandler } from './message-handler.interface'

export interface IMessageBroker {
  connect(): Promise<void>
  publish(exchange: string, routingKey: string, message: any): Promise<boolean>
  subscribe(
    queue: string,
    exchange: string,
    routingKey: string,
    handler: IMessageHandler,
  ): Promise<void>
}
