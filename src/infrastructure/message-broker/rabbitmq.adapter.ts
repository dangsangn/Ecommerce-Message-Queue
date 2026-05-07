// Implements MessageBroker interface

import { IMessageBroker } from '../../core/interfaces/message-broker.interface'
import { IMessageHandler } from '../../core/interfaces/message-handler.interface'
import { RabbitMQConnection } from './rabbitmq.connection'

export class RabbitMQAdapter implements IMessageBroker {
  private connection: RabbitMQConnection

  constructor(private url: string) {
    this.connection = RabbitMQConnection.getInstance()
  }

  async connect(): Promise<void> {
    await this.connection.connect(this.url)
  }

  async publish(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<boolean> {
    const channel = this.connection.getChannel()

    await channel.assertExchange(exchange, 'direct', { durable: true })

    const buffer = Buffer.from(JSON.stringify(message))
    // persistent: true ensures messages are written to disk
    return channel.publish(exchange, routingKey, buffer, { persistent: true })
  }

  async subscribe(
    queue: string,
    exchange: string,
    routingKey: string,
    handler: IMessageHandler,
  ): Promise<void> {
    const channel = this.connection.getChannel()

    await channel.assertExchange(exchange, 'direct', { durable: true })
    const q = await channel.assertQueue(queue, { durable: true })
    await channel.bindQueue(q.queue, exchange, routingKey)

    channel.consume(
      q.queue,
      async (msg) => {
        if (!msg) return

        try {
          const payload = JSON.parse(msg.content.toString())

          // Execute the injected handler strategy
          await handler.handle(payload)

          // Acknowledge ONLY after successful processing
          channel.ack(msg)
        } catch (error) {
          console.error(`Error processing message in ${queue}:`, error)
          // Nack the message without requeueing (routes to DLX if configured)
          channel.nack(msg, false, false)
        }
      },
      { noAck: false },
    ) // Always enforce manual acknowledgments
  }
}
