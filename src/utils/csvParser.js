/**
 * RFC-4180 compliant CSV parser written in pure JavaScript.
 * Handles quoted fields, nested commas, escaped double-quotes (""), and multi-line fields.
 */
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" inside quotes becomes "
          row[row.length - 1] += '"';
          i++; // skip next quote
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        row[row.length - 1] += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push("");
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && nextChar === '\n') {
          i++; // skip \n
        }
        lines.push(row);
        row = [""];
      } else {
        row[row.length - 1] += char;
      }
    }
  }

  // Add the last row if it's not empty
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }

  return lines;
}

/**
 * Auto-detects standard banking headers and maps column indexes.
 */
function mapHeaders(headers) {
  let dateIdx = -1;
  let descIdx = -1;
  let refIdx = -1;
  let amountIdx = -1;

  const dateTerms = ["date", "txn date", "transaction date", "value date", "post date"];
  const descTerms = ["desc", "description", "narration", "remarks", "particulars"];
  const refTerms = ["ref", "utr", "transaction id", "txn id", "chq/ref no", "reference", "reference no"];
  const amountTerms = ["credit", "deposit", "cr", "amount", "transaction amount"];

  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || "").toLowerCase().trim().replace(/[^a-z0-9/ ]/g, "");
    const words = h.split(/\s+/);
    
    if (dateIdx === -1 && dateTerms.some(term => h.includes(term))) dateIdx = i;
    if (descIdx === -1 && descTerms.some(term => h.includes(term))) descIdx = i;
    if (refIdx === -1 && refTerms.some(term => h.includes(term))) refIdx = i;
    if (amountIdx === -1 && amountTerms.some(term => {
      if (term === "cr") {
        return words.includes("cr") || h === "cr";
      }
      return h.includes(term);
    })) {
      amountIdx = i;
    }
  }

  return { dateIdx, descIdx, refIdx, amountIdx };
}

/**
 * Extracts a potential 12-digit UPI UTR or alphanumeric reference number from a string.
 */
function extractUTRFromString(val) {
  if (!val) return "";
  // Match UPI UTR (12-digit number)
  const upiMatch = val.match(/\b\d{12}\b/);
  if (upiMatch) return upiMatch[0];

  // Match IMPS reference (typically 12 digits or alphanumeric of length 10-18)
  const clean = val.replace(/[^a-zA-Z0-9]/g, "");
  if (clean.length >= 9 && clean.length <= 22) {
    return clean;
  }
  return val.trim();
}

module.exports = {
  parseCSV,
  mapHeaders,
  extractUTRFromString
};
