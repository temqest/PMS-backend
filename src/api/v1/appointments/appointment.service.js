const Appointment = require('./appointment.model');
const Patient = require('../patients/patient.model');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');

const buildScheduledAt = (date, time) => {
  if (!date || !time) return null;
  const composed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(composed.getTime())) return null;
  return composed;
};

const formatLocalDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatLocalTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const makeAppointmentId = () => `APT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

exports.getAppointments = async (query = {}, actor = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, parseInt(query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (actor.role === 'patient' && actor.patient_id) {
    filter.patient_id = actor.patient_id;
  } else if (query.patient_id) {
    filter.patient_id = query.patient_id;
  }
  if (query.status) filter.status = query.status;
  if (query.date) {
    const start = new Date(`${query.date}T00:00:00`);
    const end = new Date(`${query.date}T23:59:59.999`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      filter.scheduled_at = { $gte: start, $lte: end };
    }
  } else if (query.start_date || query.end_date) {
    const range = {};
    if (query.start_date) {
      const start = new Date(`${query.start_date}T00:00:00`);
      if (!Number.isNaN(start.getTime())) {
        range.$gte = start;
      }
    }
    if (query.end_date) {
      const end = new Date(`${query.end_date}T23:59:59.999`);
      if (!Number.isNaN(end.getTime())) {
        range.$lte = end;
      }
    }
    if (Object.keys(range).length > 0) {
      filter.scheduled_at = range;
    }
  }
  if (query.search) {
    const q = new RegExp(query.search, 'i');
    filter.$or = [{ patient_name: q }, { reason: q }];
  }

  const [total, appointments] = await Promise.all([
    Appointment.countDocuments(filter),
    Appointment.find(filter).sort({ scheduled_at: 1 }).skip(skip).limit(limit),
  ]);

  return {
    results: appointments.length,
    appointments,
    pagination: { total, page, pages: Math.ceil(total / limit) || 1, limit },
  };
};

exports.createAppointment = async (data, actor) => {
  const scheduledAt = buildScheduledAt(data.date, data.time);
  if (!scheduledAt) throw new AppError('Invalid date or time.', 422);

  const isPatient = actor?.role === 'patient';
  const patientId = isPatient ? actor.patient_id : data.patient_id;
  if (!patientId) {
    throw new AppError('patient_id is required.', 422);
  }

  let patientName = data.patient_name || '';
  if (isPatient) {
    const patient = await Patient.findOne({ patient_id: patientId });
    if (!patient) throw new AppError('Patient not found.', 404);
    patientName = `${patient.first_name} ${patient.last_name}`.trim();
  }

  const appointment = await Appointment.create({
    appointment_id: makeAppointmentId(),
    patient_id: patientId,
    patient_name: patientName,
    appointment_type: data.appointment_type || 'In-Person',
    scheduled_at: scheduledAt,
    duration_minutes: data.duration_minutes || 30,
    reason: data.reason || '',
    priority: data.priority || 'Routine',
    status: isPatient ? 'Pending' : (data.status || 'Pending'),
    send_email_reminder: !!data.send_email_reminder,
    send_sms_reminder: !!data.send_sms_reminder,
    send_confirmation: data.send_confirmation !== false,
    internal_notes: data.internal_notes || '',
    created_by: actor?.id,
  });

  await Patient.findOneAndUpdate(
    { patient_id: patientId },
    { $addToSet: { appointment_refs: appointment.appointment_id }, $set: { updated_by: actor?.id } },
    { returnDocument: 'after' }
  );

  logger.info({
    event: 'APPOINTMENT_CREATED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    appointment_id: appointment.appointment_id,
    patient_id: appointment.patient_id,
  });

  return appointment;
};

exports.updateAppointment = async (appointmentId, updates, actor) => {
  const clientVersion = typeof updates.__v !== 'undefined' ? updates.__v : null;
  if (typeof updates.__v !== 'undefined') delete updates.__v;

  const appointment = await Appointment.findOne({ appointment_id: appointmentId });
  if (!appointment) throw new AppError('Appointment not found.', 404);
  if (appointment.status === 'Cancelled') throw new AppError('Cancelled appointment cannot be updated.', 409);

  if (actor?.role === 'patient') {
    if (!actor.patient_id || appointment.patient_id !== actor.patient_id) {
      throw new AppError('Forbidden: cannot modify another patient appointment.', 403);
    }
  }

  if (clientVersion !== null && appointment.__v !== clientVersion) {
    const err = new AppError('Conflict: resource has been modified.', 409);
    err.currentVersion = appointment.__v;
    throw err;
  }

  if (updates.date || updates.time) {
    const date = updates.date || formatLocalDate(appointment.scheduled_at);
    const time = updates.time || formatLocalTime(appointment.scheduled_at);
    const scheduledAt = buildScheduledAt(date, time);
    if (!scheduledAt) throw new AppError('Invalid date or time.', 422);
    appointment.scheduled_at = scheduledAt;
  }

  const assignable = actor?.role === 'patient'
    ? ['appointment_type', 'duration_minutes', 'reason', 'priority', 'send_email_reminder', 'send_sms_reminder', 'send_confirmation']
    : [
    'patient_id',
    'patient_name',
    'appointment_type',
    'duration_minutes',
    'reason',
    'priority',
    'status',
    'send_email_reminder',
    'send_sms_reminder',
    'send_confirmation',
    'internal_notes',
    ];
  assignable.forEach((key) => {
    if (typeof updates[key] !== 'undefined') appointment[key] = updates[key];
  });
  if (actor?.role === 'patient') {
    appointment.status = 'Pending';
    appointment.internal_notes = appointment.internal_notes || '';
  }
  appointment.updated_by = actor?.id;

  await appointment.save();

  logger.info({
    event: 'APPOINTMENT_UPDATED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    appointment_id: appointment.appointment_id,
  });
  return appointment;
};

exports.cancelAppointment = async (appointmentId, reason, actor) => {
  if (actor?.role === 'patient') {
    const appointment = await Appointment.findOne({ appointment_id: appointmentId });
    if (!appointment) throw new AppError('Appointment not found.', 404);
    if (!actor.patient_id || appointment.patient_id !== actor.patient_id) {
      throw new AppError('Forbidden: cannot modify another patient appointment.', 403);
    }

    appointment.status = 'Pending';
    appointment.cancel_reason = reason || 'Cancellation requested by patient';
    appointment.updated_by = actor?.id;
    await appointment.save();

    logger.info({
      event: 'APPOINTMENT_CANCELLATION_REQUESTED',
      actor_id: actor?.id,
      actor_role: actor?.role,
      ip: actor?.ip,
      appointment_id: appointment.appointment_id,
    });

    return appointment;
  }

  const appointment = await Appointment.findOneAndUpdate(
    { appointment_id: appointmentId },
    {
      $set: {
        status: 'Cancelled',
        cancel_reason: reason || '',
        cancelled_at: new Date(),
        updated_by: actor?.id,
      },
    },
    { returnDocument: 'after' }
  );
  if (!appointment) throw new AppError('Appointment not found.', 404);

  logger.info({
    event: 'APPOINTMENT_CANCELLED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    appointment_id: appointment.appointment_id,
  });
  return appointment;
};
