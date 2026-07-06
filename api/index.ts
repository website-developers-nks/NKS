import app, { initDB } from '../backend/src/app';

// Initialize database connection for serverless
let dbInitialized = false;

const handler = async (req: any, res: any) => {
  // Ensure DB is connected (singleton pattern handles reconnection)
  if (!dbInitialized) {
    try {
      await initDB();
      dbInitialized = true;
    } catch (error) {
      console.error('[Vercel] DB connection failed:', error);
      return res.status(500).json({ error: 'Database connection failed' });
    }
  }

  return app(req, res);
};

export default handler;
