const TransportStop = require("../models/TransportStop");
const User = require("../models/User");
const { recalculateGrandTotal } = require("../utils/waterfall");
const { NotFoundError, ValidationError } = require("../utils/errors");

class TransportService {
  /**
   * Get all bus stops / drop points
   */
  async getAllStops(includeInactive = false) {
    const query = includeInactive ? {} : { isActive: true };
    return await TransportStop.find(query).sort({ createdAt: -1 });
  }

  /**
   * Get stop by ID
   */
  async getStopById(id) {
    const stop = await TransportStop.findById(id);
    if (!stop) throw new NotFoundError("Transport stop not found");
    return stop;
  }

  /**
   * Admin: Create new drop point & prices
   */
  async createStop(data) {
    if (!data.name) throw new ValidationError("Stop name is required");
    const stop = new TransportStop({
      name: data.name,
      pickupTime: data.pickupTime || "07:30 AM",
      dropTime: data.dropTime || "05:30 PM",
      monthlyPrice: Number(data.monthlyPrice) || 2000,
      yearlyPrice: Number(data.yearlyPrice) || 20000,
      description: data.description || "",
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
    });
    return await stop.save();
  }

  /**
   * Admin: Update existing drop point & prices
   */
  async updateStop(id, data) {
    const stop = await TransportStop.findById(id);
    if (!stop) throw new NotFoundError("Transport stop not found");

    if (data.name !== undefined) stop.name = data.name;
    if (data.pickupTime !== undefined) stop.pickupTime = data.pickupTime;
    if (data.dropTime !== undefined) stop.dropTime = data.dropTime;
    if (data.monthlyPrice !== undefined) stop.monthlyPrice = Number(data.monthlyPrice);
    if (data.yearlyPrice !== undefined) stop.yearlyPrice = Number(data.yearlyPrice);
    if (data.description !== undefined) stop.description = data.description;
    if (data.isActive !== undefined) stop.isActive = Boolean(data.isActive);

    return await stop.save();
  }

  /**
   * Admin: Delete drop point
   */
  async deleteStop(id) {
    const stop = await TransportStop.findByIdAndDelete(id);
    if (!stop) throw new NotFoundError("Transport stop not found");
    return { success: true, message: "Drop point deleted permanently" };
  }

  /**
   * Student: Subscribe to a drop point with monthly or yearly billing plan
   */
  async subscribePass(userId, { stopId, billingCycle = "monthly" }) {
    const user = await User.findOne({ "basicInfo.userId": userId }) || await User.findById(userId);
    if (!user) throw new NotFoundError("Student record not found");

    const stop = await TransportStop.findById(stopId);
    if (!stop || !stop.isActive) throw new ValidationError("Selected drop point is invalid or inactive");

    const cycle = billingCycle === "yearly" ? "yearly" : "monthly";
    const feeAmount = cycle === "yearly" ? stop.yearlyPrice : stop.monthlyPrice;

    const now = new Date();
    const validUntil = new Date(now);
    if (cycle === "yearly") {
      validUntil.setFullYear(validUntil.getFullYear() + 1);
    } else {
      validUntil.setMonth(validUntil.getMonth() + 1);
    }

    // Update user transportPass
    user.transportPass = {
      isOptedIn: true,
      stopId: stop._id,
      stopName: stop.name,
      billingCycle: cycle,
      feeAmount,
      subscribedAt: now,
      validUntil,
      status: "active",
    };

    if (user.roomDetails) {
      user.roomDetails.includeTransport = true;
    }

    // Sync financial ledger paymentSummary.transportFee
    if (!user.paymentSummary) user.paymentSummary = {};
    if (!user.paymentSummary.transportFee) {
      user.paymentSummary.transportFee = { total: 0, paid: 0, remaining: 0 };
    }

    const currentPaid = user.paymentSummary.transportFee.paid || 0;
    user.paymentSummary.transportFee.total = feeAmount;
    user.paymentSummary.transportFee.remaining = Math.max(0, feeAmount - currentPaid);

    recalculateGrandTotal(user.paymentSummary);
    await user.save();

    return {
      message: "Transport pass booked successfully",
      transportPass: user.transportPass,
      paymentSummary: user.paymentSummary,
    };
  }

  /**
   * Student: Cancel active transport pass (Only before payment)
   */
  async cancelPass(userId) {
    const user = await User.findOne({ "basicInfo.userId": userId }) || await User.findById(userId);
    if (!user) throw new NotFoundError("Student record not found");

    // Check if transport pass fee has already been paid
    const currentPaid = user.paymentSummary?.transportFee?.paid || 0;
    const hasApprovedPayment = Array.isArray(user.paymentDetails) && user.paymentDetails.some(
      (p) => p.category === "transport" && ["approved", "completed", "confirmed", "paid"].includes((p.status || "").toLowerCase())
    );

    if (currentPaid > 0 || hasApprovedPayment) {
      throw new BadRequestError("Transport pass cannot be cancelled after payment has been made. Please contact admin for cancellation support.");
    }

    // Reset transport pass details
    user.transportPass.isOptedIn = false;
    user.transportPass.status = "cancelled";
    user.transportPass.feeAmount = 0;

    if (user.roomDetails) {
      user.roomDetails.includeTransport = false;
    }

    // Reset financial ledger paymentSummary.transportFee
    if (user.paymentSummary && user.paymentSummary.transportFee) {
      const currentPaid = user.paymentSummary.transportFee.paid || 0;
      user.paymentSummary.transportFee.total = currentPaid; // Lock total to already paid amount
      user.paymentSummary.transportFee.remaining = 0; // Completely remove pending transport fee balance
      recalculateGrandTotal(user.paymentSummary);
    }

    // Remove any pending unapproved transport payment records from paymentDetails
    if (Array.isArray(user.paymentDetails)) {
      user.paymentDetails = user.paymentDetails.filter(
        (p) => !(p.category === "transport" && p.status === "pending")
      );
    }

    await user.save();
    return {
      message: "Transport pass cancelled successfully and pending transport fees removed",
      transportPass: user.transportPass,
      paymentSummary: user.paymentSummary,
    };
  }

  /**
   * Admin: Get subscriber roster list
   */
  async getSubscribers() {
    const users = await User.find({
      "transportPass.isOptedIn": true,
      "transportPass.status": "active",
    }).select("basicInfo roomDetails transportPass paymentSummary accountStatus");

    return users.map((u) => ({
      userId: u.basicInfo?.userId,
      name: u.basicInfo?.fullName,
      email: u.basicInfo?.email,
      phone: u.basicInfo?.phone,
      roomNumber: u.roomDetails?.roomNumber || "N/A",
      stopName: u.transportPass?.stopName,
      billingCycle: u.transportPass?.billingCycle,
      feeAmount: u.transportPass?.feeAmount,
      subscribedAt: u.transportPass?.subscribedAt,
      validUntil: u.transportPass?.validUntil,
      status: u.transportPass?.status,
    }));
  }
}

module.exports = new TransportService();
