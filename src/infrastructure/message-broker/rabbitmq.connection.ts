// Singleton connection manager

import amqp, { ChannelModel, Channel } from 'amqplib'

export class RabbitMQConnection {
  private static instance: RabbitMQConnection
  private connection: ChannelModel | null = null
  private channel: Channel | null = null
  private isConnecting: boolean = false

  // Private constructor prevents direct instantiation
  private constructor() {}

  // The single access point for the connection instance
  public static getInstance(): RabbitMQConnection {
    if (!RabbitMQConnection.instance) {
      RabbitMQConnection.instance = new RabbitMQConnection()
    }
    return RabbitMQConnection.instance
  }

  public async connect(url: string): Promise<Channel> {
    if (this.channel) return this.channel
    if (this.isConnecting)
      throw new Error('Connection is already being established')

    this.isConnecting = true
    try {
      const connection = await amqp.connect(url)
      const channel = await connection.createChannel()

      this.connection = connection
      this.channel = channel

      // Connection fault tolerance
      connection.on('error', (err) => console.error('RabbitMQ Error:', err))
      connection.on('close', () => {
        this.channel = null
        this.connection = null
        console.warn('RabbitMQ Connection closed')
      })

      // Best practice: Limit unacknowledged messages per consumer worker
      await channel.prefetch(1)

      return channel
    } finally {
      this.isConnecting = false
    }
  }

  public getChannel(): Channel {
    if (!this.channel)
      throw new Error('Channel not established. Call connect() first.')
    return this.channel
  }
}
