'use strict';

/**
 * attachRoomType.js — Shared utility to attach roomType name from populated roomTypeId.
 *
 * Eliminates duplicated inline logic like:
 *   obj.roomType = obj.roomTypeId ? obj.roomTypeId.name : '';
 *
 * Usage:
 *   const { attachRoomTypeName } = require('../utils/attachRoomType');
 *   const obj = user.toObject();
 *   attachRoomTypeName(obj);
 *
 * @param {Object} userData - Plain JS object (from .toObject() or .lean())
 *                            that has been .populate('roomTypeId', 'name')
 */
const attachRoomTypeName = (userData) => {
  if (!userData) return;
  userData.roomType = userData.roomTypeId?.name || '';
  userData.selectedRoomType = userData.roomTypeId?.name || '';
};

module.exports = { attachRoomTypeName };
