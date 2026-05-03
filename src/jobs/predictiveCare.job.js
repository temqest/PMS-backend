const cron = require('node-cron');
const logger = require('../utils/logger');
const { computePredictiveCareForAllActivePatients } = require('../api/v1/predictive-care/services/predictiveCareOrchestrator.service');

// Every day at 2:00 AM (server local time)
cron.schedule('0 2 * * *', async () => {
  try {
    logger.info({ event: 'PREDICTIVE_CARE_CRON_START' });
    await computePredictiveCareForAllActivePatients();
    logger.info({ event: 'PREDICTIVE_CARE_CRON_DONE' });
  } catch (err) {
    logger.error({
      event: 'PREDICTIVE_CARE_CRON_FAILED',
      error: err.message,
      stack: err.stack,
    });
  }
});

module.exports = cron;
