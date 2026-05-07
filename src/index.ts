// Composition Root (Dependency Injection setup)
import { RabbitMQAdapter } from './infrastructure/message-broker/rabbitmq.adapter'
import { UserCreatedHandler } from './application/handlers/user-created.handler'

async function bootstrap() {
  const RABBITMQ_URL =
    process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'
  const EXCHANGE = 'ecommerce_exchange'

  // 1. Initialize Infrastucture (The concrete adapter)
  const broker = new RabbitMQAdapter(RABBITMQ_URL)
  await broker.connect()

  // 2. Initialize Application Dependencies (using mock for demonstration)
  const emailServiceMock = {
    sendWelcomeEmail: async (email: string) =>
      console.log(`📧 Email sent to ${email}`),
  }

  // 3. Initialize Strategies (Inject dependencies into handlers)
  const userCreatedHandler = new UserCreatedHandler(emailServiceMock)

  // 4. Bind Strategies to Subscriptions via the Adapter
  await broker.subscribe(
    'email_notification_queue', // Target Queue
    EXCHANGE, // Target Exchange
    'user.created', // Routing Key to listen for
    userCreatedHandler, // The strategy to execute when a message arrives
  )

  console.log('🚀 Message Queue Service is running with Clean Architecture.')

  // Example Publisher usage (in real app, this would be injected into a controller/service)
  setTimeout(() => {
    broker.publish(EXCHANGE, 'user.created', {
      id: 1,
      email: 'user@example.com',
    })
  }, 2000)
}

bootstrap().catch(console.error)
