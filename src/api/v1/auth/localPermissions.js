const roleAliases = {
  admin: 'system_admin',
  administrator: 'system_admin',
  system_admin: 'system_admin',
  systemadmin: 'system_admin',
  'system admin': 'system_admin',
  staff: 'front_desk',
  front_desk: 'front_desk',
  frontdesk: 'front_desk',
  'front desk': 'front_desk',
  receptionist: 'front_desk',
  doctor: 'physician',
  physician: 'physician',
  nurse: 'nurse',
  patient: 'patient',
};

const splitRoleCandidates = (role) => {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return [];

  const normalized = raw.replace(/[^a-z0-9]+/g, ' ').trim();
  const underscored = normalized.replace(/\s+/g, '_');
  const colonSplit = raw.split(':').map((part) => part.trim()).filter(Boolean);
  const spaceSplit = normalized.split(/\s+/).filter(Boolean);
  const suffixes = [];

  if (colonSplit.length > 1) {
    suffixes.push(colonSplit[colonSplit.length - 1].replace(/[^a-z0-9]+/g, ' ').trim());
  }

  if (spaceSplit.length > 1) {
    suffixes.push(spaceSplit[spaceSplit.length - 1]);
    suffixes.push(spaceSplit.slice(-2).join(' '));
  }

  return Array.from(
    new Set(
      [
        raw,
        raw.replace(/[^a-z0-9]+/g, '_'),
        normalized,
        underscored,
        ...suffixes,
        ...suffixes.map((value) => value.replace(/\s+/g, '_')),
      ].filter(Boolean)
    )
  );
};

const normalizeRoleKey = (role) => {
  const candidates = splitRoleCandidates(role);

  for (const candidate of candidates) {
    if (roleAliases[candidate]) {
      return roleAliases[candidate];
    }
  }

  const normalized = candidates.find((candidate) => candidate.includes('admin'));
  if (normalized) return 'system_admin';
  if (candidates.some((candidate) => candidate.includes('doctor') || candidate.includes('physician'))) return 'physician';
  if (candidates.some((candidate) => candidate.includes('nurse'))) return 'nurse';
  if (candidates.some((candidate) => candidate.includes('staff') || candidate.includes('front_desk') || candidate.includes('reception'))) {
    return 'front_desk';
  }
  if (candidates.some((candidate) => candidate.includes('patient'))) return 'patient';

  return candidates[0] || '';
};

const permissionProfiles = {
  system_admin: [
    'dashboard:view',
    'patients:view',
    'patients:create',
    'patients:update',
    'patients:delete',
    'appointments:view',
    'appointments:create',
    'appointments:update',
    'health_records:view',
    'health_records:create',
    'health_records:update',
    'health_records:delete',
    'prescriptions:view',
    'prescriptions:create',
    'prescriptions:update',
    'telehealth:view',
    'telehealth:start',
    'admin_users:view',
    'admin_users:manage',
    'audit_logs:view',
  ],
  physician: [
    'dashboard:view',
    'patients:view',
    'patients:create',
    'patients:update',
    'appointments:view',
    'appointments:create',
    'appointments:update',
    'health_records:view',
    'health_records:create',
    'health_records:update',
    'prescriptions:view',
    'prescriptions:create',
    'telehealth:view',
    'telehealth:start',
  ],
  front_desk: [
    'dashboard:view',
    'patients:view',
    'patients:create',
    'patients:update',
    'appointments:view',
    'appointments:create',
    'appointments:update',
    'telehealth:view',
    'audit_logs:view',
  ],
  nurse: [
    'dashboard:view',
    'patients:view',
    'patients:update',
    'appointments:view',
    'appointments:update',
    'health_records:view',
    'health_records:create',
    'health_records:update',
    'prescriptions:view',
    'telehealth:view',
    'telehealth:start',
  ],
};

const getServicesFromPermissions = (permissions) => {
  const services = {};

  for (const permission of permissions) {
    const [service] = String(permission || '').split(':');
    if (!service) continue;
    services[service] = true;
  }

  return services;
};

const getLocalAccessProfile = (role) => {
  const normalizedRole = normalizeRoleKey(role);
  const permissions = permissionProfiles[normalizedRole];

  if (!permissions || normalizedRole === 'patient') {
    return null;
  }

  return {
    permissions: [...permissions],
    services: getServicesFromPermissions(permissions),
  };
};

module.exports = {
  getLocalAccessProfile,
  normalizeRoleKey,
};
