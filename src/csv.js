import { createId, nowIso } from "./store.js";

const requiredHeaders = ["name", "phone", "consent_source"];

export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field.trim());
      field = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

export function normalizePhone(value) {
  const trimmed = String(value || "").trim();
  if (/^\+\d{8,15}$/.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

function parseTags(value) {
  return String(value || "")
    .split(/[;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function importContactsFromCsv(text, existingContacts = []) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      contacts: [],
      errors: [{ row: 0, message: "CSV is empty." }]
    };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    return {
      contacts: [],
      errors: [{ row: 1, message: `Missing required column(s): ${missing.join(", ")}.` }]
    };
  }

  const byPhone = new Set(existingContacts.map((contact) => contact.phone));
  const contacts = [];
  const errors = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const record = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] || ""]));
    const name = record.name.trim();
    const phone = normalizePhone(record.phone);
    const consentSource = record.consent_source.trim();

    if (!name) {
      errors.push({ row: rowNumber, message: "Name is required." });
      return;
    }
    if (!phone) {
      errors.push({ row: rowNumber, message: "Phone must be a valid US or international number." });
      return;
    }
    if (!consentSource) {
      errors.push({ row: rowNumber, message: "Consent source is required before calls can be scheduled." });
      return;
    }
    if (byPhone.has(phone)) {
      errors.push({ row: rowNumber, message: "Duplicate phone number skipped." });
      return;
    }

    byPhone.add(phone);
    contacts.push({
      id: createId("contact"),
      name,
      phone,
      consentSource,
      tags: parseTags(record.tags),
      optedOut: false,
      createdAt: nowIso()
    });
  });

  return { contacts, errors };
}
