/* V1 → V2 Extractor core */
let selectedLGU = null;
let masterRows = [];
let abstractRows = [];
let natureIndex = new Map();
let barangayOverride = new Map();
let lastExport = null;

function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildNatureIndex(list) {
  natureIndex = new Map();
  const add = (key, item, prio) => {
    if (!key) return;
    const k = normKey(key);
    const prev = natureIndex.get(k);
    if (!prev || prio > prev.prio) natureIndex.set(k, { code: item.lineCode, prio });
  };
  (list || []).forEach(item => {
    const prio = item.isActive ? 2 : 1;
    add(item.businessLine, item, prio);
  });
}

function resolveNatureCode(natureText) {
  if (!natureText) return '';
  const parts = String(natureText).split(',').map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    const hit = natureIndex.get(normKey(p));
    return { nature: p, code: hit ? hit.code : '' };
  });
}

function resolveBarangayCode(name) {
  if (!name || !selectedLGU) return '';
  const k = normKey(name);
  if (barangayOverride.has(k)) return barangayOverride.get(k);
  const mun = BARANGAYS_REGION2[selectedLGU.psgcPrefix] || {};
  const hit = mun[k];
  return hit ? hit.psgc : '';
}

function parsePhone(raw) {
  let digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('639') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('09') && digits.length >= 11) return '639' + digits.slice(2, 11);
  if (digits.startsWith('9') && digits.length >= 10) return '639' + digits.slice(0, 10);
  return digits;
}

function parseTin(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (d.length >= 14) d = d.slice(0, 14);
  if (d.length < 9) return String(raw || '').replace(/_/g, '').trim();
  while (d.length < 14) d += '0';
  return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6, 9) + '-' + d.slice(9, 14);
}

function parseMoney(raw) {
  if (raw == null || raw === '') return '0';
  const s = String(raw);
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? String(Number(m[0])) : '0';
}

function parseDateToMDY(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/^'+/, '').trim();
  if (!s) return '';
  // Excel serial
  if (/^\d{4,5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30 + parseInt(s, 10)));
    return pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()) + '/' + d.getUTCFullYear();
  }
  // 2025-01-09 or with time
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return pad2(m[2]) + '/' + pad2(m[3]) + '/' + m[1];
  // Dec. 31, 2025
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[m[1].slice(0, 3).toLowerCase()];
    if (mo) return pad2(mo) + '/' + pad2(m[2]) + '/' + m[3];
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return pad2(m[1]) + '/' + pad2(m[2]) + '/' + m[3];
  const d = new Date(s);
  if (!isNaN(d.getTime())) return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear();
  return s;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function mapBusinessType(raw) {
  const u = String(raw || '').trim().toUpperCase();
  if (u.includes('SOLE')) return 'SOLE PROPRIETORSHIP';
  if (u.includes('ONE PERSON') || u.includes('OPC')) return 'ONE PERSON CORPORATION';
  if (u.includes('PARTNER')) return 'PARTNERSHIP';
  if (u.includes('COOP')) return 'COOPERATIVE';
  if (u.includes('CORP')) return 'CORPORATION';
  return u || 'SOLE PROPRIETORSHIP';
}

function mapAppType(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (u.startsWith('n')) return 'N';
  if (u.startsWith('r')) return 'R';
  if (u.startsWith('q')) return 'Q';
  return 'R';
}

function mapPaymentMode(onlineRaw) {
  const u = String(onlineRaw || '').trim().toLowerCase();
  return (u === 'yes' || u === 'y' || u === 'true' || u === '1') ? 'ONLINE' : 'MANUAL';
}

function quartersFromMode(mode) {
  const u = String(mode || '').toLowerCase();
  if (u.includes('quarter')) return { from: '1', to: '1' };
  if (u.includes('bi')) return { from: '1', to: '2' };
  return { from: '1', to: '4' };
}

function identityKey(row) {
  return [normKey(row.businessName), normKey(row.lastName), normKey(row.firstName)].join('|');
}

function slugCode(header, maxLen) {
  let s = String(header || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-$/, '');
  return s || 'FEE';
}

function mapFeeType(header) {
  const u = String(header || '').toUpperCase();
  if (u.includes('GARBAGE')) return 'GARBAGE';
  if (u.includes('SANITARY') || u.includes('HEALTH')) return 'SANITARY';
  if (u.includes('PERMIT') || u.includes('MAYOR') || u.includes('PLATE') || u.includes('STICKER') || u.includes('CLEARANCE')) return 'PERMIT';
  if (u.includes('BUSINESS TAX') || u.includes('LICENSE')) return 'LICENSE';
  return 'OTHER';
}

function getCell(row, ...aliases) {
  for (const a of aliases) {
    if (row[a] != null && String(row[a]).trim() !== '') return String(row[a]).trim();
    const found = Object.keys(row).find(k => normKey(k) === normKey(a));
    if (found && row[found] != null && String(row[found]).trim() !== '') return String(row[found]).trim();
  }
  return '';
}

function normalizeMasterRow(row) {
  return {
    v1Bin: getCell(row, 'Business Identification Number', 'BIN'),
    permitNo: getCell(row, 'Permit No.'),
    businessName: getCell(row, 'Business Name'),
    lastName: getCell(row, 'Last Name'),
    firstName: getCell(row, 'First Name'),
    middleName: getCell(row, 'Middle Name'),
    extName: getCell(row, 'Extension Name'),
    sex: getCell(row, 'Sex'),
    businessAddress: getCell(row, 'Business Address'),
    ownerAddress: getCell(row, 'Address of the Owner'),
    appDate: getCell(row, 'Application Date'),
    appType: getCell(row, 'Type of Application'),
    taxYear: getCell(row, 'Tax Year'),
    capital: getCell(row, 'Capital Investment'),
    gross: getCell(row, 'Gross Sales'),
    payMode: getCell(row, 'Mode of Payment'),
    bizType: getCell(row, 'Type of Business'),
    totalPaid: getCell(row, 'Total Amount Paid'),
    orNo: getCell(row, 'O.R. Number', 'OR Number'),
    orDate: getCell(row, 'O.R. Date', 'OR Date'),
    tin: getCell(row, 'TIN'),
    regNo: getCell(row, 'Registration No.'),
    male: getCell(row, 'No of Male Employee'),
    female: getCell(row, 'No of Female Employee'),
    contact: getCell(row, 'Contact Number'),
    email: getCell(row, 'Email Address'),
    nature: getCell(row, 'Nature of Business'),
    plate: getCell(row, 'Plate No.'),
    issued: getCell(row, 'Date Issued'),
    barangay: getCell(row, 'Barangay (Business Address)'),
    online: getCell(row, 'Online Payment'),
    area: getCell(row, 'Business Area'),
    floorArea: getCell(row, 'Floor Area'),
    capitalBreak: getCell(row, 'Capital Investment Breakdown'),
    grossEss: getCell(row, 'Gross Sales Essential'),
    grossNon: getCell(row, 'Gross Sales Non-Essential'),
    surcharge: getCell(row, 'Surcharge'),
    interest: getCell(row, 'Interest'),
    validUntil: getCell(row, 'Valid Until'),
    tradeName: getCell(row, 'Trade Name')
  };
}

function parseAddressParts(addr) {
  const parts = String(addr || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) return { barangay: parts[0], municipality: parts[1], province: parts[2] };
  if (parts.length === 2) return { barangay: parts[0], municipality: parts[1], province: '' };
  if (parts.length === 1) return { barangay: parts[0], municipality: '', province: '' };
  return { barangay: '', municipality: '', province: '' };
}

function buildExport() {
  if (!selectedLGU) throw new Error('Select Province and Municipality first.');
  if (!masterRows.length) throw new Error('Upload Business Masterlist first.');

  const gaps = [];
  const binMap = []; // mapping report rows
  const businesses = new Map(); // identity -> { v2Bin, row }
  let inc = 1;

  const normalized = masterRows.map(normalizeMasterRow);

  normalized.forEach((r, idx) => {
    const id = identityKey(r);
    if (!businesses.has(id)) {
      const year = (r.taxYear || '2025').replace(/\D/g, '').slice(0, 4) || '2025';
      const v2Bin = selectedLGU.psgcPrefix + '-' + year + '-' + String(inc).padStart(7, '0');
      inc++;
      businesses.set(id, { v2Bin, sample: r });
      binMap.push({
        v1_bin: r.v1Bin,
        v2_bin: v2Bin,
        business_name: r.businessName,
        owner: (r.lastName + ', ' + r.firstName).trim(),
        note: 'new business identity'
      });
    } else {
      const b = businesses.get(id);
      binMap.push({
        v1_bin: r.v1Bin,
        v2_bin: b.v2Bin,
        business_name: r.businessName,
        owner: (r.lastName + ', ' + r.firstName).trim(),
        note: 'same identity — shared V2 BIN'
      });
    }
  });

  // Also index v1Bin -> v2Bin (last wins if collision; prefer identity map via row)
  const v1ToV2 = new Map();
  normalized.forEach(r => {
    const id = identityKey(r);
    v1ToV2.set(normKey(r.v1Bin), businesses.get(id).v2Bin);
  });

  const businessCsv = [];
  const activityCsv = [];
  const applicationCsv = [];
  const feeCsv = [];
  const seenBiz = new Set();
  const seenActivity = new Set();
  const appByOr = new Map();

  normalized.forEach((r, idx) => {
    const id = identityKey(r);
    const v2Bin = businesses.get(id).v2Bin;
    const srcRow = idx + 2;

    if (!seenBiz.has(id)) {
      seenBiz.add(id);
      const addr = parseAddressParts(r.ownerAddress || r.businessAddress);
      const brgyName = r.barangay || addr.barangay;
      const brgyCode = resolveBarangayCode(brgyName);
      if (brgyName && !brgyCode) gaps.push({ table: 'Business', row: srcRow, field: 'office_barangay_code', value: brgyName, issue: 'Barangay name not matched — upload CSV or fix' });

      const sex = /^f/i.test(r.sex) ? 'F' : (/^m/i.test(r.sex) ? 'M' : '');
      if (!sex) gaps.push({ table: 'Business', row: srcRow, field: 'incharge_sex', value: r.sex, issue: 'Could not map sex to M/F' });

      const phone = parsePhone(r.contact);
      if (!phone) gaps.push({ table: 'Business', row: srcRow, field: 'cellphone_no', value: r.contact, issue: 'Could not parse cellphone' });

      const bt = mapBusinessType(r.bizType);
      const area = parseMoney(r.area);
      const floor = r.floorArea ? parseMoney(r.floorArea) : area;
      if (!r.floorArea) gaps.push({ table: 'Business', row: srcRow, field: 'floor_area', value: '', issue: 'Blank in V1 — used area fallback' });
      gaps.push({ table: 'Business', row: srcRow, field: 'location_owned', value: '', issue: 'Missing in V1 — defaulted to 1 (owned); review' });
      gaps.push({ table: 'Business', row: srcRow, field: 'dti_registration_expiry_date', value: '', issue: 'Missing in V1 — blank; required for Sole Prop' });

      businessCsv.push({
        bin: v2Bin,
        business_name: r.businessName,
        trade_name: r.tradeName,
        business_type: bt,
        dti_no: bt === 'SOLE PROPRIETORSHIP' ? (r.regNo || '') : '',
        dti_registration_expiry_date: '',
        sec_no: '',
        cda_no: '',
        tin_no: parseTin(r.tin),
        email_address: r.email,
        cellphone_no: phone,
        telephone_no: '',
        incharge_first_name: r.firstName,
        incharge_middle_name: r.middleName,
        incharge_last_name: r.lastName,
        incharge_extension_name: String(r.extName || '').replace(/\./g, ''),
        incharge_sex: sex || 'M',
        incharge_country_of_citizenship: 'Philippines',
        incharge_street: '',
        incharge_barangay: brgyName || addr.barangay || 'UNKNOWN',
        incharge_municipality: addr.municipality || selectedLGU.municipality,
        incharge_province: addr.province || selectedLGU.provinceLabel,
        office_street: '',
        office_barangay_code: brgyCode,
        location_owned: '1',
        tdn_no: '',
        pin_no: '',
        lessor_name: '',
        monthly_rental: '',
        floor_area: floor,
        area: area,
        no_of_male_employees: parseMoney(r.male),
        no_of_female_employees: parseMoney(r.female),
        no_of_employees_residing_within_the_area: '0',
        no_of_van: '0',
        no_of_truck: '0',
        no_of_motorcycle: '0',
        activity_type: 'MAIN OFFICE'
      });
    }

    // Activity — one per nature part (once per V2 BIN + nature)
    const natures = resolveNatureCode(r.nature);
    if (!natures.length) natures.push({ nature: r.nature || 'UNKNOWN', code: '' });
    natures.forEach(n => {
      const actKey = v2Bin + '|' + normKey(n.nature) + '|' + n.code;
      if (seenActivity.has(actKey)) return;
      seenActivity.add(actKey);
      if (!n.code) gaps.push({ table: 'Business Activity', row: srcRow, field: 'business_line_code', value: n.nature, issue: 'Nature not matched in Business Natures' });
      activityCsv.push({
        bin: v2Bin,
        business_line_code: n.code,
        capital_amount: parseMoney(r.capitalBreak || r.capital),
        gross_amount: parseMoney(r.gross),
        gross_amount_essential: parseMoney(r.grossEss),
        gross_amount_nonessential: parseMoney(r.grossNon || r.gross),
        retired_date: ''
      });
    });

    const q = quartersFromMode(r.payMode);
    const amt = parseMoney(r.totalPaid);
    const sur = parseMoney(r.surcharge);
    const int = parseMoney(r.interest);
    const disc = '0';
    const total = String(Number(amt) + Number(sur) + Number(int) - Number(disc));
    const orNo = String(r.orNo || '').replace(/\.0+$/, '');
    applicationCsv.push({
      business_bin: v2Bin,
      application_type: mapAppType(r.appType),
      application_date: parseDateToMDY(r.appDate),
      year: (r.taxYear || '').replace(/\D/g, '').slice(0, 4),
      qtr_from: q.from,
      qtr_to: q.to,
      amount: amt,
      discount: disc,
      surcharge: sur,
      interest: int,
      total: total,
      issued_date: parseDateToMDY(r.issued || r.appDate),
      valid_until: parseDateToMDY(r.validUntil),
      or_no: orNo,
      or_date: parseDateToMDY(r.orDate || r.appDate),
      permit_no: r.permitNo,
      barangay_clearance_number: '',
      business_plate_number: r.plate,
      mode_of_payment: mapPaymentMode(r.online)
    });
    if (orNo) appByOr.set(normKey(orNo), { v2Bin, year: (r.taxYear || '').replace(/\D/g, '').slice(0, 4), q });
  });

  // Fees from Abstract
  const feeSkip = new Set(['date', 'o.r. number', 'or number', 'business identification no.', 'business identification no', 'name of tax payer', 'business name', 'interest', 'surcharge', 'total']);
  const orsWithFees = new Set();

  abstractRows.forEach((row, idx) => {
    const orNo = getCell(row, 'O.R. Number', 'OR Number').replace(/\.0+$/, '');
    const v1Bin = getCell(row, 'Business Identification No.', 'Business Identification No');
    const app = appByOr.get(normKey(orNo));
    let v2Bin = app ? app.v2Bin : (v1ToV2.get(normKey(v1Bin)) || '');
    if (!v2Bin) {
      gaps.push({ table: 'Application Fee', row: idx + 7, field: 'business_bin', value: v1Bin + ' / OR ' + orNo, issue: 'Could not map Abstract row to V2 BIN' });
      return;
    }
    const year = app ? app.year : '';
    const q = app ? app.q : { from: '1', to: '4' };
    let any = false;
    Object.keys(row).forEach(col => {
      if (feeSkip.has(normKey(col))) return;
      const amt = parseMoney(row[col]);
      if (!amt || Number(amt) === 0) return;
      any = true;
      feeCsv.push({
        business_bin: v2Bin,
        application_or_no: orNo,
        code: slugCode(col, 20),
        description: String(col).slice(0, 100),
        amount: amt,
        discount: '0',
        Interest: '0',
        Surcharge: '0',
        total: amt,
        type: mapFeeType(col),
        qtr_from: q.from,
        qtr_to: q.to,
        year: year
      });
    });
    if (any) orsWithFees.add(normKey(orNo));
  });

  // TOTAL fallback for apps without Abstract fees
  applicationCsv.forEach((app, i) => {
    if (orsWithFees.has(normKey(app.or_no))) return;
    feeCsv.push({
      business_bin: app.business_bin,
      application_or_no: app.or_no,
      code: 'TOTAL',
      description: 'Migrated total amount paid',
      amount: app.amount,
      discount: '0',
      Interest: app.interest,
      Surcharge: app.surcharge,
      total: app.total,
      type: 'OTHER',
      qtr_from: app.qtr_from,
      qtr_to: app.qtr_to,
      year: app.year
    });
    gaps.push({ table: 'Application Fee', row: i + 1, field: 'application_or_no', value: app.or_no, issue: 'No Abstract match — emitted TOTAL fallback row' });
  });

  lastExport = { businessCsv, activityCsv, applicationCsv, feeCsv, gaps, binMap };
  return lastExport;
}

function toCsv(rows, headers) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(',')));
  return lines.join('\r\n');
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function sheetToObjects(workbook, preferredSheet) {
  const name = preferredSheet && workbook.SheetNames.includes(preferredSheet)
    ? preferredSheet
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function findHeaderRow(aoa, mustInclude) {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i].map(c => String(c || '').trim().toLowerCase());
    if (mustInclude.every(m => row.some(c => c.includes(m)))) return i;
  }
  return 0;
}

function abstractToObjects(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const hdr = findHeaderRow(aoa, ['o.r', 'business']);
  const headers = aoa[hdr].map(h => String(h || '').trim());
  const rows = [];
  for (let r = hdr + 1; r < aoa.length; r++) {
    const line = aoa[r];
    if (!line || !line.some(c => String(c || '').trim())) continue;
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = line[i]; });
    rows.push(obj);
  }
  return rows;
}
