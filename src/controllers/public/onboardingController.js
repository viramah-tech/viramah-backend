const User = require('../../models/User');
const Room = require('../../models/Room');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socketService');

/**
 * GET /api/public/onboarding/status
 * Get current onboarding progress for the logged-in resident
 */
const getStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('selectedRoom');
    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      onboardingStatus: user.onboardingStatus,
      documents: user.documents,
      emergencyContact: user.emergencyContact,
      selectedRoom: user.selectedRoom,
      roomNumber: user.roomNumber,
      roomType: user.roomType,
      messPackage: user.messPackage,
      preferences: user.preferences,
    }, 'Onboarding status fetched');
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/public/onboarding/step-1
 * Save KYC documents (idProof, addressProof, photo URLs)
 * File uploads are handled separately via /api/public/upload — this endpoint receives the URLs.
 */
const saveStep1 = async (req, res, next) => {
  try {
    const { idProof, addressProof, photo } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        'documents.idProof': idProof || '',
        'documents.addressProof': addressProof || '',
        'documents.photo': photo || '',
        onboardingStatus: 'in-progress',
      },
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      documents: user.documents,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 1 saved — documents uploaded');
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/public/onboarding/step-2
 * Save emergency contact information
 */
const saveStep2 = async (req, res, next) => {
  try {
    const { name, phone, relation } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        'emergencyContact.name': name,
        'emergencyContact.phone': phone,
        'emergencyContact.relation': relation,
        onboardingStatus: 'in-progress',
      },
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      emergencyContact: user.emergencyContact,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 2 saved — emergency contact set');
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/public/onboarding/step-3
 * Select room and mess package
 */
const saveStep3 = async (req, res, next) => {
  try {
    const { roomId, messPackage } = req.body;

    // Validate room exists and has availability
    const room = await Room.findById(roomId);
    if (!room) return error(res, 'Room not found', 404);
    if (!room.isAvailable) return error(res, 'This room is no longer available', 400);

    // Check if user previously had a different room selected — release it
    const currentUser = await User.findById(req.user._id);
    if (currentUser.selectedRoom && currentUser.selectedRoom.toString() !== roomId) {
      await Room.findByIdAndUpdate(currentUser.selectedRoom, {
        $inc: { currentOccupancy: -1 },
      });
      // Also reset status if it was full
      const prevRoom = await Room.findById(currentUser.selectedRoom);
      if (prevRoom && prevRoom.currentOccupancy < prevRoom.capacity && prevRoom.status === 'full') {
        prevRoom.status = 'available';
        await prevRoom.save();
      }
    }

    // Reserve the new room (increment occupancy)
    room.currentOccupancy += 1;
    if (room.currentOccupancy >= room.capacity) {
      room.status = 'full';
    }
    await room.save();

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        selectedRoom: room._id,
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        messPackage: messPackage || '',
        onboardingStatus: 'in-progress',
      },
      { new: true, runValidators: true }
    ).populate('selectedRoom');

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      selectedRoom: user.selectedRoom,
      roomNumber: user.roomNumber,
      roomType: user.roomType,
      messPackage: user.messPackage,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 3 saved — room selected');
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/public/onboarding/step-4
 * Save lifestyle preferences
 */
const saveStep4 = async (req, res, next) => {
  try {
    const { diet, sleepSchedule, noise } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        'preferences.diet': diet || '',
        'preferences.sleepSchedule': sleepSchedule || '',
        'preferences.noise': noise || '',
        onboardingStatus: 'in-progress',
      },
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      preferences: user.preferences,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 4 saved — preferences set');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/onboarding/confirm
 * Mark onboarding as completed — validates all required fields are filled
 */
const confirmOnboarding = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('selectedRoom');
    if (!user) return error(res, 'User not found', 404);

    // Validate all steps are complete
    const missing = [];
    if (!user.documents.idProof) missing.push('ID proof');
    if (!user.documents.addressProof) missing.push('Address proof');
    if (!user.documents.photo) missing.push('Photo');
    if (!user.emergencyContact.name || !user.emergencyContact.phone) missing.push('Emergency contact');
    if (!user.selectedRoom) missing.push('Room selection');
    if (!user.preferences.diet) missing.push('Diet preference');

    if (missing.length > 0) {
      return error(
        res,
        `Onboarding incomplete. Missing: ${missing.join(', ')}`,
        400
      );
    }

    user.onboardingStatus = 'completed';
    await user.save();

    // Emit real-time onboarding completion events
    emitToAdmins('user:updated', user);
    emitToUser(user._id.toString(), 'user:updated', user);

    return success(res, {
      onboardingStatus: user.onboardingStatus,
      user: {
        name: user.name,
        email: user.email,
        roomNumber: user.roomNumber,
        roomType: user.roomType,
        messPackage: user.messPackage,
        selectedRoom: user.selectedRoom,
      },
    }, 'Onboarding completed successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/public/rooms/available
 * List all rooms with availability
 */
const getAvailableRooms = async (req, res, next) => {
  try {
    const { roomType, minPrice, maxPrice, sort } = req.query;

    const filter = { status: { $ne: 'maintenance' } };

    if (roomType) filter.roomType = roomType;
    if (minPrice || maxPrice) {
      filter.pricePerMonth = {};
      if (minPrice) filter.pricePerMonth.$gte = Number(minPrice);
      if (maxPrice) filter.pricePerMonth.$lte = Number(maxPrice);
    }

    let sortObj = { roomNumber: 1 };
    if (sort === 'price-asc') sortObj = { pricePerMonth: 1 };
    else if (sort === 'price-desc') sortObj = { pricePerMonth: -1 };
    else if (sort === 'floor') sortObj = { floor: 1 };

    const rooms = await Room.find(filter).sort(sortObj);

    return success(res, { rooms }, 'Rooms fetched');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getStatus,
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
  confirmOnboarding,
  getAvailableRooms,
};
