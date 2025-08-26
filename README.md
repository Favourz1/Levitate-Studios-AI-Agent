# Levitate Studios AI Agent

An AI-powered automation system for managing client projects from questionnaire to completion. This system automates document generation, client communication, project management, and team coordination using modern AI technologies.

## Features

- **Automated Workflow Management**: Complete automation from client questionnaire to project finalization
- **AI Document Generation**: Brand origin documents, budget/timeline proposals, and project deliverables
- **Smart Email Processing**: Intent detection and automated responses to client communications
- **Asana Integration**: Automatic project creation, task assignment, and progress tracking
- **Document Versioning**: Comprehensive revision tracking with Google Docs integration
- **Team Coordination**: Automated task assignment with AI-generated guidance

## Architecture

### Technology Stack

- **Backend**: Node.js + Javascript + Express
- **Database**: PostgreSQL with Prisma ORM
- **Queue System**: BullMQ + Redis for background job processing
- **AI/LLM**: Vercel AI SDK with OpenAI/Anthropic integration
- **Email**: Brevo for transactional emails and inbound processing
- **Document Management**: Google Docs + Drive API
- **Project Management**: Asana API integration
- **Hosting**: Railway (recommended)

### System Components

1. **API Gateway**: RESTful endpoints for webhooks, actions, and admin interface
2. **Background Workers**: Asynchronous job processors for AI tasks
3. **Integration Services**: Unified interfaces for external APIs
4. **LLM Gateway**: AI model routing and tool calling
5. **Database Layer**: Data persistence and transaction management

## Project Structure

```
src/
├── config/          # Configuration and environment setup
├── database/        # Database connection and utilities
├── integrations/    # External API integrations (Google, Brevo, Asana)
├── llm/            # AI/LLM client and tools
├── middleware/     # Express middleware (auth, validation, errors)
├── queues/         # BullMQ queue management
├── routes/         # API route handlers
├── services/       # Business logic layer
├── utils/          # Utility functions and helpers
├── workers/        # Background job processors
└── server.js       # Main application entry point
```

## Workflow Overview

### Phase 1: Questionnaire Intake

- Client submits questionnaire via Google Forms, file upload, or web interface
- System creates client and project records
- Adds task to "Pending Projects" Asana board
- Notifies project manager

### Phase 2: Brand Origin Document

- AI generates comprehensive brand origin document
- PM reviews and can make edits in Google Docs
- Document sent to client with unique reply-to email
- AI processes client feedback and regenerates if needed

### Phase 3: Budget & Timeline

- Upon brand origin acceptance, AI generates budget/timeline document
- Creates 3 variations as alternatives
- Similar review and feedback loop with client
- Finance manager involved in approval process

### Phase 4: Project Finalization

- Upon budget acceptance, creates production Asana project
- Auto-assigns tasks to team members based on roles
- Generates detailed task guidance using AI
- Notifies team of project initialization

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Redis instance
- Google Cloud Project with Docs/Drive API enabled
- Brevo account for email
- Asana workspace and API token
- OpenAI API key

### Installation

1. **Clone and install dependencies**:

   ```bash
   git clone <repository-url>
   cd levitate-studios-ai-agent
   npm install
   ```

2. **Environment setup**:

   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Database setup**:

   ```bash
   npm run db:generate
   npm run db:push
   npm run db:seed
   ```

4. **Development**:

   ```bash
   # Start API server
   npm run dev

   # Start workers (in separate terminal)
   npm run dev:worker
   ```

### Environment Variables

See `env.example` for all required environment variables:

- **Database**: PostgreSQL connection string
- **Redis**: Redis connection for queues
- **Google APIs**: Service account credentials
- **Brevo**: API key and webhook secret
- **Asana**: Access token and workspace GID
- **OpenAI**: API key for AI features
- **Application**: JWT secret, frontend URL, email domain

## API Endpoints

### Health & Status

- `GET /api/healthz` - Basic health check
- `GET /api/readyz` - Detailed readiness check

### Webhooks

- `POST /api/webhooks/brevo/inbound` - Email processing
- `POST /api/webhooks/asana` - Asana event handling
- `POST /api/webhooks/apps-script/forms` - Google Forms submissions

### Actions (Email Links)

- `GET /api/actions/review` - Document review interface
- `POST /api/actions/send-to-client` - Send document to client
- `POST /api/actions/confirm-accepted` - Confirm document acceptance

### Admin Interface

- `GET /api/admin/projects` - List projects
- `GET /api/admin/projects/:id` - Project details
- `POST /api/admin/projects/:id/accept-doc` - Manual document acceptance
- `GET /api/admin/clients` - List clients

## Development

### Database Migrations

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes
npm run db:push

# Create migration
npm run db:migrate

# Seed database
npm run db:seed
```

### Queue Management

```bash
# View queue status via admin API
curl http://localhost:3000/api/admin/queues/status

# Or check directly in Redis
redis-cli
> keys bull:*
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking
npx tsc --noEmit
```

### Code Quality

```bash
# Linting
npm run lint
npm run lint:fix

# Build
npm run build
```

## Deployment

### Railway Deployment

1. **Connect repository** to Railway
2. **Set environment variables** in Railway dashboard
3. **Configure services**:
   - Web service: `npm start`
   - Worker service: `npm run start:worker`
4. **Add databases**:
   - PostgreSQL plugin
   - Redis plugin

### Environment-specific Configuration

- **Development**: Uses local databases and detailed logging
- **Production**: Optimized logging, error handling, and security headers

## Monitoring & Observability

### Logging

- Structured logging with correlation IDs
- Request/response logging
- Integration call tracking
- LLM usage monitoring

### Error Handling

- Global error handlers
- Graceful shutdown procedures
- Retry logic with exponential backoff
- Dead letter queues for failed jobs

### Metrics

- Queue performance monitoring
- API response times
- Integration success rates
- LLM token usage and costs

## Security Features

- JWT-based authentication for action links
- Webhook signature verification
- Rate limiting per endpoint type
- Input validation and sanitization
- CORS protection
- Security headers

## Customization

### Adding New Document Types

1. **Update Prisma schema** with new document type
2. **Create LLM schema** in `src/llm/schemas.js`
3. **Add generation logic** in document worker
4. **Update validation** in `src/utils/validation.js`

### Adding New Integrations

1. **Create integration class** in `src/integrations/`
2. **Add configuration** to environment setup
3. **Create service methods** for business logic
4. **Add error handling** specific to the integration

### Extending AI Capabilities

1. **Define new tools** in `src/llm/tools.js`
2. **Create schemas** for structured outputs
3. **Add to LLM client** tool registry
4. **Test with different prompts** and models

## Troubleshooting

### Common Issues

1. **Queue jobs stuck**: Check Redis connection and worker processes
2. **AI responses inconsistent**: Verify model configuration and prompts
3. **Email not processing**: Check Brevo webhook configuration
4. **Asana sync failing**: Verify API tokens and rate limits

### Debug Mode

Set `LOG_LEVEL=debug` to enable detailed logging for troubleshooting.

### Health Checks

Monitor the `/api/readyz` endpoint for system health status including:

- Database connectivity
- Redis queue status
- External API accessibility

## Contributing

1. Follow strict mode requirements
2. Maintain test coverage for new features
3. Use absolute imports (`@/` prefix)
4. Follow the existing error handling patterns
5. Update documentation for new endpoints or features

## License

Apache License 2.0 - see LICENSE file for details.
