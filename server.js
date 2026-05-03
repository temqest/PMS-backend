require('dotenv').config();
require('./src/config/env');
const connectDB = require('./src/config/db');
const app = require('./src/app');

if (process.env.NODE_ENV !== 'test') {
  require('./src/jobs/predictiveCare.job');
}

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`PMS Backend running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
