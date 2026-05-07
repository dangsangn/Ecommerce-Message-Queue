// Strategy: Handles user creation events

import { IMessageHandler } from '../../core/interfaces/message-handler.interface'

// This class encapsulates the strategy for handling a 'User Created' event
export class UserCreatedHandler implements IMessageHandler {
  // Dependency Injection: Inject external services/repositories via constructor
  constructor(private emailService: any) {}

  async handle(message: any): Promise<void> {
    console.log('[UserCreatedHandler] Processing payload:', message)

    // Business Logic Validation
    if (!message.email) {
      throw new Error('Invalid payload: missing email address')
    }

    // Domain Action
    await this.emailService.sendWelcomeEmail(message.email)
  }
}
