# Clean Architecture & Design Patterns for RabbitMQ (Node.js + TypeScript)

This guide outlines how to build a highly maintainable, testable, and decoupled Message Queue system using Clean Code principles, SOLID, and structural Design Patterns.

## 1. Core Architectural Principles

When building a robust enterprise message queue system, avoid tying your business logic directly to `amqplib`. Instead, apply these principles:
- **Dependency Inversion (SOLID)**: High-level modules (business logic) should not depend on low-level modules (RabbitMQ implementation). Both should depend on abstractions (Interfaces).
- **Singleton Pattern**: Use exactly one persistent connection instance for the RabbitMQ client.
- **Adapter Pattern**: Wrap the RabbitMQ library behind a generic interface so you can easily swap it out (e.g., for Kafka, Redis) or mock it during testing.
- **Strategy Pattern**: Use handlers as individual strategies to process different types of incoming messages dynamically without giant `switch` statements.

## 2. Layered Directory Structure

Adopt a layered architecture to enforce a strict separation of concerns:

```text
src/
├── core/
│   ├── interfaces/
│   │   ├── message-broker.interface.ts # Abstraction for the broker
│   │   └── message-handler.interface.ts# Abstraction for consumers
│   └── errors/
│       └── message-queue.error.ts      # Custom domain errors
├── infrastructure/
│   └── message-broker/
│       ├── rabbitmq.connection.ts      # Singleton connection manager
│       └── rabbitmq.adapter.ts         # Implements MessageBroker interface
├── application/
│   └── handlers/
│       ├── user-created.handler.ts     # Strategy: Handles user creation events
│       └── order-placed.handler.ts     # Strategy: Handles order events
└── index.ts                            # Composition Root (Dependency Injection setup)
```

## 3. Interfaces (Dependency Inversion)

First, define the contracts. Your business logic will **only** interact with these interfaces, never `amqplib`.

```typescript
// src/core/interfaces/message-broker.interface.ts
import { IMessageHandler } from './message-handler.interface';

export interface IMessageBroker {
  connect(): Promise<void>;
  publish(exchange: string, routingKey: string, message: any): Promise<boolean>;
  subscribe(queue: string, exchange: string, routingKey: string, handler: IMessageHandler): Promise<void>;
}

// src/core/interfaces/message-handler.interface.ts
export interface IMessageHandler {
  handle(message: any): Promise<void>;
}
```

## 4. Connection Manager (Singleton Pattern)

Manage the complex connection state efficiently without exposing it globally.

```typescript
// src/infrastructure/message-broker/rabbitmq.connection.ts
import amqp, { Connection, Channel } from 'amqplib';

export class RabbitMQConnection {
  private static instance: RabbitMQConnection;
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private isConnecting: boolean = false;

  // Private constructor prevents direct instantiation
  private constructor() {}

  // The single access point for the connection instance
  public static getInstance(): RabbitMQConnection {
    if (!RabbitMQConnection.instance) {
      RabbitMQConnection.instance = new RabbitMQConnection();
    }
    return RabbitMQConnection.instance;
  }

  public async connect(url: string): Promise<Channel> {
    if (this.channel) return this.channel;
    if (this.isConnecting) throw new Error('Connection is already being established');

    this.isConnecting = true;
    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      
      // Connection fault tolerance
      this.connection.on('error', (err) => console.error('RabbitMQ Error:', err));
      this.connection.on('close', () => {
        this.channel = null;
        this.connection = null;
        console.warn('RabbitMQ Connection closed');
      });

      // Best practice: Limit unacknowledged messages per consumer worker
      await this.channel.prefetch(1);
      
      return this.channel;
    } finally {
      this.isConnecting = false;
    }
  }

  public getChannel(): Channel {
    if (!this.channel) throw new Error('Channel not established. Call connect() first.');
    return this.channel;
  }
}
```

## 5. Message Broker (Adapter Pattern)

Implement the interface using the RabbitMQ library. This completely hides `amqplib` from your application layer.

```typescript
// src/infrastructure/message-broker/rabbitmq.adapter.ts
import { IMessageBroker } from '../../core/interfaces/message-broker.interface';
import { IMessageHandler } from '../../core/interfaces/message-handler.interface';
import { RabbitMQConnection } from './rabbitmq.connection';

export class RabbitMQAdapter implements IMessageBroker {
  private connection: RabbitMQConnection;

  constructor(private url: string) {
    this.connection = RabbitMQConnection.getInstance();
  }

  async connect(): Promise<void> {
    await this.connection.connect(this.url);
  }

  async publish(exchange: string, routingKey: string, message: any): Promise<boolean> {
    const channel = this.connection.getChannel();
    
    await channel.assertExchange(exchange, 'direct', { durable: true });
    
    const buffer = Buffer.from(JSON.stringify(message));
    // persistent: true ensures messages are written to disk
    return channel.publish(exchange, routingKey, buffer, { persistent: true });
  }

  async subscribe(queue: string, exchange: string, routingKey: string, handler: IMessageHandler): Promise<void> {
    const channel = this.connection.getChannel();

    await channel.assertExchange(exchange, 'direct', { durable: true });
    const q = await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(q.queue, exchange, routingKey);

    channel.consume(q.queue, async (msg) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString());
        
        // Execute the injected handler strategy
        await handler.handle(payload);
        
        // Acknowledge ONLY after successful processing
        channel.ack(msg);
      } catch (error) {
        console.error(`Error processing message in ${queue}:`, error);
        // Nack the message without requeueing (routes to DLX if configured)
        channel.nack(msg, false, false); 
      }
    }, { noAck: false }); // Always enforce manual acknowledgments
  }
}
```

## 6. Message Handlers (Strategy Pattern)

Create isolated classes for specific tasks. They implement `IMessageHandler` and only care about their specific business logic domain.

```typescript
// src/application/handlers/user-created.handler.ts
import { IMessageHandler } from '../../core/interfaces/message-handler.interface';

// This class encapsulates the strategy for handling a 'User Created' event
export class UserCreatedHandler implements IMessageHandler {
  
  // Dependency Injection: Inject external services/repositories via constructor
  constructor(private emailService: any) {}

  async handle(message: any): Promise<void> {
    console.log('[UserCreatedHandler] Processing payload:', message);
    
    // Business Logic Validation
    if (!message.email) {
      throw new Error('Invalid payload: missing email address');
    }

    // Domain Action
    await this.emailService.sendWelcomeEmail(message.email);
  }
}
```

## 7. Composition Root (Dependency Injection)

Wire everything together at the application's entry point. This is where high-level policy connects with low-level implementation.

```typescript
// src/index.ts
import { RabbitMQAdapter } from './infrastructure/message-broker/rabbitmq.adapter';
import { UserCreatedHandler } from './application/handlers/user-created.handler';

async function bootstrap() {
  const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  const EXCHANGE = 'ecommerce_exchange';

  // 1. Initialize Infrastucture (The concrete adapter)
  const broker = new RabbitMQAdapter(RABBITMQ_URL);
  await broker.connect();

  // 2. Initialize Application Dependencies (using mock for demonstration)
  const emailServiceMock = { 
    sendWelcomeEmail: async (email: string) => console.log(`📧 Email sent to ${email}`) 
  };

  // 3. Initialize Strategies (Inject dependencies into handlers)
  const userCreatedHandler = new UserCreatedHandler(emailServiceMock);

  // 4. Bind Strategies to Subscriptions via the Adapter
  await broker.subscribe(
    'email_notification_queue', // Target Queue
    EXCHANGE,                   // Target Exchange
    'user.created',             // Routing Key to listen for
    userCreatedHandler          // The strategy to execute when a message arrives
  );

  console.log('🚀 Message Queue Service is running with Clean Architecture.');
  
  // Example Publisher usage (in real app, this would be injected into a controller/service)
  setTimeout(() => {
    broker.publish(EXCHANGE, 'user.created', { id: 1, email: 'user@example.com' });
  }, 2000);
}

bootstrap().catch(console.error);
```

## Summary of the Design

1. **No Vendor Lock-in (Dependency Inversion)**: The application layer (`handlers/`) never imports `amqplib`. If you decide to switch from RabbitMQ to Kafka or Redis Streams, you simply create a `KafkaAdapter` that implements `IMessageBroker` and swap it in `index.ts`. Your business logic remains completely untouched.
2. **High Testability (Dependency Injection)**: 
    * You can easily unit-test your handlers by passing them mock implementations of their dependencies (`emailService`).
    * You can test your core services by passing them a mock `IMessageBroker` that doesn't actually connect to RabbitMQ.
3. **Single Responsibility (SRP)**: 
    * `RabbitMQConnection` only manages network connections.
    * `RabbitMQAdapter` only translates broker interface commands to library-specific calls.
    * Handlers only execute business logic based on payloads.
4. **Open/Closed Principle (OCP)**: To add a new event listener (e.g., `OrderPlaced`), you create a new `OrderPlacedHandler` strategy and bind it in `index.ts`. You do not modify existing infrastructure code or large switch statements.
