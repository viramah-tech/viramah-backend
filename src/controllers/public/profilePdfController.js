'use strict';

const pdfService = require('../../services/pdf-service');

/**
 * GET /api/v1/profile/me.pdf
 * Stream a profile summary PDF for the authenticated resident.
 */
async function downloadProfile(req, res, next) {
  try {
    const user = req.user;
    const buffer = await pdfService.generateProfilePdf(user);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="viramah-profile-${user.userId || user._id}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

module.exports = { downloadProfile };
