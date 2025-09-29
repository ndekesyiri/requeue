# ReQueue SaaS - Production-Ready API-First Queue Management Platform

A production-ready, multi-tenant SaaS platform built on top of ReQueue, providing enterprise-grade queue management with API-first architecture.

## 🚀 Features

### Core Features
- **Multi-Tenant Architecture**: Complete tenant isolation with dedicated resources
- **API-First Design**: RESTful APIs with comprehensive documentation
- **Authentication & Authorization**: JWT-based auth with role-based permissions
- **Usage Tracking**: Real-time usage monitoring and billing integration
- **Rate Limiting**: Per-tenant rate limiting and resource enforcement
- **Monitoring**: Prometheus metrics with Grafana dashboards

### Enterprise Features
- **Billing Integration**: Stripe-powered subscription management
- **Webhook Support**: Real-time event notifications
- **Background Jobs**: Scalable job processing with Bull queues
- **High Availability**: Load balancing and failover support
- **Security**: Helmet.js security headers and CORS protection
- **Logging**: Centralized logging with Winston

## 📁 Architecture

```
saas/
├── api/                    # API server
│   ├── routes/            # API endpoints
│   ├── middleware/        # Express middleware
│   ├── models/            # Database models
│   └── server.js          # Main server file
├── services/              # Business logic services
│   ├── auth/              # Authentication services
│   ├── billing/           # Billing services
│   ├── monitoring/        # Monitoring services
│   ├── queue/             # Queue management
│   └── usage/             # Usage tracking
├── dashboard/             # Frontend dashboard
│   ├── frontend/          # React/Vue dashboard
│   └── components/        # Reusable components
├── infrastructure/        # Infrastructure as code
│   ├── docker/           # Docker configurations
│   ├── kubernetes/       # K8s manifests
│   └── terraform/        # Terraform configs
└── config/               # Configuration files
    ├── environments/     # Environment configs
    └── secrets/          # Secret management
```

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 5+
- Redis 6+
- Docker & Docker Compose

### Installation

1. **Clone and setup**
```bash
git clone https://github.com/ndekesyiri/requeue.git
cd requeue/saas
npm install
```

2. **Environment configuration**
```bash
cp config/environments/production.env .env
# Edit .env with your configuration
```

3. **Start with Docker Compose**
```bash
docker-compose up -d
```

4. **Access the services**
- API: http://localhost:3000
- API Docs: http://localhost:3000/api-docs
- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090

## 📚 API Documentation

### Authentication

#### Register Tenant
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "email": "admin@mycompany.com",
    "password": "securepassword"
  }'
```

#### Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@mycompany.com",
    "password": "securepassword"
  }'
```

### Queue Management

#### Create Queue
```bash
curl -X POST http://localhost:3000/api/v1/queues \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "email-queue",
    "description": "Email processing queue",
    "settings": {
      "maxRetries": 3,
      "retryDelay": 5000
    }
  }'
```

#### Add Item to Queue
```bash
curl -X POST http://localhost:3000/api/v1/items \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "queueId": "queue-id",
    "data": {
      "to": "user@example.com",
      "subject": "Welcome!",
      "body": "Welcome to our service"
    },
    "priority": 1
  }'
```

#### Process Items
```bash
curl -X POST http://localhost:3000/api/v1/items/process \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "queueId": "queue-id",
    "maxItems": 10
  }'
```

## 🏗️ Deployment

### Docker Deployment

1. **Build and run**
```bash
docker-compose up -d
```

2. **Scale services**
```bash
docker-compose up -d --scale api=3
```

### Kubernetes Deployment

1. **Apply manifests**
```bash
kubectl apply -f infrastructure/kubernetes/
```

2. **Check status**
```bash
kubectl get pods
kubectl get services
```

### AWS Deployment

1. **Initialize Terraform**
```bash
cd infrastructure/terraform
terraform init
```

2. **Plan deployment**
```bash
terraform plan
```

3. **Deploy**
```bash
terraform apply
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | API port | `3000` |
| `MONGODB_URI` | MongoDB connection | `mongodb://localhost:27017/requeue-saas` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT secret key | Required |
| `STRIPE_SECRET_KEY` | Stripe secret key | Required |

### Tenant Plans

#### Free Plan
- 1 queue
- 1,000 items/month
- 10,000 API calls/month
- Basic support

#### Pro Plan ($29/month)
- 10 queues
- 100,000 items/month
- 100,000 API calls/month
- Webhooks
- Priority support

#### Enterprise Plan ($299/month)
- Unlimited queues
- Unlimited items
- Unlimited API calls
- SLA guarantees
- Custom integrations

## 📊 Monitoring

### Metrics
- API response times
- Queue processing rates
- Error rates
- Resource usage
- Tenant activity

### Alerts
- High error rates
- Resource limit breaches
- System health issues
- Billing anomalies

### Dashboards
- Real-time metrics
- Historical trends
- Tenant analytics
- System performance

## 🔒 Security

### Authentication
- JWT tokens with refresh
- API key authentication
- Role-based permissions
- Multi-factor authentication

### Data Protection
- Tenant data isolation
- Encryption at rest
- Secure API endpoints
- Rate limiting

### Compliance
- GDPR compliance
- SOC 2 Type II
- ISO 27001
- HIPAA ready

## 🚀 Scaling

### Horizontal Scaling
- Load balancer configuration
- Auto-scaling groups
- Database sharding
- Cache clustering

### Performance Optimization
- Redis caching
- Database indexing
- Connection pooling
- CDN integration

## 📞 Support

### Documentation
- API documentation: `/api-docs`
- Integration guides
- Best practices
- Troubleshooting

### Community
- GitHub issues
- Discord community
- Stack Overflow
- Developer forums

### Enterprise Support
- 24/7 support
- SLA guarantees
- Custom integrations
- Professional services

## 📄 License

MIT License - see [LICENSE](../../LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📧 Contact

- Website: https://requeue.com
- Email: support@requeue.com
- GitHub: https://github.com/ndekesyiri/requeue

---

**Built with ❤️ by the ReQueue team**
