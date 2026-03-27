const User = require('../../models/User');
const RoomType = require('../../models/RoomType');
const RoomHold = require('../../models/RoomHold');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socketService');

/**
 * GET /api/public/onboarding/status
 * Get current onboarding progress for the logged-in resident
 */
const getStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('roomTypeId', 'name displayName basePrice discountedPrice');
    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      onboardingStatus: user.onboardingStatus,
      name: user.name,
      dateOfBirth: user.dateOfBirth,
      idType: user.idType,
      idNumber: user.idNumber,
      documents: user.documents,
      emergencyContact: user.emergencyContact,
      parentDocuments: user.parentDocuments,
      roomTypeId: user.roomTypeId ? user.roomTypeId._id : null,
      selectedRoomType: user.roomTypeId ? user.roomTypeId.name : '', // for backward compat in frontend until updated
      roomNumber: user.roomNumber,
      messPackage: user.messPackage,
      gender: user.gender,
      address: user.address,
      paymentStatus: user.paymentStatus,
      documentVerificationStatus: user.documentVerificationStatus,
      moveInStatus: user.moveInStatus,
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
    const { idProof, addressProof, photo, fullName, dateOfBirth, idType, idNumber, gender, address } = req.body;

    const updateFields = {
      'documents.idProof': idProof || '',
      'documents.addressProof': addressProof || '',
      'documents.photo': photo || '',
      onboardingStatus: 'in-progress',
    };

    // Persist KYC text fields
    if (fullName) updateFields.name = fullName;
    if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
    if (idType) updateFields.idType = idType;
    if (idNumber) updateFields.idNumber = idNumber;
    if (gender) updateFields.gender = gender;
    if (address) updateFields.address = address;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      documents: user.documents,
      idType: user.idType,
      idNumber: user.idNumber,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 1 saved — identity verified');
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
    const { name, phone, relation, alternatePhone, parentIdType, parentIdNumber, parentIdFront, parentIdBack } = req.body;

    const updateFields = {
      'emergencyContact.name': name,
      'emergencyContact.phone': phone,
      'emergencyContact.relation': relation,
      onboardingStatus: 'in-progress',
    };

    // Persist alternate phone if provided
    if (alternatePhone) updateFields['emergencyContact.alternatePhone'] = alternatePhone;

    // Persist parent/guardian document info
    if (parentIdType) updateFields['parentDocuments.idType'] = parentIdType;
    if (parentIdNumber) updateFields['parentDocuments.idNumber'] = parentIdNumber;
    if (parentIdFront) updateFields['parentDocuments.idFront'] = parentIdFront;
    if (parentIdBack) updateFields['parentDocuments.idBack'] = parentIdBack;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      emergencyContact: user.emergencyContact,
      parentDocuments: user.parentDocuments,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 2 saved — emergency contact & guardian ID set');
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
    const { roomTypeName, roomTypeId, messPackage } = req.body;

    // Validate roomType exists and has availability
    let roomTypeObj;
    if (roomTypeId) {
      roomTypeObj = await RoomType.findById(roomTypeId);
    } else if (roomTypeName) {
      roomTypeObj = await RoomType.findOne({ name: roomTypeName, isActive: true });
    }
    
    if (!roomTypeObj || !roomTypeObj.isActive) return error(res, 'Room type not found or inactive', 404);

    if (roomTypeObj.availableSeats <= 0) return error(res, 'No vacant beds available for this room type', 400);

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        roomTypeId: roomTypeObj._id,
        messPackage: messPackage || '',
        onboardingStatus: 'in-progress',
      },
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      roomTypeId: user.roomTypeId,
      selectedRoomType: roomTypeObj.name,
      messPackage: user.messPackage,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 3 saved — room type selected');
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
    const { gender, address } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        gender: gender || '',
        address: address || '',
        onboardingStatus: 'in-progress',
      },
      { new: true, runValidators: true }
    );

    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      gender: user.gender,
      address: user.address,
      onboardingStatus: user.onboardingStatus,
    }, 'Step 4 saved — personal details set');
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
    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    // If already completed, return success without re-processing
    if (user.onboardingStatus === 'completed') {
      return success(res, {
        onboardingStatus: 'completed',
        message: 'Onboarding already completed',
      }, 'Onboarding already completed');
    }

    // Validate all steps are complete
    const missing = [];
    if (!user.documents.idProof) missing.push('ID proof');
    if (!user.documents.addressProof) missing.push('Address proof');
    if (!user.documents.photo) missing.push('Photo');
    if (!user.emergencyContact.name || !user.emergencyContact.phone) missing.push('Emergency contact');
    if (!user.roomTypeId) missing.push('Room selection');
    if (!user.gender) missing.push('Gender');
    if (!user.address) missing.push('Address');

    if (missing.length > 0) {
      // AUDIT FIX S4-2: Structured error with specific code and missing fields array.
      // Frontend can detect errorCode=INCOMPLETE_PROFILE and redirect to step-1.
      const responseBody = {
        success: false,
        message: `Onboarding incomplete. Missing: ${missing.join(', ')}`,
        errorCode: 'INCOMPLETE_PROFILE',
        missingFields: missing,
      };
      return res.status(400).json(responseBody);
    }

    user.onboardingStatus = 'completed';
    await user.save(); // validation for gender/address triggers here

    // Only increment bookedSeats if no deposit hold already reserved the seat.
    // depositService.approveDeposit() already increments bookedSeats when a hold
    // is approved, so we must NOT double-count.
    if (user.roomTypeId) {
      const existingHold = await RoomHold.findOne({
        userId: user._id,
        roomTypeId: user.roomTypeId,
        status: { $in: ['active', 'converted'] },
      });

      if (!existingHold) {
        // No deposit hold — this is a direct onboarding without deposit.
        // Increment bookedSeats atomically.
        await RoomType.findByIdAndUpdate(user.roomTypeId, {
          $inc: { bookedSeats: 1 },
        });
      }
      // If existingHold exists, seat was already counted at deposit approval — skip.
    }

    // Emit real-time onboarding completion events
    emitToAdmins('user:updated', user);
    emitToUser(user._id.toString(), 'user:updated', user);

    const populatedUser = await User.findById(user._id).populate('roomTypeId', 'name');

    return success(res, {
      onboardingStatus: populatedUser.onboardingStatus,
      user: {
        name: populatedUser.name,
        email: populatedUser.email,
        roomNumber: populatedUser.roomNumber,
        roomTypeId: populatedUser.roomTypeId ? populatedUser.roomTypeId._id : null,
        selectedRoomType: populatedUser.roomTypeId ? populatedUser.roomTypeId.name : '',
        messPackage: populatedUser.messPackage,
        gender: populatedUser.gender,
        address: populatedUser.address,
      },
    }, 'Onboarding completed successfully');
  } catch (err) {
    console.error('[Confirm Onboarding Error]', err.message, err.stack);
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
};
