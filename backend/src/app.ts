import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { connectDB } from './db/connection';
import pingRouter from './routes/ping.router';
import emailRouter from './routes/email.router';
import onboardingRouter from './routes/onboarding.router';
import docUploadRouter from './routes/doc-upload.router';
import adminRouter from './routes/admin.router';
import cronRouter from './routes/cron.router';

const app = express();

// Trust proxy for Vercel/reverse proxies (required for rate limiting)
app.set('trust proxy', 1);

// Allowed CORS origins
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    if (!allowedOrigins.includes(origin)) {
      return callback(new Error('Not allowed by CORS'));
    }
    return callback(null, true);
  },
  credentials: true,
}));

// Global rate limiter - 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  // Let express-rate-limit use default IP detection (works with trust proxy)
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    return req.path === '/api/ping' || req.path === '/api/ping/';
  },
});

app.use(globalLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// API routes
app.use('/api/ping', pingRouter);
app.use('/api/email', emailRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/docs', docUploadRouter);
app.use('/api/admin', adminRouter);
app.use('/api/cron', cronRouter);

// 404 handler for API routes (Express 5 syntax)
app.use('/api/{*path}', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);

  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS not allowed' });
  }

  // Handle JSON parse errors
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Default error response
  const statusCode = 'status' in err ? (err as { status: number }).status : 500;
  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// Database connection helper
export const initDB = async () => {
  await connectDB();
};

export default app;
