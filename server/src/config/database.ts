import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from parent directory
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// Create pool with individual config parameters for better control
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'vector',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''), // Ensure password is a string
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // maximum number of clients in the pool
  idleTimeoutMillis: 30000, // how long a client is allowed to remain idle
  connectionTimeoutMillis: 2000, // how long to wait when connecting a client
});

export default pool;

// Test database connection
pool.on('connect', () => {
  console.log('🐘 Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('💥 Database connection error:', err);
  process.exit(-1);
});
