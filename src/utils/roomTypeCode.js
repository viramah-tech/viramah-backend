'use strict';

const CANONICAL_ROOM_TYPE_CODES = Object.freeze([
  'AXIS_PLUS_STUDIO',
  'AXIS_STUDIO',
  'COLLECTIVE_1BHK',
  'NEXUS_1BHK',
]);

const DIRECT_ALIASES = new Map([
  ['AXIS_PLUS_STUDIO', 'AXIS_PLUS_STUDIO'],
  ['AXIS_PLUS', 'AXIS_PLUS_STUDIO'],
  ['AXISPLUS', 'AXIS_PLUS_STUDIO'],
  ['VIRAMAH_AXIS_PLUS', 'AXIS_PLUS_STUDIO'],
  ['VIRAMAH_AXISPLUS', 'AXIS_PLUS_STUDIO'],
  ['AXIS_STUDIO', 'AXIS_STUDIO'],
  ['AXIS', 'AXIS_STUDIO'],
  ['VIRAMAH_AXIS', 'AXIS_STUDIO'],
  ['COLLECTIVE_1BHK', 'COLLECTIVE_1BHK'],
  ['COLLECTIVE', 'COLLECTIVE_1BHK'],
  ['VIRAMAH_COLLECTIVE', 'COLLECTIVE_1BHK'],
  ['NEXUS_1BHK', 'NEXUS_1BHK'],
  ['NEXUS', 'NEXUS_1BHK'],
  ['VIRAMAH_NEXUS', 'NEXUS_1BHK'],
]);

function normalizeRoomTypeValue(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveRoomTypeCode(value) {
  if (!value) return null;

  const normalized = normalizeRoomTypeValue(value);
  if (!normalized) return null;

  const direct = DIRECT_ALIASES.get(normalized);
  if (direct) return direct;

  if (normalized.includes('AXIS') && (normalized.includes('PLUS') || normalized.includes('PREMIUM'))) {
    return 'AXIS_PLUS_STUDIO';
  }
  if (normalized.includes('AXIS')) {
    return 'AXIS_STUDIO';
  }
  if (normalized.includes('COLLECTIVE')) {
    return 'COLLECTIVE_1BHK';
  }
  if (normalized.includes('NEXUS')) {
    return 'NEXUS_1BHK';
  }

  return null;
}

function resolveRoomTypeCodeFromCandidates(...values) {
  for (const value of values) {
    const code = resolveRoomTypeCode(value);
    if (code) return code;
  }
  return null;
}

module.exports = {
  CANONICAL_ROOM_TYPE_CODES,
  normalizeRoomTypeValue,
  resolveRoomTypeCode,
  resolveRoomTypeCodeFromCandidates,
};
