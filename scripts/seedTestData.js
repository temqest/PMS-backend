const mongoose = require('mongoose');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Models
const Patient = require('../src/api/v1/patients/patient.model');
const Appointment = require('../src/api/v1/appointments/appointment.model');
const HealthRecord = require('../src/api/v1/health-records/healthRecord.model');
const PrescriptionInvoice = require('../src/api/v1/prescription-invoices/prescriptionInvoice.model');

// DB connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('DB connection error:', error);
    process.exit(1);
  }
};

// ID generators
const generatePatientId = (sequence) => {
  const datePart = dayjs().format('YYYYMMDD');
  const prefix = `PAT-${datePart}-`;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
};

const makeAppointmentId = () => `APT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const makeInvoiceId = () => `INV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const makeRecordId = () => `REC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

// Sample data
const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'James', 'Olivia', 'Robert', 'Sophia', 'William', 'Isabella', 'Joseph', 'Ava', 'Charles'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson'];
const addresses = [
  '123 Main St, Cityville',
  '456 Oak Ave, Townburg',
  '789 Pine Rd, Villagetown',
  '321 Elm St, Hamlet',
  '654 Maple Dr, Borough',
  '987 Cedar Ln, Township',
  '147 Birch Blvd, County',
  '258 Spruce Way, District',
  '369 Willow Ct, Province',
  '741 Poplar Pl, Territory'
];
const physicians = ['Dr. Alice Cooper', 'Dr. Bob Dylan', 'Dr. Carol King', 'Dr. David Bowie', 'Dr. Eve Adams'];
const appointmentReasons = ['Routine checkup', 'Follow-up visit', 'Consultation', 'Vaccination', 'Blood test', 'X-ray', 'Prescription refill'];
const labTests = ['Blood glucose', 'Cholesterol', 'CBC', 'Urine analysis', 'Thyroid function', 'Liver function'];
const imagingTypes = ['X-ray', 'MRI', 'CT scan', 'Ultrasound', 'Mammogram'];
const vaccinations = ['Flu shot', 'COVID-19', 'Tetanus', 'Hepatitis B', 'MMR', 'Polio'];
const notes = ['Patient reported mild symptoms', 'Follow-up required', 'Medication adjusted', 'Test results normal', 'Patient education provided'];

const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getRandomDate = (start, end) => {
  const startDate = dayjs(start);
  const endDate = dayjs(end);
  const diff = endDate.diff(startDate, 'day');
  return startDate.add(Math.floor(Math.random() * diff), 'day').toDate();
};

const generatePatients = (count = 10) => {
  const patients = [];
  for (let i = 0; i < count; i++) {
    const patientId = generatePatientId(i + 1); // Use local counter: 1, 2, 3...
    const firstName = getRandomElement(firstNames);
    const lastName = getRandomElement(lastNames);
    const dob = getRandomDate('1950-01-01', '2005-01-01');
    const gender = Math.random() > 0.5 ? 'Male' : 'Female';
    const contact = `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i + 1}@example.com`; // +index prevents duplicate emails
    const address = getRandomElement(addresses);
    const nationalId = `NAT${Math.floor(Math.random() * 1000000000)}`;

    patients.push({
      patient_id: patientId,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dob,
      gender,
      contact_number: contact,
      email_address: email,
      address,
      national_id: nationalId,
      status: 'active',
      visit_count: 0,
      attending_physician: getRandomElement(physicians),
      created_by: 'admin'
    });
  }
  return patients;
};

const generateAppointments = (patients) => {
  const appointments = [];
  patients.forEach(patient => {
    const numAppointments = Math.floor(Math.random() * 3) + 1; // 1-3 appointments
    for (let i = 0; i < numAppointments; i++) {
      const scheduledAt = getRandomDate('2024-01-01', '2026-12-31');
      appointments.push({
        appointment_id: makeAppointmentId(),
        patient_id: patient.patient_id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        appointment_type: Math.random() > 0.8 ? 'Telehealth' : 'In-Person',
        scheduled_at: scheduledAt,
        duration_minutes: [15, 30, 45, 60][Math.floor(Math.random() * 4)],
        reason: getRandomElement(appointmentReasons),
        priority: ['Routine', 'Urgent', 'Follow-up'][Math.floor(Math.random() * 3)],
        status: ['Pending', 'Confirmed', 'Completed'][Math.floor(Math.random() * 3)],
        created_by: 'admin'
      });
    }
  });
  return appointments;
};

const generateHealthRecords = (patients, medicines) => {
  const records = [];
  patients.forEach(patient => {
    const numRecords = Math.floor(Math.random() * 5) + 3; // 3-7 records per patient
    for (let i = 0; i < numRecords; i++) {
      const recordTypes = ['Visit', 'Lab Result', 'Imaging', 'Prescription', 'Vaccination', 'Note'];
      const recordType = getRandomElement(recordTypes);
      const recordDate = getRandomDate('2023-01-01', '2026-05-01');

      let details = {};
      let summary = '';

      switch (recordType) {
        case 'Visit':
          summary = `Patient visit: ${getRandomElement(appointmentReasons)}`;
          details = {
            symptoms: ['Headache', 'Fever', 'Cough', 'Fatigue', 'Nausea'][Math.floor(Math.random() * 5)],
            diagnosis: ['Common cold', 'Hypertension', 'Diabetes', 'Allergy', 'Infection'][Math.floor(Math.random() * 5)],
            treatment: 'Prescribed medication and rest'
          };
          break;
        case 'Lab Result':
          const test = getRandomElement(labTests);
          summary = `${test} test results`;
          details = {
            testName: test,
            result: `${Math.floor(Math.random() * 200) + 50} mg/dL`,
            normalRange: '70-140 mg/dL',
            status: Math.random() > 0.5 ? 'Normal' : 'Abnormal'
          };
          break;
        case 'Imaging':
          const imaging = getRandomElement(imagingTypes);
          summary = `${imaging} imaging report`;
          details = {
            type: imaging,
            findings: 'No abnormalities detected',
            recommendations: 'Follow-up in 6 months'
          };
          break;
        case 'Prescription':
          const med = getRandomElement(medicines);
          summary = `Prescribed ${med.name}`;
          details = {
            medicine: med.name,
            dosage: med.dosage,
            quantity: Math.floor(Math.random() * 30) + 10,
            instructions: 'Take twice daily with food'
          };
          break;
        case 'Vaccination':
          const vacc = getRandomElement(vaccinations);
          summary = `${vacc} vaccination administered`;
          details = {
            vaccine: vacc,
            dose: 'Standard dose',
            nextDue: dayjs(recordDate).add(1, 'year').format('YYYY-MM-DD')
          };
          break;
        case 'Note':
          summary = getRandomElement(notes);
          details = {
            content: 'Additional notes from the physician'
          };
          break;
      }

      records.push({
        record_id: makeRecordId(),
        patient_id: patient.patient_id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        record_type: recordType,
        record_date: recordDate,
        provider: getRandomElement(physicians),
        summary,
        details,
        created_by: 'admin'
      });
    }
  });
  return records;
};

const generatePrescriptionInvoices = (patients, medicines) => {
  const invoices = [];
  patients.forEach(patient => {
    const numInvoices = Math.floor(Math.random() * 3) + 1; // 1-3 invoices per patient
    for (let i = 0; i < numInvoices; i++) {
      const numItems = Math.floor(Math.random() * 3) + 1; // 1-3 items per invoice
      const items = [];
      let totalAmount = 0;

      for (let j = 0; j < numItems; j++) {
        const med = getRandomElement(medicines);
        const quantity = Math.floor(Math.random() * 20) + 5;
        const unitPrice = med.price;
        const totalPrice = quantity * unitPrice;
        totalAmount += totalPrice;

        items.push({
          medicineId: med.id,
          medicineName: med.name,
          prescribedDosage: med.dosage,
          prescribedQuantity: quantity,
          unitPrice,
          totalPrice
        });
      }

      invoices.push({
        invoice_id: makeInvoiceId(),
        patient_id: patient.patient_id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        items,
        total_amount: totalAmount,
        invoice_date: getRandomDate('2024-01-01', '2026-05-01'),
        status: ['pending', 'paid', 'cancelled'][Math.floor(Math.random() * 3)],
        created_by: 'admin'
      });
    }
  });
  return invoices;
};

const seedDatabase = async () => {
  try {
    // Read sample prescription data
    const samplePrescriptionPath = path.join(__dirname, '..', 'sample-prescription');
    const medicinesData = fs.readFileSync(samplePrescriptionPath, 'utf8');
    const medicines = JSON.parse(medicinesData);

    console.log('Clearing existing test data...');

    // Clear existing data
    await Patient.deleteMany({});
    await Appointment.deleteMany({});
    await HealthRecord.deleteMany({});
    await PrescriptionInvoice.deleteMany({});

    console.log('Generating test data...');

    // Generate data (now synchronous — no more async generatePatients)
    const patients = generatePatients(10);
    const appointments = generateAppointments(patients);
    const healthRecords = generateHealthRecords(patients, medicines);
    const invoices = generatePrescriptionInvoices(patients, medicines);

    // Insert data
    console.log(`Inserting ${patients.length} patients...`);
    await Patient.insertMany(patients);

    console.log(`Inserting ${appointments.length} appointments...`);
    await Appointment.insertMany(appointments);

    console.log(`Inserting ${healthRecords.length} health records...`);
    await HealthRecord.insertMany(healthRecords);

    console.log(`Inserting ${invoices.length} prescription invoices...`);
    await PrescriptionInvoice.insertMany(invoices);

    console.log('Test data generation completed successfully!');

  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

// Run the script
connectDB().then(() => {
  seedDatabase();
});