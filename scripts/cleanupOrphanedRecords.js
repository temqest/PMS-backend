/**
 * Cleanup script to remove orphaned risk profiles and ensure data consistency
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Patient = require('../src/api/v1/patients/patient.model');
const PatientRiskProfile = require('../src/api/v1/predictive-care/models/patientRiskProfile.model');
const CareAlert = require('../src/api/v1/predictive-care/models/careAlert.model');
const LabTrend = require('../src/api/v1/predictive-care/models/labTrend.model');
const AdherenceRecord = require('../src/api/v1/predictive-care/models/adherenceRecord.model');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('DB connection error:', error);
    process.exit(1);
  }
};

const cleanupOrphanedRecords = async () => {
  try {
    console.log('\n=== CLEANING UP ORPHANED RECORDS ===\n');

    // Get all valid patient IDs
    const validPatients = await Patient.find().select('patient_id');
    const validPatientIds = new Set(validPatients.map(p => p.patient_id));

    console.log(`Valid patient count: ${validPatientIds.size}`);

    // Find and delete orphaned records in each collection
    const collections = [
      { model: PatientRiskProfile, name: 'Risk Profiles' },
      { model: CareAlert, name: 'Care Alerts' },
      { model: LabTrend, name: 'Lab Trends' },
      { model: AdherenceRecord, name: 'Adherence Records' }
    ];

    for (const { model, name } of collections) {
      const allRecords = await model.find().select('patient_id');
      const orphaned = allRecords.filter(r => !validPatientIds.has(r.patient_id));
      
      if (orphaned.length > 0) {
        const orphanedIds = orphaned.map(r => r.patient_id);
        const result = await model.deleteMany({ patient_id: { $in: orphanedIds } });
        console.log(`✓ ${name}: Deleted ${result.deletedCount} orphaned records`);
      } else {
        console.log(`✓ ${name}: No orphaned records found`);
      }
    }

    console.log('\n✓ Cleanup complete\n');
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

connectDB().then(() => cleanupOrphanedRecords());
