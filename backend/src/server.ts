import app, { initDB } from './app';

const PORT = Number(process.env.PORT ?? 3000);

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Startup] DB connection failed:', err.message);
    process.exit(1);
  });
