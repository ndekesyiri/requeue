# 🌐 QueueManager Web UI Guide

## Quick Start - Access the Web UI

### Option 1: Using the Startup Script (Recommended)

1. **Navigate to the dashboard directory:**
   ```bash
   cd dashboard
   ```

2. **Run the startup script:**
   ```bash
   ./start.sh
   ```

3. **Open your browser:**
   ```
   http://localhost:3000
   ```

### Option 2: Manual Setup

1. **Install dependencies:**
   ```bash
   cd dashboard
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access the dashboard:**
   ```
   http://localhost:3000
   ```

## 🎯 What You'll See

### Dashboard Overview
- **📊 Real-time Statistics**: Total queues, jobs, active jobs, failed jobs
- **📋 Queue Management**: Create, pause, resume, and delete queues
- **⚡ Job Management**: View, add, and cancel jobs
- **📈 Performance Metrics**: System health and performance data

### Navigation Tabs

#### 1. 📊 Overview Tab
- System-wide statistics and health
- Recent activity feed
- Performance metrics
- Queue status summary

#### 2. 📋 Queues Tab
- List all queues with status
- Queue management actions
- Create new queues
- Queue configuration

#### 3. ⚡ Jobs Tab
- View all jobs across queues
- Filter jobs by queue or status
- Add new jobs with priority
- Cancel or manage jobs

#### 4. ⚙️ Settings Tab
- API endpoint configuration
- Auto-refresh settings
- Dashboard preferences

## 🔧 Configuration

### Environment Variables

Set these environment variables before starting:

```bash
# Redis Configuration
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_DB=0

# Server Configuration
export PORT=3000
```

### Dashboard Settings

In the Settings tab, you can configure:

- **API Endpoint**: URL of your QueueManager API
- **Auto-refresh**: How often to refresh data (5s, 10s, 30s, 60s, or disabled)

## 🚀 Features Available

### Queue Management
- ✅ Create new queues
- ✅ Pause/resume queues
- ✅ Delete queues
- ✅ View queue statistics
- ✅ Monitor queue health

### Job Management
- ✅ View all jobs
- ✅ Add jobs with priority
- ✅ Cancel jobs
- ✅ Filter jobs by status
- ✅ Job history tracking

### Advanced Features
- ✅ Real-time monitoring
- ✅ Auto-refresh data
- ✅ Responsive design
- ✅ Error handling
- ✅ Health checks

## 📱 Mobile Support

The dashboard is fully responsive and works on:
- 📱 Mobile phones
- 📱 Tablets
- 💻 Desktop computers
- 🖥️ Large screens

## 🔍 Troubleshooting

### Common Issues

#### 1. "Connection Refused" Error
**Problem**: Dashboard can't connect to Redis or QueueManager

**Solutions**:
```bash
# Check if Redis is running
redis-cli ping

# Start Redis if not running
redis-server

# Check QueueManager is working
node -e "const qm = require('./src/index'); qm.createQueueManager().then(() => console.log('OK')).catch(console.error)"
```

#### 2. "API Error" in Dashboard
**Problem**: Dashboard can't reach the API endpoints

**Solutions**:
- Check the API endpoint URL in Settings
- Ensure the dashboard server is running on the correct port
- Verify Redis connection in the server logs

#### 3. "No Data" Displayed
**Problem**: Dashboard shows empty data

**Solutions**:
- Check if you have any queues created
- Verify QueueManager is properly initialized
- Check browser console for JavaScript errors

### Debug Mode

Enable debug logging:

```bash
DEBUG=queuemanager:* npm start
```

### Health Checks

Check system health:

```bash
# Check dashboard health
curl http://localhost:3000/api/health

# Check system stats
curl http://localhost:3000/api/system/stats

# Check queues
curl http://localhost:3000/api/queues
```

## 🔒 Security Considerations

### Development Use
The dashboard is designed for development and internal use. For production:

1. **Add Authentication**: Implement user login
2. **Use HTTPS**: Enable SSL/TLS
3. **Restrict Access**: Use firewall rules
4. **Input Validation**: Validate all inputs
5. **Rate Limiting**: Implement API rate limits

### Production Deployment

```bash
# Use environment variables for production
export NODE_ENV=production
export PORT=3000
export REDIS_HOST=your-redis-host
export REDIS_PORT=6379

# Start with PM2 for production
npm install -g pm2
pm2 start server.js --name "queuemanager-dashboard"
pm2 save
pm2 startup
```

## 📊 API Endpoints

The dashboard provides these API endpoints:

### System Information
- `GET /api/health` - System health check
- `GET /api/system/stats` - Detailed statistics
- `GET /api/activity/recent` - Recent activity

### Queue Management
- `GET /api/queues` - List all queues
- `POST /api/queues` - Create new queue
- `GET /api/queues/:id` - Get queue details
- `DELETE /api/queues/:id` - Delete queue
- `POST /api/queues/:id/pause` - Pause queue
- `POST /api/queues/:id/resume` - Resume queue

### Job Management
- `GET /api/jobs` - List all jobs
- `GET /api/queues/:id/jobs` - Get queue jobs
- `POST /api/queues/:id/jobs` - Add job to queue
- `POST /api/queues/:id/jobs/:jobId/cancel` - Cancel job

## 🎨 Customization

### Adding Custom Features

1. **New API Endpoints**: Add to `server.js`
2. **New Dashboard Tabs**: Modify `index.html`
3. **Custom Styling**: Update CSS in `index.html`
4. **Additional Metrics**: Extend the statistics collection

### Example: Adding Authentication

```javascript
// Add to server.js
const session = require('express-session');

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
}));

// Add login endpoint
app.post('/api/login', (req, res) => {
  // Implement your authentication logic
});

// Protect API routes
app.use('/api', (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
```

## 📈 Performance Tips

### Optimizing Dashboard Performance

1. **Reduce Auto-refresh**: Use longer intervals for large datasets
2. **Limit Job Display**: Show only recent jobs
3. **Use Pagination**: Implement pagination for large job lists
4. **Cache Data**: Implement client-side caching
5. **Optimize Queries**: Use efficient Redis queries

### Monitoring Performance

```bash
# Monitor server performance
pm2 monit

# Check Redis performance
redis-cli --latency

# Monitor system resources
htop
```

## 🆘 Getting Help

### Support Resources

1. **Check Logs**: Look at server console output
2. **Browser Console**: Check for JavaScript errors
3. **API Testing**: Use curl or Postman to test endpoints
4. **Redis Connection**: Verify Redis is accessible
5. **QueueManager**: Ensure QueueManager is working

### Debug Commands

```bash
# Test Redis connection
redis-cli ping

# Test QueueManager
node -e "require('./src/index').createQueueManager().then(qm => console.log('QueueManager OK')).catch(console.error)"

# Test dashboard API
curl http://localhost:3000/api/health

# Check server logs
tail -f logs/dashboard.log
```

## 🎉 Success!

Once everything is running, you should see:

- ✅ Dashboard loads at `http://localhost:3000`
- ✅ Real-time statistics updating
- ✅ Ability to create and manage queues
- ✅ Job management capabilities
- ✅ Responsive design on all devices

**Happy Queue Managing! 🚀**
