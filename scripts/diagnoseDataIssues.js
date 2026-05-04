/**
 * Diagnostic script to identify data consistency issues
 * Shows orphaned risk profiles and risk score distribution
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Patient = require('../src/api/v1/patients/patient.model');
const PatientRiskProfile = require('../src/api/v1/predictive-care/models/patientRiskProfile.model');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('DB connection error:', error);
    process.exit(1);
  }
};

const diagnoseIssues = async () => {
  try {
    console.log('\n=== DATA CONSISTENCY DIAGNOSIS ===\n');

    // Count totals
    const patientCount = await Patient.countDocuments({ status: 'active' });
    const riskProfileCount = await PatientRiskProfile.countDocuments();

    console.log(`✓ Active Patients: ${patientCount}`);
    console.log(`✓ Risk Profiles: ${riskProfileCount}`);

    // Find orphaned risk profiles (not tied to a patient)
    const allRiskProfiles = await PatientRiskProfile.find().select('patient_id patient_name overall_risk_level overall_risk_score');
    const patientIds = new Set((await Patient.find().select('patient_id')).map(p => p.patient_id));

    const orphaned = allRiskProfiles.filter(rp => !patientIds.has(rp.patient_id));
    if (orphaned.length > 0) {
      console.log(`\n⚠️  ORPHANED RISK PROFILES: ${orphaned.length}`);
      orphaned.slice(0, 10).forEach(rp => {
        console.log(`   - ${rp.patient_id}: ${rp.patient_name || 'N/A'} (${rp.overall_risk_level})`);
      });
      if (orphaned.length > 10) console.log(`   ... and ${orphaned.length - 10} more`);
    } else {
      console.log(`✓ No orphaned risk profiles found`);
    }

    // Risk score distribution
    console.log('\n=== RISK DISTRIBUTION ===');
    const distribution = await PatientRiskProfile.aggregate([
      { $group: { _id: '$overall_risk_level', count: { $sum: 1 } } }
    ]);
    
    distribution.sort((a, b) => {
      const order = { Critical: 0, High: 1, Moderate: 2, Low: 3 };
      return (order[a._id] || 99) - (order[b._id] || 99);
    });

    distribution.forEach(item => {
      const pct = ((item.count / riskProfileCount) * 100).toFixed(1);
      console.log(`  ${item._id}: ${item.count} (${pct}%)`);
    });

    // Check if all high-risk patients have supporting data
    console.log('\n=== SAMPLE HIGH-RISK PATIENTS ===');
    const highRisk = await PatientRiskProfile.find({ overall_risk_level: { $in: ['High', 'Critical'] } })
      .sort({ overall_risk_score: -1 })
      .limit(3);

    for (const profile of highRisk) {
      const HealthRecord = require('../src/api/v1/health-records/healthRecord.model');
      const Appointment = require('../src/api/v1/appointments/appointment.model');
      const visitCount = await HealthRecord.countDocuments({ patient_id: profile.patient_id, record_type: 'Visit' });
      const labCount = await HealthRecord.countDocuments({ patient_id: profile.patient_id, record_type: 'Lab Result' });
      const apptCount = await Appointment.countDocuments({ patient_id: profile.patient_id });
      
      console.log(`\n  ${profile.patient_name} (Score: ${profile.overall_risk_score}/100)`);
      console.log(`    Visits: ${visitCount}, Labs: ${labCount}, Appointments: ${apptCount}`);
      console.log(`    Chronic: ${profile.chronic_disease_risk}, Readmission: ${profile.readmission_risk}, No-show: ${profile.no_show_risk}, Adherence: ${profile.adherence_risk}`);
    }

    console.log('\n✓ Diagnosis complete\n');
  } catch (error) {
    console.error('Error during diagnosis:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

connectDB().then(() => diagnoseIssues());
