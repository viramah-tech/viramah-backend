const transportService = require("../services/transportService");

class TransportController {
  async getAllStops(req, res, next) {
    try {
      const includeInactive = req.query.includeInactive === "true";
      const stops = await transportService.getAllStops(includeInactive);
      res.json({ success: true, data: stops });
    } catch (error) {
      next(error);
    }
  }

  async getStopById(req, res, next) {
    try {
      const stop = await transportService.getStopById(req.params.id);
      res.json({ success: true, data: stop });
    } catch (error) {
      next(error);
    }
  }

  async createStop(req, res, next) {
    try {
      const stop = await transportService.createStop(req.body);
      res.status(201).json({ success: true, data: stop, message: "Drop point created successfully" });
    } catch (error) {
      next(error);
    }
  }

  async updateStop(req, res, next) {
    try {
      const stop = await transportService.updateStop(req.params.id, req.body);
      res.json({ success: true, data: stop, message: "Drop point updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  async deleteStop(req, res, next) {
    try {
      const stop = await transportService.deleteStop(req.params.id);
      res.json({ success: true, data: stop, message: "Drop point deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  async subscribePass(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id || req.body.userId;
      const { stopId, billingCycle } = req.body;
      const result = await transportService.subscribePass(userId, { stopId, billingCycle });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async cancelPass(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id || req.body.userId;
      const result = await transportService.cancelPass(userId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getSubscribers(req, res, next) {
    try {
      const roster = await transportService.getSubscribers();
      res.json({ success: true, data: roster });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TransportController();
