#!/usr/bin/env node
/**
 * Auto-fix script for predictive care issues
 * This script diagnoses and optionally applies fixes
 */

const mongoose = require('mongoose');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Patient = require('../src/api/v1/patients/patient.model');
const PatientRiskProfile = require('../src/api/v1/predictive-care/models/patientRiskProfile.model');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
  } catch (error) {
    console.error('❌ DB connection error:', error.message);
    process.exit(1);
  }
};

const runCommand = (cmd, args = [], cwd = __dirname) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit' });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
};

const autoFix = async () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║        Predictive Care Issue Auto-Fix Tool                     ║
╚════════════════════════════════════════════════════════════════╝
`);

  await connectDB();

  try {
    // Diagnose
    console.log('🔍 Analyzing current state...\n');
    
    const patientCount = await Patient.countDocuments({ status: 'active' });
    const riskProfileCount = await PatientRiskProfile.countDocuments();
    const allRiskProfiles = await PatientRiskProfile.find().select('patient_id overall_risk_level overall_risk_score');
    const patientIds = new Set((await Patient.find().select('patient_id')).map(p => p.patient_id));
    
    const orphaned = allRiskProfiles.filter(rp => !patientIds.has(rp.patient_id));
    
    const distribution = await PatientRiskProfile.aggregate([
      { $group: { _id: '$overall_risk_level', count: { $sum: 1 } } }
    ]);
    
    const distMap = {};
    distribution.forEach(item => {
      distMap[item._id] = item.count;
    });

    console.log(`📊 CURRENT STATE:`);
    console.log(`   Active Patients: ${patientCount}`);
    console.log(`   Risk Profiles: ${riskProfileCount}`);
    console.log(`   Orphaned Profiles: ${orphaned.length}`);
    console.log(`\n   Risk Distribution:`);
    console.log(`   • Critical: ${distMap.Critical || 0} (${((distMap.Critical || 0) / riskProfileCount * 100).toFixed(1)}%)`);
    console.log(`   • High: ${distMap.High || 0} (${((distMap.High || 0) / riskProfileCount * 100).toFixed(1)}%)`);
    console.log(`   • Moderate: ${distMap.Moderate || 0} (${((distMap.Moderate || 0) / riskProfileCount * 100).toFixed(1)}%)`);
    console.log(`   • Low: ${distMap.Low || 0} (${((distMap.Low || 0) / riskProfileCount * 100).toFixed(1)}%)`);

    // Identify issues
    console.log(`\n🔎 ISSUE DETECTION:\n`);
    
    const hasOrphanedIssue = orphaned.length > 0;
    const hasLowVariationIssue = (distMap.Low || 0) / riskProfileCount > 0.6;
    
    if (hasOrphanedIssue) {
      console.log(`   ⚠️  Issue #1: ORPHANED RECORDS`);
      console.log(`       ${orphaned.length} risk profiles have no corresponding patient`);
      console.log(`       Fix: node scripts/cleanupOrphanedRecords.js\n`);
    } else {
      console.log(`   ✓ No orphaned records\n`);
    }
    
    if (hasLowVariationIssue) {
      console.log(`   ⚠️  Issue #2: LOW RISK VARIATION`);
      console.log(`       ${((distMap.Low || 0) / riskProfileCount * 100).toFixed(0)}% of patients are "Low" risk`);
      console.log(`       Fix: Re-seed with more high-risk patients\n`);
    } else {
      console.log(`   ✓ Good risk variation\n`);
    }

    // Offer fixes
    if (hasOrphanedIssue || hasLowVariationIssue) {
      console.log(`🔧 RECOMMENDED ACTIONS:\n`);
      
      let actions = [];
      if (hasOrphanedIssue) {
        actions.push({
          name: 'Cleanup orphaned records',
          cmd: 'node scripts/cleanupOrphanedRecords.js'
        });
      }
      if (hasLowVariationIssue) {
        actions.push({
          name: 'Re-seed with better risk distribution',
          cmd: 'SEED_HIGH_RISK_COUNT=15 SEED_PATIENT_COUNT=60 node scripts/seedTestData.js'
        });
      }
      
      actions.forEach((action, i) => {
        console.log(`   ${i + 1}. ${action.name}`);
        console.log(`      $ ${action.cmd}\n`);
      });
      
      if (process.argv[2] === '--auto') {
        console.log(`🚀 APPLYING FIXES AUTOMATICALLY...\n`);
        await mongoose.connection.close();

        if (hasOrphanedIssue) {
          console.log(`→ Running cleanup...\n`);
          await runCommand('node', ['scripts/cleanupOrphanedRecords.js'], path.join(__dirname, '..'));
          console.log();
        }

        if (hasLowVariationIssue) {
          console.log(`→ Re-seeding with improved distribution...\n`);
          await runCommand('node', ['scripts/seedTestData.js'], path.join(__dirname, '..'), {
            SEED_HIGH_RISK_COUNT: '15',
            SEED_PATIENT_COUNT: '60',
            ...process.env
          });
        }
        
        console.log(`\n✅ Auto-fix complete! Run this again to verify:\n`);
        console.log(`   node scripts/autoFixPredictiveCare.js\n`);
      } else {
        console.log(`To apply fixes automatically, run:\n`);
        console.log(`   node scripts/autoFixPredictiveCare.js --auto\n`);
      }
    } else {
      console.log(`✅ No issues detected! Your predictive care data looks good.\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

autoFix();
