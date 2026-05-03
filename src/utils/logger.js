const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// place logs at repository root `logs/` (outside source tree)
const logDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const auditLogger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    // rotate by size with maxFiles
    new transports.File({ filename: path.join(logDir, 'audit.log'), maxsize: 10 * 1024 * 1024, maxFiles: 5 }),
    new transports.File({ filename: path.join(logDir, 'error.log'), level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 10 }),
  ],
});

if (process.env.NODE_ENV === 'development') {
  auditLogger.add(new transports.Console({ format: format.simple() }));
}

module.exports = auditLogger;
