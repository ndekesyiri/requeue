/**
 * User Model
 * User management for SaaS platform
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  // Basic information
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  
  // Tenant association
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  
  // Role and permissions
  role: {
    type: String,
    enum: ['owner', 'admin', 'developer', 'viewer'],
    default: 'developer'
  },
  permissions: [{
    type: String,
    enum: [
      'queue:create',
      'queue:read',
      'queue:update',
      'queue:delete',
      'item:create',
      'item:read',
      'item:update',
      'item:delete',
      'webhook:create',
      'webhook:read',
      'webhook:update',
      'webhook:delete',
      'monitoring:read',
      'billing:read',
      'admin:all'
    ]
  }],
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String
  },
  passwordResetToken: {
    type: String
  },
  passwordResetExpires: {
    type: Date
  },
  
  // Security
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  
  // Preferences
  preferences: {
    timezone: {
      type: String,
      default: 'UTC'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      webhook: {
        type: Boolean,
        default: false
      }
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    }
  },
  
  // API access
  apiKeys: [{
    name: {
      type: String,
      required: true
    },
    key: {
      type: String,
      required: true
    },
    permissions: [{
      type: String
    }],
    isActive: {
      type: Boolean,
      default: true
    },
    lastUsed: {
      type: Date
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ tenantId: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'apiKeys.key': 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for account status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Hash password if modified
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }
  
  this.updatedAt = new Date();
  next();
});

// Instance methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateAuthToken = function() {
  return jwt.sign(
    { 
      userId: this._id,
      tenantId: this.tenantId,
      email: this.email,
      role: this.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

userSchema.methods.generateRefreshToken = function() {
  return jwt.sign(
    { userId: this._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

userSchema.methods.generateEmailVerificationToken = function() {
  const token = jwt.sign(
    { userId: this._id, type: 'email_verification' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  this.emailVerificationToken = token;
  return token;
};

userSchema.methods.generatePasswordResetToken = function() {
  const token = jwt.sign(
    { userId: this._id, type: 'password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  this.passwordResetToken = token;
  this.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  return token;
};

userSchema.methods.incrementLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 }
  });
};

userSchema.methods.hasPermission = function(permission) {
  if (this.role === 'owner' || this.role === 'admin') {
    return true;
  }
  
  return this.permissions.includes(permission);
};

userSchema.methods.generateApiKey = function(name, permissions = []) {
  const key = require('crypto').randomBytes(32).toString('hex');
  this.apiKeys.push({
    name,
    key,
    permissions,
    isActive: true,
    createdAt: new Date()
  });
  return key;
};

userSchema.methods.revokeApiKey = function(keyId) {
  const apiKey = this.apiKeys.id(keyId);
  if (apiKey) {
    apiKey.isActive = false;
  }
};

userSchema.methods.validateApiKey = function(key) {
  const apiKey = this.apiKeys.find(k => k.key === key && k.isActive);
  if (apiKey) {
    apiKey.lastUsed = new Date();
    return apiKey;
  }
  return null;
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByTenant = function(tenantId) {
  return this.find({ tenantId, isActive: true });
};

userSchema.statics.findByRole = function(role) {
  return this.find({ role, isActive: true });
};

userSchema.statics.getActiveUsers = function() {
  return this.find({ isActive: true });
};

const User = mongoose.model('User', userSchema);

module.exports = { User };
