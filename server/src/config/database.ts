import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Supabase
  max: 10, // Supabase free tier allows ~60 connections; pooler handles the rest
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export default pool;

pool.on('connect', () => {
  console.log('🐘 Connected to Supabase PostgreSQL');
});

pool.on('error', (err) => {
  console.error('💥 Database connection error:', err);
  process.exit(-1);
});
